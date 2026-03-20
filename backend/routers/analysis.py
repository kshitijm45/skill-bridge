"""
Analysis endpoint — runs gap analysis for a profile against its target role.
Tries Claude first; falls back to keyword matcher automatically on any failure.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Form, UploadFile, File
from typing import Optional
from models import AnalysisResult
import database as db
from auth import get_current_user_id
from routers.profiles import _row_to_profile
from services.ai_service import run_ai_analysis, run_ai_suggest_roles, AIServiceError
from services.fallback_service import (
    run_fallback_analysis, run_fallback_suggest_roles,
    _load_taxonomy, _load_job_descriptions, extract_skills_from_text, get_required_skills_for_role,
)

router = APIRouter(prefix="/analyze", tags=["Analysis"])


@router.post("/suggest-roles")
async def suggest_roles_endpoint(
    resume_text: Optional[str] = Form(None),
    resume_file: Optional[UploadFile] = File(None),
    current_career: str = Form(""),
    user_id: str = Depends(get_current_user_id),
):
    """
    Given a resume, suggest the top 3-4 best-fit roles from our JD pool.
    Uses Gemini for semantic matching; falls back to keyword scoring.
    """
    from services.resume_parser import parse_resume

    if resume_file:
        file_bytes = await resume_file.read()
        text = parse_resume(file_bytes, resume_file.filename)
    elif resume_text and resume_text.strip():
        text = resume_text.strip()
    else:
        raise HTTPException(status_code=422, detail="Please provide a resume.")

    jds = _load_job_descriptions()
    taxonomy = _load_taxonomy()

    # Aggregate required skills per role across all JDs
    roles_data: dict = {}
    for jd in jds:
        role = jd["role"]
        if role not in roles_data:
            roles_data[role] = set()
        roles_data[role].update(jd["required_skills"])
    roles_data = {k: list(v) for k, v in roles_data.items()}

    try:
        suggestions = await run_ai_suggest_roles(text, roles_data, current_career)
    except AIServiceError:
        suggestions = run_fallback_suggest_roles(text, roles_data, taxonomy)

    # Filter out any suggestion that matches the user's current career
    if current_career.strip():
        current_lower = current_career.strip().lower()
        suggestions = [
            s for s in suggestions
            if current_lower not in s["role"].lower() and s["role"].lower() not in current_lower
        ]

    return {"suggestions": suggestions}


@router.post("/{profile_id}", response_model=AnalysisResult)
async def analyze_profile(
    profile_id: int,
    force_fallback: bool = Query(default=False),
    user_id: str = Depends(get_current_user_id),
):
    """
    Run gap analysis for the given profile.

    Flow:
      1. Load profile from DB
      2. Try Claude (ai_service) — 10s timeout
      3. On AIServiceError → fall back to keyword matcher (fallback_service)
      4. Return AnalysisResult with source="ai" or source="fallback"
    """
    row = db.get_profile(profile_id, user_id=user_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")

    profile = _row_to_profile(row)
    skill_statuses = {k: v.value for k, v in profile.skill_statuses.items()}

    if force_fallback:
        result_data = run_fallback_analysis(
            resume_text=profile.resume_text,
            target_role=profile.target_role,
            audience_mode=profile.audience_mode.value,
            skill_statuses=skill_statuses,
        )
    else:
        try:
            result_data = await run_ai_analysis(
                resume_text=profile.resume_text,
                target_role=profile.target_role,
                audience_mode=profile.audience_mode.value,
                skill_statuses=skill_statuses,
                current_career=profile.current_career or "",
            )
        except AIServiceError:
            result_data = run_fallback_analysis(
                resume_text=profile.resume_text,
                target_role=profile.target_role,
                audience_mode=profile.audience_mode.value,
                skill_statuses=skill_statuses,
            )

    final_result = AnalysisResult(
        profile_id=profile_id,
        target_role=profile.target_role,
        **result_data,
    )
    # Cache so the mentor shared view serves identical data to what the student sees
    db.save_analysis_result(profile_id, final_result.model_dump_json(), user_id=user_id)
    return final_result


@router.post("/{profile_id}/compare", response_model=dict)
async def compare_ai_vs_fallback(profile_id: int, user_id: str = Depends(get_current_user_id)):
    """
    Run BOTH AI and fallback on the same profile and return both results.
    Used by the 'Compare AI vs Fallback' toggle in the UI — shows the
    difference between the two approaches for transparency.
    """
    row = db.get_profile(profile_id, user_id=user_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")

    profile = _row_to_profile(row)
    skill_statuses = {k: v.value for k, v in profile.skill_statuses.items()}

    # Always run fallback
    fallback_result = run_fallback_analysis(
        resume_text=profile.resume_text,
        target_role=profile.target_role,
        audience_mode=profile.audience_mode.value,
        skill_statuses=skill_statuses,
    )

    # Attempt AI — if it fails, return only fallback with a note
    ai_result = None
    ai_error = None
    try:
        ai_result = await run_ai_analysis(
            resume_text=profile.resume_text,
            target_role=profile.target_role,
            audience_mode=profile.audience_mode.value,
            skill_statuses=skill_statuses,
        )
    except AIServiceError as e:
        ai_error = str(e)

    return {
        "ai": ai_result,
        "fallback": {
            "match_percent": fallback_result["match_percent"],
            "skills_present": fallback_result["skills_present"],
            "skill_gaps": [g.skill for g in fallback_result["skill_gaps"]],
            "career_snapshot": fallback_result["career_snapshot"],
            "source": "fallback",
        },
        "ai_available": ai_result is not None,
        "ai_error": ai_error,
    }


@router.get("/{profile_id}/sprint")
def sprint_plan(
    profile_id: int,
    weeks: int = Query(default=8, ge=1, le=52),
    base_match: Optional[int] = Query(default=None, ge=0, le=100),
    ai_gap_skills: Optional[str] = Query(default=None),  # comma-separated AI-identified gaps
    weeks_overrides: Optional[str] = Query(default=None),  # proficiency-adjusted weeks e.g. "Python:5,Linux:2"
    user_id: str = Depends(get_current_user_id),
):
    """
    Time-bounded sprint planner.

    Given a week budget, returns the optimal subset of skill gaps to close
    that maximises match% gain per week invested (greedy knapsack).

    Prerequisites are automatically pulled in: if you select a skill whose
    prereq is also a gap, the prereq is added first and counts against the budget.
    """
    row = db.get_profile(profile_id, user_id=user_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")

    profile = _row_to_profile(row)
    taxonomy = _load_taxonomy()
    jds = _load_job_descriptions()

    required_skills, jd_count = get_required_skills_for_role(profile.target_role, jds)

    if not required_skills:
        return {"sprint_skills": [], "weeks_used": 0, "weeks_budget": weeks,
                "current_match": 0, "sprint_match": 0, "skipped_skills": []}

    # Prefer AI-identified gaps over re-computing from keyword matching.
    # This ensures skills like "Git" that the AI flagged aren't accidentally
    # excluded because the resume text contains "GitHub".
    if ai_gap_skills:
        passed_gaps = [s.strip() for s in ai_gap_skills.split(",") if s.strip()]
        # Keep only gaps that exist in our taxonomy (so we have metadata for them)
        gap_skills = [s for s in passed_gaps if s in taxonomy]
        # total_required = all required skills for the role (for % math)
        total_required = len(required_skills)
    else:
        skills_present = extract_skills_from_text(profile.resume_text, taxonomy)
        gap_skills = [s for s in required_skills if s not in skills_present]
        total_required = len(required_skills)
    # Use AI-computed match% if caller provides it; otherwise fall back to keyword count
    if base_match is not None:
        current_match = base_match
    else:
        current_match = round((total_required - len(gap_skills)) / total_required * 100)

    # Parse proficiency-adjusted week overrides from frontend
    parsed_overrides: dict[str, int] = {}
    if weeks_overrides:
        for part in weeks_overrides.split(","):
            if ":" in part:
                s, w_str = part.split(":", 1)
                try:
                    parsed_overrides[s.strip()] = max(1, int(w_str.strip()))
                except ValueError:
                    pass

    # Score each gap: efficiency = (1 match point gained) / weeks_to_learn
    # Higher = more bang per week
    gap_meta = {}
    for skill in gap_skills:
        meta = taxonomy.get(skill, {})
        w = parsed_overrides.get(skill) or meta.get("weeks_to_learn", 4)
        gap_meta[skill] = {
            "weeks": w,
            "efficiency": round(1 / w, 4),
            "category": meta.get("category", "General"),
            "trend": meta.get("trend", "stable"),
            "prerequisites": meta.get("prerequisites", []),
        }

    # Sort by efficiency descending
    ranked = sorted(gap_skills, key=lambda s: gap_meta[s]["efficiency"], reverse=True)

    selected: list[str] = []
    weeks_used = 0

    def add_skill(skill: str) -> bool:
        """Add skill + any missing prereqs. Returns False if doesn't fit."""
        nonlocal weeks_used
        if skill in selected:
            return True
        # Pull in prerequisite gaps first (recursively)
        for prereq in gap_meta.get(skill, {}).get("prerequisites", []):
            if prereq in gap_meta and prereq not in selected:
                if not add_skill(prereq):
                    return False  # prereq alone doesn't fit — skip whole chain
        skill_weeks = gap_meta[skill]["weeks"]
        if weeks_used + skill_weeks <= weeks:
            selected.append(skill)
            weeks_used += skill_weeks
            return True
        return False

    for skill in ranked:
        if weeks_used >= weeks:
            break
        add_skill(skill)

    skipped = [s for s in gap_skills if s not in selected]
    sprint_gain = round(len(selected) / total_required * 100)
    sprint_match = min(100, current_match + sprint_gain)

    return {
        "weeks_budget": weeks,
        "weeks_used": weeks_used,
        "current_match": current_match,
        "sprint_match": sprint_match,
        "match_gain": sprint_match - current_match,
        "jd_count": jd_count,
        "sprint_skills": [
            {
                "skill": s,
                "weeks": gap_meta[s]["weeks"],
                "category": gap_meta[s]["category"],
                "trend": gap_meta[s]["trend"],
                "efficiency_score": gap_meta[s]["efficiency"],
            }
            for s in selected
        ],
        "skipped_skills": [
            {"skill": s, "weeks": gap_meta[s]["weeks"]}
            for s in skipped
        ],
    }

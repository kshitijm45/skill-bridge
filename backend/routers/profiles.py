"""
Profile endpoints — Create, View, Update.
Handles both file upload (PDF/DOCX) and plain text resume input.
All endpoints are scoped to the authenticated user (Clerk JWT).
"""

import json
import secrets
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import Optional
from models import Profile, ProfileUpdate, AudienceMode, SkillStatus, AnalysisResult
import database as db
from auth import get_current_user_id
from services.resume_parser import parse_resume

router = APIRouter(prefix="/profiles", tags=["Profiles"])


@router.post("/", response_model=Profile, status_code=201)
async def create_profile(
    target_role: str = Form(...),
    name: Optional[str] = Form(None),
    current_career: Optional[str] = Form(None),
    audience_mode: AudienceMode = Form(AudienceMode.graduate),
    resume_text: Optional[str] = Form(None),
    resume_file: Optional[UploadFile] = File(None),
    user_id: str = Depends(get_current_user_id),
):
    if resume_file:
        file_bytes = await resume_file.read()
        parsed_text = parse_resume(file_bytes, resume_file.filename)
    elif resume_text and resume_text.strip():
        parsed_text = resume_text.strip()
    else:
        raise HTTPException(
            status_code=422,
            detail="Please provide a resume — either upload a PDF/DOCX file or paste your resume text."
        )

    if len(parsed_text) < 20:
        raise HTTPException(
            status_code=422,
            detail="Resume text is too short to analyze. Please provide more detail."
        )
    if not target_role.strip():
        raise HTTPException(status_code=422, detail="Please select a target role.")

    profile_id = db.create_profile(
        name=(name.strip() if name else target_role.strip()),
        resume_text=parsed_text,
        target_role=target_role.strip(),
        audience_mode=audience_mode.value,
        user_id=user_id,
        current_career=current_career.strip() if current_career else None,
    )
    return _row_to_profile(db.get_profile(profile_id, user_id))


@router.get("/", response_model=list[Profile])
def list_profiles(user_id: str = Depends(get_current_user_id)):
    """Return all profiles belonging to the authenticated user."""
    rows = db.list_profiles(user_id=user_id)
    return [_row_to_profile(r) for r in rows]


@router.get("/shared/{code}")
def get_shared_view(code: str):
    """
    Public endpoint — no auth required.
    Returns profile metadata + the student's cached analysis result (same data they see).
    Falls back to rule-based analysis if the student hasn't run analysis yet.
    """
    row = db.get_profile_by_share_code(code.upper())
    if not row:
        raise HTTPException(status_code=404, detail="Share code not found or expired.")

    profile = _row_to_profile(row)
    skill_statuses = {k: v.value for k, v in profile.skill_statuses.items()}

    # Use the cached AI result if available — this is exactly what the student sees
    if row["cached_result"]:
        result = AnalysisResult.model_validate_json(row["cached_result"])
        # Refresh skill_statuses from DB so mentor sees up-to-date progress
        result = result.model_copy(update={
            "skill_gaps": [
                g.model_copy(update={"status": skill_statuses.get(g.skill, g.status)})
                for g in result.skill_gaps
            ]
        })
    else:
        from services.fallback_service import run_fallback_analysis
        result_data = run_fallback_analysis(
            resume_text=row["resume_text"],
            target_role=profile.target_role,
            audience_mode=profile.audience_mode.value,
            skill_statuses=skill_statuses,
        )
        result = AnalysisResult(
            profile_id=profile.id,
            target_role=profile.target_role,
            **result_data,
        )

    return {
        "profile": {
            "id": profile.id,
            "name": profile.name,
            "target_role": profile.target_role,
            "audience_mode": profile.audience_mode.value,
            "skill_statuses": skill_statuses,
        },
        "result": result,
    }


@router.get("/{profile_id}", response_model=Profile)
def get_profile(profile_id: int, user_id: str = Depends(get_current_user_id)):
    row = db.get_profile(profile_id, user_id=user_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")
    return _row_to_profile(row)


@router.patch("/{profile_id}/skill", response_model=Profile)
def update_skill_status(
    profile_id: int,
    update: ProfileUpdate,
    user_id: str = Depends(get_current_user_id),
):
    success = db.update_skill_status(profile_id, update.skill, update.status.value, user_id=user_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")
    return _row_to_profile(db.get_profile(profile_id, user_id=user_id))


@router.post("/{profile_id}/share")
def generate_share_code(profile_id: int, user_id: str = Depends(get_current_user_id)):
    """Generate a 6-character share code for the mentor read-only view."""
    row = db.get_profile(profile_id, user_id=user_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")
    code = secrets.token_hex(3).upper()  # 6 hex chars, e.g. "A3F8C2"
    db.set_share_code(profile_id, code, user_id)
    return {"code": code}


@router.delete("/{profile_id}/share", status_code=204)
def revoke_share_code(profile_id: int, user_id: str = Depends(get_current_user_id)):
    """Revoke the share code — mentor link immediately stops working."""
    success = db.clear_share_code(profile_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")


def _row_to_profile(row) -> Profile:
    return Profile(
        id=row["id"],
        name=row["name"],
        resume_text=row["resume_text"],
        target_role=row["target_role"],
        audience_mode=AudienceMode(row["audience_mode"]),
        current_career=row["current_career"],
        skill_statuses={
            k: SkillStatus(v)
            for k, v in json.loads(row["skill_statuses"]).items()
        },
    )

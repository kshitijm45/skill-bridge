"""
AI analysis service using Google Gemini.
Uses gemini-1.5-flash for speed and cost efficiency in the demo.

Gemini's response_mime_type="application/json" forces structured JSON output
at the API level — no need to strip markdown fences or handle formatting errors.

On any failure (timeout, API error, malformed JSON), raises AIServiceError
so the caller can fall back to fallback_service gracefully.
"""

import json
import os
import re
import asyncio
import google.generativeai as genai
from models import SkillGap, RoadmapStep, TransferableSkill, SkillStatus
from services.fallback_service import (
    _get_resources, get_required_skills_for_role,
    _load_job_descriptions, _load_taxonomy,
)

AI_TIMEOUT_SECONDS = 45
MODEL = "gemini-3.1-flash-lite-preview"


class AIServiceError(Exception):
    """Raised when the AI service fails — triggers fallback in the router."""
    pass


def _build_prompt(
    resume_text: str,
    target_role: str,
    required_skills: list,
    taxonomy: dict,
    audience_mode: str,
    current_career: str = "",
) -> str:
    relevant_skills = set(required_skills)
    taxonomy_subset = {k: v for k, v in taxonomy.items() if k in relevant_skills}

    career_context = f"CAREER TRANSITION: {current_career} → {target_role}\n" if current_career else ""

    return f"""You are an expert career gap analyst. Read the resume carefully and use semantic reasoning — not just keyword matching — to assess which skills the candidate has demonstrated, implied, or is clearly missing.

RESUME:
{resume_text}

TARGET ROLE: {target_role}
{career_context}
REQUIRED SKILLS FOR THIS ROLE: {json.dumps(required_skills)}
SKILL TAXONOMY (name, prerequisites, category, trend, weeks_to_learn): {json.dumps(taxonomy_subset, indent=2)}
AUDIENCE MODE: {audience_mode}

Return a JSON object with this exact structure:
{{
  "skills_present": ["skill1", "skill2"],
  "skill_gaps": [
    {{
      "skill": "SkillName",
      "confidence": 0.95,
      "prerequisite_reasoning": "One sentence: cite specific resume evidence (or lack of it) that drove this assessment"
    }}
  ],
  "match_percent": 65,
  "career_snapshot": "2-3 sentences. Reference specific resume details (job titles, projects, years of experience). Mention '{target_role}', a percentage like X%, and a timeframe like N weeks or N months.",
  "ordered_roadmap": [
    {{
      "step": 1,
      "skill": "SkillName",
      "why": "One sentence: explain the learning dependency and why this skill unlocks others"
    }}
  ],
  "transferable_skills": [
    {{
      "existing_skill": "ExistingSkill",
      "maps_to": "TargetSkill",
      "explanation": "Specific explanation of how this candidate's experience with ExistingSkill gives them a head start on TargetSkill"
    }}
  ]
}}

Rules:
- Only use skill names from the SKILL TAXONOMY — no invented skill names
- skills_present: infer semantically. If the resume says "containerized microservices" that implies Docker even without the word. If "automated report generation with Python scripts" that implies Python. Infer from context, projects, job duties.
- skill_gaps: skills from REQUIRED SKILLS that are absent from the resume, ordered so skills with no unmet prerequisites come first
- confidence is 0.0-1.0: 0.9+ = explicitly named, 0.7-0.9 = clearly implied by context, 0.5-0.7 = inferred from adjacent work, below 0.5 = uncertain
- prerequisite_reasoning must cite a specific line or detail from the resume, not a generic statement
- career_snapshot must feel personalized — mention the candidate's actual background, not a template. Must contain '{target_role}', a % figure, and a timeframe.
- transferable_skills: only for audience_mode "switcher". Map the candidate's non-obvious existing strengths to target role skills — focus on skills that transfer across domains, not trivial same-name mappings.
- match_percent = (skills in skills_present that appear in REQUIRED SKILLS / total REQUIRED SKILLS) * 100, rounded to integer"""


def _extract_json_object(text: str) -> "str | None":
    """
    Extract the first complete, balanced JSON object from text.
    Uses brace counting rather than a greedy regex so trailing content
    (thinking tokens, extra whitespace, markdown fences) is excluded.
    """
    start = text.find('{')
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape_next = False
    for i, ch in enumerate(text[start:], start):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _parse_ai_response(
    raw_text: str,
    target_role: str,
    taxonomy: dict,
    skill_statuses: dict,
    audience_mode: str,
    jd_count: int,
) -> dict:
    """
    Parse Gemini's JSON response into the AnalysisResult shape.
    Raises AIServiceError if JSON is malformed or missing required fields.
    """
    # Strip markdown fences and leading/trailing whitespace
    cleaned = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Gemini 2.5 Flash thinking tokens or preamble text — extract first balanced JSON object
        extracted = _extract_json_object(cleaned)
        if not extracted:
            raise AIServiceError("Gemini returned no parseable JSON object")
        try:
            data = json.loads(extracted)
        except json.JSONDecodeError as e:
            raise AIServiceError(f"Gemini returned invalid JSON: {e}")

    required_keys = ["skills_present", "skill_gaps", "match_percent", "career_snapshot", "ordered_roadmap"]
    missing = [k for k in required_keys if k not in data]
    if missing:
        raise AIServiceError(f"Gemini response missing fields: {missing}")

    # Validate career_snapshot structure
    snapshot = data.get("career_snapshot", "")
    has_percent = bool(re.search(r'\d+%', snapshot))
    has_timeframe = bool(re.search(r'\d+\s*(week|month)', snapshot, re.IGNORECASE))
    has_role = target_role.lower() in snapshot.lower()
    if not (has_percent and has_timeframe and has_role):
        raise AIServiceError(
            f"career_snapshot missing required elements (role name, %, timeframe). Got: '{snapshot[:100]}'"
        )

    # Build SkillGap objects
    skill_gaps = []
    for gap_data in data.get("skill_gaps", []):
        skill = gap_data.get("skill", "")
        meta = taxonomy.get(skill, {})
        current_status = skill_statuses.get(skill, "not_started")
        skill_gaps.append(SkillGap(
            skill=skill,
            category=meta.get("category", "General"),
            trend=meta.get("trend", "stable"),
            confidence=float(gap_data.get("confidence", 0.8)),
            weeks_to_learn=meta.get("weeks_to_learn", 4),
            prerequisites=meta.get("prerequisites", []),
            status=SkillStatus(current_status),
            prerequisite_reasoning=gap_data.get("prerequisite_reasoning", ""),
        ))

    # Build RoadmapStep objects — always use our curated resources, not AI-generated URLs
    roadmap = []
    for step_data in data.get("ordered_roadmap", []):
        skill = step_data.get("skill", "")
        meta = taxonomy.get(skill, {})
        roadmap.append(RoadmapStep(
            step=step_data.get("step", len(roadmap) + 1),
            skill=skill,
            weeks=meta.get("weeks_to_learn", 4),
            category=meta.get("category", "General"),
            resources=_get_resources(skill),
            why=step_data.get("why", ""),
        ))

    # Build TransferableSkill objects
    transferable = [
        TransferableSkill(
            existing_skill=t.get("existing_skill", ""),
            maps_to=t.get("maps_to", ""),
            explanation=t.get("explanation", ""),
        )
        for t in data.get("transferable_skills", [])
    ]

    total_weeks = sum(s.weeks_to_learn for s in skill_gaps[:5])
    time_to_hire = total_weeks if audience_mode == "graduate" else None

    priority_next_step = (
        f"Start with '{skill_gaps[0].skill}' — {skill_gaps[0].weeks_to_learn} weeks, "
        f"check prerequisites first."
        if skill_gaps
        else "You meet all the core requirements for this role!"
    )

    return {
        "match_percent": int(data["match_percent"]),
        "skills_present": data["skills_present"],
        "skill_gaps": skill_gaps,
        "ordered_roadmap": roadmap,
        "career_snapshot": snapshot,
        "transferable_skills": transferable,
        "source": "ai",
        "stats": {
            "skills_extracted": len(data["skills_present"]),
            "jds_matched": jd_count,
            "coverage_percent": round(len(data.get("skill_gaps", [])) / max(len(taxonomy), 1) * 100),
        },
        "time_to_hire_ready_weeks": time_to_hire,
        "priority_next_step": priority_next_step,
    }


def _build_suggest_prompt(resume_text: str, roles_data: dict, current_career: str = "") -> str:
    career_line = f"Current career background: {current_career}\n\n" if current_career else ""
    roles_json = json.dumps(roles_data, indent=2)
    return f"""You are an expert tech career counselor helping someone find the best-fit role from a specific set of options.

RESUME:
{resume_text}

{career_line}AVAILABLE ROLES AND THEIR REQUIRED SKILLS:
{roles_json}

Analyze the candidate's background semantically — infer skills from projects, job duties, and context, not just keywords. Rank the top 3-4 roles by best fit.

Return a JSON object with this exact structure:
{{
  "suggestions": [
    {{
      "role": "Cloud Security Engineer",
      "match_percent": 45,
      "fit_reasoning": "2 sentences citing specific resume evidence — job titles, projects, or skills that make this role a good fit.",
      "transferable_skills": ["Python", "Linux"],
      "primary_gap": "SIEM Tools",
      "weeks_to_bridge": 18
    }}
  ]
}}

Rules:
- Return exactly 3 or 4 suggestions, ranked best-fit first
- Only use role names exactly as they appear in AVAILABLE ROLES
- match_percent = fraction of required_skills the candidate demonstrably has (including semantically implied), * 100, rounded to integer
- fit_reasoning must reference specific resume details — not generic praise. Mention actual job titles, projects, or skills.
- transferable_skills: list of skills from the role's required list that the candidate already has or clearly implies
- primary_gap: the single most critical missing skill for that role (exact name from the role's required list)
- weeks_to_bridge: realistic total weeks to close all skill gaps (sum of typical learning durations)"""


async def run_ai_suggest_roles(
    resume_text: str,
    roles_data: dict,
    current_career: str = "",
) -> list:
    """Ask Gemini to rank best-fit roles for this candidate. Raises AIServiceError on failure."""
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise AIServiceError("GEMINI_API_KEY not set")

    prompt = _build_suggest_prompt(resume_text, roles_data, current_career)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=MODEL,
        system_instruction=(
            "You are a precise career analysis assistant. "
            "Always respond with valid JSON only. No explanation, no markdown."
        ),
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.3,
            max_output_tokens=2048,
        ),
    )

    def _call():
        return model.generate_content(prompt).text

    try:
        raw_text = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _call),
            timeout=AI_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise AIServiceError(f"Gemini timed out after {AI_TIMEOUT_SECONDS}s")
    except Exception as e:
        raise AIServiceError(f"Gemini API error: {e}")

    cleaned = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        extracted = _extract_json_object(cleaned)
        if not extracted:
            raise AIServiceError("Gemini returned no parseable JSON")
        try:
            data = json.loads(extracted)
        except json.JSONDecodeError as e:
            raise AIServiceError(f"Gemini returned invalid JSON: {e}")

    if "suggestions" not in data:
        raise AIServiceError("Gemini response missing 'suggestions' field")

    return data["suggestions"]


async def run_ai_analysis(
    resume_text: str,
    target_role: str,
    audience_mode: str,
    skill_statuses: dict,
    current_career: str = "",
) -> dict:
    """
    Run Gemini analysis. Raises AIServiceError on any failure.
    Caller catches AIServiceError and falls back to fallback_service.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise AIServiceError("GEMINI_API_KEY not set — using fallback")

    taxonomy = _load_taxonomy()
    jds = _load_job_descriptions()
    required_skills, jd_count = get_required_skills_for_role(target_role, jds)

    prompt = _build_prompt(resume_text, target_role, required_skills, taxonomy, audience_mode, current_career)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=MODEL,
        system_instruction=(
            "You are a precise career analysis assistant. "
            "Always respond with valid JSON only. No explanation, no markdown."
        ),
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",  # forces JSON output at API level
            temperature=0.3,
            max_output_tokens=4096,
        ),
    )

    def _call_gemini():
        response = model.generate_content(prompt)
        return response.text

    try:
        raw_text = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _call_gemini),
            timeout=AI_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise AIServiceError(f"Gemini API timed out after {AI_TIMEOUT_SECONDS}s")
    except Exception as e:
        raise AIServiceError(f"Gemini API error: {e}")

    return _parse_ai_response(raw_text, target_role, taxonomy, skill_statuses, audience_mode, jd_count)

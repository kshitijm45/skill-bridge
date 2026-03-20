from pydantic import BaseModel, field_validator
from typing import Optional
from enum import Enum


class AudienceMode(str, Enum):
    graduate = "graduate"
    switcher = "switcher"
    mentor = "mentor"


class SkillStatus(str, Enum):
    not_started = "not_started"
    learning = "learning"
    completed = "completed"


# --- Request / Input models ---

class ProfileCreate(BaseModel):
    name: str
    resume_text: str
    target_role: str
    audience_mode: AudienceMode = AudienceMode.graduate

    @field_validator("resume_text")
    @classmethod
    def resume_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Please provide resume content")
        if len(v.strip()) < 20:
            raise ValueError("Resume text is too short to analyze")
        return v.strip()

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class ProfileUpdate(BaseModel):
    skill: str
    status: SkillStatus


# --- Response / Output models ---

class SkillGap(BaseModel):
    skill: str
    category: str
    trend: str
    confidence: float          # 0.0–1.0, from AI; 1.0 for fallback (deterministic)
    weeks_to_learn: int
    prerequisites: list[str]
    status: SkillStatus = SkillStatus.not_started
    prerequisite_reasoning: str = ""  # shown in tooltip: "appeared in 2 of 3 JDs but not in your resume"


class Resource(BaseModel):
    name: str
    url: str


class RoadmapStep(BaseModel):
    step: int
    skill: str
    weeks: int
    category: str
    resources: list[Resource]
    why: str                   # "How did AI reach this?" tooltip content


class TransferableSkill(BaseModel):
    existing_skill: str
    maps_to: str
    explanation: str


class Profile(BaseModel):
    id: int
    name: str
    resume_text: str
    target_role: str
    audience_mode: AudienceMode
    current_career: Optional[str] = None
    skill_statuses: dict[str, SkillStatus] = {}


class RoleSuggestion(BaseModel):
    role: str
    match_percent: int
    fit_reasoning: str
    transferable_skills: list[str]
    primary_gap: str
    weeks_to_bridge: int


class AnalysisResult(BaseModel):
    profile_id: int
    target_role: str
    match_percent: int
    skills_present: list[str]
    skill_gaps: list[SkillGap]
    ordered_roadmap: list[RoadmapStep]
    career_snapshot: str
    transferable_skills: list[TransferableSkill]
    source: str                          # "ai" or "fallback"
    stats: dict                          # {"skills_extracted": 8, "jds_matched": 3}
    time_to_hire_ready_weeks: Optional[int] = None   # graduate mode only
    priority_next_step: str = ""         # always one specific action

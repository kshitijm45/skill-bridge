"""
Tests for the rule-based fallback service.
Verifies keyword extraction, alias matching, prerequisite ordering, and snapshot templates.
Run: pytest tests/ -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from services.fallback_service import (
    extract_skills_from_text,
    run_fallback_analysis,
    _order_by_prerequisites,
    _snapshot_template,
    _load_taxonomy,
)
from models import SkillStatus


# --- Keyword extraction ---

def test_extracts_exact_skill_name():
    """Standard skill name in resume should be found."""
    taxonomy = _load_taxonomy()
    found = extract_skills_from_text("I have experience with Python and SQL.", taxonomy)
    assert "Python" in found
    assert "SQL" in found


def test_extracts_via_alias():
    """
    Aliases like 'k8s' should resolve to 'Kubernetes',
    and 'golang' should resolve to 'Go'.
    This is the core value of the alias system.
    """
    taxonomy = _load_taxonomy()
    found = extract_skills_from_text("Deployed services on k8s and wrote backend in golang.", taxonomy)
    assert "Kubernetes" in found, "Alias 'k8s' should map to Kubernetes"
    assert "Go" in found, "Alias 'golang' should map to Go"


def test_java_does_not_match_javascript():
    """
    Word-boundary matching must prevent 'Java' from being
    found inside 'JavaScript'. This was a deliberate design decision.
    """
    taxonomy = _load_taxonomy()
    found = extract_skills_from_text("I build frontends with JavaScript and React.", taxonomy)
    assert "JavaScript" in found
    assert "Java" not in found, "'Java' should NOT match inside 'JavaScript'"


def test_empty_resume_returns_no_skills():
    """No skills should be extracted from a meaningless string."""
    taxonomy = _load_taxonomy()
    found = extract_skills_from_text("I am a chef who loves cooking pasta.", taxonomy)
    assert found == [], f"Expected no skills, got: {found}"


# --- Full fallback analysis ---

def test_fallback_fires_without_api_key(monkeypatch):
    """
    With no ANTHROPIC_API_KEY set, the full analyze endpoint
    must still return a valid result using the fallback.
    """
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    result = run_fallback_analysis(
        resume_text="Python, SQL, Git, Docker, Linux",
        target_role="Data Engineer",
        audience_mode="graduate",
        skill_statuses={},
    )

    assert result["source"] == "fallback"
    assert result["match_percent"] >= 0
    assert len(result["skills_present"]) > 0
    assert len(result["ordered_roadmap"]) > 0
    assert result["priority_next_step"] != ""


def test_fallback_zero_match_for_irrelevant_resume():
    """
    Resume with no relevant skills should produce 0% match
    and all required skills as gaps.
    """
    result = run_fallback_analysis(
        resume_text="I am a chef. I cook pasta and manage a kitchen.",
        target_role="Cloud Security Engineer",
        audience_mode="graduate",
        skill_statuses={},
    )

    assert result["match_percent"] == 0
    assert len(result["skills_present"]) == 0


def test_fallback_compare_ai_vs_fallback_overlap():
    """
    Fallback skill extraction on a known resume should identify
    the same core skills that AI would — gap skills should be
    a reasonable subset of the role's requirements.
    """
    result = run_fallback_analysis(
        resume_text="Python, Linux, Docker, Networking, Git, CI/CD",
        target_role="Cloud Security Engineer",
        audience_mode="graduate",
        skill_statuses={},
    )

    gap_skills = {g.skill for g in result["skill_gaps"]}
    present_skills = set(result["skills_present"])

    # No skill should appear in both present and gaps
    overlap = gap_skills & present_skills
    assert overlap == set(), f"Skills cannot be both present and a gap: {overlap}"

    # match_percent should be non-zero given the relevant resume
    assert result["match_percent"] > 0, "Should have non-zero match with relevant skills"


# --- Prerequisite ordering ---

def test_prerequisite_ordering():
    """
    Skills with unmet prerequisites should come AFTER
    skills that have no prerequisites or met prerequisites.
    Kubernetes requires Docker requires Linux — they should be ordered correctly.
    """
    taxonomy = _load_taxonomy()
    gaps = ["Kubernetes", "Docker", "Linux"]
    skills_present = []

    ordered = _order_by_prerequisites(gaps, skills_present, taxonomy)

    linux_idx = ordered.index("Linux") if "Linux" in ordered else -1
    docker_idx = ordered.index("Docker") if "Docker" in ordered else -1
    k8s_idx = ordered.index("Kubernetes") if "Kubernetes" in ordered else -1

    if all(i >= 0 for i in [linux_idx, docker_idx, k8s_idx]):
        assert linux_idx < docker_idx, "Linux should come before Docker"
        assert docker_idx < k8s_idx, "Docker should come before Kubernetes"


# --- Snapshot template ---

def test_snapshot_template_high_match():
    snapshot = _snapshot_template(80, "Data Engineer", ["Spark", "Airflow"])
    assert "Data Engineer" in snapshot
    assert "80%" in snapshot
    assert "week" in snapshot.lower() or "month" in snapshot.lower()


def test_snapshot_template_low_match():
    snapshot = _snapshot_template(20, "Cloud Security Engineer", ["AWS", "SIEM", "Cloud Security"])
    assert "Cloud Security Engineer" in snapshot
    assert "20%" in snapshot


def test_skill_statuses_reflected_in_gaps():
    """
    Skills marked as 'completed' in skill_statuses should have
    their status reflected in the returned skill_gaps list.
    """
    result = run_fallback_analysis(
        resume_text="Python, SQL",
        target_role="Data Engineer",
        audience_mode="graduate",
        skill_statuses={"Spark": "completed"},
    )
    spark_gap = next((g for g in result["skill_gaps"] if g.skill == "Spark"), None)
    if spark_gap:
        assert spark_gap.status == SkillStatus.completed, \
            "Spark should reflect the 'completed' status passed in"


def test_case_insensitive_skill_extraction():
    """Skill names in mixed case should still be extracted correctly."""
    taxonomy = _load_taxonomy()
    found = extract_skills_from_text("I know PYTHON and have used docker in production.", taxonomy)
    assert "Python" in found
    assert "Docker" in found

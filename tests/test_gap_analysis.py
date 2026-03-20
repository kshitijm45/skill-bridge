"""
Tests for the gap analysis endpoint.
Covers: happy path (clarity of path metric), edge cases, snapshot structure.
Run: pytest tests/ -v
"""

import sys
import os
import re
import importlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(isolated_db):
    """
    Fresh TestClient per test — reloads main so it picks up
    the temp DB path set by the isolated_db fixture.
    """
    import main as main_module
    importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        yield c


def _make_profile(client, resume_text: str, role: str, mode: str = "graduate") -> int:
    """Helper: create a profile via the API, return its id."""
    resp = client.post("/profiles/", data={
        "name": "Test Candidate",
        "target_role": role,
        "audience_mode": mode,
        "resume_text": resume_text,
    })
    assert resp.status_code == 201, f"Profile creation failed: {resp.text}"
    return resp.json()["id"]


# --- Happy path ---

def test_happy_path_clarity_of_path(client):
    """
    A candidate with Python/SQL skills targeting Data Engineer
    should get a non-trivial match, real gaps, and a populated roadmap.
    Verifies the 'Clarity of Path' success metric.
    """
    pid = _make_profile(
        client,
        resume_text="Skills: Python, SQL, Git, Machine Learning. Built data pipelines in Python.",
        role="Data Engineer",
    )
    resp = client.post(f"/analyze/{pid}")
    assert resp.status_code == 200

    data = resp.json()

    # Match percent is meaningful — not 0 and not 100
    assert 0 < data["match_percent"] < 100, "Match percent should reflect partial skill match"

    # Skills were actually extracted
    assert len(data["skills_present"]) > 0, "Should extract at least one skill from resume"
    assert "Python" in data["skills_present"], "Python should be detected"
    assert "SQL" in data["skills_present"], "SQL should be detected"

    # There are real gaps to fill
    assert len(data["skill_gaps"]) > 0, "Should find skill gaps for this role"

    # Clarity of Path: roadmap has at least one step
    assert len(data["ordered_roadmap"]) > 0, "Roadmap must have at least one step"
    assert data["ordered_roadmap"][0]["skill"] != "", "First roadmap step must name a skill"

    # Priority next step is always populated
    assert data["priority_next_step"] != "", "Priority next step must not be empty"

    # Stats are present
    assert data["stats"]["skills_extracted"] > 0
    assert data["stats"]["jds_matched"] > 0


def test_career_snapshot_structure(client):
    """
    The career snapshot must always contain:
    - the target role name
    - a percentage (e.g. 65%)
    - a timeframe (e.g. 3 months or 8 weeks)
    """
    pid = _make_profile(
        client,
        resume_text="Python developer with SQL and Docker experience. Used Git and CI/CD pipelines.",
        role="Data Engineer",
    )
    resp = client.post(f"/analyze/{pid}")
    assert resp.status_code == 200

    snapshot = resp.json()["career_snapshot"]

    assert len(snapshot) >= 50, "Snapshot should be a meaningful sentence, not a stub"
    assert "Data Engineer" in snapshot, f"Snapshot must mention the role name. Got: '{snapshot}'"
    assert re.search(r'\d+%', snapshot), f"Snapshot must contain a percentage. Got: '{snapshot}'"
    assert re.search(r'\d+.{0,3}(week|month)', snapshot, re.IGNORECASE), \
        f"Snapshot must contain a timeframe. Got: '{snapshot}'"


def test_skill_status_update_reruns_analysis(client):
    """
    After marking a gap skill as 'completed', re-running analysis
    should reflect the updated status in the result.
    """
    pid = _make_profile(
        client,
        resume_text="Skills: Python, SQL, Git, Machine Learning. Built data pipelines in Python.",
        role="Data Engineer",
    )

    initial = client.post(f"/analyze/{pid}").json()
    assert len(initial["skill_gaps"]) > 0

    first_gap_skill = initial["skill_gaps"][0]["skill"]
    patch_resp = client.patch(f"/profiles/{pid}/skill", json={
        "skill": first_gap_skill,
        "status": "completed"
    })
    assert patch_resp.status_code == 200

    updated = client.post(f"/analyze/{pid}").json()
    completed_gap = next((g for g in updated["skill_gaps"] if g["skill"] == first_gap_skill), None)
    if completed_gap:
        assert completed_gap["status"] == "completed"


# --- Edge cases ---

def test_empty_resume_returns_422(client):
    """
    Submitting whitespace-only resume must return 422 with a clear error message.
    """
    resp = client.post("/profiles/", data={
        "name": "Empty Resume User",
        "target_role": "Software Engineer",
        "audience_mode": "graduate",
        "resume_text": "   ",
    })
    assert resp.status_code == 422
    detail = resp.json().get("detail", "")
    assert "resume" in str(detail).lower(), \
        f"Error message should mention 'resume'. Got: {detail}"


def test_nonexistent_profile_returns_404(client):
    """Requesting analysis for a profile that doesn't exist should return 404."""
    resp = client.post("/analyze/99999")
    assert resp.status_code == 404


def test_unknown_role_returns_zero_match(client):
    """
    A resume submitted against a role not in our dataset
    should return 0% match without crashing.
    """
    pid = _make_profile(
        client,
        resume_text="Python, SQL, Docker, Linux, and Git experience with backend systems.",
        role="Quantum Physicist",
    )
    # force_fallback avoids non-deterministic AI responses for unknown roles
    resp = client.post(f"/analyze/{pid}?force_fallback=true")
    assert resp.status_code == 200
    assert resp.json()["match_percent"] == 0, "Unknown role should produce 0% match"


def test_short_resume_returns_422(client):
    """Resume under the minimum character threshold should be rejected."""
    resp = client.post("/profiles/", data={
        "name": "Short Resume",
        "target_role": "Data Engineer",
        "audience_mode": "graduate",
        "resume_text": "Hi",
    })
    assert resp.status_code == 422


def test_skill_gap_confidence_fields_present(client):
    """Every skill gap must include a confidence score between 0 and 1."""
    pid = _make_profile(
        client,
        resume_text="Python, SQL, Git experience.",
        role="Data Engineer",
    )
    data = client.post(f"/analyze/{pid}").json()
    for gap in data["skill_gaps"]:
        assert "confidence" in gap, f"Gap '{gap['skill']}' missing confidence field"
        assert 0.0 <= gap["confidence"] <= 1.0, f"Confidence out of range for '{gap['skill']}'"


def test_roadmap_steps_reference_valid_skills(client):
    """Every step in ordered_roadmap must name a skill that exists in skill_gaps or skills_present."""
    pid = _make_profile(
        client,
        resume_text="Python, SQL, Git, Docker experience with backend systems.",
        role="Cloud Security Engineer",
    )
    data = client.post(f"/analyze/{pid}").json()
    all_skills = {g["skill"] for g in data["skill_gaps"]} | set(data["skills_present"])
    for step in data["ordered_roadmap"]:
        assert step["skill"] in all_skills, \
            f"Roadmap step '{step['skill']}' not in gaps or present skills"


def test_force_fallback_returns_fallback_source(client):
    """
    When force_fallback=true is passed, the result must use the
    fallback service regardless of whether the AI key is set.
    """
    pid = _make_profile(
        client,
        resume_text="Python, SQL, Git, Docker experience.",
        role="Data Engineer",
    )
    resp = client.post(f"/analyze/{pid}?force_fallback=true")
    assert resp.status_code == 200
    assert resp.json()["source"] == "fallback", "force_fallback should always return source=fallback"


def test_share_code_generates_and_serves_cached_result(client):
    """
    After running analysis, generating a share code, and fetching the shared view,
    the returned result should match the original analysis (same match_percent and source).
    """
    pid = _make_profile(
        client,
        resume_text="Python, SQL, Git, Docker experience.",
        role="Data Engineer",
    )
    analysis = client.post(f"/analyze/{pid}").json()

    share_resp = client.post(f"/profiles/{pid}/share")
    assert share_resp.status_code == 200
    code = share_resp.json()["code"]

    shared = client.get(f"/profiles/shared/{code}").json()
    assert shared["result"]["match_percent"] == analysis["match_percent"], \
        "Shared view must show same match% as the student's analysis"
    assert shared["result"]["source"] == analysis["source"], \
        "Shared view must use the same source (ai/fallback) as the student's analysis"

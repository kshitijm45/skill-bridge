"""
SQLite database setup and CRUD helpers.
Uses stdlib sqlite3 — no ORM needed at this scale.
Database file: skill_bridge.db (created automatically on first run).
"""

import sqlite3
import json
import os
from contextlib import contextmanager
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "skill_bridge.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row   # rows behave like dicts
    return conn


@contextmanager
def db():
    """Context manager: auto-commits on success, rolls back on error, always closes."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Create tables if they don't exist. Called once at app startup."""
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS profiles (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id        TEXT NOT NULL DEFAULT 'dev_user',
                name           TEXT NOT NULL,
                resume_text    TEXT NOT NULL,
                target_role    TEXT NOT NULL,
                audience_mode  TEXT NOT NULL DEFAULT 'graduate',
                current_career TEXT,
                skill_statuses TEXT NOT NULL DEFAULT '{}',
                share_code     TEXT,
                cached_result  TEXT
            )
        """)
        # Migrate existing DBs
        for migration in [
            "ALTER TABLE profiles ADD COLUMN user_id TEXT NOT NULL DEFAULT 'dev_user'",
            "ALTER TABLE profiles ADD COLUMN current_career TEXT",
            "ALTER TABLE profiles ADD COLUMN share_code TEXT",
            "ALTER TABLE profiles ADD COLUMN cached_result TEXT",
        ]:
            try:
                conn.execute(migration)
            except sqlite3.OperationalError:
                pass  # column already exists


# --- Profile CRUD ---

def create_profile(
    name: str,
    resume_text: str,
    target_role: str,
    audience_mode: str,
    user_id: str = "dev_user",
    current_career: Optional[str] = None,
) -> int:
    """Insert a new profile, return the new row id."""
    with db() as conn:
        cursor = conn.execute(
            "INSERT INTO profiles (user_id, name, resume_text, target_role, audience_mode, current_career) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, name, resume_text, target_role, audience_mode, current_career)
        )
        return cursor.lastrowid


def get_profile(profile_id: int, user_id: Optional[str] = None) -> Optional[sqlite3.Row]:
    """
    Fetch a profile by ID.
    If user_id is provided, only returns the profile if it belongs to that user.
    """
    with db() as conn:
        if user_id:
            return conn.execute(
                "SELECT * FROM profiles WHERE id = ? AND user_id = ?",
                (profile_id, user_id)
            ).fetchone()
        return conn.execute(
            "SELECT * FROM profiles WHERE id = ?", (profile_id,)
        ).fetchone()


def update_skill_status(profile_id: int, skill: str, status: str, user_id: Optional[str] = None) -> bool:
    """
    Update the status of one skill (not_started / learning / completed).
    skill_statuses is stored as a JSON string in SQLite.
    Returns False if profile not found or doesn't belong to user_id.
    """
    with db() as conn:
        query = "SELECT skill_statuses FROM profiles WHERE id = ?"
        params: tuple = (profile_id,)
        if user_id:
            query += " AND user_id = ?"
            params = (profile_id, user_id)

        row = conn.execute(query, params).fetchone()
        if not row:
            return False

        statuses = json.loads(row["skill_statuses"])
        statuses[skill] = status

        conn.execute(
            "UPDATE profiles SET skill_statuses = ? WHERE id = ?",
            (json.dumps(statuses), profile_id)
        )
        return True


def set_share_code(profile_id: int, code: str, user_id: str) -> bool:
    """Set a share code on a profile. Returns False if profile not found / not owned by user."""
    with db() as conn:
        result = conn.execute(
            "UPDATE profiles SET share_code = ? WHERE id = ? AND user_id = ?",
            (code, profile_id, user_id)
        )
        return result.rowcount > 0


def clear_share_code(profile_id: int, user_id: str) -> bool:
    """Remove the share code from a profile."""
    with db() as conn:
        result = conn.execute(
            "UPDATE profiles SET share_code = NULL WHERE id = ? AND user_id = ?",
            (profile_id, user_id)
        )
        return result.rowcount > 0


def get_profile_by_share_code(code: str) -> Optional[sqlite3.Row]:
    """Fetch a profile by its share code (no user_id check — public access)."""
    with db() as conn:
        return conn.execute(
            "SELECT * FROM profiles WHERE share_code = ?", (code,)
        ).fetchone()


def save_analysis_result(profile_id: int, result_json: str, user_id: Optional[str] = None) -> None:
    """Persist the latest analysis result so the mentor view can serve the same data."""
    with db() as conn:
        query = "UPDATE profiles SET cached_result = ? WHERE id = ?"
        params: tuple = (result_json, profile_id)
        if user_id:
            query += " AND user_id = ?"
            params = (result_json, profile_id, user_id)
        conn.execute(query, params)


def list_profiles(user_id: Optional[str] = None) -> list[sqlite3.Row]:
    """
    Return profiles. If user_id is provided, only returns that user's profiles.
    """
    with db() as conn:
        if user_id:
            return conn.execute(
                "SELECT * FROM profiles WHERE user_id = ? ORDER BY id DESC",
                (user_id,)
            ).fetchall()
        return conn.execute("SELECT * FROM profiles ORDER BY id DESC").fetchall()

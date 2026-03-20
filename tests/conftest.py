"""
Pytest configuration: give each test module its own temp SQLite file
so connections share the same database (unlike :memory: which is per-connection).
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """
    Point DB_PATH at a fresh temp file for every test.
    Ensures init_db() and queries all hit the same database.
    load_dotenv() in main.py runs on every reload, so we suppress it
    here by making dotenv a no-op before the client fixture reloads main.
    """
    db_file = str(tmp_path / "test_skill_bridge.db")
    monkeypatch.setenv("DB_PATH", db_file)
    # Prevent load_dotenv() from reinstating the Clerk key during test reloads
    monkeypatch.setenv("CLERK_PUBLISHABLE_KEY", "")

    import importlib
    import database
    importlib.reload(database)
    database.init_db()
    yield

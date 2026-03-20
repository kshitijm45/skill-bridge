"""
Skill-Bridge Career Navigator — FastAPI backend
Run: uvicorn main:app --reload
Docs: http://localhost:8000/docs
"""

import json
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import database as db
from routers import profiles, analysis

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(
    title="Skill-Bridge Career Navigator",
    description="AI-powered career gap analysis for graduates, career switchers, and mentors.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(profiles.router)
app.include_router(analysis.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/roles")
def list_roles():
    """Return all available target roles from the job descriptions dataset."""
    data_path = os.path.join(os.path.dirname(__file__), "data", "job_descriptions.json")
    with open(data_path) as f:
        jds = json.load(f)
    roles = sorted(set(jd["role"] for jd in jds))
    return {"roles": roles}


@app.get("/samples")
def list_sample_resumes():
    """Return sample persona metadata for the 'Load Sample' feature."""
    data_path = os.path.join(os.path.dirname(__file__), "data", "sample_resumes.json")
    with open(data_path) as f:
        samples = json.load(f)
    # Return metadata only — not the full resume text
    return {
        "samples": [
            {
                "id": s["id"],
                "name": s["name"],
                "persona": s["persona"],
                "audience_mode": s["audience_mode"],
                "suggested_roles": s["suggested_roles"],
            }
            for s in samples
        ]
    }


@app.get("/samples/{sample_id}")
def get_sample_resume(sample_id: str):
    """Return full resume text for a sample persona."""
    data_path = os.path.join(os.path.dirname(__file__), "data", "sample_resumes.json")
    with open(data_path) as f:
        samples = json.load(f)
    match = next((s for s in samples if s["id"] == sample_id), None)
    if not match:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not found.")
    return match



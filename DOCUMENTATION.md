# Skill-Bridge — Design Documentation

## 1. Problem & Solution

The problem I wanted to solve is one I've personally run into: you look at a job description, you know you're missing some skills, but you have no idea where to start. Most tools give you a list. That's not enough — a list of 8 missing skills doesn't tell you that you need to learn Linux before Docker before Kubernetes, or that half those skills will come naturally once you've covered two foundational ones.

The core idea behind Skill-Bridge is that the output shouldn't be "here's what you're missing" — it should be "here's what to learn, in this order, given what you already know." For career switchers, the problem is even earlier: they often don't know which role to aim for in the first place. So I made role discovery the starting point for that mode — the tool tells you where your background fits before asking you to commit to a target.

---

## 2. Architecture Overview

```
Browser (React 18 + Vite + TypeScript)
        │  axios / REST  (Clerk JWT in Authorization header)
        ▼
FastAPI (Python 3.9)
  ├── /profiles   — CRUD, skill status updates, share codes
  └── /analyze    — gap analysis, sprint planner, role suggestions
        │
        ├── ai_service.py  ──►  Gemini API (gemini-3.1-flash-lite-preview)
        │                         │  structured JSON prompt
        │                         │  structural validation (role name, %, timeframe)
        │                         │  skill name validation against taxonomy
        │                         └►  reject + fallback on any validation failure
        │
        └── fallback_service.py  ──►  word-boundary keyword regex + aliases
                                       topological sort (prerequisite graph)
                                       deterministic career snapshot template
        │
        SQLite (single file, raw sqlite3, no ORM)
        └── profiles: id, user_id, resume_text, target_role,
                      audience_mode, skill_statuses (JSON), share_code,
                      cached_result (last analysis JSON)
```

### Request flows

| Action | Flow |
|---|---|
| Create profile | `POST /profiles/` → validate resume length → store in SQLite |
| Run analysis | `POST /analyze/{id}` → Gemini (10s timeout) → on fail/timeout → fallback → cache result in `cached_result` column |
| Update skill | `PATCH /profiles/{id}/skill` → merge into `skill_statuses` JSON column |
| Sprint plan | `GET /analyze/{id}/sprint?weeks=8&ai_gap_skills=...&weeks_overrides=...` → greedy knapsack on gap metadata |
| Share with mentor | `POST /profiles/{id}/share` → 6-char hex code → `GET /profiles/shared/{code}` serves `cached_result` directly (no auth, no re-analysis) |
| Role discovery | `POST /analyze/suggest-roles` → Gemini ranks roles by resume fit → fallback uses keyword overlap scoring |

---

## 3. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend framework | **FastAPI** | Provides auto-generated docs for testing during development and Pydantic for request/response validation without separate serialisers — both out of the box. |
| AI runtime | **Google Gemini API** (`gemini-3.1-flash-lite-preview`) | The free tier is genuinely usable for a demo without a credit card. Response times are suitable for an interactive tool. |
| Fallback engine | **Custom keyword matcher** (`fallback_service.py`) | A hand-written matcher produces real results rather than a "service unavailable" message, and is fully deterministic and independently testable. |
| Database | **SQLite** (raw `sqlite3`) | The schema is simple — one table, no joins, no concurrent writes. Postgres with a connection pool would be unfeasible for the time constraint. |
| Auth | **Clerk** (optional JWT) | The dev-mode bypass means the app runs without any keys set, so reviewers don't need to create accounts. Clerk handles JWKS and key rotation without custom logic. |
| Frontend | **React 18 + Vite + TypeScript** | Vite's HMR keeps frontend iteration fast. TypeScript catches API shape mismatches at compile time rather than at runtime in the browser. |
| Resume parsing | **pdfplumber** (PDF) + **python-docx** (DOCX) | Covers the two most common resume formats without a cloud OCR service. The limitation — complex multi-column or scanned PDFs — is documented in Known Limitations. |

**Production trade-offs:** A production version would use Postgres with connection pooling for concurrent writes, a task queue (Celery or ARQ) to avoid blocking the API on Gemini responses, and AWS Textract for PDFs that `pdfplumber` can't parse cleanly. All three were deliberately excluded to stay within the timebox.

---

## 4. Key Design Decisions

### Prerequisite-ordered roadmap (topological sort)

This was the first thing I designed, because it's what makes the roadmap useful rather than just correct. `_order_by_prerequisites()` in `fallback_service.py` runs a topological sort over the dependency graph in `skill_taxonomy.json`. The graph edges look like: `Kubernetes → [Docker, Linux]`, `Docker → [Linux]`. The sort produces an ordering where prerequisites always come first — regardless of what Gemini returns or alphabetical order. You'll never be told to learn Kubernetes before Docker.

### Fallback as a real alternative, not a stub

`fallback_service.py` produces a complete `AnalysisResult` — match percentage, skill gaps with confidence scores, a prerequisite-ordered roadmap, and a career snapshot — using only deterministic keyword matching and taxonomy metadata. It runs the same topological sort as the AI path. The source badge (`✦ AI-Powered` or `⚠ Fallback Mode`) is always visible in the UI. A demo toggle in `AudienceModeSelector.tsx` allows switching between modes live, making it easy to compare outputs side by side.

### Cached result for consistent mentor sharing

Rather than building a separate mentor authentication flow — creating mentor accounts, linking them to students in the database, managing permissions — the mentor view was implemented as a view-only share link. A student generates a 6-character code from their dashboard; anyone with the link can view the analysis without signing up. The full result JSON is cached in a `cached_result` column after every analysis run, so the shared view always serves the same result the student saw rather than re-running the analysis. Skill status updates (Learning/Done) are applied on top of the cache at read time.

### Proficiency-adjusted sprint timeline

The sprint used to estimate time based purely on taxonomy data — everyone got the same weeks-to-learn number regardless of what they already knew. I added a self-assessment step where users can rate each gap skill (Never used / Know the basics / Have used it). The sprint endpoint accepts `weeks_overrides` derived from these ratings. Multipliers are: `none = 1.0×`, `familiar = 0.6×`, `used = 0.3×`. This makes the planner's output feel personal rather than generic.

### Three audience modes, one data model

`AudienceMode` has three values: `graduate`, `switcher`, `mentor`. Rather than creating separate endpoints or response schemas, I kept a single `AnalysisResult` Pydantic model with nullable mode-specific fields (`transferable_skills`, `time_to_hire_ready_weeks`). The frontend branches on the mode to show or hide the relevant sections. This kept the backend simple and made the modes easy to add incrementally.

---

## 5. Synthetic Data

All data was written by hand. No live scraping, no real personal information anywhere.

| File | Contents |
|---|---|
| `backend/data/skill_taxonomy.json` | ~35 skills. Each skill has: `prerequisites` (dependency graph), `category`, `trend` (rising/stable/declining), `weeks_to_learn`, `aliases` (e.g. `k8s → Kubernetes`), and `resources` (name + URL) |
| `backend/data/job_descriptions.json` | 10 job descriptions across 6 roles: Data Engineer, Cloud Security Engineer, DevSecOps Engineer, SOC Analyst, ML Engineer, Software Engineer |
| `backend/data/sample_resumes.json` | 3 personas for quick demo: **Alex** (B.Tech CS from NIT Trichy, Python/ML background, interned at Mu Sigma), **Sam** (B.Com from SRCC, finance career switcher from Kotak Mahindra Bank, learning Python/SQL), **Jordan** (backend engineer at Razorpay, Java/Spring, pivoting to cloud security) |

I weighted the 6 roles toward security and cloud, partly because those are Palo Alto's core areas and partly because they make interesting cases for career switching — the overlap between a finance background and cloud security is non-obvious and a good test for the transferable skills feature.

---

## 6. Responsible AI

I tried to think through the ways this tool could mislead someone and address them directly.

| Concern | How I handled it |
|---|---|
| Invented skill names | Gemini sometimes returns skill names it made up. I validate every name against the taxonomy and drop anything that doesn't match before it reaches the UI. |
| Non-deterministic snapshot | Without validation, the career snapshot would sometimes be missing a percentage or timeframe. I reject any response missing these fields and fall back to a template. |
| Confidence transparency | Gemini returns a confidence score (0–1) per gap skill. I surface this in the UI — anything below 0.7 gets a `⚠ Low confidence` badge so the user knows to verify that gap themselves. |
| Resume privacy | Resume text is stored in SQLite for the session but is never sent to the frontend after the initial submission. The shared mentor view doesn't expose the raw resume at all. |
| Bias in JDs | There's a tooltip in the Gap Dashboard: "Job descriptions in this dataset may reflect historical hiring patterns. Use this as a starting point, not a definitive verdict." Feels like a small thing but it's important to say. |
| AI vs fallback transparency | The source badge is always visible. You never get an AI result presented as if it's ground truth with no indication of where it came from. |
| API key security | Keys are never committed. The `.env.example` shows which variables are needed without exposing any values. |

---

## 7. Edge Cases Handled

| Edge Case | Where it occurs | How it's handled |
|---|---|---|
| Resume too short to analyse | `POST /profiles/` | FastAPI returns `422` if resume text is under 50 characters — caught before any AI call is made |
| Gemini API timeout or network failure | `POST /analyze/{id}` | 10-second timeout on the Gemini call; any `AIServiceError` or timeout silently falls back to the keyword matcher — the user sees a result either way |
| Gemini returns malformed or non-JSON output | `ai_service.py` | Balanced-brace extraction pulls the first valid JSON object from the response; if no valid JSON is found, fallback is triggered |
| Gemini invents skill names not in taxonomy | `ai_service.py` | Every skill name in the AI response is checked against `skill_taxonomy.json`; unrecognised names are dropped before the result is returned |
| Gemini snapshot missing required fields | `ai_service.py` | Career snapshot must contain role name, a `%` figure, and a timeframe; missing any field rejects the response and triggers fallback |
| Gemini rate limit exceeded (free tier quota) | `ai_service.py` | `AIServiceError` is raised and caught at the router level; fallback result is returned with `source: "fallback"` |
| Circular dependency in skill prerequisite graph | `fallback_service.py` | Topological sort has a `max_iterations = len(remaining) * 2` guard; if a cycle is detected, remaining skills are appended as-is rather than looping forever |
| Requesting a shared view before analysis has been run | `GET /profiles/shared/{code}` | If `cached_result` is null, falls back to running `run_fallback_analysis` on the spot so the mentor view always has something to show |
| Password-protected or unreadable PDF | `resume_parser.py` | `pdfplumber` exception is caught and surfaced as a `400` error with a message telling the user to try a plain-text PDF or paste the resume manually |
| User submits a role that doesn't exist in the JD pool | `fallback_service.py` | Returns a result with `match_percent: 0`, an empty gap list, and a snapshot noting the role wasn't found — no crash |

---

## 8. Future Enhancements

If I had more time, here's what I'd prioritise and why:

1. **Real JD ingestion pipeline** — The 6-role synthetic dataset is the biggest limitation right now. I'd build a scraper or use hiring APIs (LinkedIn, Greenhouse, Lever) to pull real postings, deduplicate by role+company, and refresh nightly. The taxonomy and analysis logic are already built to handle this.

2. **Agentic analysis pipeline** — The current analysis is a single Gemini prompt. I'd break this into a chain: extract skills from resume → match against taxonomy → identify gaps → generate roadmap → verify prerequisite ordering. Each step would be independently testable and retryable, which would make the analysis more reliable and easier to debug.

3. **Mock interview feature** — Given a user's specific skill gaps, generate technical interview questions for those skills. Use AI to evaluate free-text answers and flag weak areas. This feels like the most natural next step after "here's what to learn" — validating that you've actually learned it.

4. **Cloud OCR for complex PDFs** — `pdfplumber` works well for standard resumes but loses structure on multi-column or scanned PDFs. AWS Textract or Google Document AI would handle these correctly. I skipped it to stay within the timebox but it's a real limitation.

5. **Company-specific training plans** — Let a user specify a dream company (say, Palo Alto Networks), pull that company's public JDs, weight skills by how frequently they appear across those JDs, and generate a roadmap tuned to that company's hiring signal rather than the general role average.

6. **Expanded taxonomy** — ~35 skills is enough to demonstrate the concept but not enough to be genuinely useful. I'd grow this to 100+ skills with community contributions and use JD frequency data to flag which skills are trending up or down.

7. **Learning Path Marketplace** — Let users who've completed a roadmap publish it for others in a similar starting position to use. A CS grad who landed a Cloud Security role could share their exact path, vetted by real outcome data rather than just taxonomy metadata.

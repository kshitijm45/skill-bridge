# Skill-Bridge Career Navigator

> A career navigation tool that reads your resume, finds the skills gap between where you are and where you want to be, and builds a learning roadmap in the right order — not just a flat list.

---

## Candidate

| Field | |
|---|---|
| **Name** | Kshitij Mitra |
| **Scenario** | Option 2 — Skill-Bridge Career Navigator |
| **Estimated time spent** | ~5 and half hours |
| **Demo video** | https://youtu.be/jT8MAH3uRqU |
| **Design doc** | [DOCUMENTATION.md](DOCUMENTATION.md) |

---

## Quick Start

**Prerequisites:** Python 3.9+, Node 18+, a free [Google AI Studio](https://aistudio.google.com/) API key

```bash
# Clone and enter the repo
git clone <repo-url>
cd skill-bridge

# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # paste your GEMINI_API_KEY
uvicorn main:app --reload     # → http://localhost:8000

# 2. Frontend (new terminal, from repo root)
cd frontend
npm install
npm run dev                   # → http://localhost:5173

# 3. Tests (from repo root, with backend venv active)
cd ..                         # back to repo root if in frontend/
source backend/.venv/bin/activate
pytest tests/ -v
```

> **No Gemini key?** That's fine — the app automatically falls back to a rule-based keyword matcher. You'll see a ⚠ Fallback Mode badge instead of ✦ AI-Powered, but everything still works.

> **Auth is optional.** If you want to test Clerk sign-in, add `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_PUBLISHABLE_KEY` to the `.env` files. Without them, the app runs in dev mode and treats all requests as a single `dev_user`.

---

## Features

### For New Grads

- **Prerequisite-ordered Roadmap** — To make sure that the learning path provided actually makes sense, a topological sort over the skill dependency graph ensures you're never told to learn Kubernetes before Docker. Each step includes links to free resources (official docs, free courses, hands-on sandboxes).
- **Sprint Planner** — Set a week budget (4–24 weeks) and the planner uses a greedy knapsack approach to figure out which skills give you the best match% improvement per week invested. Useful if you have a job application deadline.
- **Proficiency Check** — You can self-rate each gap skill (Never used / Know the basics / Have used it before). The sprint timeline adjusts in real time based on what you already partly know.

### For Career Switchers

- **Role Discovery** — Instead of making you pick a target role upfront (which career switchers often can't), you paste your resume and the AI tells you which roles from the pool your background is best suited for. Each suggestion comes with a match estimate, the reasoning behind it, and transferable skills.
- **Transferable Skills** — Once you pick a role, there's a dedicated section showing how your current experience maps across (e.g. financial modelling → data analysis, stakeholder reporting → data visualisation). I added this because career switchers often undersell skills they already have.
- Full gap analysis, sprint planning, and roadmap after role selection.

### For Mentors

- **Read-only mentor view** — From the dashboard, a student can generate a 6-character share code and send the link to their mentor. The mentor sees the full analysis — match%, career snapshot, skill gaps, 30/60/90 day plan, and the full roadmap — without needing to sign up.

### Across All Modes

- **3-tab dashboard** — Overview (snapshot + sprint planner + proficiency check), Skill Gaps (filter by category, mark status), Roadmap (can be filtered to sprint skills only)
- **Skill status tracking** — Mark skills as Not Started / Learning / Done. The progress bar updates immediately; skills marked Done get crossed out in the Sprint Planner automatically without needing to re-run the analysis.
- **Session persistence** — Your profile and analysis survive a page refresh via `localStorage`. The raw resume text is never stored client-side.

---

## AI Disclosure

**Did I use an AI assistant?**
Yes — two of them:
- **Claude:** I used this throughout development for code generation, architecture decisions, and debugging.
- **Google Gemini API (`gemini-3.1-flash-lite-preview`):** This is the AI embedded in the app itself — it handles resume analysis, role suggestion ranking, and career snapshot generation.

**How I verified the outputs:**
I didn't take either AI's output at face value. For Claude's suggestions during development, every code change was reviewed before committing — Claude twice generated code with imports it had itself removed earlier (e.g. `Form`, `File` in `analysis.py`), which only surfaced when running the tests. When Claude suggested the sprint planner re-derive gap skills using keyword extraction, I caught that this would silently drop skills the AI had correctly identified (the Git/GitHub false-negative issue) and pushed back — the fix was passing `ai_gap_skills` directly to the sprint endpoint instead.

For Gemini's runtime output, every response goes through a validation step before the frontend sees it:

- The career snapshot must contain the target role name, a percentage figure, and a timeframe. If any of these are missing, the response is rejected and the fallback kicks in.
- Skill names in the AI's output are checked against `skill_taxonomy.json`. If Gemini invents a name that isn't in the taxonomy, it gets dropped silently — the AI can't fabricate skills or inflate match scores.
- Gemini also returns a confidence score (0.0–1.0) per gap skill. Anything below 0.7 shows a warning badge in the UI so the user knows to treat that gap with some scepticism.
- The JSON parser uses balanced-brace extraction to handle cases where Gemini prepends thinking text before the actual JSON object.

**One output I rejected or changed:**
A few examples across both tools:

- Claude initially suggested using TF-IDF for the fallback skill extractor. I replaced it with simple word-boundary keyword matching — it's easier to test, easier to reason about, and accurate enough for a 35-skill taxonomy. TF-IDF would've added complexity without a meaningful accuracy gain at this scale.
- Claude wrote a test assertion using set algebra to compute expected match% — `len(present_skills & gap_skills | present_skills) / total * 100` — which was logically wrong due to operator precedence and was passing by coincidence on the specific inputs. I caught it while adding new test cases and fixed the expression.
- Throughout the UI, Claude generated placeholder text and generic labels that didn't fit the actual product (e.g. generic card descriptions, tooltip copy that didn't match what the feature actually did). I went through and rewrote or removed these so the UI only says things that are accurate and relevant.

**Fallback when AI is unavailable:**
I spent real time on this rather than making it a stub. The fallback uses keyword matching with alias support from the taxonomy, produces a proper career snapshot from a template, and runs the same topological sort for the roadmap. The source is always visible in the UI — `✦ AI-Powered` or `⚠ Fallback Mode (Rule-Based)`.

**Responsible AI note:**
This tool is meant to complement a mentor or recruiter conversation, not replace it. The job descriptions in the dataset are synthetic and may not reflect all roles equally. The roadmap ordering follows common learning prerequisites, but that's a generalisation — your situation may differ.

---

## Tradeoffs & Prioritisation

| Decision | What I did | Why |
|---|---|---|
| SQLite over Postgres | Single-file DB, no setup | The schema is simple and I'm not handling concurrent writes — Postgres would've added infra overhead with no real benefit for a local demo |
| Keyword matching for fallback instead of TF-IDF | Word-boundary regex per skill name and alias | I wanted the fallback to be something I could actually test and reason about. TF-IDF would've been harder to debug and isn't meaningfully more accurate for a 35-skill taxonomy |
| `localStorage` for session restore | Store profile ID + analysis result, never the raw resume | Avoids a server-side session table and keeps PII out of the browser |
| Mentor view as a share link | 6-char code, no mentor account needed | This is how real tools like Notion and Figma do view-only sharing. It felt more natural than requiring a second sign-up |
| `pdfplumber` over cloud OCR | Text-based PDF parsing, no image/scan support | Integrating AWS Textract or Google Document AI would've added cost, credentials, and setup complexity. `pdfplumber` handles standard resumes well enough — the limitation is documented |

**What I cut and why:**
- **Mock interview feature** — It's mentioned in the scenario brief and I genuinely wanted to build it, but it would've been its own mini-project. I'd rather have the gap analysis and roadmap feel complete than add a half-baked interview section.
- **Graphical interface for the roadmap** — I prototyped this mentally and realised a clean numbered list actually communicates learning order better than a visual graph for a linear path.

---

## Known Limitations

- **Tech roles only** — The skill taxonomy and job description dataset are scoped entirely to tech — software engineering, cloud, security, and data roles. The tool won't be useful for someone looking to move into non-technical fields.
- **Gemini rate limits** — The free tier has a daily quota. If you hit it during testing, the fallback activates automatically and everything keeps working.
- **Taxonomy coverage** — I hand-crafted ~35 skills. Niche or very new technologies won't be extracted from resumes if they're not in the taxonomy yet.
- **PDF parsing** — Works well for standard single-column PDFs. Complex multi-column layouts or image-based PDFs may lose structure since I'm using `pdfplumber` without OCR.
- **6-role JD pool** — The role discovery feature is limited to the roles in my synthetic dataset. This is enough to demonstrate the idea but obviously not production-ready.
- **Match% is an estimate** — The suggest-roles endpoint and the full analysis endpoint use separate AI calls, so the % on the suggestion card and the % on the dashboard may differ slightly. Both are labeled to make this clear (`~75% est. match` vs `75% match`).
- **SQLite in production** — I wouldn't use SQLite if this were a real deployment. Postgres with connection pooling is the right call for anything with concurrent users.

---

## What I'd Build Next

See [DOCUMENTATION.md — Future Enhancements](DOCUMENTATION.md#7-future-enhancements) for the full prioritised list. The short version:

- **Real JD ingestion** — Pull actual job postings from LinkedIn or Greenhouse instead of relying on my synthetic dataset of 10 JDs.
- **Agentic analysis pipeline** — Break the single Gemini prompt into a chain of smaller, independently verifiable steps.
- **Mock interview feature** — Generate technical questions based on the user's specific skill gaps and use AI to score the answers.
- **Cloud OCR** — AWS Textract or Google Document AI for PDFs that `pdfplumber` can't parse cleanly.
- **Company-specific roadmaps** — Let a user pick a target company, pull that company's public JDs, and weight the roadmap accordingly.
- **Learning Path Marketplace** — Let users who've completed a roadmap publish it for others in a similar starting position to use. A CS grad who landed a Cloud Security role could share their exact path, vetted by real outcome data rather than just taxonomy metadata.
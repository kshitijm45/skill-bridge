"""
Rule-based fallback service.
Used when the Claude API is unavailable, times out, or returns invalid output.

Strategy:
  1. Lowercase the resume text
  2. For each skill in the taxonomy, check if the skill name OR any alias appears in the resume
  3. Compare found skills against the target role's required skills to find gaps
  4. Order gaps by prerequisite dependency (skills with no unmet prereqs come first)
  5. Generate a deterministic career_snapshot string

This is transparent, explainable, and genuinely useful — not a stub.
"""

import json
import os
import re
from models import SkillGap, RoadmapStep, TransferableSkill, SkillStatus

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def _load_taxonomy() -> dict:
    with open(os.path.join(_DATA_DIR, "skill_taxonomy.json")) as f:
        return json.load(f)


def _load_job_descriptions() -> list:
    with open(os.path.join(_DATA_DIR, "job_descriptions.json")) as f:
        return json.load(f)


def extract_skills_from_text(resume_text: str, taxonomy: dict) -> list[str]:
    """
    Return list of skill names found in the resume text.
    Checks skill name and all aliases (case-insensitive, word-boundary aware).
    """
    text_lower = resume_text.lower()
    found = []

    for skill, meta in taxonomy.items():
        terms_to_check = [skill.lower()] + [a.lower() for a in meta.get("aliases", [])]
        for term in terms_to_check:
            # Use word boundary matching to avoid "Java" matching "JavaScript"
            pattern = r'\b' + re.escape(term) + r'\b'
            if re.search(pattern, text_lower):
                found.append(skill)
                break  # found this skill, move to next

    return found


def get_required_skills_for_role(target_role: str, jds: list) -> tuple[list[str], int]:
    """
    Return (required_skills, jd_count) for the given role.
    Aggregates required skills across all JDs for that role and returns unique set.
    """
    matching_jds = [jd for jd in jds if jd["role"].lower() == target_role.lower()]
    if not matching_jds:
        # Fallback: return empty if role not found
        return [], 0

    all_required: set[str] = set()
    for jd in matching_jds:
        all_required.update(jd["required_skills"])

    return list(all_required), len(matching_jds)


def _order_by_prerequisites(gaps: list[str], skills_present: list[str], taxonomy: dict) -> list[str]:
    """
    Topological sort: skills whose prerequisites are already met (present or earlier in list)
    come before skills that depend on them.
    """
    ordered = []
    remaining = list(gaps)
    resolved = set(skills_present)

    max_iterations = len(remaining) * 2  # prevent infinite loop on circular deps
    iteration = 0

    while remaining and iteration < max_iterations:
        iteration += 1
        progress = False
        for skill in list(remaining):
            prereqs = taxonomy.get(skill, {}).get("prerequisites", [])
            unmet = [p for p in prereqs if p not in resolved and p not in ordered]
            if not unmet:
                ordered.append(skill)
                resolved.add(skill)
                remaining.remove(skill)
                progress = True
        if not progress:
            # Circular dependency or all remaining have unmet prereqs — just append them
            ordered.extend(remaining)
            break

    return ordered


def _snapshot_template(match_percent: int, target_role: str, top_gaps: list[str]) -> str:
    top_3 = ", ".join(top_gaps[:3]) if top_gaps else "core technical skills"

    if match_percent >= 75:
        timeframe = "4–6 weeks"
        tone = f"You're {match_percent}% of the way to a {target_role} role — strong foundation."
    elif match_percent >= 50:
        timeframe = "8–12 weeks"
        tone = f"You're {match_percent}% matched for a {target_role} role — solid progress to build on."
    elif match_percent >= 25:
        timeframe = "3–5 months"
        tone = f"You're {match_percent}% matched for a {target_role} role — a focused plan will get you there."
    else:
        timeframe = "5–8 months"
        tone = f"You're at {match_percent}% for a {target_role} role — the path is clear, it just takes commitment."

    return (
        f"{tone} "
        f"Your priority gaps are: {top_3}. "
        f"Estimated time to close these gaps: {timeframe}."
    )


def _get_transferable_skills(skills_present: list[str], target_role: str) -> list[TransferableSkill]:
    """
    Identify transferable skills for career switcher mode.
    Role-aware: maps existing skills to the specific value they provide in the target domain.
    """
    role_lower = target_role.lower()

    if any(x in role_lower for x in ["security", "soc", "devsecops", "threat"]):
        skill_map = {
            "Linux": ("Linux", "System-level Linux knowledge is foundational for log analysis, threat detection, and incident response."),
            "Networking": ("Networking", "Understanding network protocols and traffic patterns is essential for spotting anomalies and attack vectors."),
            "Docker": ("DevSecOps", "Container expertise maps directly to container security — hardening images, runtime protection, and supply chain scanning."),
            "CI/CD": ("DevSecOps", "Your CI/CD pipeline experience is a direct entry point for integrating SAST/DAST security gates into developer workflows."),
            "Python": ("Python", "Python is the primary language for security automation, log parsing, and custom detection rule development in SOC and DevSecOps roles."),
            "REST APIs": ("REST APIs", "API security testing and secure design review leverages your existing knowledge of how APIs are built and consumed."),
            "Log Analysis": ("Log Analysis", "Experience with centralized logging translates directly to SIEM ingestion, alert tuning, and threat hunting workflows."),
        }
    elif any(x in role_lower for x in ["data engineer", "data analyst", "ml engineer", "machine learning"]):
        skill_map = {
            "Python": ("Python", "Your Python scripting background directly transfers to data pipeline development, ETL automation, and ML model workflows."),
            "SQL": ("SQL", "SQL is the core language for data warehousing and analytics — your querying and data modeling skills translate immediately."),
            "Data Visualization": ("Data Visualization", "Business dashboarding and charting skills map directly to BI and analytics tooling used by data teams."),
            "Machine Learning": ("Machine Learning", "ML fundamentals apply directly to feature engineering, model evaluation, and production ML pipeline work."),
            "Data Structures": ("Data Structures", "Algorithmic thinking from data structures maps well to query optimization, pipeline design, and large-scale data processing."),
        }
    elif any(x in role_lower for x in ["cloud", "devops", "sre", "infrastructure"]):
        skill_map = {
            "Docker": ("Docker", "Containerization is a core building block for cloud-native deployments — Docker expertise transfers directly to Kubernetes and cloud workloads."),
            "Linux": ("Linux", "Server administration and shell scripting are daily tools in DevOps and cloud engineering — your Linux background is directly applicable."),
            "Python": ("Python", "Infrastructure automation (Boto3, Pulumi, Ansible) and custom tooling rely heavily on Python scripting."),
            "CI/CD": ("CI/CD", "Your pipeline experience is directly applicable — cloud and DevOps engineers own deployment automation and release engineering end-to-end."),
            "Networking": ("Networking", "Cloud networking (VPCs, subnets, security groups, load balancers) directly builds on your existing networking fundamentals."),
        }
    else:
        skill_map = {
            "Python": ("Python", "Python scripting transfers broadly — automation, testing, and backend development apply across almost every engineering role."),
            "SQL": ("SQL", "SQL is universally used for data access — your querying skills are reusable across backend, data, and analytics roles."),
            "Git": ("Git", "Version control experience signals professional development readiness and collaborative workflow familiarity."),
            "Linux": ("Linux", "Command-line and systems experience is foundational for server-side and infrastructure-adjacent roles."),
            "REST APIs": ("REST APIs", "API experience bridges frontend and backend development and is a core skill in nearly every engineering discipline."),
            "Data Structures": ("Data Structures", "Algorithmic thinking and problem-solving transfer to any role that requires writing efficient, scalable code."),
        }

    results = []
    for skill in skills_present:
        if skill in skill_map:
            maps_to, explanation = skill_map[skill]
            results.append(TransferableSkill(
                existing_skill=skill,
                maps_to=maps_to,
                explanation=explanation
            ))

    return results[:5]  # cap at 5 for UI clarity


def run_fallback_analysis(
    resume_text: str,
    target_role: str,
    audience_mode: str,
    skill_statuses: dict,
) -> dict:
    """
    Full fallback analysis. Returns a dict matching the AnalysisResult shape.
    """
    taxonomy = _load_taxonomy()
    jds = _load_job_descriptions()

    skills_present = extract_skills_from_text(resume_text, taxonomy)
    required_skills, jd_count = get_required_skills_for_role(target_role, jds)

    if not required_skills:
        # Role not found in dataset
        gaps_raw = []
    else:
        gaps_raw = [s for s in required_skills if s not in skills_present]

    # Calculate match percent
    if required_skills:
        match_percent = round((len(required_skills) - len(gaps_raw)) / len(required_skills) * 100)
    else:
        match_percent = 0

    # Order gaps by prerequisites
    ordered_gap_names = _order_by_prerequisites(gaps_raw, skills_present, taxonomy)

    # Build SkillGap objects
    skill_gaps = []
    for skill in ordered_gap_names:
        meta = taxonomy.get(skill, {})
        current_status = skill_statuses.get(skill, "not_started")
        skill_gaps.append(SkillGap(
            skill=skill,
            category=meta.get("category", "General"),
            trend=meta.get("trend", "stable"),
            confidence=1.0,  # deterministic — always certain
            weeks_to_learn=meta.get("weeks_to_learn", 4),
            prerequisites=meta.get("prerequisites", []),
            status=SkillStatus(current_status),
            prerequisite_reasoning=f"Required by {jd_count} '{target_role}' job description(s) in our dataset. Not found in your resume."
        ))

    # Build roadmap steps
    roadmap = []
    for i, gap in enumerate(skill_gaps):
        meta = taxonomy.get(gap.skill, {})
        prereqs = meta.get("prerequisites", [])
        why = f"'{gap.skill}' appears in {jd_count} '{target_role}' JD(s) and was not detected in your resume."
        if prereqs:
            why += f" Prerequisites ({', '.join(prereqs)}) are already in your profile or earlier in this roadmap."

        roadmap.append(RoadmapStep(
            step=i + 1,
            skill=gap.skill,
            weeks=gap.weeks_to_learn,
            category=gap.category,
            resources=_get_resources(gap.skill),
            why=why
        ))

    # Career snapshot (deterministic template)
    snapshot = _snapshot_template(match_percent, target_role, [g.skill for g in skill_gaps])

    # Transferable skills (switcher mode)
    transferable = []
    if audience_mode == "switcher":
        transferable = _get_transferable_skills(skills_present, target_role)

    # Time to hire ready (graduate mode)
    total_weeks = sum(s.weeks_to_learn for s in skill_gaps[:5])  # top 5 priority gaps
    time_to_hire = total_weeks if audience_mode == "graduate" else None

    # Priority next step
    priority_next_step = (
        f"Start with '{skill_gaps[0].skill}' — {skill_gaps[0].weeks_to_learn} weeks, "
        f"no unmet prerequisites." if skill_gaps else "You meet all the core requirements for this role!"
    )

    return {
        "match_percent": match_percent,
        "skills_present": skills_present,
        "skill_gaps": skill_gaps,
        "ordered_roadmap": roadmap,
        "career_snapshot": snapshot,
        "transferable_skills": transferable,
        "source": "fallback",
        "stats": {
            "skills_extracted": len(skills_present),
            "jds_matched": jd_count,
            "coverage_percent": round(len(required_skills) / max(len(taxonomy), 1) * 100),
        },
        "time_to_hire_ready_weeks": time_to_hire,
        "priority_next_step": priority_next_step,
    }


def run_fallback_suggest_roles(resume_text: str, roles_data: dict, taxonomy: dict) -> list:
    """
    Score resume against each role's required skills and return top 3-4 suggestions.
    Used when AI is unavailable.
    """
    skills_present = set(extract_skills_from_text(resume_text, taxonomy))

    scored = []
    for role, required_skills in roles_data.items():
        if not required_skills:
            continue
        found = [s for s in required_skills if s in skills_present]
        gaps = [s for s in required_skills if s not in skills_present]
        match_percent = round(len(found) / len(required_skills) * 100)
        primary_gap = gaps[0] if gaps else ""
        weeks_to_bridge = sum(taxonomy.get(s, {}).get("weeks_to_learn", 4) for s in gaps[:5])

        if found:
            skills_str = ", ".join(found[:3])
            fit_reasoning = (
                f"Your existing skills in {skills_str} align with {role} requirements. "
                f"You're {match_percent}% matched — focus on {primary_gap or 'advanced topics'} to bridge the remaining gap."
            )
        else:
            fit_reasoning = (
                f"The {role} role is a stretch at {match_percent}% match, "
                f"but a structured learning plan focused on {primary_gap} can get you there."
            )

        scored.append({
            "role": role,
            "match_percent": match_percent,
            "fit_reasoning": fit_reasoning,
            "transferable_skills": found[:4],
            "primary_gap": primary_gap,
            "weeks_to_bridge": weeks_to_bridge,
        })

    scored.sort(key=lambda x: x["match_percent"], reverse=True)
    return scored[:4]


def _get_resources(skill: str) -> list[dict]:
    """Curated free learning resources per skill — returns {name, url} dicts."""
    resources_map: dict[str, list[dict]] = {
        "Python": [
            {"name": "Python.org Official Tutorial", "url": "https://docs.python.org/3/tutorial/"},
            {"name": "Automate the Boring Stuff (free)", "url": "https://automatetheboringstuff.com/"},
        ],
        "Docker": [
            {"name": "Docker Official Get Started Guide", "url": "https://docs.docker.com/get-started/"},
            {"name": "Play with Docker (free sandbox)", "url": "https://labs.play-with-docker.com/"},
        ],
        "Kubernetes": [
            {"name": "Kubernetes.io Interactive Tutorial", "url": "https://kubernetes.io/docs/tutorials/kubernetes-basics/"},
            {"name": "KillerCoda K8s Labs (free)", "url": "https://killercoda.com/playgrounds/scenario/kubernetes"},
        ],
        "AWS": [
            {"name": "AWS Skill Builder Free Tier", "url": "https://explore.skillbuilder.aws/learn"},
            {"name": "Cloud Practitioner Essentials (free)", "url": "https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials"},
        ],
        "GCP": [
            {"name": "Google Cloud Skills Boost", "url": "https://cloudskillsboost.google/"},
        ],
        "Terraform": [
            {"name": "HashiCorp Learn — Terraform", "url": "https://developer.hashicorp.com/terraform/tutorials"},
            {"name": "Terraform in 100 Seconds (YouTube)", "url": "https://www.youtube.com/watch?v=tomUWcQ0P3k"},
        ],
        "SQL": [
            {"name": "SQLZoo (free interactive)", "url": "https://sqlzoo.net/"},
            {"name": "Mode SQL Tutorial", "url": "https://mode.com/sql-tutorial/"},
        ],
        "Linux": [
            {"name": "Linux Journey (free)", "url": "https://linuxjourney.com/"},
            {"name": "OverTheWire: Bandit (free CTF for Linux)", "url": "https://overthewire.org/wargames/bandit/"},
        ],
        "Networking": [
            {"name": "Professor Messer Network+ (free videos)", "url": "https://www.professormesser.com/network-plus/n10-008/n10-008-video/n10-008-training-course/"},
            {"name": "Cisco NetAcad Intro to Networks", "url": "https://www.netacad.com/courses/networking/ccna-introduction-networks"},
        ],
        "SIEM": [
            {"name": "Splunk Fundamentals 1 (free)", "url": "https://www.splunk.com/en_us/training/free-courses/splunk-fundamentals-1.html"},
            {"name": "Microsoft Sentinel Ninja Training", "url": "https://techcommunity.microsoft.com/t5/microsoft-sentinel-blog/become-a-microsoft-sentinel-ninja-the-complete-level-400/ba-p/1246310"},
        ],
        "Threat Intelligence": [
            {"name": "MITRE ATT&CK Framework (free)", "url": "https://attack.mitre.org/"},
            {"name": "OpenCTI community edition", "url": "https://github.com/OpenCTI-Platform/opencti"},
        ],
        "Cloud Security": [
            {"name": "AWS Security Learning Plan", "url": "https://explore.skillbuilder.aws/learn/public/learning_plan/view/97/security-learning-plan"},
            {"name": "Google Cloud Security Fundamentals", "url": "https://cloudskillsboost.google/course_templates/87"},
        ],
        "DevSecOps": [
            {"name": "OWASP DevSecOps Guideline", "url": "https://owasp.org/www-project-devsecops-guideline/"},
            {"name": "Snyk Learn (free)", "url": "https://learn.snyk.io/"},
        ],
        "Machine Learning": [
            {"name": "fast.ai Practical Deep Learning (free)", "url": "https://course.fast.ai/"},
            {"name": "Andrew Ng ML Specialization (audit free)", "url": "https://www.coursera.org/specializations/machine-learning-introduction"},
        ],
        "Spark": [
            {"name": "Apache Spark official docs", "url": "https://spark.apache.org/docs/latest/"},
            {"name": "Databricks Community Edition (free)", "url": "https://community.cloud.databricks.com/"},
        ],
        "CI/CD": [
            {"name": "GitHub Actions official docs", "url": "https://docs.github.com/en/actions"},
            {"name": "GitLab CI free tutorial", "url": "https://docs.gitlab.com/ee/ci/"},
        ],
        "React": [
            {"name": "React official docs (react.dev)", "url": "https://react.dev/learn"},
            {"name": "The Odin Project (free)", "url": "https://www.theodinproject.com/paths/full-stack-javascript"},
        ],
        "Git": [
            {"name": "Pro Git Book (free online)", "url": "https://git-scm.com/book/en/v2"},
            {"name": "GitHub Skills", "url": "https://skills.github.com/"},
        ],
        "Go": [
            {"name": "A Tour of Go (free)", "url": "https://go.dev/tour/"},
            {"name": "Go by Example (free)", "url": "https://gobyexample.com/"},
        ],
        "Incident Response": [
            {"name": "SANS Cyber Aces (free)", "url": "https://www.sans.org/cyberaces/"},
            {"name": "Blue Team Labs Online (free tier)", "url": "https://blueteamlabs.online/"},
        ],
        "Penetration Testing": [
            {"name": "TryHackMe free rooms", "url": "https://tryhackme.com/"},
            {"name": "HackTheBox Starting Point", "url": "https://www.hackthebox.com/hacker/hacking-labs"},
        ],
        "Vulnerability Management": [
            {"name": "Qualys FreeScan", "url": "https://freescan.qualys.com/freescan-front/"},
            {"name": "NIST NVD documentation", "url": "https://nvd.nist.gov/"},
        ],
        "Airflow": [
            {"name": "Apache Airflow official tutorial", "url": "https://airflow.apache.org/docs/apache-airflow/stable/tutorial/index.html"},
            {"name": "Astronomer Academy (free tier)", "url": "https://academy.astronomer.io/"},
        ],
        "System Design": [
            {"name": "System Design Primer (GitHub)", "url": "https://github.com/donnemartin/system-design-primer"},
            {"name": "ByteByteGo YouTube (free)", "url": "https://www.youtube.com/@ByteByteGo"},
        ],
        "TypeScript": [
            {"name": "TypeScript official handbook", "url": "https://www.typescriptlang.org/docs/handbook/intro.html"},
            {"name": "Execute Program TypeScript (free intro)", "url": "https://www.executeprogram.com/courses/typescript"},
        ],
        "Prometheus": [
            {"name": "Prometheus official getting started", "url": "https://prometheus.io/docs/prometheus/latest/getting_started/"},
            {"name": "Grafana Play (free sandbox)", "url": "https://play.grafana.org/"},
        ],
        "REST APIs": [
            {"name": "REST API Tutorial", "url": "https://restfulapi.net/"},
            {"name": "Postman Learning Center (free)", "url": "https://learning.postman.com/"},
        ],
        "Data Structures": [
            {"name": "Visualgo (free visualizations)", "url": "https://visualgo.net/en"},
            {"name": "NeetCode (free)", "url": "https://neetcode.io/roadmap"},
        ],
        "Log Analysis": [
            {"name": "Elastic SIEM docs (free)", "url": "https://www.elastic.co/guide/en/siem/guide/current/index.html"},
            {"name": "Graylog documentation (free)", "url": "https://docs.graylog.org/"},
        ],
        "Data Visualization": [
            {"name": "Tableau Public (free)", "url": "https://public.tableau.com/en-us/s/"},
            {"name": "Observable Plot (free, JS-based)", "url": "https://observablehq.com/plot/"},
        ],
        "Cloud Fundamentals": [
            {"name": "AWS Cloud Practitioner Essentials", "url": "https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials"},
            {"name": "Google Cloud Digital Leader training", "url": "https://cloudskillsboost.google/paths/9"},
        ],
    }
    default = [{"name": "Search official documentation", "url": "https://www.google.com/search?q=" + skill.replace(" ", "+") + "+tutorial+free"}]
    return resources_map.get(skill, default)

import axios from 'axios'

const client = axios.create({ baseURL: '/api' })

// Set by App.tsx after Clerk loads — called per-request so tokens stay fresh
let _getToken: (() => Promise<string | null>) | null = null

export function setTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn
}

client.interceptors.request.use(async config => {
  if (_getToken) {
    const token = await _getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// --- Types ---

export type AudienceMode = 'graduate' | 'switcher' | 'mentor'
export type SkillStatus = 'not_started' | 'learning' | 'completed'

export interface Profile {
  id: number
  name: string
  resume_text: string
  target_role: string
  audience_mode: AudienceMode
  current_career: string | null
  skill_statuses: Record<string, SkillStatus>
}

export interface SkillGap {
  skill: string
  category: string
  trend: 'rising' | 'stable' | 'declining'
  confidence: number
  weeks_to_learn: number
  prerequisites: string[]
  status: SkillStatus
  prerequisite_reasoning: string
}

export interface Resource {
  name: string
  url: string
}

export interface RoadmapStep {
  step: number
  skill: string
  weeks: number
  category: string
  resources: Resource[]
  why: string
}

export interface TransferableSkill {
  existing_skill: string
  maps_to: string
  explanation: string
}

export interface AnalysisResult {
  profile_id: number
  target_role: string
  match_percent: number
  skills_present: string[]
  skill_gaps: SkillGap[]
  ordered_roadmap: RoadmapStep[]
  career_snapshot: string
  transferable_skills: TransferableSkill[]
  source: 'ai' | 'fallback'
  stats: { skills_extracted: number; jds_matched: number; coverage_percent: number }
  time_to_hire_ready_weeks: number | null
  priority_next_step: string
}

export interface RoleSuggestion {
  role: string
  match_percent: number
  fit_reasoning: string
  transferable_skills: string[]
  primary_gap: string
  weeks_to_bridge: number
}

export interface SampleResume {
  id: string
  name: string
  persona: string
  audience_mode: AudienceMode
  suggested_roles: string[]
}

// --- API calls ---

export async function createProfile(data: {
  target_role: string
  audience_mode: AudienceMode
  current_career?: string
  resume_text?: string
  resume_file?: File
}): Promise<Profile> {
  const form = new FormData()
  form.append('target_role', data.target_role)
  if (data.current_career) form.append('current_career', data.current_career)
  form.append('audience_mode', data.audience_mode)
  if (data.resume_file) form.append('resume_file', data.resume_file)
  else if (data.resume_text) form.append('resume_text', data.resume_text)

  const res = await client.post<Profile>('/profiles/', form)
  return res.data
}

export async function getProfile(id: number): Promise<Profile> {
  const res = await client.get<Profile>(`/profiles/${id}`)
  return res.data
}

export async function updateSkillStatus(
  profileId: number,
  skill: string,
  status: SkillStatus
): Promise<Profile> {
  const res = await client.patch<Profile>(`/profiles/${profileId}/skill`, { skill, status })
  return res.data
}

export async function listProfiles(): Promise<Profile[]> {
  const res = await client.get<Profile[]>('/profiles/')
  return res.data
}

export async function analyzeProfile(profileId: number, forceMode?: 'ai' | 'fallback'): Promise<AnalysisResult> {
  const params = forceMode === 'fallback' ? { force_fallback: true } : {}
  const res = await client.post<AnalysisResult>(`/analyze/${profileId}`, null, { params })
  return res.data
}

export async function compareAiVsFallback(profileId: number) {
  const res = await client.post(`/analyze/${profileId}/compare`)
  return res.data
}

export async function getRoles(): Promise<string[]> {
  const res = await client.get<{ roles: string[] }>('/roles')
  return res.data.roles
}

export async function listSamples(): Promise<SampleResume[]> {
  const res = await client.get<{ samples: SampleResume[] }>('/samples')
  return res.data.samples
}

export async function getSample(sampleId: string) {
  const res = await client.get(`/samples/${sampleId}`)
  return res.data
}

export interface SprintSkill {
  skill: string
  weeks: number
  category: string
  trend: 'rising' | 'stable' | 'declining'
  efficiency_score: number
}

export interface SprintPlan {
  weeks_budget: number
  weeks_used: number
  current_match: number
  sprint_match: number
  match_gain: number
  jd_count: number
  sprint_skills: SprintSkill[]
  skipped_skills: { skill: string; weeks: number }[]
}

export async function suggestRoles(data: {
  resume_text?: string
  resume_file?: File
  current_career?: string
}): Promise<RoleSuggestion[]> {
  const form = new FormData()
  if (data.resume_file) form.append('resume_file', data.resume_file)
  else if (data.resume_text) form.append('resume_text', data.resume_text)
  if (data.current_career) form.append('current_career', data.current_career)
  const res = await client.post<{ suggestions: RoleSuggestion[] }>('/analyze/suggest-roles', form)
  return res.data.suggestions
}

export async function getSprintPlan(
  profileId: number,
  weeks: number,
  baseMatch?: number,
  aiGapSkills?: string[],
  weeksOverrides?: string,
): Promise<SprintPlan> {
  const params: Record<string, string | number> = { weeks }
  if (baseMatch !== undefined) params.base_match = baseMatch
  if (aiGapSkills && aiGapSkills.length > 0) params.ai_gap_skills = aiGapSkills.join(',')
  if (weeksOverrides) params.weeks_overrides = weeksOverrides
  const res = await client.get<SprintPlan>(`/analyze/${profileId}/sprint`, { params })
  return res.data
}

export interface SharedView {
  profile: {
    id: number
    name: string
    target_role: string
    audience_mode: AudienceMode
    skill_statuses: Record<string, SkillStatus>
  }
  result: AnalysisResult
}

export async function generateShareCode(profileId: number): Promise<{ code: string }> {
  const res = await client.post<{ code: string }>(`/profiles/${profileId}/share`)
  return res.data
}

export async function revokeShareCode(profileId: number): Promise<void> {
  await client.delete(`/profiles/${profileId}/share`)
}

export async function getSharedView(code: string): Promise<SharedView> {
  const res = await client.get<SharedView>(`/profiles/shared/${code}`)
  return res.data
}

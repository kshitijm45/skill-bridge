import { useState, useEffect, useRef } from 'react'
import {
  updateSkillStatus, getSprintPlan, generateShareCode, revokeShareCode,
  type Profile, type AnalysisResult, type SkillGap, type SkillStatus, type SprintPlan,
} from '../api'
import ProficiencyCheck from './ProficiencyCheck'
import RoadmapView from './RoadmapView'
import TransferableSkills from './TransferableSkills'
import SprintPlanner from './SprintPlanner'

const CATEGORIES = ['All', 'Cloud', 'Security', 'Backend', 'Data', 'Infrastructure', 'Languages']

const TREND_BADGE: Record<string, string> = {
  rising:   'text-green-700 bg-green-50 border-green-200',
  stable:   'text-gray-600 bg-gray-50 border-gray-200',
  declining:'text-raspberry-red-600 bg-raspberry-red-50 border-raspberry-red-200',
}
const TREND_ICON: Record<string, string> = {
  rising: '↑', stable: '→', declining: '↓',
}

type Tab = 'overview' | 'gaps' | 'roadmap'

export default function GapDashboard({
  profile,
  result,
  onUpdateResult,
}: {
  profile: Profile
  result: AnalysisResult
  onUpdateResult: (r: AnalysisResult) => void
}) {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [filterCat, setFilterCat] = useState('All')
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null)
  const [sprintWeeks, setSprintWeeks] = useState<number>(() => {
    const saved = localStorage.getItem(`sb_sprint_weeks_${profile.id}`)
    return saved ? Number(saved) : 8
  })
  const [sprintPlan, setSprintPlan] = useState<SprintPlan | null>(null)
  const [sprintLoading, setSprintLoading] = useState(false)
  const [sprintOnly, setSprintOnly] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [showShare, setShowShare] = useState(false)

  type ProfLevel = 'none' | 'familiar' | 'used'
  const PROF_MULTIPLIER: Record<ProfLevel, number> = { none: 1.0, familiar: 0.6, used: 0.3 }
  const [profLevels, setProfLevels] = useState<Record<string, ProfLevel>>(() => {
    try {
      const saved = localStorage.getItem(`sb_proficiency_${profile.id}`)
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })

  // Persist proficiency levels
  useEffect(() => {
    localStorage.setItem(`sb_proficiency_${profile.id}`, JSON.stringify(profLevels))
  }, [profLevels, profile.id])

  // Compute proficiency-adjusted weeks per gap skill
  const adjustedWeeks: Record<string, number> = {}
  for (const g of result.skill_gaps) {
    const mult = PROF_MULTIPLIER[profLevels[g.skill] ?? 'none']
    adjustedWeeks[g.skill] = Math.max(1, Math.round(g.weeks_to_learn * mult))
  }

  // Fetch sprint plan — debounced so slider doesn't hammer the API
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSprintLoading(true)
      try {
        const aiGaps = result.skill_gaps.map(g => g.skill)
        const weeksOverrides = Object.entries(adjustedWeeks)
          .filter(([skill]) => (profLevels[skill] ?? 'none') !== 'none')
          .map(([skill, w]) => `${skill}:${w}`)
          .join(',')
        const data = await getSprintPlan(profile.id, sprintWeeks, result.match_percent, aiGaps, weeksOverrides || undefined)
        setSprintPlan(data)
      } finally {
        setSprintLoading(false)
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintWeeks, profile.id, result.match_percent, JSON.stringify(profLevels)])

  // Persist week selection per profile
  useEffect(() => {
    localStorage.setItem(`sb_sprint_weeks_${profile.id}`, String(sprintWeeks))
  }, [sprintWeeks, profile.id])

  const sprintSkillNames = new Set(sprintPlan?.sprint_skills.map(s => s.skill) ?? [])

  const filteredGaps: SkillGap[] = filterCat === 'All'
    ? result.skill_gaps
    : result.skill_gaps.filter(g => g.category === filterCat)

  const handleSkillStatus = async (skill: string, status: SkillStatus) => {
    setUpdatingSkill(skill)
    try {
      await updateSkillStatus(profile.id, skill, status)
      // Patch the skill status locally — no need to re-run a full analysis
      onUpdateResult({
        ...result,
        skill_gaps: result.skill_gaps.map(g => g.skill === skill ? { ...g, status } : g),
      })
    } finally {
      setUpdatingSkill(null)
    }
  }

  const handleShare = async () => {
    if (shareCode) { setShowShare(v => !v); return }
    setShareLoading(true)
    try {
      const { code } = await generateShareCode(profile.id)
      setShareCode(code)
      setShowShare(true)
    } finally {
      setShareLoading(false)
    }
  }

  const handleRevoke = async () => {
    await revokeShareCode(profile.id)
    setShareCode(null)
    setShowShare(false)
  }


  const inProgress = result.skill_gaps.filter(g => g.status === 'learning').length
  const completed  = result.skill_gaps.filter(g => g.status === 'completed').length
  const total      = result.skill_gaps.length

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'gaps', label: 'Skill Gaps', count: result.skill_gaps.length },
    { id: 'roadmap', label: 'Resource Roadmap', count: result.ordered_roadmap.length },
  ]

  return (
    <div className="space-y-4">

      {/* Source badge + stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            result.source === 'ai'
              ? 'bg-dodger-blue-50 text-dodger-blue-700 border-dodger-blue-200'
              : 'bg-sunflower-gold-50 text-sunflower-gold-700 border-sunflower-gold-200'
          }`}>
            {result.source === 'ai' ? '✦ AI-Powered' : '⚠ Fallback Mode (Rule-Based)'}
          </span>
          {result.source === 'fallback' && (
            <span className="text-xs text-gray-400">Gemini unavailable — keyword analysis used</span>
          )}
        </div>
        <button
          onClick={handleShare}
          disabled={shareLoading}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-dodger-blue-200 text-dodger-blue-700 bg-dodger-blue-50 hover:bg-dodger-blue-100 transition-colors disabled:opacity-50"
        >
          {shareLoading ? 'Generating…' : shareCode ? (showShare ? 'Hide link' : 'Show link') : 'Share with Mentor'}
        </button>
      </div>

      {/* Share panel */}
      {showShare && shareCode && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-green-800 mb-1">Share this link with your mentor</p>
            <p className="text-xs text-green-700 font-mono bg-white border border-green-200 rounded px-2 py-1 inline-block select-all">
              {`${window.location.origin}/?mentor=${shareCode}`}
            </p>
            <p className="text-xs text-green-600 mt-1">Code: <span className="font-bold tracking-widest">{shareCode}</span> — read-only, no login required</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?mentor=${shareCode}`)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              Copy link
            </button>
            <button
              onClick={handleRevoke}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-raspberry-red-200 text-raspberry-red-600 hover:bg-dodger-blue-50 transition-colors"
            >
              Revoke
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-dodger-blue-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                activeTab === tab.id ? 'bg-dodger-blue-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Hero row: match % + snapshot + priority */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col items-center justify-center">
              <div className={`text-5xl font-bold mb-1 ${
                result.match_percent >= 70 ? 'text-green-600' :
                result.match_percent >= 40 ? 'text-sunflower-gold-500' : 'text-raspberry-red-500'
              }`}>
                {result.match_percent}%
              </div>
              <div className="text-sm text-gray-500">match with {result.target_role}</div>
              {result.time_to_hire_ready_weeks && (
                <div className="mt-3 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                  ~{result.time_to_hire_ready_weeks} weeks to hire-ready
                </div>
              )}
            </div>

            <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Career Snapshot</span>
                <span className="text-xs text-gray-300 bg-gray-100 px-1.5 py-0.5 rounded">AI-generated summary</span>
              </div>
              <p className="text-gray-700 text-sm leading-relaxed">{result.career_snapshot}</p>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                  Your #1 Priority This Week
                </div>
                {sprintPlan && sprintPlan.sprint_skills.length > 0 ? (
                  <p className="text-sm font-medium text-dodger-blue-700">
                    Start with '{sprintPlan.sprint_skills[0].skill}' — {sprintPlan.sprint_skills[0].weeks}w, highest ROI in your sprint.
                  </p>
                ) : (
                  <p className="text-sm font-medium text-dodger-blue-700">{result.priority_next_step}</p>
                )}
              </div>
            </div>
          </div>

          {/* Progress bar — always visible */}
          {total > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
              <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
                <span className="font-medium text-gray-600">Gap Progress</span>
                <span>
                  <span className="text-green-600 font-medium">{completed} done</span>
                  {' · '}
                  <span className="text-dodger-blue-500 font-medium">{inProgress} learning</span>
                  {' · '}
                  {total - completed - inProgress} not started
                </span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden flex">
                <div className="bg-green-500 h-full transition-all duration-300" style={{ width: `${(completed / total) * 100}%` }} />
                <div className="bg-dodger-blue-400 h-full transition-all duration-300" style={{ width: `${(inProgress / total) * 100}%` }} />
              </div>
              {completed === 0 && inProgress === 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  Mark skills as Learning or Done in the Gaps tab to track your progress here.
                </p>
              )}
            </div>
          )}

          {/* Proficiency check */}
          <ProficiencyCheck
            skillGaps={result.skill_gaps}
            profileId={profile.id}
            levels={profLevels}
            onLevelChange={(skill: string, level: ProfLevel) => setProfLevels(prev => ({ ...prev, [skill]: level }))}
          />

          {/* Transferable skills (switcher mode) */}
          {profile.audience_mode === 'switcher' && result.transferable_skills.length > 0 && (
            <TransferableSkills items={result.transferable_skills} />
          )}

          {/* Sprint planner */}
          <SprintPlanner
            weeks={sprintWeeks}
            plan={sprintPlan}
            loading={sprintLoading}
            onWeeksChange={setSprintWeeks}
            skillStatuses={Object.fromEntries(result.skill_gaps.map(g => [g.skill, g.status]))}
          />
        </div>
      )}

      {/* ── GAPS TAB ── */}
      {activeTab === 'gaps' && (
        <div className="space-y-4">
          {/* Skills present */}
          {result.skills_present.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-3">
                Skills Present <span className="text-green-600 font-bold">({result.skills_present.length})</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {result.skills_present.map(skill => (
                  <span key={skill} className="px-2.5 py-1 text-xs rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">
                    ✓ {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Skill gaps */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="font-semibold text-gray-900">
                Skill Gaps <span className="text-raspberry-red-500 font-bold">({result.skill_gaps.length})</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setFilterCat(cat)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                      filterCat === cat
                        ? 'bg-dodger-blue-600 text-white border-dodger-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredGaps.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No gaps in this category.</p>
            ) : (
              <div className="space-y-2">
                {filteredGaps.map(gap => (
                  <SkillGapRow
                    key={gap.skill}
                    gap={gap}
                    onStatusChange={handleSkillStatus}
                    updating={updatingSkill === gap.skill}
                    inSprint={sprintSkillNames.has(gap.skill)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ROADMAP TAB ── */}
      {activeTab === 'roadmap' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">
                Learning Roadmap
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {sprintOnly && sprintSkillNames.size > 0
                    ? `${sprintSkillNames.size} sprint steps (${sprintWeeks}w plan)`
                    : `${result.ordered_roadmap.length} prerequisite-ordered steps`}
                </span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Steps are ordered so you always learn prerequisites first. Each step includes free resources.
              </p>
            </div>
            {sprintSkillNames.size > 0 && (
              <button
                onClick={() => setSprintOnly(v => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                  sprintOnly
                    ? 'bg-dodger-blue-600 text-white border-dodger-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {sprintOnly ? '⚡ Sprint only' : 'Show sprint only'}
              </button>
            )}
          </div>
          <RoadmapView
            steps={
              sprintOnly && sprintSkillNames.size > 0
                ? result.ordered_roadmap.filter(s => sprintSkillNames.has(s.skill))
                : result.ordered_roadmap
            }
          />
        </div>
      )}

    </div>
  )
}

function SkillGapRow({
  gap,
  onStatusChange,
  updating,
  inSprint = false,
}: {
  gap: SkillGap
  onStatusChange: (skill: string, status: SkillStatus) => void
  updating: boolean
  inSprint?: boolean
}) {
  const [showWhy, setShowWhy] = useState(false)

  const statusColors: Record<SkillStatus, string> = {
    not_started: 'bg-raspberry-red-50 border-raspberry-red-200',
    learning:    'bg-dodger-blue-50 border-dodger-blue-200',
    completed:   'bg-green-50 border-green-200',
  }

  return (
    <div className={`rounded-lg border px-4 py-3 transition-colors ${statusColors[gap.status]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm text-gray-900 flex-1 min-w-0">{gap.skill}</span>

        {inSprint && (
          <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-dodger-blue-600 text-white border-dodger-blue-600">
            In Sprint
          </span>
        )}

        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TREND_BADGE[gap.trend]}`}>
          {TREND_ICON[gap.trend]} {gap.trend}
        </span>

        {gap.confidence < 1.0 && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            gap.confidence >= 0.7
              ? 'bg-gray-50 text-gray-500 border-gray-200'
              : 'bg-sunflower-gold-50 text-sunflower-gold-600 border-sunflower-gold-200'
          }`}>
            {gap.confidence < 0.7 ? '⚠ ' : ''}{Math.round(gap.confidence * 100)}% confidence
          </span>
        )}

        <span className="text-xs text-gray-400">{gap.weeks_to_learn}w</span>

        <button
          onClick={() => setShowWhy(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
          title="How did we identify this gap?"
        >
          why?
        </button>

        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {(['not_started', 'learning', 'completed'] as SkillStatus[]).map(s => (
            <button
              key={s}
              disabled={updating}
              onClick={() => onStatusChange(gap.skill, s)}
              className={`px-2 py-1 transition-colors disabled:opacity-50 ${
                gap.status === s
                  ? s === 'completed' ? 'bg-green-500 text-white'
                    : s === 'learning' ? 'bg-dodger-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {s === 'not_started' ? '—' : s === 'learning' ? 'Learning' : '✓ Done'}
            </button>
          ))}
        </div>
      </div>

      {gap.prerequisites.length > 0 && (
        <div className="mt-1.5 text-xs text-gray-400">
          Prereqs: {gap.prerequisites.join(' → ')}
        </div>
      )}

      {showWhy && gap.prerequisite_reasoning && (
        <div className="mt-2 text-xs text-gray-500 bg-white border border-gray-100 rounded px-3 py-2">
          {gap.prerequisite_reasoning}
        </div>
      )}
    </div>
  )
}


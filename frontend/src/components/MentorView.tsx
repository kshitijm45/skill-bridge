import { useState } from 'react'
import { type Profile, type AnalysisResult, type SkillGap } from '../api'
import RoadmapView from './RoadmapView'

type SortMode = 'impact' | 'effort'

export default function MentorView({
  result,
}: {
  profile: Profile
  result: AnalysisResult
  onUpdateResult?: (r: AnalysisResult) => void
}) {
  const [sortMode, setSortMode] = useState<SortMode>('impact')
  const [showRoadmap, setShowRoadmap] = useState(false)

  const completed = result.skill_gaps.filter(g => g.status === 'completed').length
  const learning  = result.skill_gaps.filter(g => g.status === 'learning').length
  const total     = result.skill_gaps.length
  const totalWeeks = result.skill_gaps.reduce((s, g) => s + g.weeks_to_learn, 0)

  const sortedGaps: SkillGap[] = [...result.skill_gaps].sort((a, b) => {
    if (sortMode === 'impact') {
      const trendScore: Record<string, number> = { rising: 2, stable: 1, declining: 0 }
      return (trendScore[b.trend] ?? 0) - (trendScore[a.trend] ?? 0)
    }
    return a.weeks_to_learn - b.weeks_to_learn
  })

  const handleExport = () => {
    const lines = [
      `LEARNING ROADMAP — ${result.target_role}`,
      `Match: ${result.match_percent}%`,
      `Generated: ${new Date().toLocaleDateString()}`,
      '',
      'CAREER SNAPSHOT',
      result.career_snapshot,
      '',
      'TOP PRIORITY GAPS',
      ...sortedGaps.slice(0, 3).map((g, i) =>
        `${i + 1}. ${g.skill} (${g.weeks_to_learn}w, ${g.trend})`
      ),
      '',
      'FULL ROADMAP',
      ...result.ordered_roadmap.map(s =>
        `Step ${s.step}: ${s.skill} (${s.weeks}w) — ${s.why}`
      ),
      '',
      'SKILLS PRESENT',
      result.skills_present.join(', '),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${result.target_role.replace(/\s+/g, '_')}_roadmap.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Mentee Progress</p>
          <h2 className="text-2xl font-bold text-gray-900">{result.target_role}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {result.match_percent}% match &middot; {total} gaps to close &middot; ~{totalWeeks}w total
          </p>
        </div>
        <button
          onClick={handleExport}
          className="px-4 py-2 text-sm bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg font-medium transition-colors"
        >
          ↓ Export (.txt)
        </button>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Role Match"
          value={`${result.match_percent}%`}
          color={result.match_percent >= 70 ? 'text-green-600' : result.match_percent >= 40 ? 'text-sunflower-gold-500' : 'text-raspberry-red-500'}
        />
        <StatCard label="Skills Present" value={String(result.skills_present.length)} color="text-blue-600" />
        <StatCard label="Gaps Remaining" value={String(total - completed)} color="text-gray-700" />
        <StatCard label="In Progress" value={String(learning)} color="text-purple-600" />
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
            <span>Gap Progress</span>
            <span>{completed} done · {learning} learning · {total - completed - learning} not started</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
            <div className="bg-green-500 h-full transition-all" style={{ width: `${(completed / total) * 100}%` }} />
            <div className="bg-blue-400 h-full transition-all" style={{ width: `${(learning / total) * 100}%` }} />
          </div>
          {result.priority_next_step && (
            <p className="mt-3 text-xs">
              <span className="text-gray-400">Next priority: </span>
              <span className="text-blue-700 font-medium">{result.priority_next_step}</span>
            </p>
          )}
        </div>
      )}

      {/* Career snapshot */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Career Snapshot</p>
        <p className="text-sm text-gray-700 leading-relaxed">{result.career_snapshot}</p>
      </div>

      {/* Confirmed skills */}
      {result.skills_present.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-3">
            Confirmed Skills <span className="text-green-600">({result.skills_present.length})</span>
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
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Skill Gaps to Bridge</h3>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => setSortMode('impact')}
              className={`px-3 py-1.5 transition-colors ${sortMode === 'impact' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              By Impact
            </button>
            <button
              onClick={() => setSortMode('effort')}
              className={`px-3 py-1.5 transition-colors ${sortMode === 'effort' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              By Effort
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {sortedGaps.map((gap, i) => (
            <GapRow key={gap.skill} gap={gap} rank={i + 1} highlight={i < 3} />
          ))}
        </div>
      </div>

      {/* 30/60/90 plan */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Suggested 30/60/90 Day Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PlanPeriod label="First 30 Days"  color="border-blue-200 bg-blue-50"     labelColor="text-blue-700"   steps={result.ordered_roadmap.slice(0, 2)} />
          <PlanPeriod label="Days 30–60"     color="border-purple-200 bg-purple-50" labelColor="text-purple-700" steps={result.ordered_roadmap.slice(2, 4)} />
          <PlanPeriod label="Days 60–90"     color="border-green-200 bg-green-50"   labelColor="text-green-700"  steps={result.ordered_roadmap.slice(4, 6)} />
        </div>
      </div>

      {/* Full roadmap */}
      <div>
        <button
          onClick={() => setShowRoadmap(v => !v)}
          className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl shadow-sm px-5 py-4 hover:bg-gray-50 transition-colors"
        >
          <span className="font-semibold text-gray-900">
            Full Learning Roadmap — {result.ordered_roadmap.length} prerequisite-ordered steps
          </span>
          <span className="text-sm text-gray-400">{showRoadmap ? '↑ Collapse' : '↓ Expand'}</span>
        </button>
        {showRoadmap && <RoadmapView steps={result.ordered_roadmap} />}
      </div>

    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  )
}

function GapRow({ gap, rank, highlight }: { gap: SkillGap; rank: number; highlight: boolean }) {
  const trendColor = {
    rising:   'bg-green-50 text-green-700 border-green-200',
    stable:   'bg-gray-50 text-gray-500 border-gray-200',
    declining:'bg-raspberry-red-50 text-raspberry-red-600 border-raspberry-red-200',
  }[gap.trend]
  const trendIcon = { rising: '↑', stable: '→', declining: '↓' }[gap.trend]
  const statusColor = {
    not_started: '',
    learning: 'text-blue-600 font-medium',
    completed: 'text-green-600 font-medium',
  }[gap.status]
  const statusLabel = {
    not_started: '',
    learning: 'Learning',
    completed: '✓ Done',
  }[gap.status]

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${
      highlight ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'
    }`}>
      <span className={`font-bold text-xs w-5 flex-shrink-0 ${highlight ? 'text-blue-600' : 'text-gray-400'}`}>
        {rank}
      </span>
      <span className="font-medium text-gray-900 flex-1 min-w-0">{gap.skill}</span>
      {statusLabel && (
        <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
      )}
      <span className="text-xs text-gray-400">{gap.weeks_to_learn}w</span>
      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${trendColor}`}>
        {trendIcon} {gap.trend}
      </span>
    </div>
  )
}

function PlanPeriod({
  label, color, labelColor, steps,
}: {
  label: string
  color: string
  labelColor: string
  steps: AnalysisResult['ordered_roadmap']
}) {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className={`text-sm font-semibold mb-3 ${labelColor}`}>{label}</div>
      {steps.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No steps scheduled</p>
      ) : (
        <ul className="space-y-1">
          {steps.map(s => (
            <li key={s.step} className="text-xs text-gray-700 flex items-start gap-1.5">
              <span className="text-gray-400 flex-shrink-0">•</span>
              <span>{s.skill} <span className="text-gray-400">({s.weeks}w)</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

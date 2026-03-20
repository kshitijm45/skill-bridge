import { type SprintPlan, type SprintSkill } from '../api'

const CATEGORY_COLOR: Record<string, string> = {
  Cloud:          'bg-sky-100 text-sky-700 border-sky-200',
  Security:       'bg-raspberry-red-100 text-raspberry-red-700 border-raspberry-red-200',
  Backend:        'bg-dodger-blue-100 text-dodger-blue-700 border-dodger-blue-200',
  Data:           'bg-teal-100 text-teal-700 border-teal-200',
  Infrastructure: 'bg-dodger-blue-100 text-dodger-blue-700 border-dodger-blue-200',
  Languages:      'bg-raspberry-red-100 text-raspberry-red-700 border-dodger-blue-200',
  General:        'bg-gray-100 text-gray-600 border-gray-200',
}

const TREND_ICON: Record<string, string> = {
  rising: '↑', stable: '→', declining: '↓',
}
const TREND_COLOR: Record<string, string> = {
  rising: 'text-green-600', stable: 'text-gray-500', declining: 'text-raspberry-red-500',
}

const WEEK_OPTIONS = [4, 8, 12, 16, 20, 24]

export default function SprintPlanner({
  weeks,
  plan,
  loading,
  onWeeksChange,
  skillStatuses = {},
}: {
  weeks: number
  plan: SprintPlan | null
  loading: boolean
  onWeeksChange: (w: number) => void
  skillStatuses?: Record<string, string>
}) {

  const activeSkills = plan?.sprint_skills.filter(s => skillStatuses[s.skill] !== 'completed') ?? []
  const doneSkills   = plan?.sprint_skills.filter(s => skillStatuses[s.skill] === 'completed') ?? []

  const matchGainColor = !plan ? 'text-gray-400'
    : plan.match_gain >= 20 ? 'text-green-600'
    : plan.match_gain >= 10 ? 'text-sunflower-gold-500'
    : 'text-dodger-blue-600'

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-semibold text-gray-900">Sprint Planner</h3>
          <span className="text-xs bg-dodger-blue-50 text-dodger-blue-700 border border-dodger-blue-200 px-2 py-0.5 rounded-full font-medium">
            New
          </span>
        </div>
        <p className="text-xs text-gray-400">
          Set your time budget — we'll pick the skills that close the most gaps per week invested.
        </p>
      </div>

      {/* Week budget selector */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Time budget</span>
          <span className="text-sm font-bold text-dodger-blue-700">{weeks} weeks</span>
        </div>
        <input
          type="range"
          min={2}
          max={24}
          step={2}
          value={weeks}
          onChange={e => onWeeksChange(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-dodger-blue-600"
        />
        {/* Tick labels pinned to their actual slider positions */}
        <div className="relative h-5 mt-1">
          {WEEK_OPTIONS.map(w => (
            <button
              key={w}
              onClick={() => onWeeksChange(w)}
              style={{ left: `${((w - 2) / (24 - 2)) * 100}%` }}
              className={`absolute -translate-x-1/2 text-xs px-1 py-0.5 rounded transition-colors ${
                weeks === w
                  ? 'text-dodger-blue-700 font-semibold'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {w}w
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="text-xs text-gray-400 text-center py-4 animate-pulse">
          Calculating optimal sprint…
        </div>
      )}

      {!loading && plan && (
        <>
          {/* Match % impact bar */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
            {/* Numbers row */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-gray-500">{plan.current_match}%</div>
                <div className="text-xs text-gray-400">Today</div>
              </div>
              {plan.match_gain > 0 && (
                <span className={`text-sm font-semibold px-2 py-0.5 rounded-full bg-green-50 border border-green-200 ${matchGainColor}`}>
                  +{plan.match_gain}%
                </span>
              )}
              <div className="text-right">
                <div className={`text-2xl font-bold ${plan.match_gain > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                  {plan.sprint_match}%
                </div>
                <div className="text-xs text-gray-400">After sprint</div>
              </div>
            </div>

            {/* Full-width bar */}
            <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full bg-gray-400 rounded-full"
                style={{ width: `${plan.current_match}%` }}
              />
              {plan.match_gain > 0 && (
                <div
                  className="absolute top-0 h-full bg-green-500 rounded-full transition-all duration-500"
                  style={{ left: `${plan.current_match}%`, width: `${plan.match_gain}%` }}
                />
              )}
            </div>

            {/* Tick labels aligned to bar positions */}
            <div className="relative h-4 text-xs text-gray-400">
              <span
                className="absolute -translate-x-1/2"
                style={{ left: `${plan.current_match}%` }}
              >
                {plan.current_match}%
              </span>
              {plan.match_gain > 0 && (
                <span
                  className="absolute -translate-x-1/2 text-green-600 font-medium"
                  style={{ left: `${plan.sprint_match}%` }}
                >
                  {plan.sprint_match}%
                </span>
              )}
            </div>

            <div className="text-xs text-gray-400">
              {plan.weeks_used}w of {plan.weeks_budget}w used
              {plan.weeks_used < plan.weeks_budget && (
                <span className="ml-1 text-sunflower-gold-500">
                  · {plan.weeks_budget - plan.weeks_used}w spare
                </span>
              )}
            </div>
          </div>

          {/* Sprint skills */}
          {plan.sprint_skills.length > 0 ? (
            <div className="space-y-3">
              {activeSkills.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Focus on these {activeSkills.length} skills
                  </div>
                  <div className="space-y-2">
                    {activeSkills.map((skill, i) => (
                      <SprintSkillRow key={skill.skill} skill={skill} rank={i + 1} />
                    ))}
                  </div>
                </div>
              )}

              {doneSkills.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-2">
                    ✓ Completed ({doneSkills.length})
                  </div>
                  <div className="space-y-1.5">
                    {doneSkills.map(skill => (
                      <div key={skill.skill} className="flex items-center gap-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg opacity-60">
                        <span className="text-green-600 text-sm">✓</span>
                        <span className="text-sm text-gray-500 line-through">{skill.skill}</span>
                        <span className="text-xs text-gray-400 ml-auto">{skill.weeks}w</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeSkills.length === 0 && doneSkills.length > 0 && (
                <p className="text-sm text-green-600 text-center py-1 font-medium">
                  All sprint skills complete — time to expand your plan!
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-2">
              No gaps fit in this time budget — try increasing the weeks.
            </p>
          )}

          {/* Skipped skills */}
          {plan.skipped_skills.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Deferred ({plan.skipped_skills.length} skills — tackle after sprint)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.skipped_skills.map(s => (
                  <span
                    key={s.skill}
                    className="text-xs px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-500"
                  >
                    {s.skill} · {s.weeks}w
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SprintSkillRow({ skill, rank }: { skill: SprintSkill; rank: number }) {
  const efficiencyPct = Math.min(Math.round(skill.efficiency_score * 100 * 4), 100) // normalise to visual bar

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-dodger-blue-50 border border-dodger-blue-100 rounded-lg">
      {/* Rank */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-dodger-blue-600 to-cornflower-ocean-400 text-white text-xs font-bold flex items-center justify-center">
        {rank}
      </div>

      {/* Name + category */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{skill.skill}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${CATEGORY_COLOR[skill.category] ?? CATEGORY_COLOR.General}`}>
            {skill.category}
          </span>
          <span className={`text-xs font-medium ${TREND_COLOR[skill.trend]}`}>
            {TREND_ICON[skill.trend]} {skill.trend}
          </span>
        </div>
        {/* Efficiency bar */}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-dodger-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-dodger-blue-500 rounded-full"
              style={{ width: `${efficiencyPct}%` }}
            />
          </div>
          <span className="text-xs text-dodger-blue-500 whitespace-nowrap flex-shrink-0">
            best ROI
          </span>
        </div>
      </div>

      {/* Weeks badge */}
      <div className="flex-shrink-0 text-right">
        <div className="text-sm font-bold text-gray-700">{skill.weeks}w</div>
      </div>
    </div>
  )
}

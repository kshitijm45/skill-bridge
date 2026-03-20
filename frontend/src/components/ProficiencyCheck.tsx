import { useState, useEffect } from 'react'
import { type SkillGap } from '../api'

type Level = 'none' | 'familiar' | 'used'

const LEVELS: { id: Level; label: string; multiplier: number }[] = [
  { id: 'none',     label: 'Never used',  multiplier: 1.0 },
  { id: 'familiar', label: 'Know basics', multiplier: 0.6 },
  { id: 'used',     label: 'Used it',     multiplier: 0.3 },
]

export default function ProficiencyCheck({
  skillGaps,
  profileId,
  levels: externalLevels,
  onLevelChange,
}: {
  skillGaps: SkillGap[]
  profileId: number
  levels?: Record<string, Level>
  onLevelChange?: (skill: string, level: Level) => void
}) {
  const [internalLevels, setInternalLevels] = useState<Record<string, Level>>(() => {
    try {
      const saved = localStorage.getItem(`sb_proficiency_${profileId}`)
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })

  // Use external levels if provided (lifted state), otherwise use internal
  const levels = externalLevels ?? internalLevels

  useEffect(() => {
    if (!externalLevels) {
      localStorage.setItem(`sb_proficiency_${profileId}`, JSON.stringify(internalLevels))
    }
  }, [internalLevels, profileId, externalLevels])

  const setLevel = (skill: string, level: Level) => {
    if (onLevelChange) {
      onLevelChange(skill, level)
    } else {
      setInternalLevels(prev => ({ ...prev, [skill]: level }))
    }
  }

  const totalRaw = skillGaps.reduce((sum, g) => sum + g.weeks_to_learn, 0)
  const totalAdjusted = Math.round(
    skillGaps.reduce((sum, g) => {
      const level = levels[g.skill] ?? 'none'
      const mult = LEVELS.find(l => l.id === level)!.multiplier
      return sum + g.weeks_to_learn * mult
    }, 0)
  )

  const savedWeeks = totalRaw - totalAdjusted
  const ratedAboveNone = skillGaps.filter(g => levels[g.skill] && levels[g.skill] !== 'none')
  const hardestGap = skillGaps.find(g => !levels[g.skill] || levels[g.skill] === 'none')

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Proficiency Check</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Rate your current level in each gap — we'll adjust your learning timeline accordingly.
        </p>
      </div>

      <div className="divide-y divide-gray-50">
        {skillGaps.map(gap => {
          const current = levels[gap.skill] ?? 'none'
          const adjWeeks = Math.round(
            gap.weeks_to_learn * (LEVELS.find(l => l.id === current)!.multiplier)
          )

          return (
            <div key={gap.skill} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-800">{gap.skill}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {current !== 'none' && adjWeeks !== gap.weeks_to_learn
                    ? <><s>{gap.weeks_to_learn}w</s> → {adjWeeks}w</>
                    : <>{gap.weeks_to_learn}w</>
                  }
                </span>
              </div>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs flex-shrink-0">
                {LEVELS.map(l => (
                  <button
                    key={l.id}
                    onClick={() => setLevel(gap.skill, l.id)}
                    className={`px-2.5 py-1.5 transition-colors ${
                      current === l.id
                        ? l.id === 'none'
                          ? 'bg-raspberry-red-100 text-raspberry-red-700 font-medium'
                          : l.id === 'familiar'
                          ? 'bg-sunflower-gold-100 text-sunflower-gold-700 font-medium'
                          : 'bg-green-100 text-green-700 font-medium'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      <div className="pt-3 border-t border-gray-100 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Estimated learning time</span>
          <div className="flex items-center gap-2">
            {savedWeeks > 0 && (
              <span className="text-xs line-through text-gray-400">{totalRaw}w</span>
            )}
            <span className="text-sm font-bold text-gray-900">{totalAdjusted}w</span>
            {savedWeeks > 0 && (
              <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full">
                −{savedWeeks}w saved
              </span>
            )}
          </div>
        </div>

        {ratedAboveNone.length > 0 && hardestGap && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
            Your prior experience in{' '}
            <span className="font-medium text-gray-700">
              {ratedAboveNone.map(g => g.skill).join(', ')}
            </span>{' '}
            cuts your timeline. Prioritise{' '}
            <span className="font-medium text-gray-700">{hardestGap.skill}</span> — zero prior exposure, biggest gap to close.
          </p>
        )}

        {ratedAboveNone.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-1">
            Rate your skills above to get a personalised timeline.
          </p>
        )}

        {hardestGap === undefined && skillGaps.length > 0 && (
          <p className="text-xs text-green-600 text-center py-1 font-medium">
            Great — you have some experience in all gap skills. Focus on formalising each one.
          </p>
        )}
      </div>
    </div>
  )
}

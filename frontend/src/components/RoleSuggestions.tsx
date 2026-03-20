import { useState } from 'react'
import { createProfile, analyzeProfile, type RoleSuggestion, type Profile, type AnalysisResult } from '../api'

export default function RoleSuggestions({
  suggestions,
  pendingResume,
  forceMode,
  onReady,
  onBack,
}: {
  suggestions: RoleSuggestion[]
  pendingResume: { text: string; file: File | null; currentCareer: string }
  forceMode: 'ai' | 'fallback'
  onReady: (profile: Profile, result: AnalysisResult) => void
  onBack: () => void
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const handleExplore = async (role: string) => {
    setLoading(role)
    setError('')
    try {
      const profile = await createProfile({
        target_role: role,
        audience_mode: 'switcher',
        ...(pendingResume.currentCareer ? { current_career: pendingResume.currentCareer } : {}),
        ...(pendingResume.file ? { resume_file: pendingResume.file } : { resume_text: pendingResume.text }),
      })
      const result = await analyzeProfile(profile.id, forceMode)
      onReady(profile, result)
    } catch {
      setError('Failed to analyze this role. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1">
        ← Back
      </button>

      <h2 className="text-2xl font-bold mb-1 bg-gradient-to-r from-dodger-blue-600 to-cornflower-ocean-400 bg-clip-text text-transparent">Best-Fit Roles For You</h2>
      <p className="text-gray-500 mb-8 text-sm">
        Based on your resume, here are the roles where your background translates best. Pick one to get a full gap analysis.
      </p>

      {error && (
        <div className="text-sm text-raspberry-red-600 bg-raspberry-red-50 border border-raspberry-red-200 rounded-lg px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {suggestions.map((s, i) => (
          <div key={s.role} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-start gap-4">
              {/* Left: content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  {i === 0 && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-dodger-blue-100 text-dodger-blue-700 border border-dodger-blue-200">
                      Best Match
                    </span>
                  )}
                  <h3 className="font-semibold text-gray-900">{s.role}</h3>
                </div>

                <p className="text-sm text-gray-600 mb-3 leading-relaxed">{s.fit_reasoning}</p>

                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                  {s.transferable_skills.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-gray-400">You have:</span>
                      {s.transferable_skills.map(skill => (
                        <span key={skill} className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                  {s.primary_gap && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400">Key gap:</span>
                      <span className="px-2 py-0.5 rounded-full bg-sunflower-gold-50 text-sunflower-gold-700 border border-sunflower-gold-100">
                        {s.primary_gap}
                      </span>
                    </div>
                  )}
                  <span className="text-gray-400">~{s.weeks_to_bridge}w to bridge</span>
                </div>

                {/* Match bar */}
                <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${s.match_percent}%`,
                      backgroundColor: s.match_percent >= 60 ? '#22c55e' : s.match_percent >= 35 ? '#7c3aed' : '#f59e0b',
                    }}
                  />
                </div>
              </div>

              {/* Right: match% + button */}
              <div className="flex flex-col items-end gap-3 flex-shrink-0">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">~{s.match_percent}%</div>
                  <div className="text-xs text-gray-400">est. match</div>
                </div>
                <button
                  onClick={() => handleExplore(s.role)}
                  disabled={!!loading}
                  className="px-3 py-1.5 text-sm font-medium bg-dodger-blue-600 text-white rounded-lg hover:bg-dodger-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {loading === s.role ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Analyzing…
                    </span>
                  ) : 'Explore →'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

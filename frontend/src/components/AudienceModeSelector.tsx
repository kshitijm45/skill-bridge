import { useState } from 'react'
import { type AudienceMode } from '../api'

const MODES: {
  id: AudienceMode
  title: string
  subtitle: string
  description: string
  icon: string
  color: string
}[] = [
  {
    id: 'graduate',
    title: "I'm a new grad",
    subtitle: 'Recent Graduate',
    description: 'See which courses you need to do, get a time-to-hire-ready estimate, and find your concrete next step.',
    icon: '🎓',
    color: 'border-dodger-blue-200 hover:border-dodger-blue-400 hover:bg-dodger-blue-50',
  },
  {
    id: 'switcher',
    title: "I want to switch careers",
    subtitle: 'Career Switcher',
    description: 'Upload your resume and we\'ll identify which tech roles fit your background best — then show you exactly what to bridge to get there.',
    icon: '🔄',
    color: 'border-dodger-blue-200 hover:border-dodger-blue-500 hover:bg-dodger-blue-50',
  },
]

export default function AudienceModeSelector({
  onSelect,
  forceMode,
  onForceModeChange,
}: {
  onSelect: (mode: AudienceMode) => void
  forceMode: 'ai' | 'fallback'
  onForceModeChange: (mode: 'ai' | 'fallback') => void
}) {
  const [showDemoPanel, setShowDemoPanel] = useState(false)

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-3 bg-gradient-to-r from-dodger-blue-600 to-cornflower-ocean-400 bg-clip-text text-transparent">
          Career Navigator
        </h1>
        <p className="text-gray-500 text-lg max-w-xl mx-auto">
          AI-powered gap analysis between your skills and your target role —
          with a prerequisite-ordered roadmap to get you there.
        </p>
      </div>

      <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4 text-center">
        Who are you?
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onSelect(mode.id)}
            className={`text-left p-6 rounded-xl border-2 bg-white transition-all duration-150 shadow-sm hover:shadow-md ${mode.color}`}
          >
            <div className="text-3xl mb-3">{mode.icon}</div>
            <div className="font-semibold text-gray-900 mb-1">{mode.title}</div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
              {mode.subtitle}
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{mode.description}</p>
          </button>
        ))}
      </div>

      {/* Demo controls */}
      <div className="mt-8 max-w-2xl mx-auto">
        <button
          onClick={() => setShowDemoPanel(v => !v)}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors mx-auto"
        >
          <span className="w-4 h-4 rounded border border-gray-300 flex items-center justify-center text-[10px]">⚙</span>
          Demo controls {showDemoPanel ? '↑' : '↓'}
        </button>

        {showDemoPanel && (
          <div className="mt-3 p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Analysis mode</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {forceMode === 'ai' ? 'Using Gemini AI — richer results, career snapshot, transferable skills' : 'Using keyword matcher — fast, deterministic, no API call'}
              </p>
            </div>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs flex-shrink-0">
              <button
                onClick={() => onForceModeChange('ai')}
                className={`px-3 py-2 font-medium transition-colors ${forceMode === 'ai' ? 'bg-dodger-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                ✦ AI
              </button>
              <button
                onClick={() => onForceModeChange('fallback')}
                className={`px-3 py-2 font-medium transition-colors ${forceMode === 'fallback' ? 'bg-sunflower-gold-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                ⚠ Fallback
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Responsible AI note */}
      <div className="mt-4 max-w-2xl mx-auto p-4 bg-sunflower-gold-50 border border-sunflower-gold-200 rounded-lg text-sm text-sunflower-gold-800">
        <span className="font-semibold">Note:</span> This tool uses synthetic job description data only.
        Analysis is AI-assisted with a rule-based fallback — always use as a starting point,
        not a definitive verdict.
      </div>
    </div>
  )
}

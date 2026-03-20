import { useState } from 'react'
import { type RoadmapStep } from '../api'

const CATEGORY_COLOR: Record<string, string> = {
  Cloud:          'bg-sky-100 text-sky-700',
  Security:       'bg-raspberry-red-100 text-raspberry-red-700',
  Backend:        'bg-dodger-blue-100 text-dodger-blue-700',
  Frontend:       'bg-pink-100 text-pink-700',
  Data:           'bg-teal-100 text-teal-700',
  Infrastructure: 'bg-dodger-blue-100 text-dodger-blue-700',
  Languages:      'bg-raspberry-red-100 text-raspberry-red-700',
  General:        'bg-gray-100 text-gray-600',
}

export default function RoadmapView({ steps }: { steps: RoadmapStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="mt-2 bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
        No roadmap steps — you may already meet all the requirements.
      </div>
    )
  }

  const totalWeeks = steps.reduce((sum, s) => sum + s.weeks, 0)

  return (
    <div className="mt-2 bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <p className="text-xs text-gray-400">
        Total estimated time: <span className="font-medium text-gray-600">{totalWeeks} weeks</span> if done sequentially.
        Steps are ordered by prerequisite dependency — start from Step 1.
      </p>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-5 top-6 bottom-6 w-px bg-gray-200" />

        <div className="space-y-3">
          {steps.map(step => (
            <RoadmapCard key={step.step} step={step} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RoadmapCard({ step }: { step: RoadmapStep }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex gap-4 relative z-10">
      {/* Step number bubble */}
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold shadow-sm">
        {step.step}
      </div>

      {/* Card content */}
      <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">{step.skill}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLOR[step.category] ?? CATEGORY_COLOR.General}`}>
            {step.category}
          </span>
          <span className="text-xs text-gray-400 ml-auto">{step.weeks}w</span>
        </div>

        {/* Why tooltip */}
        {step.why && (
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{step.why}</p>
        )}

        {/* Resources (expandable) */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          {expanded ? '↑ Hide resources' : `↓ Free resources (${step.resources.length})`}
        </button>

        {expanded && (
          <ul className="mt-2 space-y-1">
            {step.resources.map(r => (
              <li key={r.url} className="text-xs text-gray-600 flex items-start gap-1.5">
                <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {r.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

import { type TransferableSkill } from '../api'

export default function TransferableSkills({ items }: { items: TransferableSkill[] }) {
  if (items.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-green-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="font-semibold text-gray-900">Transferable Skills</h3>
        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
          Career Switcher
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        These existing skills map directly to your target role — they're strengths, not gaps.
      </p>

      <div className="space-y-3">
        {items.map(item => (
          <div
            key={item.existing_skill}
            className="p-3 bg-green-50 rounded-lg border border-green-100 space-y-1.5"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-green-800">
                {item.existing_skill}
              </span>
              <span className="text-green-400 text-xs flex-shrink-0">→</span>
              <span className="text-sm font-semibold text-green-800">
                {item.maps_to}
              </span>
            </div>
            <p className="text-xs text-green-700 leading-relaxed">
              {item.explanation}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

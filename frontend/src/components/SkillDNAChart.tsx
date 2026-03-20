import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend, Tooltip,
} from 'recharts'
import { type SkillGap } from '../api'

const AXES = ['Cloud', 'Security', 'Backend', 'Data', 'Infrastructure', 'Languages']

const CATEGORY_TO_AXIS: Record<string, string> = {
  Cloud:          'Cloud',
  Security:       'Security',
  Backend:        'Backend',
  Frontend:       'Backend',  // group frontend into Backend axis
  Data:           'Data',
  Infrastructure: 'Infrastructure',
  Languages:      'Languages',
  General:        'Backend',
}

function scoreAxis(axis: string, skillsPresent: string[], skillGaps: SkillGap[], taxonomy: Record<string, string>): number {
  const present = skillsPresent.filter(s => (CATEGORY_TO_AXIS[taxonomy[s]] ?? 'Backend') === axis).length
  const gap     = skillGaps.filter(g => (CATEGORY_TO_AXIS[g.category] ?? 'Backend') === axis).length
  const total   = present + gap
  if (total === 0) return 0
  return Math.round((present / total) * 100)
}

function roleScore(axis: string, skillGaps: SkillGap[], skillsPresent: string[], taxonomy: Record<string, string>): number {
  // Role score = 100% on axes where skills are required (present or gap)
  const hasAny =
    skillGaps.some(g => (CATEGORY_TO_AXIS[g.category] ?? 'Backend') === axis) ||
    skillsPresent.some(s => (CATEGORY_TO_AXIS[taxonomy[s]] ?? 'Backend') === axis)
  return hasAny ? 100 : 20  // show a baseline of 20 so the shape is visible
}

// Static category lookup — mirrors what's in the taxonomy
const SKILL_CATEGORY: Record<string, string> = {
  Python: 'Languages', JavaScript: 'Languages', TypeScript: 'Languages',
  Java: 'Languages', Go: 'Languages', SQL: 'Data',
  Linux: 'Infrastructure', Networking: 'Security', Docker: 'Cloud',
  Kubernetes: 'Cloud', Terraform: 'Cloud', AWS: 'Cloud', GCP: 'Cloud',
  Azure: 'Cloud', 'CI/CD': 'Cloud', React: 'Frontend',
  'REST APIs': 'Backend', 'Machine Learning': 'Data', Spark: 'Data',
  Airflow: 'Data', 'Log Analysis': 'Security', SIEM: 'Security',
  'Threat Intelligence': 'Security', 'Penetration Testing': 'Security',
  'Incident Response': 'Security', 'Cloud Security': 'Security',
  DevSecOps: 'Security', 'Vulnerability Management': 'Security',
  Git: 'Backend', 'System Design': 'Backend', 'Data Structures': 'Backend',
  Prometheus: 'Cloud',
}

export default function SkillDNAChart({
  skillsPresent,
  skillGaps,
  targetRole,
}: {
  skillsPresent: string[]
  skillGaps: SkillGap[]
  targetRole: string
}) {
  const data = AXES.map(axis => ({
    axis,
    You:  scoreAxis(axis, skillsPresent, skillGaps, SKILL_CATEGORY),
    [`${targetRole}`]: roleScore(axis, skillGaps, skillsPresent, SKILL_CATEGORY),
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-semibold text-gray-900">Skill DNA</h3>
          <p className="text-xs text-gray-400 mt-0.5">Your profile (blue) vs {targetRole} requirements (orange)</p>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          Gap = shaded area
        </span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fontSize: 12, fill: '#6b7280' }}
          />
          <Tooltip
            formatter={(value: number, name: string) => [`${value}%`, name]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Radar
            name={targetRole}
            dataKey={targetRole}
            stroke="#f97316"
            fill="#f97316"
            fillOpacity={0.15}
            strokeWidth={2}
          />
          <Radar
            name="You"
            dataKey="You"
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.25}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

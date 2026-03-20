import { useState, useEffect } from 'react'
import {
  createProfile, analyzeProfile, suggestRoles, getRoles, listSamples, getSample,
  type AudienceMode, type Profile, type AnalysisResult, type SampleResume, type RoleSuggestion,
} from '../api'

export default function ResumeInput({
  audienceMode,
  forceMode,
  onReady,
  onSuggest,
  onBack,
}: {
  audienceMode: AudienceMode
  forceMode: 'ai' | 'fallback'
  onReady: (profile: Profile, result: AnalysisResult) => void
  onSuggest?: (suggestions: RoleSuggestion[], text: string, file: File | null, currentCareer: string) => void
  onBack: () => void
}) {
  const [targetRole, setTargetRole] = useState('')
  const [currentCareer, setCurrentCareer] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [inputMode, setInputMode] = useState<'text' | 'file'>('file')
  const [roles, setRoles] = useState<string[]>([])
  const [samples, setSamples] = useState<SampleResume[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getRoles().then(setRoles).catch(() => {})
    listSamples().then(setSamples).catch(() => {})
  }, [])

  const loadSample = async (sampleId: string) => {
    try {
      const sample = await getSample(sampleId)
      setResumeText(sample.resume_text)
      setTargetRole(sample.suggested_roles[0])
      setInputMode('text')
      setResumeFile(null)
    } catch {
      setError('Could not load sample.')
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (!resumeFile && !resumeText.trim()) {
      setError('Please upload a resume file or paste your resume text.')
      return
    }

    // Switcher mode: suggest roles instead of analyzing against a specific role
    if (audienceMode === 'switcher' && onSuggest) {
      setLoading(true)
      try {
        const suggestions = await suggestRoles({
          ...(resumeFile ? { resume_file: resumeFile } : { resume_text: resumeText }),
          ...(currentCareer.trim() ? { current_career: currentCareer.trim() } : {}),
        })
        onSuggest(suggestions, resumeText, resumeFile, currentCareer)
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { detail?: string } } })
          ?.response?.data?.detail
        setError(msg || 'Something went wrong. Please try again.')
      } finally {
        setLoading(false)
      }
      return
    }

    if (!targetRole) { setError('Please select a target role.'); return }

    setLoading(true)
    try {
      const profile = await createProfile({
        target_role: targetRole,
        audience_mode: audienceMode,
        ...(resumeFile ? { resume_file: resumeFile } : { resume_text: resumeText }),
      })
      const result = await analyzeProfile(profile.id, forceMode)
      onReady(profile, result)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      setError(msg || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1">
        ← Back
      </button>

      <h2 className="text-2xl font-bold text-gray-900 mb-1">
        {audienceMode === 'switcher' ? 'Discover Your Best-Fit Roles' : 'Your Profile'}
      </h2>
      <p className="text-gray-500 mb-8 text-sm">
        {audienceMode === 'switcher'
          ? 'Upload your resume and we\'ll identify the top roles that match your background.'
          : 'Upload your resume and pick a target role — we\'ll do the rest.'}
      </p>

      {/* Sample personas */}
      {samples.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
             Sample Profiles
          </p>
          <div className="flex flex-wrap gap-2">
            {samples.map((s) => (
              <button
                key={s.id}
                onClick={() => loadSample(s.id)}
                className="px-3 py-1.5 text-sm rounded-full border border-gray-200 bg-white hover:border-dodger-blue-400 hover:bg-dodger-blue-50 text-gray-700 transition-colors"
              >
                {s.name} · {s.persona}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">

        {/* Career switcher: optional current career context */}
        {audienceMode === 'switcher' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current Career <span className="text-gray-400 font-normal">(optional — helps surface transferable skills)</span>
            </label>
            <input
              type="text"
              value={currentCareer}
              onChange={e => setCurrentCareer(e.target.value)}
              placeholder="e.g. Finance Analyst, Backend Developer, Teacher…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-dodger-blue-500"
            />
          </div>
        )}

        {/* Target role (non-switcher modes) */}
        {audienceMode !== 'switcher' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Role</label>
          <select
            value={targetRole}
            onChange={e => setTargetRole(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-dodger-blue-500 bg-white"
          >
            <option value="">Select a role…</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        )}

        {/* Resume input toggle */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <label className="block text-sm font-medium text-gray-700">Resume</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => setInputMode('file')}
                className={`px-3 py-1 ${inputMode === 'file' ? 'bg-dodger-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Upload File
              </button>
              <button
                onClick={() => setInputMode('text')}
                className={`px-3 py-1 ${inputMode === 'text' ? 'bg-dodger-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Paste Text
              </button>
            </div>
          </div>

          {inputMode === 'file' ? (
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                resumeFile ? 'border-dodger-blue-300 bg-dodger-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="file"
                accept=".pdf,.docx"
                id="resume-upload"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  setResumeFile(f)
                  if (f) setResumeText('')
                }}
              />
              <label htmlFor="resume-upload" className="cursor-pointer">
                {resumeFile ? (
                  <div>
                    <p className="text-dodger-blue-700 font-medium text-sm">{resumeFile.name}</p>
                    <p className="text-xs text-dodger-blue-500 mt-1">Click to change</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-gray-500 text-sm">Drop your PDF or DOCX here</p>
                    <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                  </div>
                )}
              </label>
            </div>
          ) : (
            <textarea
              value={resumeText}
              onChange={e => { setResumeText(e.target.value); setResumeFile(null) }}
              placeholder="Paste your resume content here…"
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-dodger-blue-500 resize-none font-mono"
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-raspberry-red-600 bg-raspberry-red-50 border border-raspberry-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-gradient-to-r from-dodger-blue-600 to-cornflower-ocean-400 hover:from-dodger-blue-700 hover:to-cornflower-ocean-400 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Analyzing…
            </>
          ) : audienceMode === 'switcher' ? 'Discover My Best Roles →' : 'Analyze My Skills →'}
        </button>
      </div>
    </div>
  )
}

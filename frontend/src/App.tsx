import { useEffect, useState } from 'react'
import AudienceModeSelector from './components/AudienceModeSelector'
import ResumeInput from './components/ResumeInput'
import RoleSuggestions from './components/RoleSuggestions'
import GapDashboard from './components/GapDashboard'
import MentorView from './components/MentorView'
import { setTokenGetter, getProfile, getSharedView, type AudienceMode, type Profile, type AnalysisResult, type RoleSuggestion, type SharedView } from './api'

// Clerk is optional — only imported when VITE_CLERK_PUBLISHABLE_KEY is set
const clerkEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)

// Lazy Clerk imports — avoids runtime error when Clerk is not configured
let SignedIn: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>
let SignedOut: React.FC<{ children: React.ReactNode }> = () => null
let UserButton: React.FC<{ afterSignOutUrl?: string }> = () => null
let SignInButton: React.FC<{ mode?: string; children: React.ReactNode }> = ({ children }) => <>{children}</>
let SignUpButton: React.FC<{ mode?: string; children: React.ReactNode }> = ({ children }) => <>{children}</>
let useAuth: () => { getToken: () => Promise<string | null> } = () => ({ getToken: async () => null })

if (clerkEnabled) {
  const clerk = await import('@clerk/clerk-react')
  SignedIn     = clerk.SignedIn     as typeof SignedIn
  SignedOut    = clerk.SignedOut    as typeof SignedOut
  UserButton   = clerk.UserButton   as typeof UserButton
  SignInButton = clerk.SignInButton as typeof SignInButton
  SignUpButton = clerk.SignUpButton as typeof SignUpButton
  useAuth      = clerk.useAuth     as typeof useAuth
}

type Step = 'mode' | 'input' | 'suggest' | 'dashboard'

export default function App() {
  const [step, setStep] = useState<Step>('mode')
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('graduate')
  const [forceMode, setForceMode] = useState<'ai' | 'fallback'>('ai')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [suggestions, setSuggestions] = useState<RoleSuggestion[] | null>(null)
  const [pendingResume, setPendingResume] = useState<{ text: string; file: File | null; currentCareer: string } | null>(null)
  const [sharedView, setSharedView] = useState<SharedView | null>(null)
  const [sharedError, setSharedError] = useState(false)

  const { getToken } = useAuth()

  // Register Clerk's getToken with the axios client so every request carries the JWT
  useEffect(() => {
    setTokenGetter(getToken)
  }, [getToken])

  // Check for ?mentor=CODE in URL — load shared read-only view if present
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('mentor')
    if (!code) return
    getSharedView(code)
      .then(setSharedView)
      .catch(() => setSharedError(true))
  }, [])

  // Restore last session from localStorage on mount
  // We store profile.id + result only — resume_text is PII and stays server-side
  useEffect(() => {
    const saved = localStorage.getItem('sb_session')
    if (!saved) return
    ;(async () => {
      try {
        const { profileId, result: r, audienceMode: m } = JSON.parse(saved)
        if (!profileId || !r) return
        // Re-fetch profile to get fresh skill_statuses from DB
        const freshProfile = await getProfile(profileId)
        // Merge fresh skill_statuses into cached result
        const mergedResult: AnalysisResult = {
          ...r,
          skill_gaps: r.skill_gaps.map((g: AnalysisResult['skill_gaps'][0]) => ({
            ...g,
            status: freshProfile.skill_statuses[g.skill] ?? g.status,
          })),
        }
        setProfile(freshProfile)
        setResult(mergedResult)
        setAudienceMode(m ?? 'graduate')
        setStep('dashboard')
      } catch {
        localStorage.removeItem('sb_session')
      }
    })()
  }, [])

  // Persist session whenever profile/result changes — resume_text deliberately excluded
  useEffect(() => {
    if (profile && result) {
      localStorage.setItem('sb_session', JSON.stringify({
        profileId: profile.id,
        result,
        audienceMode,
      }))
    }
  }, [profile, result, audienceMode])

  const handleModeSelect = (mode: AudienceMode) => {
    setAudienceMode(mode)
    setStep('input')
  }

  const handleProfileReady = (p: Profile, r: AnalysisResult) => {
    setProfile(p)
    setResult(r)
    setStep('dashboard')
  }

  const handleSuggest = (
    s: RoleSuggestion[],
    text: string,
    file: File | null,
    currentCareer: string,
  ) => {
    setSuggestions(s)
    setPendingResume({ text, file, currentCareer })
    setStep('suggest')
  }

  const handleReset = () => {
    localStorage.removeItem('sb_session')
    setStep('mode')
    setProfile(null)
    setResult(null)
    setSuggestions(null)
    setPendingResume(null)
  }

  // Shared mentor view — bypasses auth and normal app flow
  if (sharedError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-2xl font-bold text-gray-900">Link expired</div>
          <p className="text-sm text-gray-500">This share code is invalid or has been revoked.</p>
        </div>
      </div>
    )
  }

  if (sharedView) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-slate-900 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-dodger-blue-500 to-cornflower-ocean-400 rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-sm">SB</span>
            </div>
            <span className="font-semibold text-white">Skill-Bridge</span>
            <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              Mentor view — read only
            </span>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-8">
          <MentorView profile={sharedView.profile as Profile} result={sharedView.result} />
        </main>
      </div>
    )
  }

  const mainContent = (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-900 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={handleReset} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 bg-gradient-to-br from-dodger-blue-500 to-cornflower-ocean-400 rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-sm">SB</span>
            </div>
            <span className="font-semibold text-white">Skill-Bridge</span>
          </button>

          {step !== 'mode' && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <StepDot active={step === 'input'} done={step === 'suggest' || step === 'dashboard'} label="Resume" />
              {audienceMode === 'switcher' && (
                <>
                  <div className="w-8 h-px bg-slate-600" />
                  <StepDot active={step === 'suggest'} done={step === 'dashboard'} label="Roles" />
                </>
              )}
              <div className="w-8 h-px bg-slate-600" />
              <StepDot active={step === 'dashboard'} done={false} label="Analysis" />
            </div>
          )}

          <div className="flex items-center gap-3">
            {step === 'dashboard' && profile && (
              <button
                onClick={handleReset}
                className="text-sm text-dodger-blue-300 hover:text-dodger-blue-200 font-medium"
              >
                New Analysis
              </button>
            )}
            {clerkEnabled && <UserButton afterSignOutUrl="/" />}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {step === 'mode' && (
          <AudienceModeSelector
            onSelect={handleModeSelect}
            forceMode={forceMode}
            onForceModeChange={setForceMode}
          />
        )}

        {step === 'input' && (
          <ResumeInput
            audienceMode={audienceMode}
            forceMode={forceMode}
            onReady={handleProfileReady}
            onSuggest={audienceMode === 'switcher' ? handleSuggest : undefined}
            onBack={() => setStep('mode')}
          />
        )}

        {step === 'suggest' && suggestions && pendingResume && (
          <RoleSuggestions
            suggestions={suggestions}
            pendingResume={pendingResume}
            forceMode={forceMode}
            onReady={handleProfileReady}
            onBack={() => setStep('input')}
          />
        )}

        {step === 'dashboard' && profile && result && (
          audienceMode === 'mentor'
            ? <MentorView profile={profile} result={result} onUpdateResult={setResult} />
            : <GapDashboard profile={profile} result={result} onUpdateResult={setResult} />
        )}
      </main>

    </div>
  )

  if (!clerkEnabled) return mainContent

  return (
    <>
      <SignedIn>{mainContent}</SignedIn>
      <SignedOut>
        <AuthScreen SignInButton={SignInButton} SignUpButton={SignUpButton} />
      </SignedOut>
    </>
  )
}

function AuthScreen({
  SignInButton,
  SignUpButton,
}: {
  SignInButton: React.FC<{ mode?: string; children: React.ReactNode }>
  SignUpButton: React.FC<{ mode?: string; children: React.ReactNode }>
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 bg-gradient-to-br from-dodger-blue-500 to-cornflower-ocean-400 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-base">SB</span>
        </div>
        <span className="text-xl font-semibold text-gray-900">Skill-Bridge</span>
      </div>
      <p className="text-sm text-gray-500 max-w-xs text-center">
        Analyse your resume, track skill gaps, and save your learning progress.
      </p>
      <div className="flex gap-3">
        <SignInButton mode="modal">
          <button className="px-5 py-2 bg-gradient-to-r from-dodger-blue-600 to-cornflower-ocean-400 text-white text-sm font-medium rounded-lg hover:from-dodger-blue-700 hover:to-cornflower-ocean-400 transition-colors">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="px-5 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            Create account
          </button>
        </SignUpButton>
      </div>
    </div>
  )
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className={`w-2 h-2 rounded-full ${done ? 'bg-green-500' : active ? 'bg-dodger-blue-400' : 'bg-gray-300'}`} />
      <span className={active ? 'text-white font-medium' : 'text-slate-400'}>{label}</span>
    </div>
  )
}

import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { stepsToDo, type WelcomeFacts, type WelcomeStep } from './onboarding'
import { useSamples } from './useWelcome'
import { SampleOption } from './WelcomePage'
import './onboarding.css'

const ROWS: Record<Exclude<WelcomeStep, 'done'>, { icon: string; label: string }> = {
  collection: { icon: 'collections_bookmark', label: 'Bring your collection' },
  deck: { icon: 'style', label: 'Make your first deck' },
  account: { icon: 'group', label: 'Sign in to sync and add friends' },
}

/**
 * Home with nothing of the user's own in it: the welcome steps not done yet, each opening the flow
 * at that step, and the samples to try it with. In place of Home's empty widgets. The Android app's
 * GetStartedCard (ui/onboarding/GetStarted.kt).
 */
export function GetStartedCard({ facts, className = '', style }: { facts: WelcomeFacts; className?: string; style?: CSSProperties }) {
  const navigate = useNavigate()
  const samples = useSamples()
  const steps = stepsToDo(facts).filter((s): s is Exclude<WelcomeStep, 'done'> => s !== 'done')
  return (
    <section className={`panel get-started ${className}`.trim()} style={style}>
      <div className="eyebrow">Get started</div>
      <h2>Make Manabind yours</h2>
      {steps.map((s) => (
        <button key={s} type="button" className="get-started-row press" onClick={() => navigate(`/welcome?step=${s}`)}>
          <Icon name={ROWS[s].icon} />
          <span>{ROWS[s].label}</span>
          <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
        </button>
      ))}
      <SampleOption samples={samples} has={facts.samples} />
    </section>
  )
}

/** While samples are in the library, wherever they show: what they are, and "Remove samples". */
export function SamplesBar({ className = '', style }: { className?: string; style?: CSSProperties }) {
  const { remove } = useSamples()
  return (
    <div className={`banner samples-bar ${className}`.trim()} style={style} role="status">
      <Icon name="science" />
      <span className="banner-text" style={{ flex: 1 }}>The sample deck and binder are only on this device and don’t sync.</span>
      <button type="button" className="btn line sm" onClick={remove}>Remove samples</button>
    </div>
  )
}

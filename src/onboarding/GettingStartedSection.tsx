import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { firstStepToDo } from './onboarding'
import { SampleOption } from './WelcomePage'
import { useSamples, useWelcomeFacts } from './useWelcome'

/**
 * Settings › Getting started: the welcome flow again, at the first step not done, and the samples —
 * add them, or remove them in one tap. The Android app's Settings › Getting started
 * (ui/onboarding/GetStarted.kt, GettingStartedSection).
 */
export function GettingStartedSection() {
  const facts = useWelcomeFacts()
  const samples = useSamples()
  return (
    <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <p className="dim settings-note" style={{ margin: 0 }}>Bring in your cards, make a first deck and sign in — a few short steps, any of them skippable.</p>
      <Link to={`/welcome?step=${firstStepToDo(facts)}`} className="banner press" style={{ textDecoration: 'none', marginBottom: 0 }}>
        <Icon name="flag" />
        <span className="banner-text" style={{ flex: 1 }}>Open the welcome steps</span>
        <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
      </Link>
      <SampleOption samples={samples} has={facts.samples} />
    </section>
  )
}

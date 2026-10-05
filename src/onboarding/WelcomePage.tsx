import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { rise } from '../components/kit'
import { AccountPanel } from '../components/AccountPanel'
import { ImportCardsDialog } from '../collection/CardListDialogs'
import { ProfileEditor } from '../social/ProfileEditor'
import { useOverview } from '../social/SocialContext'
import { PasteDeckDialog } from './PasteDeckDialog'
import { nextStep, stepDone, WELCOME_STEPS, type WelcomeStep } from './onboarding'
import { useSamples, useWelcomeFacts, useWelcomeState } from './useWelcome'
import './onboarding.css'

const TITLES: Record<WelcomeStep, string> = {
  collection: 'Bring your collection',
  deck: 'Your first deck',
  account: 'Play and friends',
  done: 'You’re all set',
}

/**
 * The welcome flow: bring your cards in, make a first deck, sign in — each skippable — then Home. Opens
 * by itself once on a first visit with an empty library; Settings › Getting started and Home's "Get
 * started" card open it again at any step (?step=deck). Every option reuses what the app already has:
 * the binder import, the scanner, the decklist import, the precons page, the account panel and the
 * profile editor. The Android app's ui/onboarding/WelcomeScreen.kt.
 */
export function WelcomePage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const asked = params.get('step') as WelcomeStep | null
  const step: WelcomeStep = asked && WELCOME_STEPS.includes(asked) ? asked : 'collection'
  const facts = useWelcomeFacts()
  const [, setWelcome] = useWelcomeState()
  const samples = useSamples()
  const [importing, setImporting] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [deckName, setDeckName] = useState('My deck')

  const go = (to: WelcomeStep) => setParams({ step: to }, { replace: true })
  const finish = (how: 'done' | 'skipped') => {
    setWelcome({ finished: how, opened: true })
    navigate('/', { replace: true })
  }
  // Reaching the end counts as done, even if they leave from here some other way.
  useEffect(() => {
    if (step === 'done') setWelcome({ finished: 'done', opened: true })
  }, [step, setWelcome])

  const done = stepDone(step, facts)
  const index = WELCOME_STEPS.indexOf(step)

  return (
    <div className="content-scroll welcome-page">
      <div className="welcome rise" style={rise(0)}>
        <div className="welcome-top">
          <div className="welcome-dots" aria-label={`Step ${index + 1} of ${WELCOME_STEPS.length}`}>
            {WELCOME_STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                className={`welcome-dot${i === index ? ' on' : ''}${s !== 'done' && stepDone(s, facts) ? ' done' : ''}`}
                aria-label={TITLES[s]}
                onClick={() => go(s)}
              />
            ))}
          </div>
          {step !== 'done' && <button type="button" className="link" onClick={() => finish('skipped')}>Skip</button>}
        </div>

        <div className="eyebrow">{step === 'collection' ? 'Welcome to Manabind' : `Step ${index + 1} of ${WELCOME_STEPS.length}`}</div>
        <h1 className="welcome-title">{TITLES[step]}</h1>

        {step === 'collection' && (
          <>
            <p className="dim welcome-lead">Already keep your cards in another app? Bring them in. Or scan a few to start.</p>
            {done && <DoneNote text={`${facts.cards} ${facts.cards === 1 ? 'card is' : 'cards are'} in your collection.`} />}
            <Option icon="upload_file" title="Import a list or file" text="A .csv or .txt export from ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer or Dragon Shield, or a pasted list." onClick={() => setImporting(true)} />
            <Option icon="photo_camera" title="Scan a few cards" text="Point your camera at a card to add it." onClick={() => navigate('/scan')} />
            <SampleOption samples={samples} has={facts.samples} />
          </>
        )}

        {step === 'deck' && (
          <>
            <p className="dim welcome-lead">Paste a list from anywhere, or start from an official precon.</p>
            {done && <DoneNote text={`You have ${facts.decks} ${facts.decks === 1 ? 'deck' : 'decks'}.`} />}
            <label className="field-label" htmlFor="welcome-deck-name" style={{ marginTop: 0 }}>Deck name</label>
            <input id="welcome-deck-name" className="input" value={deckName} onChange={(e) => setDeckName(e.target.value)} />
            <Option icon="content_paste" title="Paste a list" text="On Moxfield or Archidekt, use Export › Copy as plain text, then paste it here." onClick={() => setPasting(true)} />
            <Option icon="inventory_2" title="Start from a precon" text="Every official Commander precon, ready to copy." onClick={() => navigate('/precons')} />
          </>
        )}

        {step === 'account' && <AccountStep onNext={() => go('done')} />}

        {step === 'done' && (
          <>
            <p className="dim welcome-lead">Home is where your decks, binders and games come together.</p>
            <div className="panel welcome-summary">
              {(['collection', 'deck', 'account'] as const).map((s) => (
                <button key={s} type="button" className="welcome-summary-row press" onClick={() => go(s)}>
                  <Icon name={stepDone(s, facts) ? 'check_circle' : 'radio_button_unchecked'} className={stepDone(s, facts) ? 'ok' : ''} />
                  <span>{TITLES[s]}</span>
                  <span className="dim">{stepDone(s, facts) ? 'Done' : 'Later, from Home'}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="welcome-foot">
          {index > 0 && <button type="button" className="btn line" onClick={() => go(WELCOME_STEPS[index - 1])}><Icon name="arrow_back" />Back</button>}
          {step === 'done'
            ? <button type="button" className="btn gold" onClick={() => finish('done')}><Icon name="home" />Go to Home</button>
            : <button type="button" className={`btn ${done ? 'gold' : 'line'}`} onClick={() => go(nextStep(step))}>{done ? 'Next' : 'Later'}<Icon name="arrow_forward" /></button>}
        </div>
      </div>

      {importing && <ImportCardsDialog onDismiss={() => setImporting(false)} />}
      {pasting && <PasteDeckDialog name={deckName} onDismiss={() => setPasting(false)} />}
    </div>
  )
}

function Option({ icon, title, text, onClick, disabled }: { icon: string; title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="banner press welcome-option" onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
      <span className="banner-text"><b>{title}</b><br /><span className="dim">{text}</span></span>
      <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
    </button>
  )
}

function DoneNote({ text }: { text: string }) {
  return <div className="notice welcome-done"><Icon name="check_circle" />{text}</div>
}

/** "Try it with a sample deck and binder", or — once they're in — where they are and how to remove them. */
export function SampleOption({ samples, has }: { samples: ReturnType<typeof useSamples>; has: boolean }) {
  const navigate = useNavigate()
  if (has) {
    return (
      <div className="banner welcome-option">
        <Icon name="science" />
        <span className="banner-text"><b>Samples added</b><br /><span className="dim">A sample deck and binder are in Decks and Collection. They don’t sync.</span></span>
        <button type="button" className="btn line sm" onClick={samples.remove}>Remove samples</button>
      </div>
    )
  }
  return (
    <>
      <Option
        icon="science"
        title={samples.adding ? 'Adding samples…' : 'Try it with a sample deck and binder'}
        text="A real precon and a dozen of its cards, labelled Sample. They stay on this device and go in one tap."
        disabled={samples.adding}
        onClick={() => { void samples.add().then((deck) => { if (deck) navigate(`/decks/${deck.id}`) }) }}
      />
      {samples.error && <div className="notice warn">{samples.error}</div>}
    </>
  )
}

/** Step 3: sign in or make an account, then pick a username — the app's own account panel and profile editor. */
function AccountStep({ onNext }: { onNext: () => void }) {
  const facts = useWelcomeFacts()
  const { overview, loading } = useOverview()
  return (
    <>
      <p className="dim welcome-lead">Optional. An account keeps your phone and the web in sync, and lets you add friends and trade cards.</p>
      {!facts.accountsAvailable && <div className="notice">Accounts aren’t set up in this build. Everything stays on this device.</div>}
      {facts.accountsAvailable && !facts.signedIn && <AccountPanel />}
      {facts.signedIn && !overview && loading && <div className="dim">Loading your profile…</div>}
      {facts.signedIn && overview && !overview.me && (
        <div className="panel">
          <div className="p-h"><h3>Pick a username</h3></div>
          <p className="dim" style={{ marginTop: 0 }}>Friends find you by it, and see it on shared decks, trades and the life counter.</p>
          <ProfileEditor onDone={onNext} />
        </div>
      )}
      {facts.signedIn && overview?.me && <DoneNote text={`Signed in as @${overview.me.username}.`} />}
    </>
  )
}

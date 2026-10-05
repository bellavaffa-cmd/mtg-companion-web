import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { countScreen, sendDue, setUsageEnabled, useUsageEnabled } from './usage'

/** Counts each screen opened (App.tsx, inside the router); sends finished days at start. */
export function UsageScreens() {
  const { pathname } = useLocation()
  useEffect(() => { void sendDue() }, [])
  useEffect(() => { countScreen(pathname) }, [pathname])
  return null
}

/** The one sentence Settings › Privacy says about it, the same as the Android app's. */
const USAGE_NOTE = 'Manabind counts which screens and features get used each day, under a random id that changes every 90 days and never with card names, decks, messages or your account; turned off, nothing is counted or sent.'

/** Settings › Privacy. */
export function PrivacySection() {
  const on = useUsageEnabled()
  return (
    <section className="panel">
      <button type="button" role="switch" aria-checked={on} className="share-switch" onClick={() => setUsageEnabled(!on)}>
        <span className="txt">
          <b>Share anonymous usage counts</b>
          <span>
            {USAGE_NOTE}
          </span>
        </span>
        <span className={`sw${on ? ' on' : ''}`}><i /></span>
      </button>
    </section>
  )
}

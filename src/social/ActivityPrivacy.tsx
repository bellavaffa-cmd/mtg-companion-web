// Settings › Privacy: what friends' Activity shows of the user (activity_prefs). The Android app's
// twin is ActivityPrivacySection in ui/social/ActivityFeed.kt.

import { useEffect, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import * as activity from './activity'
import { ACTIVITY_PREF_ROWS, ACTIVITY_PRIVACY_NOTE, type ActivityPrefs } from './activityLogic'

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

/** The switches, once signed in and the server has them; nothing otherwise. */
export function ActivityPrivacy() {
  const { account } = useSync()
  const available = activity.useActivityComments()
  const [prefs, setPrefs] = useState<ActivityPrefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!available) return
    let cancelled = false
    activity.activityPrefs().then((p) => { if (!cancelled) setPrefs(p) }).catch((e: unknown) => { if (!cancelled) setError(message(e)) })
    return () => { cancelled = true }
  }, [available, account?.userId])
  if (!account || !available) return null

  const flip = (key: keyof ActivityPrefs) => {
    if (!prefs) return
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setError(null)
    activity.setActivityPrefs(next).catch((e: unknown) => { setPrefs(prefs); setError(message(e)) })
  }
  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <div className="p-h"><h3>Friends' activity</h3></div>
      <p className="muted" style={{ margin: '0 0 8px' }}>{ACTIVITY_PRIVACY_NOTE}</p>
      {!prefs && !error && <p className="muted">Loading…</p>}
      {prefs && ACTIVITY_PREF_ROWS.map((row) => (
        <button key={row.key} type="button" role="switch" aria-checked={prefs[row.key]} className="share-switch" onClick={() => flip(row.key)}>
          <span className="txt">
            <b>{row.title}</b>
            <span>{row.detail}</span>
          </span>
          <span className={`sw${prefs[row.key] ? ' on' : ''}`}><i /></span>
        </button>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}

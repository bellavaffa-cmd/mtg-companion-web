import { useEffect, useState } from 'react'
import * as push from './push'

/**
 * Notifications: whether this browser gets them, and which kinds (friend requests, trades) the
 * account gets on every device.
 */
export function NotificationsPanel() {
  const [state, setState] = useState<push.PushState | null>(null)
  const [prefs, setPrefs] = useState<push.NotificationPrefs | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    push.pushState().then(setState).catch(() => setState('unsupported'))
    push.loadNotificationPrefs().then(setPrefs).catch(() => {})
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const toggleDevice = () => run(async () => {
    if (state === 'on') {
      await push.disablePush()
      setState('off')
    } else {
      setState(await push.enablePush())
    }
  })
  const setKind = (patch: Partial<push.NotificationPrefs>) => {
    if (!prefs) return
    const next = { ...prefs, ...patch }
    setPrefs(next)
    void run(async () => setPrefs(await push.saveNotificationPrefs(next)))
  }

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="p-h" style={{ marginTop: 0 }}><h3>Notifications</h3></div>
      {state === 'unsupported' ? (
        <p className="dim" style={{ margin: '4px 0 8px', fontSize: 13 }}>
          {push.needsHomeScreen()
            ? 'On iPhone and iPad, add Manabind to your Home Screen first (Share → Add to Home Screen), then turn notifications on from there.'
            : "This browser can't show notifications."}
        </p>
      ) : (
        <Switch
          label="On this device"
          detail={state === 'blocked' ? 'Blocked — allow notifications for this site in the browser’s settings' : 'Friend requests and trades, even when the app is closed'}
          on={state === 'on'}
          disabled={busy || state === null || state === 'blocked'}
          onChange={toggleDevice}
        />
      )}
      {prefs && (
        <>
          <Switch label="Friend requests" detail="Someone asks to be friends, or says yes" on={prefs.friends} disabled={busy} onChange={() => setKind({ friends: !prefs.friends })} />
          <Switch label="Trades" detail="A trade arrives, or yours is answered" on={prefs.trades} disabled={busy} onChange={() => setKind({ trades: !prefs.trades })} />
          <p className="dim" style={{ margin: '4px 0 0', fontSize: 12 }}>These two apply to all your devices.</p>
        </>
      )}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  )
}

function Switch({ label, detail, on, disabled, onChange }: { label: string; detail: string; on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="share-switch" disabled={disabled} onClick={onChange}>
      <span className="txt"><b>{label}</b><span>{detail}</span></span>
      <span className={`sw${on ? ' on' : ''}`}><i /></span>
    </button>
  )
}

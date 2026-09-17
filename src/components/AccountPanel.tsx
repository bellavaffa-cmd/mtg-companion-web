import { useEffect, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import * as auth from '../sync/supabaseAuth'
import { Icon } from './Icon'
import { SetPasswordDialog } from './AccountDialogs'

function syncLine(syncing: boolean, failed: boolean, message: string | null, lastSyncedAt: number): string {
  if (syncing) return 'Syncing…'
  if (failed) return message ?? 'Sync failed'
  if (lastSyncedAt === 0) return 'Not synced yet'
  const seconds = (Date.now() - lastSyncedAt) / 1000
  if (seconds < 60) return 'Synced just now'
  if (seconds < 3600) return `Synced ${Math.round(seconds / 60)} min ago`
  return `Synced ${new Date(lastSyncedAt).toLocaleString()}`
}

/**
 * Sign in with the same account as the Android app to sync decks and binders. Signed out,
 * everything still works and stays in this browser.
 */
export function AccountPanel() {
  const { accountsAvailable, account, cloud, signIn, signUp, signOut, syncNow, resendConfirmation, sendPasswordReset } = useSync()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [signedOut, setSignedOut] = useState(() => auth.signedOutNotice())

  // A sign-out can happen while this panel is open (a sync pass finding the session gone).
  useEffect(() => {
    if (account) setSignedOut(null)
    else setSignedOut(auth.signedOutNotice())
  }, [account])

  if (!accountsAvailable) {
    return <div className="notice">Accounts aren't set up in this build — changes stay in this browser only.</div>
  }

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setNotice(null)
    try {
      setNotice(await action())
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Something went wrong.')
      if (e instanceof Error && e.message.startsWith('Confirm your email')) setAwaitingConfirmation(true)
    } finally {
      setBusy(false)
    }
  }

  if (account) {
    return (
      <div className="account-panel">
        <div className="panel account-panel">
          <div className="account-status">
            <span className="avatar">{account.email.slice(0, 1).toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow">Signed in</div>
              <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.email}</div>
            </div>
          </div>
          <div className="row" style={{ gap: 8, color: cloud.failed ? 'var(--warn)' : 'var(--t1)', fontSize: 13, fontWeight: 600 }}>
            <Icon name={cloud.syncing ? 'sync' : cloud.failed ? 'cloud_off' : 'cloud_done'} style={{ fontSize: 18, color: cloud.failed ? 'var(--warn)' : 'var(--ok)' }} />
            {syncLine(cloud.syncing, cloud.failed, cloud.message, cloud.lastSyncedAt)}
          </div>
          <button type="button" className="btn gold block" onClick={() => void syncNow()} disabled={cloud.syncing}>
            <Icon name="sync" />Sync now
          </button>
        </div>
        <div className="row">
          <button type="button" className="btn line" style={{ flex: 1 }} onClick={() => setChangingPassword(true)}>Change password</button>
          <button type="button" className="btn line" style={{ flex: 1 }} onClick={() => void signOut()}>Sign out</button>
        </div>
        <div className="dim account-hint" style={{ padding: '0 4px' }}>
          Decks and binders sync on their own and are merged card by card, so edits here and on your phone don't overwrite each other. Signing out keeps everything in this browser; it only stops syncing.
        </div>
        {changingPassword && (
          <SetPasswordDialog
            title="Change password"
            explanation={`Choose a new password for ${account.email}.`}
            onDismiss={() => setChangingPassword(false)}
          />
        )}
      </div>
    )
  }

  const canSubmit = !busy && email.includes('@') && password.length >= 6
  return (
    <form
      className="panel account-panel"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) void run(async () => { await signIn(email, password); setPassword(''); return null })
      }}
    >
      {signedOut && (
        <div className="notice signed-out">
          <b>You were signed out</b>
          <span>{signedOut.reason}</span>
          <span className="dim">
            On {new Date(signedOut.at).toLocaleString()}. Your decks and binders are still in this browser.
          </span>
          <button type="button" className="btn btn-link sm" onClick={() => { auth.dismissSignedOutNotice(); setSignedOut(null) }}>
            Dismiss
          </button>
        </div>
      )}
      <div className="muted">
        Sign in with your MTG Companion account to sync decks and binders with the Android app. Everything still works signed out.
      </div>
      <input
        className="input" type="email" autoComplete="email" placeholder="Email"
        value={email} onChange={(e) => { setEmail(e.target.value); setNotice(null) }}
      />
      <input
        className="input" type="password" autoComplete="current-password" placeholder="Password"
        value={password} onChange={(e) => { setPassword(e.target.value); setNotice(null) }}
      />
      <div className="account-actions">
        <button type="submit" className="btn gold" disabled={!canSubmit} style={{ flex: 1 }}>Sign in</button>
        <button
          type="button" className="btn line" disabled={!canSubmit} style={{ flex: 1 }}
          onClick={() => void run(async () => {
            if (await signUp(email, password)) { setPassword(''); return null }
            setAwaitingConfirmation(true)
            return `Account created. Open the confirmation link we emailed to ${email} — it brings you back here, signed in.`
          })}
        >
          Create account
        </button>
      </div>
      <div className="row-between">
        <span className="dim account-hint">At least 6 characters.</span>
        <button
          type="button" className="btn btn-link sm" disabled={busy}
          onClick={() => {
            if (!email.includes('@')) { setNotice('Enter your email above first, then tap Forgot password.'); return }
            void run(async () => {
              await sendPasswordReset(email)
              return `If ${email} has an account, a reset link is on its way. Open it to choose a new password.`
            })
          }}
        >
          Forgot password?
        </button>
      </div>
      {notice && <div className="account-notice">{notice}</div>}
      {awaitingConfirmation && email.includes('@') && (
        <button
          type="button" className="btn btn-link sm" disabled={busy} style={{ alignSelf: 'flex-start' }}
          onClick={() => void run(async () => {
            await resendConfirmation(email)
            return `Sent a new confirmation email to ${email}. Older links won't work.`
          })}
        >
          Resend confirmation email
        </button>
      )}
    </form>
  )
}

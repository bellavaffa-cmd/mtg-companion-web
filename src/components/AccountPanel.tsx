import { useState } from 'react'
import { useSync } from '../sync/SyncContext'
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

  if (!accountsAvailable) {
    return (
      <div className="alert-banner">
        <Icon name="cloud_off" style={{ color: 'var(--accent)', fontSize: 20 }} />
        <div style={{ flex: 1 }}>Accounts aren't set up in this build — changes stay in this browser only.</div>
      </div>
    )
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
      <div className="card-panel account-panel">
        <div className="row" style={{ gap: 10 }}>
          <Icon name={cloud.failed ? 'cloud_off' : 'cloud_done'} style={{ color: 'var(--accent)', fontSize: 20 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Signed in as <span style={{ color: 'var(--accent-light)' }}>{account.email}</span>
            </div>
            <div className="dim">{syncLine(cloud.syncing, cloud.failed, cloud.message, cloud.lastSyncedAt)}</div>
          </div>
        </div>
        <div className="row account-actions">
          <button className="btn btn-primary" onClick={() => void syncNow()} disabled={cloud.syncing}>Sync now</button>
          <button className="btn" onClick={() => setChangingPassword(true)}>Change password</button>
          <button className="btn" onClick={() => void signOut()}>Sign out</button>
        </div>
        <div className="dim account-hint">Signing out keeps your decks and binders in this browser; it only stops syncing.</div>
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
      className="card-panel account-panel"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) void run(async () => { await signIn(email, password); setPassword(''); return null })
      }}
    >
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="cloud_off" style={{ color: 'var(--accent)', fontSize: 20 }} />
        <div className="muted" style={{ flex: 1 }}>
          Sign in with your MTG Companion account to sync decks and binders with the Android app. Each deck
          syncs on its own, so edits on your phone and here don't overwrite each other.
        </div>
      </div>
      <input
        className="input" type="email" autoComplete="email" placeholder="Email"
        value={email} onChange={(e) => { setEmail(e.target.value); setNotice(null) }}
      />
      <input
        className="input" type="password" autoComplete="current-password" placeholder="Password"
        value={password} onChange={(e) => { setPassword(e.target.value); setNotice(null) }}
      />
      <div className="row account-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>Sign in</button>
        <button
          type="button" className="btn" disabled={!canSubmit}
          onClick={() => void run(async () => {
            if (await signUp(email, password)) { setPassword(''); return null }
            setAwaitingConfirmation(true)
            return `Account created. Open the confirmation link we emailed to ${email} — it brings you back here, signed in.`
          })}
        >
          Create account
        </button>
        <button
          type="button" className="btn btn-link" disabled={busy}
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
      <div className="dim account-hint">Passwords need at least 6 characters.</div>
      {notice && <div className="account-notice">{notice}</div>}
      {awaitingConfirmation && email.includes('@') && (
        <button
          type="button" className="btn btn-link" disabled={busy} style={{ alignSelf: 'flex-start' }}
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

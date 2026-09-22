import { useEffect, useRef, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import * as auth from '../sync/supabaseAuth'
import { Icon } from './Icon'
import { SetPasswordDialog } from './AccountDialogs'
import { QrCode } from '../social/ui'
import { loginLinkFor, startQrLogin, waitForApproval, type QrLoginRequest } from '../sync/qrLogin'

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
  const { accountsAvailable, account, cloud, signIn, signInWithToken, signUp, signOut, syncNow, resendConfirmation, sendPasswordReset } = useSync()
  // Signing in by showing a code for the phone to scan (see sync/qrLogin.ts).
  const [byPhone, setByPhoneState] = useState<QrLoginRequest | null>(null)
  // The waiting loop reads this to know the user cancelled, or started another code.
  const requestRef = useRef<QrLoginRequest | null>(null)
  const setByPhone = (request: QrLoginRequest | null) => { requestRef.current = request; setByPhoneState(request) }
  const [phoneNotice, setPhoneNotice] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [signedOut, setSignedOut] = useState(() => auth.signedOutNotice())
  const [signingOut, setSigningOut] = useState(false)
  const [unsynced, setUnsynced] = useState<number | null>(null)

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
          <button
            type="button"
            className="btn line"
            style={{ flex: 1 }}
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true)
              void signOut().then((r) => setUnsynced(r.unsynced || null)).finally(() => setSigningOut(false))
            }}
          >
            {signingOut ? 'Syncing first…' : 'Sign out'}
          </button>
        </div>
        {unsynced !== null && (
          <div className="notice warn" role="alert">
            <b>{unsynced} {unsynced === 1 ? 'change hasn’t' : 'changes haven’t'} synced yet.</b> Signing out removes your decks and
            binders from this browser, so {unsynced === 1 ? 'it' : 'they'} would be lost. Check your connection and sync again, or sign out anyway.
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button type="button" className="btn line sm" onClick={() => setUnsynced(null)}>Cancel</button>
              <button type="button" className="btn line sm" onClick={() => { setUnsynced(null); void signOut(true) }}>Sign out anyway</button>
            </div>
          </div>
        )}
        <div className="dim account-hint" style={{ padding: '0 4px' }}>
          Decks and binders sync on their own and are merged card by card, so edits here and on your phone don't overwrite each other. Signing out removes them from this browser — they stay in your account and come back when you sign in.
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
            On {new Date(signedOut.at).toLocaleString()}. Your decks and binders were removed from this browser; sign in to get them back from your account.
          </span>
          <button type="button" className="btn btn-link sm" onClick={() => { auth.dismissSignedOutNotice(); setSignedOut(null) }}>
            Dismiss
          </button>
        </div>
      )}
      <div className="muted">
        Sign in with your Manabind account to sync decks and binders with the Android app. Everything still works signed out.
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
      {byPhone ? (
        <div className="panel-inset qr-box">
          <QrCode text={loginLinkFor(byPhone.code)} size={200} label="Sign-in code for the app on your phone" />
          <div style={{ marginTop: 8 }}>Open Manabind on your phone, tap <b>Scan</b>, and point it at this code.</div>
          <div className="dim" style={{ marginTop: 4 }}>{phoneNotice ?? 'Waiting for your phone… the code lasts two minutes.'}</div>
          <button type="button" className="btn line sm" style={{ marginTop: 8 }} onClick={() => { setByPhone(null); setPhoneNotice(null) }}>Cancel</button>
        </div>
      ) : (
        <button
          type="button" className="btn line" disabled={busy}
          onClick={() => void (async () => {
            setNotice(null)
            setPhoneNotice(null)
            let request: QrLoginRequest
            try {
              request = await startQrLogin()
            } catch {
              setNotice("Couldn't start a phone sign-in — check your connection.")
              return
            }
            setByPhone(request)
            try {
              const token = await waitForApproval(request, () => requestRef.current !== request)
              if (requestRef.current !== request) return
              if (!token) { setPhoneNotice('That code ran out. Tap again for a new one.'); return }
              await signInWithToken(token)
              setByPhone(null)
            } catch {
              if (requestRef.current === request) setPhoneNotice("That didn't work — tap Cancel and try again.")
            }
          })()}
        >
          <Icon name="qr_code_scanner" aria-hidden />Sign in with your phone
        </button>
      )}
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

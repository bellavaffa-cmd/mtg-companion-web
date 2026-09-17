import { useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { Dialog } from './Dialog'

/** Choose a new password — after a reset link signs the user in, and from "Change password". */
export function SetPasswordDialog({ title, explanation, onDismiss }: { title: string; explanation: string; onDismiss: () => void }) {
  const { updatePassword } = useSync()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const mismatch = confirm !== '' && confirm !== password
  const canSave = !busy && password.length >= 6 && password === confirm

  if (done) {
    return (
      <Dialog title="Password changed" onDismiss={onDismiss} actions={<button className="btn gold" onClick={onDismiss}>OK</button>}>
        <p className="muted" style={{ margin: 0 }}>Use the new password next time you sign in, here or on your phone.</p>
      </Dialog>
    )
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await updatePassword(password)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn\'t change the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={title}
      onDismiss={() => { if (!busy) onDismiss() }}
      actions={
        <>
          <button className="btn line" onClick={onDismiss} disabled={busy}>Not now</button>
          <button className="btn gold" onClick={() => void save()} disabled={!canSave}>{busy ? 'Saving…' : 'Save password'}</button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>{explanation}</p>
      <div className="field-label">New password</div>
      <input className="input" type="password" autoComplete="new-password" value={password} autoFocus
        onChange={(e) => { setPassword(e.target.value); setError(null) }} />
      <div className="field-label" style={{ marginTop: 12 }}>Repeat new password</div>
      <input className="input" type="password" autoComplete="new-password" value={confirm}
        onChange={(e) => { setConfirm(e.target.value); setError(null) }} />
      <div className={mismatch ? 'account-notice' : 'dim'} style={{ marginTop: 8 }}>
        {mismatch ? "The passwords don't match." : 'At least 6 characters.'}
      </div>
      {error && <div className="account-notice" style={{ marginTop: 8 }}>{error}</div>}
    </Dialog>
  )
}

/** App-wide account prompts: first sign-in in a browser with a library, password reset, email-link notices. */
export function AccountDialogs() {
  const { mergePrompt, resolveMerge, passwordRecovery, dismissPasswordRecovery, linkNotice, dismissLinkNotice, signOut } = useSync()

  if (mergePrompt) {
    const parts = [
      mergePrompt.decks > 0 ? `${mergePrompt.decks} deck${mergePrompt.decks === 1 ? '' : 's'}` : null,
      mergePrompt.collections > 0 ? `${mergePrompt.collections} binder${mergePrompt.collections === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' and ')
    return (
      <Dialog
        title="This browser already has a library"
        onDismiss={() => {}}
        actions={
          <>
            <button className="btn line" onClick={() => void signOut()}>Sign out</button>
            <button className="btn line" onClick={() => resolveMerge('replace')}>Use my account only</button>
            <button className="btn gold" onClick={() => resolveMerge('add')}>Add to my account</button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          This browser has {parts} saved from before you signed in as {mergePrompt.email}.
        </p>
        <p className="muted">
          <b>Add to my account</b> uploads the ones your account doesn't have. Decks already in your account
          keep the account's version.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          <b>Use my account only</b> replaces this browser's library with your account's. Pick this if this
          browser's copy is old — for example, decks you've since deleted on your phone.
        </p>
      </Dialog>
    )
  }

  if (passwordRecovery) {
    return (
      <SetPasswordDialog
        title="Choose a new password"
        explanation="You're signed in from the reset link. Set a new password to use next time."
        onDismiss={dismissPasswordRecovery}
      />
    )
  }

  if (linkNotice) {
    return (
      <Dialog title="Account" onDismiss={dismissLinkNotice} actions={<button className="btn gold" onClick={dismissLinkNotice}>OK</button>}>
        <p className="muted" style={{ margin: 0 }}>{linkNotice}</p>
      </Dialog>
    )
  }

  return null
}

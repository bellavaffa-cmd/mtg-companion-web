import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Dialog } from '../components/Dialog'
import { rise, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { deleteMyAccount } from '../account/deleteAccount'
import { CONTACT } from '../account/contact'

/**
 * How to delete a Manabind account — the public page Google Play asks for — and, when signed in,
 * the button that does it (delete_my_account, then sign out). A server without the function says
 * so and nothing is deleted.
 */
export function DeleteAccountPage() {
  const back = useBack('/account')
  const { accountsAvailable, account, signOut } = useSync()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const remove = async () => {
    if (!account) return
    setBusy(true)
    setProblem(null)
    try {
      const result = await deleteMyAccount(account.userId)
      if (result === 'deleted') {
        await signOut(true)
        setDone(account.email)
      } else if (result === 'unavailable') {
        setProblem("Deleting accounts isn't switched on yet, so nothing was deleted. Please contact us (below) and we'll do it for you.")
      } else {
        setProblem("The server couldn't delete your account, so nothing was deleted. Try again later, or contact us (below).")
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't delete your account.")
    }
    setBusy(false)
    setAsking(false)
  }

  return (
    <>
      <TopBar title="Delete my account" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <article className="narrow-width prose-page">
          {done ? (
            <div className="notice" role="status">The account {done} and everything synced to it have been deleted, and you're signed out.</div>
          ) : (
            <>
              <p>
                Deleting your Manabind account removes, for good: your sign-in (email and password), your synced decks, binders,
                wishlist, storage places and loans, your profile and picture, your friends, pods and shares, trades and ratings,
                messages, pod games you recorded, notification tokens and reports you made. It can't be undone.
              </p>
              <p>
                Copies on your devices aren't on our server: they go when you sign out (which happens when the account is deleted)
                or uninstall the app. Export anything you want to keep first.
              </p>

              <h2>In the Android app</h2>
              <p>Settings › Account &amp; sync › <strong>Delete my account</strong>, then <strong>Delete for good</strong>.</p>

              <h2>Here, on manabind.com</h2>
              {!accountsAvailable ? (
                <p>Accounts aren't set up on this copy of the site — use the app, or contact us below.</p>
              ) : account ? (
                <>
                  <p>You're signed in as <strong>{account.email}</strong>.</p>
                  <button type="button" className="btn danger" onClick={() => { setProblem(null); setAsking(true) }}>Delete my account</button>
                </>
              ) : (
                <ol>
                  <li><Link to="/account">Sign in</Link> with the account you want to delete. Forgot the password? Use <strong>Forgot password</strong> there.</li>
                  <li>Come back to this page and choose <strong>Delete my account</strong>.</li>
                </ol>
              )}
              {problem && <div className="notice warn" role="alert" style={{ marginTop: 12 }}>{problem}</div>}

              <h2>Can't sign in any more?</h2>
              <p>
                If you no longer have access to the email address, contact us through <a href={CONTACT.href} target="_blank" rel="noreferrer">{CONTACT.label}</a>.
                Don't post your email address publicly; we'll arrange a private way to confirm the account is yours.
              </p>
              <p className="dim">See the <Link to="/privacy">privacy policy</Link> for what Manabind stores.</p>
            </>
          )}
        </article>
      </div>
      {asking && account && (
        <Dialog
          title="Delete your account?"
          onDismiss={() => { if (!busy) setAsking(false) }}
          actions={
            <>
              <button type="button" className="btn line" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="btn danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete for good'}</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            This deletes {account.email} and everything synced to it from Manabind's server, for good. It can't be undone.
          </p>
        </Dialog>
      )}
    </>
  )
}

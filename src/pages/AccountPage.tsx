import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { AccountPanel } from '../components/AccountPanel'
import { rise, useBack } from '../components/kit'
import { PricesPanel } from '../components/PricesPanel'
import { Dialog } from '../components/Dialog'
import { useSync } from '../sync/SyncContext'

/** Account & sync — the web counterpart of the Android app's Settings → Account & sync. */
export function AccountPage() {
  const back = useBack('/')
  return (
    <>
      <TopBar title="Account & sync" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <div className="narrow-width">
          <AccountPanel />
          <LibraryBackupPanel />
          <PricesPanel />
          <Link to="/settings" className="banner press" style={{ marginTop: 16, textDecoration: 'none' }}>
            <Icon name="settings" />
            <span style={{ flex: 1 }}>Settings — brightness, accent color and how cards are shown</span>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </Link>
          <Link to="/app" className="banner press" style={{ marginTop: 16, textDecoration: 'none' }}>
            <Icon name="android" />
            <span style={{ flex: 1 }}>Get the Android app: the same account, with notifications and offline card search.</span>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </Link>
        </div>
      </div>
    </>
  )
}

/**
 * What "Use my account only" set aside on first sign-in: offered back here until it's brought back
 * (added as new decks and binders, nothing overwritten) or discarded.
 */
function LibraryBackupPanel() {
  const { libraryBackup, restoreLibraryBackup, discardLibraryBackup } = useSync()
  const [discarding, setDiscarding] = useState(false)
  const [restored, setRestored] = useState(false)
  if (restored) {
    return <div className="notice" style={{ marginTop: 16 }}>They're back — find them with your other decks and binders.</div>
  }
  if (!libraryBackup) return null
  const parts = [
    libraryBackup.decks > 0 ? `${libraryBackup.decks} deck${libraryBackup.decks === 1 ? '' : 's'}` : null,
    libraryBackup.collections > 0 ? `${libraryBackup.collections} binder${libraryBackup.collections === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' and ')
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="p-h"><h3>From before you signed in</h3></div>
      <div className="dim">
        This browser still has a copy of the {parts} it had before you chose to use your account only.
        Bringing them back adds them to your library as new decks and binders — nothing you have now is changed.
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" className="btn line" onClick={() => setDiscarding(true)}>Discard copy</button>
        <button type="button" className="btn gold" style={{ flex: 1 }} onClick={() => { restoreLibraryBackup(); setRestored(true) }}>
          Bring back the decks and binders this browser had before signing in
        </button>
      </div>
      {discarding && (
        <Dialog
          title="Discard this copy?"
          onDismiss={() => setDiscarding(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setDiscarding(false)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { discardLibraryBackup(); setDiscarding(false) }}>Discard</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>The {parts} from before you signed in will be gone for good. Your library as it is now stays.</p>
        </Dialog>
      )}
    </div>
  )
}

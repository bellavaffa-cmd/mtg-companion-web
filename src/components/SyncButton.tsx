import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from './Icon'

/** Asks the pull-to-sync indicator to run a sync, with its spinner and result pill. */
export const SYNC_REQUEST_EVENT = 'mtgweb:sync-request'

export function requestSync() {
  window.dispatchEvent(new Event(SYNC_REQUEST_EVENT))
}

/**
 * Sync now: spins while syncing, and the result shows in the same pill as pull to sync. A red dot
 * marks a sync that failed, or being signed out — then it opens the sign-in page instead, so a
 * browser that quietly stopped syncing is easy to spot.
 */
export function SyncButton({ variant = '' }: { variant?: '' | 'glass' }) {
  const { account, accountsAvailable, cloud } = useSync()
  const navigate = useNavigate()
  if (!accountsAvailable) return null
  if (!account) {
    return (
      <button type="button" className={`ib sync-btn alert ${variant}`} onClick={() => navigate('/account')} aria-label="Not syncing — sign in" title="Not syncing — sign in">
        <Icon name="sync_disabled" />
      </button>
    )
  }
  const label = cloud.syncing ? 'Syncing…' : cloud.failed ? `Sync failed${cloud.message ? `: ${cloud.message}` : ''} — tap to try again` : 'Sync now'
  return (
    <button
      type="button"
      className={`ib sync-btn ${variant}${cloud.syncing ? ' spinning' : ''}${cloud.failed ? ' alert' : ''}`}
      onClick={requestSync}
      disabled={cloud.syncing}
      aria-label={label}
      title={label}
    >
      <Icon name="sync" />
    </button>
  )
}

import { useSync } from '../sync/SyncContext'

export function SyncStatusBar() {
  const { connected, email, syncing, message, lastSyncedAt, localDirty, connect, disconnect, syncNow } = useSync()

  return (
    <div className="card-panel row-between" style={{ marginBottom: 20 }}>
      <div>
        {connected ? (
          <>
            <div style={{ fontSize: 14 }}>
              Connected as <span style={{ color: 'var(--accent-light)' }}>{email ?? '…'}</span>
              {localDirty && <span className="badge badge-gold" style={{ marginLeft: 8 }}>unsynced changes</span>}
            </div>
            <div className="dim" style={{ marginTop: 2 }}>
              {syncing
                ? 'Syncing…'
                : lastSyncedAt
                  ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
                  : 'Not synced yet'}
              {message && !syncing ? ` — ${message}` : ''}
            </div>
          </>
        ) : (
          <div className="muted">Not connected — your changes are only saved in this browser until you connect.</div>
        )}
      </div>
      <div className="row">
        {connected ? (
          <>
            <button className="btn" onClick={() => syncNow()} disabled={syncing}>
              Sync now
            </button>
            <button className="btn btn-danger" onClick={disconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => connect()}>
            Connect Google Drive
          </button>
        )}
      </div>
    </div>
  )
}

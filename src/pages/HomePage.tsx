import { Link } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { SyncStatusBar } from '../components/SyncStatusBar'

export function HomePage() {
  const { decks, collections } = useSync()
  const totalCards = collections.reduce((sum, c) => sum + c.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0), 0)

  return (
    <div>
      <h1 className="page-title">HOME</h1>
      <SyncStatusBar />
      <div className="row" style={{ gap: 14, marginBottom: 20 }}>
        <div className="card-panel" style={{ flex: 1 }}>
          <div style={{ fontSize: 24, color: 'var(--accent-light)', fontFamily: 'var(--font-heading)' }}>{decks.length}</div>
          <div className="muted">DECKS</div>
        </div>
        <div className="card-panel" style={{ flex: 1 }}>
          <div style={{ fontSize: 24, color: 'var(--accent-light)', fontFamily: 'var(--font-heading)' }}>{collections.length}</div>
          <div className="muted">BINDERS</div>
        </div>
        <div className="card-panel" style={{ flex: 1 }}>
          <div style={{ fontSize: 24, color: 'var(--accent-light)', fontFamily: 'var(--font-heading)' }}>{totalCards}</div>
          <div className="muted">CARDS OWNED</div>
        </div>
      </div>
      <div className="card-panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Sign in with the same Google account as your phone to edit the same collection and decks here.
        </p>
        <div className="row">
          <Link to="/collections" className="btn">Browse Collection</Link>
          <Link to="/decks" className="btn">Browse Decks</Link>
          <Link to="/search" className="btn">Search Cards</Link>
        </div>
      </div>
    </div>
  )
}

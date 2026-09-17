import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { AccountPanel } from '../components/AccountPanel'

export function HomePage() {
  const navigate = useNavigate()
  const { decks, collections } = useSync()
  const totalCards = collections.reduce((sum, c) => sum + c.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0), 0)

  return (
    <>
      <TopBar title="MTG COMPANION" />
      <div className="content-scroll">
        <p className="muted" style={{ marginTop: 0 }}>
          Search cards, track your collection, and build decks — all in one place.
        </p>

        <AccountPanel />

        <div className="stat-row">
          <div className="stat-card">
            <div className="stat-value">{decks.length}</div>
            <div className="stat-label">DECKS</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{collections.length}</div>
            <div className="stat-label">BINDERS</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalCards}</div>
            <div className="stat-label">CARDS</div>
          </div>
        </div>

        <div className="home-tile" onClick={() => navigate('/search')}>
          <Icon name="search" className="tile-icon" />
          <div style={{ flex: 1 }}>
            <div className="tile-title">Search</div>
            <div className="tile-subtitle">Find any card on Scryfall</div>
          </div>
          <Icon name="chevron_right" className="chevron" />
        </div>
        <div className="home-tile" onClick={() => navigate('/collections')}>
          <Icon name="collections" className="tile-icon" />
          <div style={{ flex: 1 }}>
            <div className="tile-title">Collection</div>
            <div className="tile-subtitle">Your owned cards and binders</div>
          </div>
          <Icon name="chevron_right" className="chevron" />
        </div>
        <div className="home-tile" onClick={() => navigate('/decks')}>
          <Icon name="style" className="tile-icon" />
          <div style={{ flex: 1 }}>
            <div className="tile-title">Decks</div>
            <div className="tile-subtitle">Build and manage your decks</div>
          </div>
          <Icon name="chevron_right" className="chevron" />
        </div>
      </div>
    </>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { GAME_MODES, GAME_MODE_LABELS, DECK_OWNERSHIP_LABELS } from '../types/models'
import type { GameMode } from '../types/models'

export function DecksPage() {
  const { decks } = useSync()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <>
      <TopBar
        title="DECKS"
        actions={
          <button className="top-bar-icon" onClick={() => setShowCreate(true)} aria-label="New deck">
            <Icon name="add" />
          </button>
        }
      />
      <div className="content-scroll">
        {decks.length === 0 ? (
          <div className="empty-state">No decks yet. Tap + to build your first deck.</div>
        ) : (
          <div className="deck-grid">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="deck-tile"
                style={deck.commander?.imageUrl ? { backgroundImage: `url(${deck.commander.imageUrl})` } : undefined}
                onClick={() => navigate(`/decks/${deck.id}`)}
              >
                {deck.ownership !== 'PHYSICAL' && (
                  <div className="ownership-badge">{DECK_OWNERSHIP_LABELS[deck.ownership].toUpperCase()}</div>
                )}
                <div className="scrim" />
                <div className="tile-content">
                  <div className="deck-name">{deck.name}</div>
                  <div className="deck-sub">{deck.commander?.name ?? 'No commander'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && <CreateDeckDialog onDismiss={() => setShowCreate(false)} onCreated={(id) => navigate(`/decks/${id}`)} />}
    </>
  )
}

function CreateDeckDialog({ onDismiss, onCreated }: { onDismiss: () => void; onCreated: (id: string) => void }) {
  const { createDeck } = useSync()
  const [name, setName] = useState('')
  const [gameMode, setGameMode] = useState<GameMode>('COMMANDER')

  return (
    <Dialog
      title="New deck"
      onDismiss={onDismiss}
      actions={
        <>
          <button className="btn" onClick={onDismiss}>CANCEL</button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              const deck = createDeck(name.trim(), gameMode)
              onCreated(deck.id)
            }}
          >
            CREATE
          </button>
        </>
      }
    >
      <div className="field-label">Deck name</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="field-label" style={{ marginTop: 14 }}>Game mode</div>
      <select className="input" value={gameMode} onChange={(e) => setGameMode(e.target.value as GameMode)}>
        {GAME_MODES.map((m) => (
          <option key={m} value={m}>{GAME_MODE_LABELS[m]}</option>
        ))}
      </select>
    </Dialog>
  )
}

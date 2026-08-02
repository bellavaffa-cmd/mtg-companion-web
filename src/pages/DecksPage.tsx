import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { GAME_MODES, GAME_MODE_LABELS } from '../types/models'
import type { GameMode } from '../types/models'

export function DecksPage() {
  const { decks, createDeck, deleteDeck } = useSync()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [gameMode, setGameMode] = useState<GameMode>('COMMANDER')

  return (
    <div>
      <h1 className="page-title">DECKS</h1>
      <div className="card-panel" style={{ marginBottom: 20 }}>
        <div className="row">
          <input
            className="input"
            placeholder="New deck name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <select className="input" style={{ width: 150 }} value={gameMode} onChange={(e) => setGameMode(e.target.value as GameMode)}>
            {GAME_MODES.map((m) => (
              <option key={m} value={m}>{GAME_MODE_LABELS[m]}</option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              const deck = createDeck(name.trim(), gameMode)
              setName('')
              navigate(`/decks/${deck.id}`)
            }}
          >
            Create
          </button>
        </div>
      </div>

      {decks.length === 0 ? (
        <div className="empty-state">No decks yet. Create one above.</div>
      ) : (
        decks.map((deck) => {
          const cardCount = deck.cards.reduce((s, c) => s + c.quantity, 0)
          return (
            <div key={deck.id} className="card-row" style={{ padding: '14px 16px' }}>
              <Link to={`/decks/${deck.id}`} className="name" style={{ color: 'var(--text-primary)' }}>
                <div style={{ fontSize: 15 }}>{deck.name}</div>
                <div className="dim">
                  {GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode} ·{' '}
                  {deck.commander?.name ?? 'No commander'} · {cardCount} card{cardCount === 1 ? '' : 's'}
                </div>
              </Link>
              <button className="btn btn-danger" onClick={() => deleteDeck(deck.id)}>
                Delete
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}

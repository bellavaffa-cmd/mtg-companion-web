import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { CardSearchResults } from '../components/CardSearchResults'
import { GAME_MODES, GAME_MODES_USING_COMMANDER, GAME_MODE_LABELS } from '../types/models'
import type { DeckCardEntry, GameMode } from '../types/models'

export function DeckDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    decks, setCardQuantity, removeCardFromDeck, addCardToDeck,
    setCommander, setPartnerCommander, setGameMode, setDeckTags,
  } = useSync()
  const deck = decks.find((d) => d.id === id)
  const [tagInput, setTagInput] = useState('')

  if (!deck) {
    return <div className="empty-state">Deck not found. It may have been deleted.</div>
  }

  const usesCommander = GAME_MODES_USING_COMMANDER.has(deck.gameMode as GameMode)
  const commanderIds = new Set([deck.commander?.scryfallId, deck.partnerCommander?.scryfallId].filter(Boolean))
  const otherCards = deck.cards.filter((c) => !commanderIds.has(c.scryfallId))
  const totalCards = deck.cards.reduce((s, c) => s + c.quantity, 0)

  function canPartner(entry: DeckCardEntry): boolean {
    if (!deck!.commander || !entry.partnerAbility || !deck!.commander.partnerAbility) return false
    if (entry.scryfallId === deck!.commander.scryfallId) return false
    if (entry.partnerAbility === 'Partner' && deck!.commander.partnerAbility === 'Partner') return true
    if (entry.partnerAbility.toLowerCase() === deck!.commander.name.toLowerCase()) return true
    if (deck!.commander.partnerAbility.toLowerCase() === entry.name.toLowerCase()) return true
    return false
  }

  return (
    <div>
      <button className="btn" onClick={() => navigate('/decks')} style={{ marginBottom: 16 }}>
        ← Back to Decks
      </button>
      <h1 className="page-title">{deck.name.toUpperCase()}</h1>

      <div className="card-panel">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="row">
            <span className="muted">Game mode</span>
            <select
              className="input"
              style={{ width: 150 }}
              value={deck.gameMode}
              onChange={(e) => setGameMode(deck.id, e.target.value as GameMode)}
            >
              {GAME_MODES.map((m) => (
                <option key={m} value={m}>{GAME_MODE_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div className="muted">{totalCards} card{totalCards === 1 ? '' : 's'}</div>
        </div>

        {usesCommander && (
          <div style={{ marginBottom: 10 }}>
            <div className="muted" style={{ marginBottom: 6 }}>COMMANDER</div>
            {deck.commander ? (
              <div className="row">
                <span className="badge badge-gold">{deck.commander.name}</span>
                <button className="btn" onClick={() => setCommander(deck.id, null)}>Remove</button>
              </div>
            ) : (
              <div className="dim">None set — use "Set as commander" on a card below.</div>
            )}
            {deck.partnerCommander && (
              <div className="row" style={{ marginTop: 6 }}>
                <span className="badge badge-gold">{deck.partnerCommander.name} (partner)</span>
                <button className="btn" onClick={() => setPartnerCommander(deck.id, null)}>Remove</button>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="muted" style={{ marginBottom: 6 }}>TAGS</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {deck.tags.map((tag) => (
              <span key={tag} className="chip selected" onClick={() => setDeckTags(deck.id, deck.tags.filter((t) => t !== tag))}>
                {tag} ×
              </span>
            ))}
            <input
              className="input"
              style={{ width: 160 }}
              placeholder="Add tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  setDeckTags(deck.id, [...deck.tags, tagInput.trim()])
                  setTagInput('')
                }
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        {otherCards.length === 0 ? (
          <div className="empty-state">No cards yet — search below to add some.</div>
        ) : (
          otherCards.map((entry) => (
            <div key={entry.scryfallId} className="card-row">
              {entry.imageUrl && <img src={entry.imageUrl} alt={entry.name} />}
              <div className="name">{entry.name}</div>
              <div className="qty-stepper">
                <button onClick={() => setCardQuantity(deck.id, entry.scryfallId, entry.quantity - 1)}>−</button>
                <span>{entry.quantity}</span>
                <button onClick={() => setCardQuantity(deck.id, entry.scryfallId, entry.quantity + 1)}>+</button>
              </div>
              {usesCommander && entry.canBeCommander && (
                <button className="btn" onClick={() => setCommander(deck.id, entry)}>
                  Set as commander
                </button>
              )}
              {usesCommander && canPartner(entry) && (
                <button className="btn" onClick={() => setPartnerCommander(deck.id, entry)}>
                  Set as partner
                </button>
              )}
              <button className="btn btn-danger" onClick={() => removeCardFromDeck(deck.id, entry.scryfallId)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <div className="card-panel" style={{ marginTop: 24 }}>
        <div className="muted" style={{ marginBottom: 10 }}>ADD CARDS</div>
        <CardSearchResults onAdd={(card) => addCardToDeck(deck.id, card)} />
      </div>
    </div>
  )
}

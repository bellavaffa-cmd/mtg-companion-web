import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal } from '../components/CardZoomModal'
import { ContextMenu } from '../components/ContextMenu'
import { useLongPress } from '../components/useLongPress'
import { CardSearchResults } from '../components/CardSearchResults'
import { ExportDeckDialog } from '../components/ExportDeckDialog'
import { useAddWarning } from '../components/useAddWarning'
import {
  GAME_MODES, GAME_MODES_USING_COMMANDER, GAME_MODE_LABELS,
  DECK_OWNERSHIP_OPTIONS, DECK_OWNERSHIP_LABELS, DECK_OWNERSHIP_DESCRIPTIONS,
} from '../types/models'
import type { DeckCardEntry, DeckOwnership, GameMode } from '../types/models'

export function DeckDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    decks, setCardQuantity, removeCardFromDeck, addCardToDeck,
    setCommander, setPartnerCommander, setGameMode, setDeckOwnership, setDeckTags, deleteDeck,
  } = useSync()
  const deck = decks.find((d) => d.id === id)
  const [tagInput, setTagInput] = useState('')
  const [zoomId, setZoomId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DeckCardEntry } | null>(null)
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [addWarning, setAddWarning] = useAddWarning()

  if (!deck) {
    return (
      <>
        <TopBar title="DECK" onBack={() => navigate('/decks')} />
        <div className="content-scroll">
          <div className="empty-state">Deck not found. It may have been deleted.</div>
        </div>
      </>
    )
  }

  const usesCommander = GAME_MODES_USING_COMMANDER.has(deck.gameMode as GameMode)
  const commanderIds = new Set([deck.commander?.scryfallId, deck.partnerCommander?.scryfallId].filter(Boolean))
  const otherCards = deck.cards.filter((c) => !commanderIds.has(c.scryfallId))
  const totalCards = deck.cards.reduce((s, c) => s + c.quantity, 0)
  const zoomEntry = deck.cards.find((c) => c.scryfallId === zoomId) ?? null

  function canPartner(entry: DeckCardEntry): boolean {
    if (!deck!.commander || !entry.partnerAbility || !deck!.commander.partnerAbility) return false
    if (entry.scryfallId === deck!.commander.scryfallId) return false
    if (entry.partnerAbility === 'Partner' && deck!.commander.partnerAbility === 'Partner') return true
    if (entry.partnerAbility.toLowerCase() === deck!.commander.name.toLowerCase()) return true
    if (deck!.commander.partnerAbility.toLowerCase() === entry.name.toLowerCase()) return true
    return false
  }

  return (
    <>
      <TopBar
        title={deck.name.toUpperCase()}
        onBack={() => navigate('/decks')}
        actions={
          <button
            className="top-bar-icon"
            onClick={(e) => setOverflowMenu({ x: e.clientX, y: e.clientY })}
            aria-label="Deck menu"
          >
            <Icon name="more_vert" />
          </button>
        }
      />
      <div className="content-scroll">
        <div className="card-panel">
          <div className="row-between" style={{ marginBottom: 10 }}>
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
            <span className="muted">{totalCards} card{totalCards === 1 ? '' : 's'}</span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div className="section-label">Ownership</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {DECK_OWNERSHIP_OPTIONS.map((option) => (
                <span
                  key={option}
                  className={`chip${deck.ownership === option ? ' selected' : ''}`}
                  onClick={() => setDeckOwnership(deck.id, option as DeckOwnership)}
                >
                  {DECK_OWNERSHIP_LABELS[option]}
                </span>
              ))}
            </div>
            <div className="dim" style={{ marginTop: 6 }}>{DECK_OWNERSHIP_DESCRIPTIONS[deck.ownership]}</div>
          </div>

          {usesCommander && (
            <div style={{ marginBottom: 10 }}>
              <div className="section-label">Commander</div>
              {deck.commander ? (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="badge badge-gold">{deck.commander.name}</span>
                  <Icon name="close" style={{ cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => setCommander(deck.id, null)} />
                  {deck.partnerCommander && (
                    <>
                      <span className="badge badge-gold">{deck.partnerCommander.name}</span>
                      <Icon name="close" style={{ cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => setPartnerCommander(deck.id, null)} />
                    </>
                  )}
                </div>
              ) : (
                <div className="dim">None — long-press an eligible card below.</div>
              )}
            </div>
          )}

          <div>
            <div className="section-label">Tags</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {deck.tags.map((tag) => (
                <span key={tag} className="chip selected" onClick={() => setDeckTags(deck.id, deck.tags.filter((t) => t !== tag))}>
                  {tag} ×
                </span>
              ))}
              <input
                className="input"
                style={{ width: 130 }}
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

        <div style={{ marginTop: 16 }}>
          {otherCards.length === 0 ? (
            <div className="empty-state">No cards yet — search below to add some.</div>
          ) : (
            otherCards.map((entry) => (
              <DeckCardRow
                key={entry.scryfallId}
                entry={entry}
                onZoom={() => setZoomId(entry.scryfallId)}
                onIncrement={() => setCardQuantity(deck.id, entry.scryfallId, entry.quantity + 1)}
                onDecrement={() => setCardQuantity(deck.id, entry.scryfallId, entry.quantity - 1)}
                onLongPress={(x, y) => setMenu({ x, y, entry })}
              />
            ))
          )}
        </div>

        <div className="section-label" style={{ marginTop: 20 }}>ADD CARDS</div>
        {addWarning && <div className="add-warning">{addWarning}</div>}
        <CardSearchResults onAdd={(card) => setAddWarning(addCardToDeck(deck.id, card))} />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          actions={[
            ...(usesCommander && menu.entry.canBeCommander
              ? [{ label: 'Set as commander', icon: 'star', onClick: () => setCommander(deck.id, menu.entry) }]
              : []),
            ...(usesCommander && canPartner(menu.entry)
              ? [{ label: 'Set as partner commander', icon: 'star', onClick: () => setPartnerCommander(deck.id, menu.entry) }]
              : []),
            { label: 'Remove from deck', icon: 'delete', destructive: true, onClick: () => removeCardFromDeck(deck.id, menu.entry.scryfallId) },
          ]}
        />
      )}

      {overflowMenu && (
        <ContextMenu
          x={overflowMenu.x}
          y={overflowMenu.y}
          onClose={() => setOverflowMenu(null)}
          actions={[
            { label: 'Export decklist', icon: 'ios_share', onClick: () => setShowExport(true) },
            {
              label: 'Delete deck',
              icon: 'delete',
              destructive: true,
              onClick: () => {
                deleteDeck(deck.id)
                navigate('/decks')
              },
            },
          ]}
        />
      )}

      {showExport && <ExportDeckDialog deck={deck} onDismiss={() => setShowExport(false)} />}

      {zoomEntry && (
        <CardZoomModal
          imageUrl={zoomEntry.imageUrl}
          name={zoomEntry.name}
          scryfallId={zoomEntry.scryfallId}
          currentDeckId={deck.id}
          backImageUrl={zoomEntry.backImageUrl}
          tags={zoomEntry.tags}
          onSelectSimilar={(similar) => setAddWarning(addCardToDeck(deck.id, similar))}
          onClose={() => setZoomId(null)}
        >
          <div className="qty-stepper" style={{ marginTop: 14, justifyContent: 'center' }}>
            <button onClick={() => setCardQuantity(deck.id, zoomEntry.scryfallId, zoomEntry.quantity - 1)}>−</button>
            <span>{zoomEntry.quantity}</span>
            <button onClick={() => setCardQuantity(deck.id, zoomEntry.scryfallId, zoomEntry.quantity + 1)}>+</button>
          </div>
        </CardZoomModal>
      )}
    </>
  )
}

function DeckCardRow({
  entry,
  onZoom,
  onIncrement,
  onDecrement,
  onLongPress,
}: {
  entry: DeckCardEntry
  onZoom: () => void
  onIncrement: () => void
  onDecrement: () => void
  onLongPress: (x: number, y: number) => void
}) {
  const longPress = useLongPress({ onLongPress, onClick: onZoom })
  return (
    <div className="card-row">
      <div className="thumb-wrap">
        <img src={entry.imageUrl ?? undefined} alt={entry.name} {...longPress} style={{ cursor: 'pointer' }} />
        {entry.backImageUrl && (
          <span className="flip-badge">
            <Icon name="autorenew" />
          </span>
        )}
      </div>
      <div className="name" {...longPress} style={{ cursor: 'pointer' }}>{entry.name}</div>
      <div className="qty-stepper">
        <button onClick={onDecrement}>−</button>
        <span>{entry.quantity}</span>
        <button onClick={onIncrement}>+</button>
      </div>
    </div>
  )
}

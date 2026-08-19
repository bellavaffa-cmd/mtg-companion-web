import { useEffect, useState } from 'react'
import { searchCards } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import { backImageUrl, cardTags, displayImageUrl, hasFlipSides } from '../types/scryfall'
import { useSync } from '../sync/SyncContext'
import { ContextMenu } from './ContextMenu'
import { Icon } from './Icon'
import { useLongPress } from './useLongPress'
import { CardZoomModal } from './CardZoomModal'

interface Props {
  /** If provided, long-press just offers a single "Add" wired to this (used inside a deck/binder's
   * own "add cards" section). Otherwise falls back to a flat list of every deck/binder to add into
   * (the standalone Search page). */
  onAdd?: (card: ScryfallCard) => void
  placeholder?: string
}

export function CardSearchResults({ onAdd, placeholder = 'Search cards, e.g. "c:g t:creature"' }: Props) {
  const { decks, collections, addCardToDeck, addEntryToCollection } = useSync()
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<ScryfallCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomCard, setZoomCard] = useState<ScryfallCard | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; card: ScryfallCard } | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setCards([])
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      searchCards(trimmed)
        .then((page) => {
          if (cancelled) return
          setCards(page.cards)
          setError(null)
        })
        .catch((e) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : 'Search failed')
          setCards([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  function menuActionsFor(card: ScryfallCard) {
    if (onAdd) {
      return [{ label: 'Add', icon: 'add', onClick: () => onAdd(card) }]
    }
    return [
      ...collections.map((c) => ({ label: `Add to ${c.name}`, icon: 'collections', onClick: () => addEntryToCollection(c.id, card) })),
      ...decks.map((d) => ({ label: `Add to ${d.name}`, icon: 'style', onClick: () => addCardToDeck(d.id, card) })),
    ]
  }

  return (
    <div>
      <input
        className="input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div style={{ marginTop: 14 }}>
        {loading && <div className="muted">Searching…</div>}
        {error && <div className="muted" style={{ color: 'var(--error)' }}>{error}</div>}
        {!loading && !error && query.trim() && cards.length === 0 && (
          <div className="empty-state">No cards match.</div>
        )}
        {cards.map((card) => (
          <ResultRow
            key={card.id}
            card={card}
            onZoom={() => setZoomCard(card)}
            onLongPress={(x, y) => setMenu({ x, y, card })}
          />
        ))}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} actions={menuActionsFor(menu.card)} />
      )}

      {zoomCard && (
        <CardZoomModal
          imageUrl={displayImageUrl(zoomCard)}
          name={zoomCard.name}
          priceUsd={zoomCard.prices?.usd}
          scryfallId={zoomCard.id}
          backImageUrl={backImageUrl(zoomCard)}
          tags={cardTags(zoomCard)}
          onSelectSimilar={setZoomCard}
          onClose={() => setZoomCard(null)}
        >
          {onAdd ? (
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { onAdd(zoomCard); setZoomCard(null) }}>
              ADD
            </button>
          ) : (
            <div className="muted" style={{ marginTop: 10 }}>Long-press the card to add it somewhere.</div>
          )}
        </CardZoomModal>
      )}
    </div>
  )
}

function ResultRow({
  card,
  onZoom,
  onLongPress,
}: {
  card: ScryfallCard
  onZoom: () => void
  onLongPress: (x: number, y: number) => void
}) {
  const longPress = useLongPress({ onLongPress, onClick: onZoom })
  return (
    <div className="card-row" {...longPress} style={{ cursor: 'pointer' }}>
      <div className="thumb-wrap">
        <img src={displayImageUrl(card) ?? undefined} alt={card.name} loading="lazy" />
        {hasFlipSides(card) && (
          <span className="flip-badge">
            <Icon name="autorenew" />
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="name">{card.name}</div>
        <div className="type-line">{(card.type_line ?? '').toUpperCase()}</div>
      </div>
      {card.prices?.usd && <div className="muted">${card.prices.usd}</div>}
    </div>
  )
}

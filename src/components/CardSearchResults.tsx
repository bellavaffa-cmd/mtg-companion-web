import { useEffect, useState } from 'react'
import { searchCards } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import { displayImageUrl } from '../types/scryfall'
import { AddToTargetMenu } from './AddToTargetMenu'

interface Props {
  /** If provided, each result shows a single "Add" button wired to this. Otherwise falls back to
   * the generic "Add to…" deck/binder picker (used by the standalone Search page). */
  onAdd?: (card: ScryfallCard) => void
  placeholder?: string
}

export function CardSearchResults({ onAdd, placeholder = 'Search Scryfall — card name or syntax like "c:g t:creature"' }: Props) {
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<ScryfallCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div>
      <input
        className="input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div style={{ marginTop: 16 }}>
        {loading && <div className="muted">Searching…</div>}
        {error && <div className="muted" style={{ color: 'var(--error)' }}>{error}</div>}
        {!loading && !error && query.trim() && cards.length === 0 && (
          <div className="empty-state">No cards match.</div>
        )}
        <div className="grid">
          {cards.map((card) => (
            <div key={card.id} className="card-tile" style={{ cursor: 'default' }}>
              <img src={displayImageUrl(card) ?? undefined} alt={card.name} loading="lazy" />
              <div className="tile-label">{card.name}</div>
              <div style={{ padding: '0 8px 8px' }}>
                {onAdd ? (
                  <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => onAdd(card)}>
                    Add
                  </button>
                ) : (
                  <AddToTargetMenu card={card} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { Deck } from '../types/models'
import { OPENING_HAND, shuffledLibrary, type LibraryCard } from '../decks/goldfish'
import { CardZoomModal } from './CardZoomModal'
import { Icon } from './Icon'

/**
 * Solo playtesting: the deck shuffled, an opening hand drawn, then a card at a time — to see how its
 * mana and curve play out. Nothing is saved; it starts over each time it's opened.
 */
export function GoldfishDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const deal = () => {
    const library = shuffledLibrary(deck)
    return { hand: library.slice(0, OPENING_HAND), library: library.slice(OPENING_HAND) }
  }
  const [{ hand, library }, setGame] = useState<{ hand: LibraryCard[]; library: LibraryCard[] }>(deal)
  const [zoom, setZoom] = useState<LibraryCard | null>(null)
  const empty = hand.length === 0 && library.length === 0

  // Escape closes the zoom first, then this.
  useEffect(() => {
    if (zoom) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, onClose])

  const draw = () => setGame((g) => (g.library.length ? { hand: [...g.hand, g.library[0]], library: g.library.slice(1) } : g))

  return (
    <div className="goldfish" role="dialog" aria-modal="true" aria-label={`Goldfish ${deck.name}`}>
      <div className="goldfish-bar">
        <button type="button" className="ib" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        <div className="goldfish-title">
          <b>Goldfish</b>
          <span className="dim">{deck.name} · Library: {library.length}</span>
        </div>
      </div>
      <div className="goldfish-body">
        {empty ? (
          <div className="empty-state"><Icon name="style" />Add cards to this deck before playtesting.</div>
        ) : (
          <>
            <div className="goldfish-label">Hand ({hand.length})</div>
            <div className="goldfish-hand">
              {hand.map((c) => (
                <button key={c.key} type="button" className="goldfish-card press" onClick={() => setZoom(c)} aria-label={c.entry.name}>
                  {c.entry.imageUrl ? <img src={c.entry.imageUrl} alt="" loading="lazy" /> : <span className="goldfish-noimg">{c.entry.name}</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {!empty && (
        <div className="goldfish-actions">
          <button type="button" className="btn line" onClick={() => setGame(deal())}><Icon name="refresh" aria-hidden />New hand</button>
          <button type="button" className="btn gold" disabled={library.length === 0} onClick={draw}><Icon name="add_card" aria-hidden />Draw</button>
        </div>
      )}
      {zoom && (
        <CardZoomModal
          imageUrl={zoom.entry.imageUrl}
          name={zoom.entry.name}
          typeLine={zoom.entry.typeLine}
          scryfallId={zoom.entry.scryfallId}
          currentDeckId={deck.id}
          backImageUrl={zoom.entry.backImageUrl}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  )
}

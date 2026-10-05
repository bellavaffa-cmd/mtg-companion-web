import { useState } from 'react'
import { Dialog } from './Dialog'
import { ManaPips } from './kit'
import { BASIC_LAND_FOR, basicLandSplit, basicsWanted, mainDeckPips, strongestPairs } from '../decks/limited'
import type { Deck, DeckCardEntry } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

// The draft and sealed parts of the deck page (decks/limited.ts): the pool's strongest colour pairs,
// and "Add basic lands". The Android app's LimitedUi.kt shows the same.

const COLOURS = ['W', 'U', 'B', 'R', 'G']

/** One line over the pool: the three colour pairs with the most playable cards. */
export function PoolPairsHint({ pool, cardsById }: { pool: DeckCardEntry[]; cardsById: Map<string, ScryfallCard> }) {
  const pairs = strongestPairs(pool, cardsById)
  if (pairs.length === 0) return null
  return (
    <div className="dim" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', margin: '4px 0 10px' }}>
      <span>Strongest pairs</span>
      {pairs.map((p) => (
        <span key={p.colours} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={`${p.count} playable cards in these colours or colourless`}>
          <ManaPips colors={p.colours.split('')} size={16} />
          <b>{p.count}</b>
        </span>
      ))}
    </div>
  )
}

/**
 * "Add basic lands": 17 lands for 40 cards (less the lands already in), split by the coloured mana
 * symbols in the main deck. Every count can be changed before they go into the main deck.
 */
export function BasicLandsDialog({ deck, cardsById, onAdd, onDismiss }: {
  deck: Deck
  cardsById: Map<string, ScryfallCard>
  onAdd: (counts: Record<string, number>) => void
  onDismiss: () => void
}) {
  const [counts, setCounts] = useState<Record<string, number>>(() => basicLandSplit(mainDeckPips(deck.cards, cardsById), basicsWanted(deck.cards, cardsById)))
  const suggested = Object.keys(counts).length > 0
  const total = COLOURS.reduce((n, c) => n + (counts[c] ?? 0), 0)
  const step = (c: string, by: number) => setCounts((now) => ({ ...now, [c]: Math.max(0, (now[c] ?? 0) + by) }))
  return (
    <Dialog
      title="Add basic lands"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={total === 0} onClick={() => onAdd(counts)}>
            Add {total} {total === 1 ? 'land' : 'lands'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: '0 0 12px' }}>
        {suggested
          ? 'Split by the coloured mana symbols in your main deck — 17 lands for 40 cards. Change any count before adding them.'
          : 'No coloured mana symbols in the main deck yet. Move your picks in from the pool first, or choose the lands yourself.'}
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {COLOURS.map((c) => (
          <div key={c} className="row-between">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ManaPips colors={[c]} size={18} />
              {BASIC_LAND_FOR[c]}
            </span>
            <div className="stepper-big">
              <button type="button" disabled={(counts[c] ?? 0) <= 0} onClick={() => step(c, -1)} aria-label={`One ${BASIC_LAND_FOR[c]} fewer`}>−</button>
              <span className="qn" aria-live="polite">{counts[c] ?? 0}</span>
              <button type="button" onClick={() => step(c, 1)} aria-label={`One ${BASIC_LAND_FOR[c]} more`}>+</button>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

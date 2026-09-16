import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import { displayManaCost, type ScryfallCard } from '../types/scryfall'
import type { Deck } from '../types/models'
import { ManaSymbol } from './ManaSymbols'

/** Canonical mana-color order, with generic {C} last. Mirrors the Android app's pipTotals. */
const PIP_ORDER = ['W', 'U', 'B', 'R', 'G', 'Colorless'] as const

const PIP_SYMBOL_PATTERN = /\{([^}]+)\}/g

/**
 * How many colored mana symbols of each color appear across every card's cast cost, weighted by
 * how many copies the deck runs. Generic numbers aren't a color and are excluded; hybrid and
 * Phyrexian symbols count toward each color they represent, since either one can be paid.
 *
 * This is the deck's actual color-mana *demand* — distinct from counting cards per color identity,
 * which says nothing about how hard each color is to cast. Mirrors DeckDetailViewModel's
 * colorPipCounts.
 */
function colorPipCounts(
  entries: { scryfallId: string; quantity: number }[],
  cardsById: Map<string, ScryfallCard>,
): [string, number][] {
  const totals = new Map<string, number>(PIP_ORDER.map((k) => [k, 0]))
  for (const entry of entries) {
    const card = cardsById.get(entry.scryfallId)
    const cost = card ? displayManaCost(card) : null
    if (!cost) continue
    for (const match of cost.matchAll(PIP_SYMBOL_PATTERN)) {
      const symbol = match[1].toUpperCase()
      if (symbol === 'C') {
        totals.set('Colorless', totals.get('Colorless')! + entry.quantity)
      } else {
        // "2/W" and "W/P" both contain a real color; "2" and "X" contain none, and the
        // has() guard drops those without needing to enumerate them.
        for (const part of symbol.split('/')) {
          const current = totals.get(part)
          if (current !== undefined) totals.set(part, current + entry.quantity)
        }
      }
    }
  }
  return PIP_ORDER.map((key) => [key, totals.get(key)!] as [string, number]).filter(([, n]) => n > 0)
}

/**
 * The deck's Stats tab. Deck entries only cache a field subset (no mana cost), so the full cards
 * are fetched once per deck — which also means this works for decks built before the tab existed,
 * rather than showing nothing until every card is re-added.
 */
export function DeckStats({ deck }: { deck: Deck }) {
  // undefined = not loaded yet, null = failed.
  const [cardsById, setCardsById] = useState<Map<string, ScryfallCard> | null | undefined>(undefined)

  const allEntries = [deck.commander, deck.partnerCommander, ...deck.cards].filter((e) => e !== null)
  const ids = allEntries.map((e) => e.scryfallId)
  const idKey = ids.join(',')

  useEffect(() => {
    if (ids.length === 0) {
      setCardsById(new Map())
      return
    }
    let cancelled = false
    setCardsById(undefined)
    getCardsByIds(ids)
      .then((cards) => {
        if (!cancelled) setCardsById(new Map(cards.map((c) => [c.id, c])))
      })
      .catch(() => {
        if (!cancelled) setCardsById(null)
      })
    return () => {
      cancelled = true
    }
    // idKey, not `ids`: a fresh array every render would restart the fetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey])

  if (allEntries.length === 0) {
    return <div className="empty-state">Add some cards to see this deck's stats.</div>
  }
  if (cardsById === undefined) {
    return <div className="empty-state">Loading card data…</div>
  }
  if (cardsById === null) {
    return <div className="empty-state">Couldn't load card data. Check your connection and try again.</div>
  }

  const pips = colorPipCounts(allEntries, cardsById)
  const totalPips = pips.reduce((sum, [, n]) => sum + n, 0)

  return (
    <div className="card-panel">
      <div className="section-label">MANA SYMBOLS</div>
      {totalPips === 0 ? (
        <div className="dim" style={{ marginTop: 8 }}>
          No colored mana symbols — this deck's cards all cost generic mana.
        </div>
      ) : (
        <>
          <div className="mana-table">
            {pips.map(([color, count]) => (
              <div className="mana-table-row" key={color}>
                <ManaSymbol code={color} size={16} />
                <span className="mana-table-count">{count}</span>
                <span className="mana-bar">
                  <span className="mana-bar-fill" style={{ width: `${(count / totalPips) * 100}%` }} />
                </span>
                <span className="mana-table-pct">{Math.floor((count * 100) / totalPips)}%</span>
              </div>
            ))}
          </div>
          <div className="dim" style={{ marginTop: 10 }}>
            {totalPips} colored mana symbols across every card's cast cost — how much of each color
            this deck actually demands, not just how many lands produce it.
          </div>
        </>
      )}
    </div>
  )
}

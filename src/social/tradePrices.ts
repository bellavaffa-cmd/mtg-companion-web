import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { TradeCard } from './api'
import type { PriceBook } from './tradeFairness'

// Today's prices for the cards of a trade (TradeValue) or a game night's suggested trades (TradeNightSection).

/** Prices of [cards] (USD, and the foil price for foil copies), fetched when the list changes. Null when they couldn't be fetched. */
export function useTradePrices(cards: TradeCard[]): PriceBook | null | undefined {
  const [prices, setPrices] = useState<{ key: string; book: PriceBook | null } | null>(null)
  const key = [...new Set(cards.map((c) => c.scryfallId))].sort().join(',')
  useEffect(() => {
    if (!key) return
    let cancelled = false
    getCardsByIds(key.split(','))
      .then((list) => {
        if (cancelled) return
        setPrices({ key, book: new Map(list.map((c) => [c.id, {
          usd: c.prices?.usd ? Number(c.prices.usd) : null,
          foil: c.prices?.usd_foil ? Number(c.prices.usd_foil) : null,
        }])) })
      })
      .catch(() => { if (!cancelled) setPrices({ key, book: null }) })
    return () => { cancelled = true }
  }, [key])
  if (!key) return new Map()
  if (prices?.key === key) return prices.book
  // The last answer still does while it has every card (a card taken off), so the totals don't blink.
  const last = prices?.book
  return last && key.split(',').every((id) => last.has(id)) ? last : undefined
}

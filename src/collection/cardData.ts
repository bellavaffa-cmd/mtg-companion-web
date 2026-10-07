// Scryfall's data for the cards owned (price, colours, type, set): a card added later is fetched on
// its own, not the whole collection again. Kept for this visit here, and in the browser between visits
// (cardDataStore.ts), so a big collection's details don't come over the network every time. Shared
// by the Collection's All cards and Sets pages.

import { useEffect, useMemo, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import { isStale, loadSavedCards, saveCards } from './cardDataStore'

export const knownCards = new Map<string, ScryfallCard>()
/** Fetched from Scryfall on this visit: never stale. */
const fetchedNow = new Set<string>()

/** Scryfall's data for [ids], as it comes: undefined while the first batch loads. */
export function useCardData(ids: string[]): Map<string, ScryfallCard> | undefined {
  // Worked out again only when the ids change: a big collection has thousands.
  const key = useMemo(() => [...ids].sort().join(','), [ids])
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    void loadSavedCards().then((saved) => {
      let found = false
      for (const id of ids) {
        const s = saved.get(id)
        if (s && !knownCards.has(id)) { knownCards.set(id, s); found = true }
      }
      if (found && !cancelled) setVersion((v) => v + 1)
      // Missing, or saved more than a day ago (prices move): asked for again.
      const want = ids.filter((id) => !knownCards.has(id) || (!fetchedNow.has(id) && isStale(id)))
      if (want.length === 0) return
      void getCardsByIds(want).then((cards) => {
        for (const c of cards) { knownCards.set(c.id, c); fetchedNow.add(c.id) }
        saveCards(cards)
        if (!cancelled) setVersion((v) => v + 1)
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return useMemo(() => (ids.length === 0 || ids.some((id) => knownCards.has(id)) ? new Map(knownCards) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version])
}

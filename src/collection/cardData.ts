// Scryfall's data for the cards owned (price, colours, type, set), kept for this visit: a card added
// later is fetched on its own, not the whole collection again. Shared by the Collection's All cards
// and Sets pages.

import { useEffect, useMemo, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'

export const knownCards = new Map<string, ScryfallCard>()

/** Scryfall's data for [ids], as it comes: undefined while the first batch loads. */
export function useCardData(ids: string[]): Map<string, ScryfallCard> | undefined {
  const key = [...ids].sort().join(',')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const missing = ids.filter((id) => !knownCards.has(id))
    if (missing.length === 0) return
    let cancelled = false
    void getCardsByIds(missing).then((cards) => {
      for (const c of cards) knownCards.set(c.id, c)
      if (!cancelled) setVersion((v) => v + 1)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return useMemo(() => (ids.length === 0 || ids.some((id) => knownCards.has(id)) ? new Map(knownCards) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version])
}

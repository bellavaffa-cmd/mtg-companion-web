import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { TokenNeeded } from '../decks/tokens'
import type { ScryfallCard } from '../types/scryfall'

/**
 * The pictures of a deck's tokens (decks/tokens.ts), fetched once per set of tokens. A token that
 * hasn't arrived yet just isn't in the map, so its name is still worth showing.
 */
export function useTokenArt(tokens: TokenNeeded[]): Map<string, ScryfallCard> {
  const [art, setArt] = useState<Map<string, ScryfallCard>>(new Map())
  const ids = tokens.map((t) => t.id).join(',')
  useEffect(() => {
    if (!ids) { setArt(new Map()); return }
    let cancelled = false
    getCardsByIds(ids.split(','))
      .then((cards) => { if (!cancelled) setArt(new Map(cards.map((c) => [c.id, c]))) })
      .catch(() => { /* names alone are still worth showing */ })
    return () => { cancelled = true }
  }, [ids])
  return art
}

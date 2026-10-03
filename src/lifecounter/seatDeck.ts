// Looks up what a deck brings to the table (its tokens and its start-of-turn cards) — see
// seatDeckInfoOf in tableExtras.ts. The Android app's SeatDeck.kt.

import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import { toArtCrop } from '../components/kit'
import { displayImageUrl } from '../types/scryfall'
import type { Deck } from '../types/models'
import { seatDeckInfoOf, type SeatDeckInfo } from './tableExtras'
import { tokensNeeded } from '../decks/tokens'

/** Once per deck (and its size, so an edited deck is looked up again). */
const cache = new Map<string, SeatDeckInfo>()
const deckKey = (deck: Deck) => `${deck.id}:${deck.cards.length}`

/**
 * [deck]'s tokens and trigger cards. Deck entries don't keep oracle text, so the cards come from
 * Scryfall's batch lookup — one request per 75 cards, and one more for the tokens' power and
 * toughness. Null when the cards couldn't be looked up (offline, say).
 */
export async function loadSeatDeckInfo(deck: Deck): Promise<SeatDeckInfo | null> {
  const key = deckKey(deck)
  const cached = cache.get(key)
  if (cached) return cached
  const entries = [deck.commander, deck.partnerCommander, ...deck.cards].filter((e) => e !== null)
  if (entries.length === 0) return { deck: deck.name, tokens: [], triggers: [] }
  const cards = await getCardsByIds(entries.map((e) => e.scryfallId)).catch(() => [])
  // The lookup gives back nothing at all rather than failing when it's offline.
  if (cards.length === 0) return null
  const byId = new Map(cards.map((c) => [c.id, c]))
  const needed = tokensNeeded(deck, byId).filter((t) => !t.isEmblem)
  const tokenCards = needed.length ? await getCardsByIds(needed.map((t) => t.id)).catch(() => []) : []
  const info = seatDeckInfoOf(deck, byId, new Map(tokenCards.map((c) => [c.id, c])), (c) => toArtCrop(displayImageUrl(c)))
  cache.set(key, info)
  return info
}

/** [deck]'s info once it's looked up: [loading] meanwhile, [info] null without a deck or when it couldn't be. */
export function useSeatDeckInfo(deck: Deck | null | undefined): { info: SeatDeckInfo | null; loading: boolean } {
  const key = deck ? deckKey(deck) : null
  const [state, setState] = useState<{ key: string | null; info: SeatDeckInfo | null; loading: boolean }>({ key: null, info: null, loading: false })
  useEffect(() => {
    if (!deck || !key) { setState({ key: null, info: null, loading: false }); return }
    let cancelled = false
    const cached = cache.get(key)
    if (cached) { setState({ key, info: cached, loading: false }); return }
    setState({ key, info: null, loading: true })
    void loadSeatDeckInfo(deck).then((info) => { if (!cancelled) setState({ key, info, loading: false }) })
    return () => { cancelled = true }
    // The key, not the deck object: a deck re-made on every sync would look it up again and again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? { info: state.info, loading: state.loading } : { info: null, loading: !!key }
}

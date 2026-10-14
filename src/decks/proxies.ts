/**
 * Proxies in a deck, and swapping them for the real thing. A deck marked Proxy is proxies all
 * through to begin with; as real copies turn up in your binders they're swapped in one at a time,
 * so a deck can say "7 proxies left" and stop counting the ones that aren't proxies any more.
 * Mirrors the Android app's data/Proxies.kt.
 */

import type { Collection, Deck, DeckCardEntry } from '../types/models'
import { copiesHeld } from './missing'

const key = (name: string) => name.trim().toLowerCase()

/**
 * How many of this entry's copies are proxies. A deck marked Proxy is all proxies until copies are
 * swapped in; any other deck holds proxies only where it says so.
 */
export function proxyCopies(deck: Deck, entry: DeckCardEntry): number {
  const held = entry.proxyQuantity ?? (deck.ownership === 'PROXY' ? entry.quantity : 0)
  return Math.max(0, Math.min(entry.quantity, held))
}

/** How many proxies the whole deck holds. */
export function deckProxyCopies(deck: Deck): number {
  return deck.cards.reduce((n, e) => n + proxyCopies(deck, e), 0)
}

/** Real copies sitting in binders, by card name — what a proxy could be swapped for. */
export function spareCopies(collections: Collection[]): Map<string, number> {
  const spare = new Map<string, number>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      const copies = e.quantity + e.foilQuantity
      if (copies > 0) spare.set(key(e.name), (spare.get(key(e.name)) ?? 0) + copies)
    }
  }
  return spare
}

/** A proxy that could become the real card, and how many spare copies are sitting in binders. */
export interface ProxySwap {
  deck: Deck
  entry: DeckCardEntry
  /** Copies of it in your binders, after the swaps listed before this one. */
  spare: number
}

/**
 * The proxies you already own a real copy of, deck by deck. A binder copy is only offered once,
 * however many decks are playing a proxy of that card.
 */
export function proxySwaps(collections: Collection[], decks: Deck[]): ProxySwap[] {
  const spare = spareCopies(collections)
  const out: ProxySwap[] = []
  for (const deck of decks) {
    // A cube's proxies are filled from the collection by its own pull list, into the cube box (decks/cube.ts).
    if (deck.gameMode === 'CUBE') continue
    for (const entry of deck.cards) {
      const proxies = proxyCopies(deck, entry)
      if (proxies === 0) continue
      const left = spare.get(key(entry.name)) ?? 0
      if (left <= 0) continue
      const swappable = Math.min(proxies, left)
      spare.set(key(entry.name), left - swappable)
      out.push({ deck, entry, spare: swappable })
    }
  }
  return out
}

/** A proxy you own a real copy of, but only in another deck — where it is, and how many. */
export interface ProxyHeldElsewhere {
  entry: DeckCardEntry
  /** Proxies of it still left once the binder copies have been swapped in. */
  proxies: number
  /** The other decks holding a real copy, and how many each has. */
  decks: { deck: Deck; copies: number }[]
}

/**
 * Proxies in [deck] you already own for real, but only in another deck. These aren't offered as a
 * swap: moving the card would leave that deck a card short without anyone saying so. Knowing where
 * it is lets you decide which deck gets it. A proxy a binder copy can cover is left to the swap,
 * and only decks you actually hold count, the same as for the cards a deck is missing.
 */
export function proxiesHeldElsewhere(collections: Collection[], decks: Deck[], deck: Deck): ProxyHeldElsewhere[] {
  const swappable = new Map(proxySwaps(collections, [deck]).map((s) => [s.entry.scryfallId, s.spare]))
  const held = decks.filter((d) => d.id !== deck.id).map((d) => ({ deck: d, copies: copiesHeld(d) }))
  const out: ProxyHeldElsewhere[] = []
  for (const entry of deck.cards) {
    const proxies = proxyCopies(deck, entry) - (swappable.get(entry.scryfallId) ?? 0)
    if (proxies <= 0) continue
    const found = held
      .map(({ deck: d, copies }) => ({ deck: d, copies: copies.get(key(entry.name)) ?? 0 }))
      .filter((h) => h.copies > 0)
    if (found.length > 0) out.push({ entry, proxies, decks: found })
  }
  return out
}

// Swapping a proxy for a binder's copy (withSwapIn) is in swapIn.ts: it records the binder (collection/binderFlows.ts),
// and this low-level file stays free of the collection code.


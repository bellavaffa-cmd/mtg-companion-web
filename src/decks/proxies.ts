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

/** A binder holding a spare copy of [name] — where a swapped-in card comes from. */
function binderWithCopy(collections: Collection[], name: string): Collection | undefined {
  return collections.find((c) => c.type !== 'WISHLIST' && c.entries.some((e) => key(e.name) === key(name) && e.quantity + e.foilQuantity > 0))
}

/**
 * One proxy swapped for the real card: the deck keeps the same card, one copy of it stops being a
 * proxy, and the binder copy that took its place is gone from the binder — it's in the deck now.
 * Unchanged (the same objects) when there's no proxy of that card, or no copy to swap in.
 */
export function withSwapIn(collections: Collection[], decks: Deck[], deckId: string, scryfallId: string): { collections: Collection[]; decks: Deck[] } {
  const deck = decks.find((d) => d.id === deckId)
  const entry = deck?.cards.find((e) => e.scryfallId === scryfallId)
  if (!deck || !entry || proxyCopies(deck, entry) === 0) return { collections, decks }
  const binder = binderWithCopy(collections, entry.name)
  if (!binder) return { collections, decks }

  const nextDecks = decks.map((d) => (d.id !== deckId ? d : {
    ...d,
    cards: d.cards.map((e) => (e.scryfallId !== scryfallId ? e : { ...e, proxyQuantity: proxyCopies(deck, entry) - 1 })),
  }))
  const nextCollections = collections.map((c) => {
    if (c.id !== binder.id) return c
    let taken = false
    const entries = c.entries.flatMap((e) => {
      if (taken || key(e.name) !== key(entry.name)) return [e]
      taken = true
      // A plain copy first; a foil only if that's all there is.
      const next = e.quantity > 0 ? { ...e, quantity: e.quantity - 1 } : { ...e, foilQuantity: e.foilQuantity - 1 }
      return next.quantity + next.foilQuantity > 0 ? [next] : []
    })
    return { ...c, entries }
  })
  return { collections: nextCollections, decks: nextDecks }
}

// One proxy swapped for a binder's real copy — the Android app's withSwapIn in data/Proxies.kt. Kept
// out of proxies.ts, which the collection code imports, so the two don't import each other.

import type { Collection, Deck } from '../types/models'
import { binderRef } from './binderRefs'
import { proxyCopies } from './proxies'
import { assignedCopies, sortingBinderIds, withCardBinders } from '../collection/binderViews'
import { leftInBinder, withRef } from '../collection/binderFlows'
import { tidyCameFrom } from '../collection/pullList'

const key = (name: string) => name.trim().toLowerCase()

/** A binder holding a spare copy of [name] — where a swapped-in card comes from. */
function binderWithCopy(collections: Collection[], name: string): Collection | undefined {
  return collections.find((c) => c.type !== 'WISHLIST' && c.entries.some((e) => key(e.name) === key(name) && e.quantity + e.foilQuantity > 0))
}

/**
 * One proxy swapped for the real card: the deck keeps the same card, one copy of it stops being a
 * proxy, and the binder copy that took its place is gone from the binder — it's in the deck now, and
 * the deck's card is sorted into that binder, so the binder still lists it (collection/binderFlows.ts),
 * with the spot it was kept in noted on the deck (Deck.cameFrom). Taken from No binder, it's in no
 * binder. Unchanged (the same objects) when there's no proxy of that card, or no copy to swap in.
 */
export function withSwapIn(collections: Collection[], decks: Deck[], deckId: string, scryfallId: string): { collections: Collection[]; decks: Deck[] } {
  const deck = decks.find((d) => d.id === deckId)
  const entry = deck?.cards.find((e) => e.scryfallId === scryfallId)
  if (!deck || !entry || proxyCopies(deck, entry) === 0) return { collections, decks }
  const binder = binderWithCopy(collections, entry.name)
  if (!binder) return { collections, decks }
  const taking = binder.entries.find((e) => key(e.name) === key(entry.name) && e.quantity + e.foilQuantity > 0)!
  // A plain copy first; a foil only if that's all there is. One with no place first, then the last place's.
  const foil = taking.quantity <= 0
  const { left, came } = leftInBinder(taking, foil ? 0 : 1, foil ? 1 : 0)

  const swapped: Deck = { ...deck, cards: deck.cards.map((e) => (e.scryfallId !== scryfallId ? e : { ...e, proxyQuantity: proxyCopies(deck, entry) - 1 })) }
  const sorted = !sortingBinderIds(collections).has(binder.id) ? swapped
    : withCardBinders(swapped, scryfallId, withRef(assignedCopies(deck, entry), binderRef(binder.id, 1, foil ? 1 : 0)))
  const next = came.length === 0 ? sorted : { ...sorted, cameFrom: tidyCameFrom([...(sorted.cameFrom ?? []), ...came]) }
  const nextDecks = decks.map((d) => (d.id !== deckId ? d : next))
  const nextCollections = collections.map((c) => (c.id !== binder.id ? c : { ...c, entries: c.entries.flatMap((e) => (e !== taking ? [e] : left ? [left] : [])) }))
  return { collections: nextCollections, decks: nextDecks }
}

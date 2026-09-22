/**
 * The Unsorted pile: cards you own that aren't in a binder or a deck yet. Like the Wishlist it's
 * always there — it used to appear only once the scanner or an import dropped something in it,
 * which left nowhere obvious to put a loose card by hand. It can be emptied but not deleted, and it
 * isn't a binder: it isn't counted as one, and sits beside the Wishlist rather than among them.
 * Mirrors the Android app's withUnsortedPile in data/CollectionModels.kt.
 */

import { UNSORTED_COLLECTION_ID, UNSORTED_COLLECTION_NAME, isUnsorted, type Collection, type CollectionEntry, type Deck, type DeckCardEntry } from '../types/models'
import { isWishlist } from './wishlist'
import { proxyCopies } from '../decks/proxies'

/**
 * Whether [collection] is one of the user's binders — not the Wishlist, and not the Unsorted pile.
 * Both of those are always there, so counting them as binders told an empty library it had two.
 */
export const isBinder = (collection: Collection): boolean => !isUnsorted(collection) && !isWishlist(collection)

/**
 * [collections] with the Unsorted pile in it. The same array when it's already there, so a caller
 * can tell nothing changed. Made with createdAt 0, like the Wishlist, so two devices that each make
 * one agree on it exactly rather than trading timestamps back and forth.
 */
export function withUnsortedPile(collections: Collection[]): Collection[] {
  if (collections.some(isUnsorted)) return collections
  const pile: Collection = { id: UNSORTED_COLLECTION_ID, name: UNSORTED_COLLECTION_NAME, entries: [], createdAt: 0, type: 'OWNED' }
  return [...collections, pile]
}

/** The same card by name: equal once case is ignored, and either face of a double-faced card counts. */
const sameCard = (a: string, b: string) => {
  const faces = (n: string) => n.toLowerCase().split(' // ')
  const fa = faces(a)
  return faces(b).some((f) => fa.includes(f))
}

/**
 * The Unsorted pile's [entries] once [count] copies of a card ([scryfallId], [name]) have gone into
 * one of the user's physical decks — the loose copies are the ones that went: that printing's first,
 * then other printings of the same card; plain before foil. Entries left with no copies go. Also how
 * many were taken: fewer than [count] when the pile didn't have that many. Mirrors the Android app's
 * takenFromUnsorted in data/UnsortedPile.kt.
 */
export function takenFromUnsorted(entries: CollectionEntry[], scryfallId: string, name: string, count: number): { entries: CollectionEntry[]; taken: number } {
  let left = count
  const order = [
    ...entries.filter((e) => e.scryfallId === scryfallId),
    ...entries.filter((e) => e.scryfallId !== scryfallId && sameCard(e.name, name)),
  ]
  const after = new Map<CollectionEntry, CollectionEntry>()
  for (const entry of order) {
    if (left <= 0) break
    const plain = Math.min(entry.quantity, left)
    left -= plain
    const foil = Math.min(entry.foilQuantity ?? 0, left)
    left -= foil
    after.set(entry, { ...entry, quantity: entry.quantity - plain, foilQuantity: (entry.foilQuantity ?? 0) - foil })
  }
  if (left === count) return { entries, taken: 0 }
  return {
    entries: entries.map((e) => after.get(e) ?? e).filter((e) => e.quantity + (e.foilQuantity ?? 0) > 0),
    taken: count - left,
  }
}

/** Whether a deck holds the user's own copies — only then does adding to it take them out of Unsorted. */
export const holdsOwnCopies = (deck: Deck) => deck.ownership === 'PHYSICAL'

/**
 * The real copies a deck holds, as Unsorted entries — where its cards go when the deck is deleted but
 * the cards kept. Only a physical deck holds the user's own copies, and not its proxies (see
 * proxyCopies); its commander is one of its cards. Mirrors the Android app's realCopiesOf.
 */
export function realCopiesOf(deck: Deck): CollectionEntry[] {
  if (!holdsOwnCopies(deck)) return []
  return deck.cards
    .map((c) => ({ scryfallId: c.scryfallId, name: c.name, imageUrl: c.imageUrl, quantity: c.quantity - proxyCopies(deck, c), foilQuantity: 0, backImageUrl: c.backImageUrl ?? null, tags: c.tags ?? [] }))
    .filter((e) => e.quantity > 0)
}

/** The Unsorted pile's [entries] with [added] put in: copies of a printing already there are added to it. */
export function intoPile(entries: CollectionEntry[], added: CollectionEntry[]): CollectionEntry[] {
  let out = entries
  for (const a of added) {
    const existing = out.find((e) => e.scryfallId === a.scryfallId)
    out = existing
      ? out.map((e) => (e === existing ? { ...e, quantity: e.quantity + a.quantity, foilQuantity: (e.foilQuantity ?? 0) + (a.foilQuantity ?? 0) } : e))
      : [...out, a]
  }
  return out
}

/**
 * How many real copies leave a deck when [entry]'s count goes down to [newQuantity] (0: taken out
 * altogether) — the ones that go back to the Unsorted pile. Only a physical deck holds the user's own
 * copies, and a proxy leaving is no card at all: copies come off the real ones first, the proxies
 * staying while the deck still holds that many. Mirrors the Android app's realCopiesLeaving.
 */
export function realCopiesLeaving(deck: Deck, entry: DeckCardEntry, newQuantity: number): number {
  if (!holdsOwnCopies(deck) || newQuantity >= entry.quantity) return 0
  const before = entry.quantity - proxyCopies(deck, entry)
  const left = Math.max(0, newQuantity)
  const after = left === 0 ? 0 : left - proxyCopies(deck, { ...entry, quantity: left })
  return Math.max(0, before - after)
}

/** [count] copies of [entry] as an Unsorted entry — a deck's card going back to the pile. */
export const pileEntryOf = (entry: DeckCardEntry, count: number): CollectionEntry =>
  ({ scryfallId: entry.scryfallId, name: entry.name, imageUrl: entry.imageUrl, quantity: count, foilQuantity: 0, backImageUrl: entry.backImageUrl ?? null, tags: entry.tags ?? [] })

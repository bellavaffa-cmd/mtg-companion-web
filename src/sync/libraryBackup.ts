// "Use my account only" on first sign-in sets this browser's own library aside rather than deleting
// it outright: Account & sync can bring it back later, added to whatever the library holds then.

import type { Collection, Deck } from '../types/models'
import { UNSORTED_COLLECTION_ID } from '../types/models'
import { intoPile, withUnsortedPile } from '../collection/unsorted'
import { isWishlist, WISHLIST_ID } from '../collection/wishlist'
import type { Library } from './cloudSync'
import { isSample } from '../onboarding/onboarding'
import { withBinderIds } from '../decks/binderRefs'

/** The Wishlist or the Unsorted pile with nothing in it: always there, so not something the user made. */
export const isEmptyStandingCollection = (c: Collection): boolean =>
  (c.id === WISHLIST_ID || c.id === UNSORTED_COLLECTION_ID) && c.entries.length === 0

/**
 * How many decks and binders [lib] holds that the user made or filled — what a prompt counts. Samples
 * from the welcome flow aren't the user's, and never go to the account, so they don't count.
 */
export function libraryCounts(lib: { decks: Deck[]; collections: Collection[] }): { decks: number; collections: number } {
  return {
    decks: lib.decks.filter((d) => !isSample(d)).length,
    collections: lib.collections.filter((c) => !isEmptyStandingCollection(c) && !isSample(c)).length,
  }
}

/**
 * [current] with the decks and binders of [backup] added as new ones (fresh ids from [newId]), so
 * nothing already in the library is overwritten. The Wishlist and the Unsorted pile are one of each
 * per library, so the backup's cards go into those instead: the pile's copies are added to the pile,
 * and wishlist cards the Wishlist doesn't have yet are added (cards it only held because a deck was
 * considering them come back by themselves with that deck).
 */
export function withBackupAdded(current: Library, backup: Library, newId: () => string): Library {
  // Binders come back with new ids, so the deck cards that say which binder their copies are in
  // (decks/binderRefs.ts) are pointed at the new ones.
  const deckIds = backup.decks.map(() => newId())
  const binderIds = new Map<string, string>()
  for (const c of backup.collections) if (c.id !== UNSORTED_COLLECTION_ID && !isWishlist(c)) binderIds.set(c.id, newId())
  const decks = [...current.decks, ...backup.decks.map((d, i) => ({ ...withBinderIds(d, binderIds), id: deckIds[i] }))]
  let collections = current.collections
  for (const c of backup.collections) {
    if (c.id === UNSORTED_COLLECTION_ID) {
      if (c.entries.length === 0) continue
      collections = withUnsortedPile(collections).map((p) => (p.id === UNSORTED_COLLECTION_ID ? { ...p, entries: intoPile(p.entries, c.entries) } : p))
    } else if (isWishlist(c)) {
      const added = c.entries.filter((e) => !e.auto)
      if (added.length === 0) continue
      const wishlist = collections.find(isWishlist)
      collections = wishlist
        ? collections.map((w) => (w === wishlist ? { ...w, entries: [...w.entries, ...added.filter((e) => !w.entries.some((x) => x.scryfallId === e.scryfallId))] } : w))
        : [...collections, { ...c, entries: added }]
    } else {
      collections = [...collections, { ...c, id: binderIds.get(c.id)! }]
    }
  }
  return { ...current, decks, collections }
}

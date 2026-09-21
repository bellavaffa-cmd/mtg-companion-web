/**
 * The Unsorted pile: cards you own that aren't in a binder or a deck yet. Like the Wishlist it's
 * always there — it used to appear only once the scanner or an import dropped something in it,
 * which left nowhere obvious to put a loose card by hand. It can be emptied but not deleted, and it
 * isn't a binder: it isn't counted as one, and sits beside the Wishlist rather than among them.
 * Mirrors the Android app's withUnsortedPile in data/CollectionModels.kt.
 */

import { UNSORTED_COLLECTION_ID, UNSORTED_COLLECTION_NAME, isUnsorted, type Collection } from '../types/models'
import { isWishlist } from './wishlist'

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

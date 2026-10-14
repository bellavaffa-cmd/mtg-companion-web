// The core of binders as views (binderViews.ts): which collections deck copies can be sorted into,
// and which binders a deck card's copies are in. Kept apart, light on imports, so the copy flows
// (binderFlows.ts, pullList.ts) can use it without importing the rest of the collection code.

import { UNSORTED_COLLECTION_ID, type Collection, type Deck, type DeckCardEntry } from '../types/models'
import { binderRef, foilsOf, type BinderRef } from '../decks/binderRefs'
import { ownedCopies } from './ownedCopies'
import { isWishlist } from './wishlist'

/** Whether [c] is a binder deck copies can be sorted into: one of the user's own, not the pile, not a wishlist. */
export const sortsInto = (c: Collection): boolean => c.type !== 'WISHLIST' && c.id !== UNSORTED_COLLECTION_ID && !isWishlist(c)

/**
 * Which binders [entry]'s copies in [deck] are in, as far as it has real owned copies: the refs in
 * order, each cut down to the copies left, the same binder twice made one, none for a deck that
 * doesn't count as owned or a card with only proxies.
 */
export function assignedCopies(deck: Deck, entry: DeckCardEntry): BinderRef[] {
  let left = ownedCopies(deck, entry)
  const refs = entry.binders
  if (left <= 0 || !refs || refs.length === 0) return []
  const out: BinderRef[] = []
  for (const ref of refs) {
    if (left <= 0) break
    const take = Math.min(Math.max(0, ref.qty), left)
    if (take <= 0) continue
    left -= take
    // A ref cut down keeps its foils: the plain copies are the ones that leave first (binderFlows.ts).
    const foil = Math.min(foilsOf(ref), take)
    const at = out.findIndex((r) => r.id === ref.id)
    if (at >= 0) out[at] = binderRef(ref.id, out[at].qty + take, foilsOf(out[at]) + foil)
    else out.push(binderRef(ref.id, take, foil))
  }
  return out
}

/** The binders deck copies can be sorted into, by id. */
export const sortingBinderIds = (collections: Collection[]): Set<string> => new Set(collections.filter(sortsInto).map((c) => c.id))

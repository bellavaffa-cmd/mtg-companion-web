// Settings › Data and speed › Danger zone › Reset collection: what each choice removes, how that's
// said, and the library after it. The Android app's ResetCollection.kt, rule for rule and word for word.
//
//  - Cards only: every binder and the Unsorted pile emptied (their cards' places, prices to watch and
//    copies to sell go with the cards). Binders, storage places, the Wishlist, decks, sealed product,
//    graded cards, gear and loans stay.
//  - Collection: every card, every binder but the Unsorted pile and the Wishlist (which stay, empty),
//    the storage places, sealed product, graded cards, gear and loans. Decks stay, and so does card
//    price history — it's market data, not the collection.
//  - Everything: the collection and every deck, with the decks' history and games logged. Settings,
//    friends and the account stay.
//
// Binders and decks that go are noted as deleted (cloudSync.noteDeleted), the same as deleting one by
// hand, so the sync pushes their deletion rather than reading an emptied library as one that went
// missing. Emptied ones are pushed empty: the merge (mergeItems.ts) keeps a card removed on one side
// removed, so other devices' copies of them don't bring the cards back.

import type { Collection, Deck } from '../types/models'
import { UNSORTED_COLLECTION_ID } from '../types/models'
import { WISHLIST_ID } from '../collection/wishlist'
import { isSample } from '../onboarding/onboarding'
import { noteDeleted, type Library } from '../sync/cloudSync'

export type ResetScope = 'cards' | 'collection' | 'everything'

export const RESET_SCOPES: { id: ResetScope; title: string; detail: string }[] = [
  {
    id: 'cards',
    title: 'Cards only',
    detail: 'Empties every binder and the Unsorted pile. Your binders, storage places, Wishlist, decks, sealed product, graded cards, gear and loans stay.',
  },
  {
    id: 'collection',
    title: 'Collection',
    detail: 'Every card and binder, storage places, sealed product, graded cards, gear, loans, and your copies’ photos and history. The Unsorted pile and Wishlist stay, empty. Decks and card prices stay.',
  },
  {
    id: 'everything',
    title: 'Everything',
    detail: 'The whole collection and every deck, with their history and games logged. Settings, friends and your account stay.',
  },
]

/** The word to type before Reset can be pressed. */
export const RESET_WORD = 'RESET'

/** Whether [typed] is the word, in any case, spaces around it aside. */
export const resetConfirmed = (typed: string): boolean => typed.trim().toUpperCase() === RESET_WORD

/** How long Undo is offered, and the deletions held back from the sync meanwhile. */
export const RESET_UNDO_MS = 10_000

/** When the choice would remove nothing (Reset stays off). */
export const RESET_NOTHING = 'Nothing to remove'

/** The message shown with Undo. */
export const RESET_DONE = 'Collection reset'

/** Under the Reset button when signed in. */
export const RESET_SYNC_NOTE = 'Signed in, the reset reaches your other devices once Undo has gone. Offline, it goes when you’re back online.'

const isWishlistType = (c: Collection) => c.type === 'WISHLIST'
/** The two that are always there: emptied, never removed. */
const isStanding = (c: Collection) => c.id === UNSORTED_COLLECTION_ID || c.id === WISHLIST_ID

export interface ResetCounts {
  copies: number
  binders: number
  wishlistCards: number
  places: number
  sealed: number
  graded: number
  gear: number
  loans: number
  decks: number
}

/** What [scope] would remove from the library. */
export function resetCounts(lib: { decks: Deck[]; collections: Collection[] }, scope: ResetScope): ResetCounts {
  const owned = lib.collections.filter((c) => !isWishlistType(c))
  const copies = owned.reduce((n, c) => n + c.entries.reduce((m, e) => m + e.quantity + e.foilQuantity, 0), 0)
  const whole = scope !== 'cards'
  const pile = lib.collections.find((c) => c.id === UNSORTED_COLLECTION_ID)
  return {
    copies,
    binders: whole
      ? lib.collections.filter((c) => !isStanding(c)).length
      : owned.filter((c) => c.id !== UNSORTED_COLLECTION_ID && c.entries.length > 0).length,
    wishlistCards: whole ? lib.collections.filter(isWishlistType).reduce((n, c) => n + c.entries.length, 0) : 0,
    places: whole ? pile?.storagePlaces?.length ?? 0 : 0,
    sealed: whole ? pile?.sealed?.length ?? 0 : 0,
    graded: whole ? pile?.graded?.length ?? 0 : 0,
    gear: whole ? pile?.gear?.length ?? 0 : 0,
    loans: whole ? pile?.loans?.length ?? 0 : 0,
    decks: scope === 'everything' ? lib.decks.length : 0,
  }
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** "1,402 copies in 8 binders · 23 places · 3 decks" — what will go, or that there's nothing to. */
export function resetCountsText(c: ResetCounts): string {
  const cards = c.copies > 0 && c.binders > 0 ? `${count(c.copies, 'copy', 'copies')} in ${count(c.binders, 'binder', 'binders')}`
    : c.copies > 0 ? count(c.copies, 'copy', 'copies')
    : c.binders > 0 ? count(c.binders, 'binder', 'binders')
    : ''
  const parts = [
    cards,
    c.wishlistCards > 0 ? count(c.wishlistCards, 'wishlist card', 'wishlist cards') : '',
    c.places > 0 ? count(c.places, 'place', 'places') : '',
    c.sealed > 0 ? `${c.sealed.toLocaleString('en-GB')} sealed` : '',
    c.graded > 0 ? `${c.graded.toLocaleString('en-GB')} graded` : '',
    c.gear > 0 ? count(c.gear, 'piece of gear', 'pieces of gear') : '',
    c.loans > 0 ? count(c.loans, 'loan', 'loans') : '',
    c.decks > 0 ? count(c.decks, 'deck', 'decks') : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : RESET_NOTHING
}

/** An emptied Unsorted pile: its cards gone, and with [whole] what rides on it too — as [], never left out (see Collection.loans). */
function emptiedPile(c: Collection, whole: boolean): Collection {
  if (!whole) return { ...c, entries: [] }
  return {
    ...c,
    entries: [],
    ...(c.storagePlaces !== undefined ? { storagePlaces: [] } : {}),
    ...(c.loans !== undefined ? { loans: [] } : {}),
    ...(c.sealed !== undefined ? { sealed: [] } : {}),
    ...(c.graded !== undefined ? { graded: [] } : {}),
    ...(c.gear !== undefined ? { gear: [] } : {}),
  }
}

/**
 * [lib] after a reset of [scope] at [now]: the binders and decks that go noted as deleted (samples
 * aside: they never reach the account), the rest emptied as the scope says.
 */
export function resetLibrary(lib: Library, scope: ResetScope, now = Date.now()): Library {
  const whole = scope !== 'cards'
  const collections = lib.collections.flatMap((c): Collection[] => {
    if (c.id === UNSORTED_COLLECTION_ID) return [emptiedPile(c, whole)]
    if (c.id === WISHLIST_ID) return [whole ? { ...c, entries: [] } : c]
    if (whole) return []
    return isWishlistType(c) || c.entries.length === 0 ? [c] : [{ ...c, entries: [] }]
  })
  const decks = scope === 'everything' ? [] : lib.decks
  const gone = [
    ...(whole ? lib.collections.filter((c) => !isStanding(c) && !isSample(c)).map((c) => `collection:${c.id}`) : []),
    ...(scope === 'everything' ? lib.decks.filter((d) => !isSample(d)).map((d) => `deck:${d.id}`) : []),
  ]
  return noteDeleted({ ...lib, decks, collections }, gone, now)
}

/**
 * A reset waiting out its Undo: the library from before it, and until when. Undo and the commit each
 * happen at most once, and never both.
 */
export class PendingReset {
  private settled = false
  readonly scope: ResetScope
  readonly previous: Library
  readonly until: number
  constructor(scope: ResetScope, previous: Library, until: number) {
    this.scope = scope
    this.previous = previous
    this.until = until
  }

  /** The library to put back, or null when the reset has already been committed or undone. */
  undo(): Library | null {
    if (this.settled) return null
    this.settled = true
    return this.previous
  }

  /** True the one time the reset is committed: the sync may send it now. False when undone or done. */
  commit(): boolean {
    if (this.settled) return false
    this.settled = true
    return true
  }

  get open(): boolean { return !this.settled }
}

// The Wishlist: one built-in binder of cards the user wants, the same id on every device (so two
// devices' Wishlists merge into one when they sync). It can't be deleted, and — like any wishlist —
// its cards count toward nothing the user owns. It holds what the user adds, and by itself the
// cards their decks are considering that they don't own. Older wishlist binders fold into it.
// Mirrors the Android app's data/Wishlist.kt.

import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../types/models'

export const WISHLIST_ID = 'wishlist'
export const WISHLIST_NAME = 'Wishlist'

export const isWishlist = (c: Collection): boolean => c.id === WISHLIST_ID

const key = (name: string) => name.trim().toLowerCase()

/** Whether [c] is the Wishlist with nothing in it — not something the user made. */
export const isEmptyWishlist = (c: Collection): boolean => isWishlist(c) && c.entries.length === 0

/**
 * [collections] with the Wishlist as it should be:
 *  - there, whatever else;
 *  - holding the cards of any other wishlist binder, which then go (their copies added together,
 *    a price alert kept);
 *  - with each card a deck in [decks] is considering and the user owns in no binder, added by
 *    itself (`auto`) — and taken off again once it's owned or no longer considered. A card the user
 *    added themselves is never taken off.
 * The same array when nothing needs to change.
 */
export function withWishlist(collections: Collection[], decks: Deck[]): Collection[] {
  const others = collections.filter((c) => c.type === 'WISHLIST' && !isWishlist(c))
  const existing = collections.find(isWishlist)
  let entries: CollectionEntry[] = existing?.entries ?? []
  for (const entry of others.flatMap((c) => c.entries)) {
    const i = entries.findIndex((e) => e.scryfallId === entry.scryfallId)
    if (i < 0) {
      entries = [...entries, { ...entry, auto: false }]
    } else {
      const had = entries[i]
      entries = entries.map((e, j) => j !== i ? e : {
        ...had,
        quantity: had.quantity + entry.quantity,
        foilQuantity: had.foilQuantity + entry.foilQuantity,
        priceAlert: had.priceAlert ?? entry.priceAlert ?? null,
        auto: false,
      })
    }
  }

  // Owned: in any binder that isn't a wishlist (the Unsorted pile too).
  const owned = new Set(
    collections.filter((c) => c.type !== 'WISHLIST')
      .flatMap((c) => c.entries).filter((e) => e.quantity + e.foilQuantity > 0).map((e) => key(e.name)),
  )
  const wanted = new Map<string, DeckCardEntry>()
  for (const deck of decks) {
    for (const card of deck.considering ?? []) {
      const k = key(card.name)
      if (!owned.has(k) && !wanted.has(k)) wanted.set(k, card)
    }
  }

  const kept = entries.filter((e) => !e.auto || wanted.has(key(e.name)))
  const have = new Set(kept.map((e) => key(e.name)))
  const added: CollectionEntry[] = [...wanted].filter(([k]) => !have.has(k)).map(([, card]) => ({
    scryfallId: card.scryfallId, name: card.name, imageUrl: card.imageUrl, quantity: 1, foilQuantity: 0,
    backImageUrl: card.backImageUrl ?? null, tags: card.tags, auto: true,
  }))
  const changedEntries = others.length > 0 || kept.length !== entries.length || added.length > 0

  if (existing && !changedEntries && existing.name === WISHLIST_NAME && existing.type === 'WISHLIST') return collections
  const wishlist: Collection = {
    ...(existing ?? { id: WISHLIST_ID, createdAt: 0 }),
    name: WISHLIST_NAME,
    type: 'WISHLIST',
    entries: changedEntries ? [...kept, ...added] : entries,
  } as Collection
  return [...collections.filter((c) => c.type !== 'WISHLIST' && !isWishlist(c)), wishlist]
}

/** The names of [decks] considering [cardName] — for "Considering in …" on a card added from them. */
export function decksConsidering(decks: Deck[], cardName: string): string[] {
  return decks.filter((d) => (d.considering ?? []).some((c) => key(c.name) === key(cardName))).map((d) => d.name)
}

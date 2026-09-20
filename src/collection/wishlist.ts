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

  // Taken off by hand ("not interested"), and still considered — a card nobody considers any more
  // is forgotten, so putting it back in a deck's Considering list offers it again.
  const notWanted = existing?.notWanted ?? []
  const notWantedKeys = new Set(notWanted.map(key))

  // Owned: in any binder that isn't a wishlist (the Unsorted pile too).
  const owned = new Set(
    collections.filter((c) => c.type !== 'WISHLIST')
      .flatMap((c) => c.entries).filter((e) => e.quantity + e.foilQuantity > 0).map((e) => key(e.name)),
  )
  const considered = new Set<string>()
  const wanted = new Map<string, DeckCardEntry>()
  // A card the user put on the list themselves is wanted, whatever they said before.
  const byHand = new Set(entries.filter((e) => !e.auto).map((e) => key(e.name)))
  for (const deck of decks) {
    for (const card of deck.considering ?? []) {
      const k = key(card.name)
      considered.add(k)
      if (!owned.has(k) && !wanted.has(k) && !(notWantedKeys.has(k) && !byHand.has(k))) wanted.set(k, card)
    }
  }
  const stillNotWanted = notWanted.filter((n) => considered.has(key(n)) && !byHand.has(key(n)))

  const kept = entries.filter((e) => !e.auto || wanted.has(key(e.name)))
  const have = new Set(kept.map((e) => key(e.name)))
  const added: CollectionEntry[] = [...wanted].filter(([k]) => !have.has(k)).map(([, card]) => ({
    scryfallId: card.scryfallId, name: card.name, imageUrl: card.imageUrl, quantity: 1, foilQuantity: 0,
    backImageUrl: card.backImageUrl ?? null, tags: card.tags, auto: true,
  }))
  const changedEntries = others.length > 0 || kept.length !== entries.length || added.length > 0
  const sameNotWanted = JSON.stringify(existing?.notWanted ?? []) === JSON.stringify(stillNotWanted)

  if (existing && !changedEntries && sameNotWanted && existing.name === WISHLIST_NAME && existing.type === 'WISHLIST') return collections
  const wishlist: Collection = {
    ...(existing ?? { id: WISHLIST_ID, createdAt: 0 }),
    name: WISHLIST_NAME,
    type: 'WISHLIST',
    notWanted: stillNotWanted,
    entries: changedEntries ? [...kept, ...added] : entries,
  } as Collection
  return [...collections.filter((c) => c.type !== 'WISHLIST' && !isWishlist(c)), wishlist]
}

/** A card to put on the Wishlist, and how many copies are wanted. */
export interface WantedCard {
  scryfallId: string
  name: string
  imageUrl: string | null
  backImageUrl?: string | null
  tags?: string[]
  /** Copies wanted — a deck's missing cards ask for as many as the deck plays. */
  quantity: number
}

/**
 * [collections] with [cards] on the Wishlist, making it if it isn't there. A card already on the
 * list keeps the larger count rather than doubling, and asking for a card by hand undoes an earlier
 * "not interested".
 */
export function withWantedCards(collections: Collection[], cards: WantedCard[]): Collection[] {
  if (cards.length === 0) return collections
  const existing = collections.find(isWishlist)
  let entries: CollectionEntry[] = existing?.entries ?? []
  for (const card of cards) {
    const at = entries.findIndex((e) => key(e.name) === key(card.name))
    const want = Math.max(1, card.quantity)
    entries = at < 0
      ? [...entries, {
          scryfallId: card.scryfallId, name: card.name, imageUrl: card.imageUrl, quantity: want, foilQuantity: 0,
          backImageUrl: card.backImageUrl ?? null, tags: card.tags, auto: false,
        }]
      : entries.map((e, i) => (i === at ? { ...e, quantity: Math.max(e.quantity, want), auto: false } : e))
  }
  const asked = new Set(cards.map((c) => key(c.name)))
  const wishlist: Collection = {
    ...(existing ?? { id: WISHLIST_ID, createdAt: 0 }),
    name: WISHLIST_NAME,
    type: 'WISHLIST',
    notWanted: (existing?.notWanted ?? []).filter((n) => !asked.has(key(n))),
    entries,
  } as Collection
  return existing ? collections.map((c) => (isWishlist(c) ? wishlist : c)) : [...collections, wishlist]
}

/**
 * [collections] with [cardName] off the Wishlist and left off while decks still consider it — what
 * taking off a card the Wishlist added by itself means. Adding it back by hand undoes this.
 */
export function withoutWishlistCard(collections: Collection[], cardName: string): Collection[] {
  return collections.map((c) => (!isWishlist(c) ? c : {
    ...c,
    entries: c.entries.filter((e) => key(e.name) !== key(cardName)),
    notWanted: [...(c.notWanted ?? []), cardName.trim()].filter((n, i, all) => all.findIndex((o) => key(o) === key(n)) === i),
  }))
}

/**
 * [collections] with [cardName] wanted again — undoing "not interested". The card comes back by
 * itself while a deck considers it.
 */
export function withWishlistCardWantedAgain(collections: Collection[], cardName: string): Collection[] {
  return collections.map((c) => (!isWishlist(c) ? c : { ...c, notWanted: (c.notWanted ?? []).filter((n) => key(n) !== key(cardName)) }))
}

/** The names of [decks] considering [cardName] — for "Considering in …" on a card added from them. */
export function decksConsidering(decks: Deck[], cardName: string): string[] {
  return decks.filter((d) => (d.considering ?? []).some((c) => key(c.name) === key(cardName))).map((d) => d.name)
}

// What an accepted trade does to one side's binders: the cards they hand over come out of the
// binders they were in, and the cards they get go into the binder they choose. Each side applies
// only their own half, on their own device — nobody's app ever writes into someone else's library.

import type { Collection, CollectionEntry } from '../types/models'
import type { SharedCardHit, Trade, TradeCard } from './api'

export interface CollectionChange {
  collectionId: string
  card: Pick<TradeCard, 'scryfallId' | 'name' | 'imageUrl'>
  /** Change in regular copies (negative: taken out). */
  quantity: number
  /** Change in foil copies. */
  foilQuantity: number
}

/** The caller's side of [trade]: what they give and what they get. */
export function tradeSides(trade: Trade, me: string): { give: TradeCard[]; get: TradeCard[]; other: string } {
  return trade.from_user === me
    ? { give: trade.give, get: trade.want, other: trade.to_user }
    : { give: trade.want, get: trade.give, other: trade.from_user }
}

/** Whether the caller still has to update their binders for [trade]. */
export function awaitingMyUpdate(trade: Trade, me: string): boolean {
  return trade.status === 'accepted' && (trade.from_user === me ? !trade.from_applied : !trade.to_applied)
}

/**
 * The binder changes for the caller's side of an accepted [trade]: each card given comes out of the
 * binder it was offered from (or [fallbackFrom], for a card that didn't say), and each card received
 * goes into [receiveInto].
 */
export function tradeChanges(trade: Trade, me: string, receiveInto: string, fallbackFrom: string | null): CollectionChange[] {
  const { give, get } = tradeSides(trade, me)
  const out: CollectionChange[] = []
  for (const c of give) {
    const from = c.collectionId ?? fallbackFrom
    if (!from) continue
    out.push({ collectionId: from, card: c, quantity: c.foil ? 0 : -c.quantity, foilQuantity: c.foil ? -c.quantity : 0 })
  }
  for (const c of get) {
    out.push({ collectionId: receiveInto, card: c, quantity: c.foil ? 0 : c.quantity, foilQuantity: c.foil ? c.quantity : 0 })
  }
  return out
}

/**
 * Applies [changes] to [collections]. Copies taken out never go below zero, and a card with no copies
 * left leaves the binder. Answers the new binders and the cards that couldn't be taken out in full
 * (no longer in that binder, or fewer copies than the trade says).
 */
export function applyCollectionChanges(collections: Collection[], changes: CollectionChange[]): { collections: Collection[]; short: CollectionChange[] } {
  const short: CollectionChange[] = []
  const next = collections.map((collection) => {
    const mine = changes.filter((ch) => ch.collectionId === collection.id)
    if (mine.length === 0) return collection
    let entries = [...collection.entries]
    for (const ch of mine) {
      const i = entries.findIndex((e) => e.scryfallId === ch.card.scryfallId)
      const existing = i >= 0 ? entries[i] : null
      const quantity = (existing?.quantity ?? 0) + ch.quantity
      const foilQuantity = (existing?.foilQuantity ?? 0) + ch.foilQuantity
      if (quantity < 0 || foilQuantity < 0) short.push(ch)
      const q = Math.max(0, quantity)
      const f = Math.max(0, foilQuantity)
      if (existing) {
        entries = q === 0 && f === 0 ? entries.filter((_, j) => j !== i) : entries.map((e, j) => (j === i ? { ...e, quantity: q, foilQuantity: f } : e))
      } else if (q > 0 || f > 0) {
        entries.push({ scryfallId: ch.card.scryfallId, name: ch.card.name, imageUrl: ch.card.imageUrl ?? null, quantity: q, foilQuantity: f })
      }
    }
    return { ...collection, entries }
  })
  for (const ch of changes) {
    if (!collections.some((c) => c.id === ch.collectionId) && (ch.quantity < 0 || ch.foilQuantity < 0)) short.push(ch)
  }
  return { collections: next, short }
}

/** How many cards a list holds, counting copies. */
export const cardTotal = (cards: TradeCard[]) => cards.reduce((n, c) => n + c.quantity, 0)

/** A card of the user's that's on one of a friend's shared wishlists. [card]: one copy, ready to offer. */
export interface WantedCard {
  name: string
  imageUrl: string | null
  copies: number
  wishlist: string
  card: TradeCard
}

/**
 * The user's cards (in their own binders, not wishlists) that are on a friend's wishlists among
 * [theirs] — one line each, offered from the binder with the most regular copies (or foil, if
 * that's all there is). The Android app's cardsTheyWant is the same.
 */
export function cardsTheyWant(mine: Collection[], theirs: Collection[]): WantedCard[] {
  const wants = new Map<string, string>() // card name -> the wishlist it's on
  for (const c of theirs) {
    if (c.type !== 'WISHLIST') continue
    for (const e of c.entries ?? []) {
      const key = e.name.trim().toLowerCase()
      if (!wants.has(key)) wants.set(key, c.name)
    }
  }
  if (wants.size === 0) return []
  const held = new Map<string, { collectionId: string; entry: CollectionEntry }[]>()
  for (const c of mine) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      const key = e.name.trim().toLowerCase()
      if (wants.has(key) && e.quantity + e.foilQuantity > 0) held.set(key, [...(held.get(key) ?? []), { collectionId: c.id, entry: e }])
    }
  }
  return [...held.entries()].map(([key, copies]) => {
    const best = copies.reduce((a, b) => (b.entry.quantity > a.entry.quantity || (b.entry.quantity === a.entry.quantity && b.entry.foilQuantity > a.entry.foilQuantity) ? b : a))
    const e = best.entry
    return {
      name: e.name,
      imageUrl: e.imageUrl,
      copies: copies.reduce((n, c) => n + c.entry.quantity + c.entry.foilQuantity, 0),
      wishlist: wants.get(key)!,
      card: { scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, foil: e.quantity <= 0, quantity: 1, collectionId: best.collectionId },
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** A friend's cards on the user's wishlists (from wishlistMatches) as trade lines: one copy of each card. */
export function hitsAsTrade(hits: SharedCardHit[]): TradeCard[] {
  const seen = new Set<string>()
  const out: TradeCard[] = []
  for (const h of hits) {
    const key = h.name.trim().toLowerCase()
    if (h.quantity + h.foil_quantity <= 0 || seen.has(key)) continue
    seen.add(key)
    out.push({ scryfallId: h.scryfall_id, name: h.name, imageUrl: h.image_url, foil: h.quantity <= 0, quantity: 1, collectionId: h.item_id })
  }
  return out
}

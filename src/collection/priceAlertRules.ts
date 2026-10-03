// When a price alert goes off. Two kinds, one per binder kind:
//  - a wishlist card's priceAlert: tell me when it's at or BELOW this (to buy it);
//  - an owned card's priceAlertAbove: tell me when it rises to or ABOVE this (to sell or trade it).
// Both are US dollars. A wishlist alert is checked against the non-foil price; a rise alert against
// the non-foil price too, unless every copy in the entry is foil, when it's the foil price. Kept
// apart from priceAlerts.ts (the check and the notification) so it can be tested on its own.
// Mirrors the Android app's data/PriceAlertRules.kt.

import type { Collection, CollectionEntry } from '../types/models'

export type AlertDirection = 'BELOW' | 'ABOVE'

/** One card watched for a price, in the binder [collectionId]. */
export interface AlertWatch { collectionId: string; entry: CollectionEntry; direction: AlertDirection; target: number }

/** Where the check remembers what it last told about this watch. */
export const memoryKey = (w: AlertWatch) => (w.direction === 'ABOVE' ? `above:${w.entry.scryfallId}` : w.entry.scryfallId)

/** Every alert set: wishlist cards' "at or below" and owned binder cards' "at or above". */
export function alertWatches(collections: Collection[]): AlertWatch[] {
  return collections.flatMap((c) => c.entries.flatMap((entry): AlertWatch[] => {
    if (c.type === 'WISHLIST') return (entry.priceAlert ?? 0) > 0 ? [{ collectionId: c.id, entry, direction: 'BELOW', target: entry.priceAlert! }] : []
    return (entry.priceAlertAbove ?? 0) > 0 ? [{ collectionId: c.id, entry, direction: 'ABOVE', target: entry.priceAlertAbove! }] : []
  }))
}

/** The price a watch is checked against, from the card's non-foil and foil prices (US dollars). */
export function alertPrice(w: AlertWatch, usd: number | null, usdFoil: number | null): number | null {
  if (w.direction === 'ABOVE' && w.entry.quantity <= 0 && w.entry.foilQuantity > 0) return usdFoil ?? usd
  return usd
}

/** Whether [price] has crossed the watch's line. */
export const crossed = (w: AlertWatch, price: number) => (w.direction === 'BELOW' ? price <= w.target : price >= w.target)

/**
 * What the check does with one watch: forget (not crossed, so crossing again tells again), stay
 * quiet (already told at this price or a less striking one), or tell (and remember [price]).
 */
export type AlertStep = { kind: 'forget' } | { kind: 'quiet' } | { kind: 'tell'; price: number }

/**
 * The step for a watch now at [price], having last told about it at [told] (null: not told since it
 * last crossed). A card is told about again only when it moves further past the line — cheaper for a
 * wishlist card, dearer for an owned one — or after going back and crossing again.
 */
export function alertStep(w: AlertWatch, price: number, told: number | null): AlertStep {
  if (!crossed(w, price)) return { kind: 'forget' }
  if (told == null) return { kind: 'tell', price }
  if (w.direction === 'BELOW' && price < told - 0.001) return { kind: 'tell', price }
  if (w.direction === 'ABOVE' && price > told + 0.001) return { kind: 'tell', price }
  return { kind: 'quiet' }
}

/** A watch that has crossed its line, at [price] — for the notification and Home's list. */
export interface AlertHit { watch: AlertWatch; price: number }

/** The watches that are past their line now, by [prices] (scryfallId → non-foil, foil US dollars). */
export function alertHits(watches: AlertWatch[], prices: Map<string, [number | null, number | null]>): AlertHit[] {
  return watches.flatMap((w) => {
    const p = prices.get(w.entry.scryfallId)
    if (!p) return []
    const price = alertPrice(w, p[0], p[1])
    return price != null && crossed(w, price) ? [{ watch: w, price }] : []
  })
}

/** Home's list order: drops (wishlist) first, then rises — as the phone sorts them. */
export const byDirection = (hits: AlertHit[]) => [...hits].sort((a, b) => (a.watch.direction === b.watch.direction ? 0 : a.watch.direction === 'BELOW' ? -1 : 1))

/**
 * The notification for [hits] (told about for the first time, or further past the line), in the
 * phone's words. [money] formats a US dollar price in the chosen currency.
 */
export function alertNotification(hits: AlertHit[], money: (usd: number) => string): { title: string; body: string } | null {
  if (hits.length === 0) return null
  const first = hits[0]
  const rises = hits.every((h) => h.watch.direction === 'ABOVE')
  const drops = hits.every((h) => h.watch.direction === 'BELOW')
  const name = first.watch.entry.name
  const body = hits.length === 1
    ? first.watch.direction === 'ABOVE'
      ? `${name} is ${money(first.price)} — over your ${money(first.watch.entry.priceAlertAbove ?? 0)} alert`
      : `${name} is ${money(first.price)} — under your ${money(first.watch.entry.priceAlert ?? 0)} alert`
    : (drops ? `${hits.length} wishlist cards are under your alert prices: `
      : rises ? `${hits.length} of your cards are over your alert prices: `
      : `${hits.length} cards passed your alert prices: `) + hits.map((h) => `${h.watch.entry.name} ${money(h.price)}`).join(', ')
  const title = hits.length === 1 && first.watch.direction === 'ABOVE' ? `Price rise: ${name}`
    : hits.length === 1 ? `Price drop: ${name}`
    : drops ? 'Price drops on your wishlist'
    : rises ? 'Price rises on your cards'
    : 'Price alerts'
  return { title, body }
}

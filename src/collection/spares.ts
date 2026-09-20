/**
 * Spares: cards sitting in your binders that none of your decks play. They're the obvious things to
 * trade away or sell — a deck's own copies live in the deck, so a binder copy is only spoken for if
 * a deck is short of it or thinking about it.
 * Mirrors the Android app's data/Spares.kt.
 */

import type { Collection, CollectionEntry, Deck } from '../types/models'

const key = (name: string) => name.trim().toLowerCase()

/** Every card name your decks play, are short of, or are considering — the ones to hold on to. */
export function namesDecksUse(decks: Deck[]): Set<string> {
  const used = new Set<string>()
  for (const deck of decks) {
    for (const entry of [deck.commander, deck.partnerCommander, ...deck.cards, ...(deck.considering ?? [])]) {
      if (entry) used.add(key(entry.name))
    }
  }
  return used
}

/** A card you could let go of: where it sits, and how many you have. */
export interface Spare {
  /** The first printing found, for the picture and for trading. */
  entry: CollectionEntry
  /** Binders holding it, in the order they were looked at. */
  binders: string[]
  copies: number
  foils: number
}

/**
 * The cards in your binders that no deck of yours uses, most copies first. Wishlists are cards you
 * want, so they're left out, and [minCopies] can ask for only the ones you hold several of.
 */
export function spares(collections: Collection[], decks: Deck[], minCopies = 1): Spare[] {
  const used = namesDecksUse(decks)
  const byName = new Map<string, Spare>()
  for (const collection of collections) {
    if (collection.type === 'WISHLIST') continue
    for (const entry of collection.entries) {
      const copies = entry.quantity + entry.foilQuantity
      if (copies <= 0 || used.has(key(entry.name))) continue
      const had = byName.get(key(entry.name))
      if (had) {
        had.copies += copies
        had.foils += entry.foilQuantity
        if (!had.binders.includes(collection.name)) had.binders.push(collection.name)
      } else {
        byName.set(key(entry.name), { entry, binders: [collection.name], copies, foils: entry.foilQuantity })
      }
    }
  }
  return [...byName.values()]
    .filter((s) => s.copies >= minCopies)
    .sort((a, b) => b.copies - a.copies || a.entry.name.localeCompare(b.entry.name))
}

/** What the spares are worth, for sorting the most valuable to the top. */
export function spareValue(spare: Spare, prices: Map<string, number>): number {
  return (prices.get(spare.entry.scryfallId) ?? 0) * spare.copies
}

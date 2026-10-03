// The All cards filter: Search's type, text, colour and rarity filters, over the cards you own.
// Mirrors the Android app's CollectionFilter (ui/collection/CollectionFilter.kt) — same fields,
// same matching rules, same wording.

import { displayOracleText, type ScryfallCard } from '../types/scryfall'

export type FilterColor = 'W' | 'U' | 'B' | 'R' | 'G'

/** What the filter needs to know about a card, taken from its Scryfall data. */
export interface CardFacts {
  /** Colour identity as WUBRG letters; empty for a colourless card. */
  colors: Set<string>
  typeLine: string
  rarity: string
  /** The card's rules text, every face of it. */
  text: string
}

export function cardFactsOf(card: ScryfallCard): CardFacts {
  return {
    colors: new Set((card.color_identity ?? card.colors ?? []).map((c) => c.charAt(0).toUpperCase()).filter(Boolean)),
    typeLine: card.type_line ?? '',
    rarity: (card.rarity ?? '').toLowerCase(),
    text: displayOracleText(card) ?? '',
  }
}

export interface CollectionFilter {
  /** Words that must all be in the type line, e.g. "legendary creature". */
  type: string
  /** A phrase that must be in the rules text, e.g. "draw a card". */
  text: string
  colors: FilterColor[]
  rarities: string[]
}

export const NO_COLLECTION_FILTER: CollectionFilter = { type: '', text: '', colors: [], rarities: [] }
export const COLLECTION_FILTER_RARITIES = ['common', 'uncommon', 'rare', 'mythic']

export function filterActive(f: CollectionFilter): boolean {
  return f.type.trim() !== '' || f.text.trim() !== '' || f.colors.length > 0 || f.rarities.length > 0
}

export function filterCount(f: CollectionFilter): number {
  return (f.type.trim() ? 1 : 0) + (f.text.trim() ? 1 : 0) + f.colors.length + f.rarities.length
}

/**
 * A card passes when its type line has every word typed, its rules text has the phrase typed, it
 * has every chosen colour and is any of the chosen rarities. A card whose data hasn't loaded
 * ([facts] undefined) can't be judged, so it's left out while a filter is on.
 */
export function filterMatches(f: CollectionFilter, facts: CardFacts | undefined | null): boolean {
  if (!filterActive(f)) return true
  if (!facts) return false
  const typeLine = facts.typeLine.toLowerCase()
  if (f.type.split(' ').some((w) => w.trim() !== '' && !typeLine.includes(w.trim().toLowerCase()))) return false
  if (f.text.trim() && !facts.text.toLowerCase().includes(f.text.trim().toLowerCase())) return false
  if (!f.colors.every((c) => facts.colors.has(c))) return false
  if (f.rarities.length > 0 && !f.rarities.includes(facts.rarity)) return false
  return true
}

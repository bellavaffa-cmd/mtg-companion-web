// Solo playtesting ("goldfishing"): the deck shuffled into a library, an opening hand of seven, and
// a card drawn at a time. The Android app's GoldfishDialog does the same.

import type { Deck, DeckCardEntry } from '../types/models'

/** One physical copy in the library — [key] tells copies of the same card apart. */
export interface LibraryCard {
  key: string
  entry: DeckCardEntry
}

export const OPENING_HAND = 7

/**
 * Every copy of the deck's cards, shuffled — less one copy of each commander, which starts in the
 * command zone (a deck's commanders are in its card list too).
 */
export function shuffledLibrary(deck: Deck, random: () => number = Math.random): LibraryCard[] {
  const commanders = new Map<string, number>()
  for (const c of [deck.commander, deck.partnerCommander]) {
    if (c) commanders.set(c.scryfallId, (commanders.get(c.scryfallId) ?? 0) + 1)
  }
  const cards: LibraryCard[] = []
  for (const entry of deck.cards) {
    const copies = entry.quantity - (commanders.get(entry.scryfallId) ?? 0)
    for (let i = 0; i < copies; i++) cards.push({ key: `${entry.scryfallId}#${i}`, entry })
  }
  // Fisher–Yates.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

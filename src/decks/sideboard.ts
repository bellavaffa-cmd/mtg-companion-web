// A deck's sideboard: up to fifteen cards beside the main deck, for formats that have one
// (hasSideboard). Kept in Deck.sideboard — out of the main list, so stats, size, price and combos never
// see it — and merged by the sync exactly like the Considering list. Its copies don't count as cards
// the deck holds: adding to it or moving cards in and out of it leaves the Unsorted pile alone. The
// changes here are plain functions on a Deck so they can be tested. Mirrors the Android app's
// data/Sideboard.kt.

import type { ListSection } from '../collection/cardListText'
import { GAME_MODES_USING_COMMANDER, type Deck, type DeckCardEntry, type GameMode } from '../types/models'

/** The most cards a sideboard may hold. */
export const MAX_SIDEBOARD = 15

/**
 * Whether a format has a sideboard. Commander and Brawl don't: their "sideboard" lines go to
 * Considering instead.
 */
export const hasSideboard = (mode: string): boolean => !GAME_MODES_USING_COMMANDER.has(mode as GameMode)

/** Where an imported decklist line goes in a deck. */
export type DeckPart = 'main' | 'sideboard' | 'considering'

/**
 * Where a decklist line from [section] goes in a [mode] deck: a sideboard line into the sideboard for
 * a format that has one, onto Considering for Commander and Brawl; a maybeboard line onto Considering
 * always.
 */
export function importPart(section: ListSection, mode: string): DeckPart {
  if (section === 'main') return 'main'
  if (section === 'sideboard') return hasSideboard(mode) ? 'sideboard' : 'considering'
  return 'considering'
}

/** How many cards the sideboard holds. */
export const sideboardCount = (deck: Deck): number => (deck.sideboard ?? []).reduce((n, c) => n + c.quantity, 0)

/** [entries] with [entry]'s copies added: onto the row for the same printing, or as a new row. */
export function plusCopies(entries: DeckCardEntry[], entry: DeckCardEntry): DeckCardEntry[] {
  return entries.some((e) => e.scryfallId === entry.scryfallId)
    ? entries.map((e) => (e.scryfallId === entry.scryfallId ? { ...e, quantity: e.quantity + entry.quantity } : e))
    : [...entries, entry]
}

/** A sideboard card is never a cut candidate. */
function sided(entry: DeckCardEntry): DeckCardEntry {
  const { replaceable: _dropped, ...rest } = entry
  return rest
}

/** This deck with [entry]'s copies added to its sideboard. */
export function withSideboardCopies(deck: Deck, entry: DeckCardEntry): Deck {
  return { ...deck, sideboard: plusCopies(deck.sideboard ?? [], sided(entry)) }
}

/** This deck with the sideboard's copies of [scryfallId] set to [quantity]; zero or less takes it off. */
export function withSideboardQuantity(deck: Deck, scryfallId: string, quantity: number): Deck {
  const side = deck.sideboard ?? []
  return {
    ...deck,
    sideboard: quantity <= 0
      ? side.filter((c) => c.scryfallId !== scryfallId)
      : side.map((c) => (c.scryfallId === scryfallId ? { ...c, quantity } : c)),
  }
}

/**
 * This deck with every main-deck copy of [scryfallId] moved to the sideboard (merging with copies
 * already there). A commander stays where it is: it isn't a card you side out. Unchanged when the card
 * isn't in the main deck.
 */
export function movedToSideboard(deck: Deck, scryfallId: string): Deck {
  const entry = deck.cards.find((c) => c.scryfallId === scryfallId)
  if (!entry) return deck
  if (scryfallId === deck.commander?.scryfallId || scryfallId === deck.partnerCommander?.scryfallId) return deck
  return {
    ...deck,
    cards: deck.cards.filter((c) => c.scryfallId !== scryfallId),
    sideboard: plusCopies(deck.sideboard ?? [], sided(entry)),
  }
}

/** This deck with every sideboard copy of [scryfallId] moved into the main deck. */
export function movedToMain(deck: Deck, scryfallId: string): Deck {
  const entry = (deck.sideboard ?? []).find((c) => c.scryfallId === scryfallId)
  if (!entry) return deck
  return {
    ...deck,
    cards: plusCopies(deck.cards, entry),
    sideboard: (deck.sideboard ?? []).filter((c) => c.scryfallId !== scryfallId),
  }
}

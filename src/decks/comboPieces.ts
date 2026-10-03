/**
 * Which of a deck's cards are combo pieces, for the Cards tab's badges and its "Combo pieces"
 * filter. Mirrors the Android app's cardNameKeys/comboPieces (data/DeckBuilding.kt) and the
 * near-miss pieces worked out in DeckDetailViewModel.
 */

import type { DeckCombos } from '../api/relay'
import type { Deck, DeckCardEntry } from '../types/models'

/**
 * Name keys for matching a card across sources. Includes the front face alone, since a
 * double-faced card is "A // B" to Scryfall but often just "A" elsewhere.
 */
export function cardNameKeys(name: string): string[] {
  const full = name.trim().toLowerCase()
  const front = full.split(' // ')[0].trim()
  return front === full ? [full] : [full, front]
}

/** Whether any of [name]'s keys is among [keys]. */
export const hasNameKey = (keys: Set<string>, name: string) => cardNameKeys(name).some((k) => keys.has(k))

/**
 * The names the combo lookup is asked about: the commanders, and every other card in the deck.
 * The Stats tab's Combos panel asks with the same names, so the two share one request and one
 * cached answer.
 */
export function comboLookupNames(deck: Deck): { commanders: string[]; main: string[] } {
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)
  const commanderIds = new Set(commanders.map((c) => c.scryfallId))
  const commanderNames = commanders.map((c) => c.name)
  const main = [...new Set(deck.cards.filter((c) => !commanderIds.has(c.scryfallId)).map((c) => c.name))]
    .filter((n) => !commanderNames.includes(n))
  return { commanders: commanderNames, main }
}

export interface ComboPieces {
  /** Name keys of every card in a combo the deck has whole. */
  pieces: Set<string>
  /** Name keys of the deck's cards in a combo it's exactly one card short of. */
  nearMiss: Set<string>
}

export const NO_COMBO_PIECES: ComboPieces = { pieces: new Set(), nearMiss: new Set() }

/** The combo pieces among [deckNames], from what Commander Spellbook found for the deck. */
export function comboPieces(combos: DeckCombos, deckNames: string[]): ComboPieces {
  const pieces = new Set(combos.included.flatMap((combo) => combo.uses.flatMap((use) => cardNameKeys(use.card.name))))
  const inDeck = new Set(deckNames.flatMap(cardNameKeys))
  const nearMiss = new Set<string>()
  for (const combo of combos.almostIncluded) {
    // Spellbook's "almost" can mean a card outside the deck's colours too; only one-card-away counts.
    const missing = new Set(combo.uses.map((use) => use.card.name).filter((name) => !hasNameKey(inDeck, name)))
    if (missing.size !== 1) continue
    for (const use of combo.uses) for (const key of cardNameKeys(use.card.name)) if (inDeck.has(key)) nearMiss.add(key)
  }
  return { pieces, nearMiss }
}

/** The Cards tab's filter chips, labelled as on the phone (CardFilterChips). */
export type CardFilter = 'ALL' | 'CUT' | 'COMBO'
export const CARD_FILTERS: CardFilter[] = ['ALL', 'CUT', 'COMBO']
export const CARD_FILTER_LABELS: Record<CardFilter, string> = { ALL: 'All', CUT: 'Cut candidates', COMBO: 'Combo pieces' }

/** Whether [card] is shown under [filter]. */
export function passesFilter(card: DeckCardEntry, filter: CardFilter, combo: ComboPieces): boolean {
  if (filter === 'CUT') return !!card.replaceable
  if (filter === 'COMBO') return hasNameKey(combo.pieces, card.name)
  return true
}

/** How many of [cards] each chip would show: the cut candidates, and the combo pieces. */
export function filterCounts(cards: DeckCardEntry[], combo: ComboPieces): { cut: number; combo: number } {
  return {
    cut: cards.filter((c) => c.replaceable).length,
    combo: cards.filter((c) => hasNameKey(combo.pieces, c.name)).length,
  }
}

/** What an empty list says, for a search or a chip that matched nothing (as on the phone). */
export function noMatchMessage(query: string, filter: CardFilter): string {
  if (query) return `No cards in this deck match “${query}”.`
  if (filter === 'CUT') return 'No cut candidates. Open a card’s ⋮ menu and choose Mark as cut candidate.'
  if (filter === 'COMBO') return 'No combo pieces detected in this deck.'
  return 'No cards.'
}

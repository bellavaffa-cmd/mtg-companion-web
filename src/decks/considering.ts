// Moving cards between a deck and its Considering list, and the combo questions that come with
// cutting one. Mirrors the Android app's DeckRepository (moveToConsidering, swap), SwapPickerDialog
// and ComboPieceWarningDialog (ui/decks/DeckBuildingUi.kt).

import type { ComboVariant, DeckCombos } from '../api/relay'
import type { Deck, DeckCardEntry } from '../types/models'
import { cardNameKeys, hasNameKey } from './comboPieces'

/** A card going onto Considering stops being a cut candidate: it's a candidate of another kind now. */
const considered = (entry: DeckCardEntry): DeckCardEntry => ({ ...entry, replaceable: false })

/** [list] with [entry] on it — a list of candidates, so a card already there isn't added twice. */
function withConsidered(list: DeckCardEntry[], entry: DeckCardEntry): DeckCardEntry[] {
  return list.some((c) => c.scryfallId === entry.scryfallId) ? list : [...list, considered(entry)]
}

/** [cards] with [entry]'s copies added, onto the same printing when it's there. */
function withCard(cards: DeckCardEntry[], entry: DeckCardEntry): DeckCardEntry[] {
  return cards.some((c) => c.scryfallId === entry.scryfallId)
    ? cards.map((c) => (c.scryfallId === entry.scryfallId ? { ...c, quantity: c.quantity + entry.quantity } : c))
    : [...cards, considered(entry)]
}

function withoutCard(deck: Deck, scryfallId: string): Deck {
  return {
    ...deck,
    cards: deck.cards.filter((c) => c.scryfallId !== scryfallId),
    commander: deck.commander?.scryfallId === scryfallId ? null : deck.commander,
    partnerCommander: deck.partnerCommander?.scryfallId === scryfallId ? null : deck.partnerCommander,
  }
}

/** Takes a card (all copies) out of the deck and parks it on Considering instead. */
export function moveToConsidering(deck: Deck, scryfallId: string): Deck {
  const entry = deck.cards.find((c) => c.scryfallId === scryfallId)
  if (!entry) return deck
  return { ...withoutCard(deck, scryfallId), considering: withConsidered(deck.considering ?? [], entry) }
}

/**
 * One step: [outId] leaves the deck for Considering and [inId] leaves Considering for the deck — so
 * nothing is lost, and the change can be swapped back.
 */
export function swapConsidered(deck: Deck, outId: string, inId: string): Deck {
  const outgoing = deck.cards.find((c) => c.scryfallId === outId)
  const incoming = deck.considering?.find((c) => c.scryfallId === inId)
  if (!outgoing || !incoming) return deck
  const without = withoutCard(deck, outId)
  return {
    ...without,
    cards: withCard(without.cards, incoming),
    considering: withConsidered((deck.considering ?? []).filter((c) => c.scryfallId !== inId), outgoing),
  }
}

/** The other half of a swap to pick from: cut candidates first, since that's what they're for, then A to Z. */
export function swapOptions(options: DeckCardEntry[]): DeckCardEntry[] {
  return [...options].sort((a, b) => Number(!!b.replaceable) - Number(!!a.replaceable) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

/** The complete combos [name] is a piece of — what cutting it would break. */
export function combosWithCard(included: ComboVariant[], name: string): ComboVariant[] {
  const keys = new Set(cardNameKeys(name))
  return included.filter((combo) => combo.uses.some((use) => cardNameKeys(use.card.name).some((k) => keys.has(k))))
}

/** "Cutting it would break this combo:" / "…these 3 combos:" */
export const breakText = (count: number) => `Cutting it would break ${count === 1 ? 'this combo' : `these ${count} combos`}:`

/** A combo the deck is one card short of, and the card it's missing. */
export interface NearMiss {
  combo: ComboVariant
  missing: string[]
}

/**
 * The combos [deckNames] are exactly one card short of, most popular first. Spellbook's "almost"
 * list can be missing more (or a card outside the colours); only one-card-away counts, as on the phone.
 */
export function nearMisses(combos: DeckCombos, deckNames: string[]): NearMiss[] {
  const inDeck = new Set(deckNames.flatMap(cardNameKeys))
  return combos.almostIncluded
    .map((combo) => ({ combo, missing: [...new Set(combo.uses.map((u) => u.card.name).filter((n) => !hasNameKey(inDeck, n)))] }))
    .filter((n) => n.missing.length === 1)
    .sort((a, b) => (b.combo.popularity ?? 0) - (a.combo.popularity ?? 0))
}

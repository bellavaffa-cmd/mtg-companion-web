// Draft and sealed (the Limited format): a deck built from a pool of cards opened at the table. The
// pool is the deck's sideboard (Deck.sideboard, JSON key "sideboard"), so nothing new is synced:
// cards move between the pool and the 40-card main deck with the sideboard's own moves. Here: the
// pool sorted by colour, the colour pairs it supports best, and the basic lands to add. Pure, so it
// can be tested. Mirrors the Android app's data/Limited.kt.

import type { Deck, DeckCardEntry } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

/** A Limited deck's smallest main deck, and the lands it usually runs. */
export const LIMITED_DECK_SIZE = 40
export const LIMITED_LANDS = 17

/** Whether a deck of [mode] is a draft or sealed deck. */
export const isLimited = (mode: string): boolean => mode === 'LIMITED'

const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const

/** The pool's groups, in the order they're shown: each colour, then multicolour, colourless and lands. */
export const POOL_GROUPS = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L'] as const
export type PoolGroupKey = (typeof POOL_GROUPS)[number]

export const POOL_GROUP_LABELS: Record<PoolGroupKey, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolour', C: 'Colourless', L: 'Lands',
}

/** The basic land that makes each colour. */
export const BASIC_LAND_FOR: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }

/**
 * Coloured mana symbols in a mana cost, by colour: "{1}{W}{W}" is two white. A hybrid or Phyrexian
 * symbol counts towards each colour in it ("{W/U}" is one white and one blue), as the Stats tab's
 * mana symbols do.
 */
export function manaPips(cost: string | null | undefined): Record<string, number> {
  const pips: Record<string, number> = {}
  for (const [, symbol] of (cost ?? '').matchAll(/\{([^}]+)\}/g)) {
    for (const part of symbol.toUpperCase().split('/')) {
      if ((COLOURS as readonly string[]).includes(part)) pips[part] = (pips[part] ?? 0) + 1
    }
  }
  return pips
}

/** The card's mana cost — the front face's, for a card whose faces have their own. */
const costOf = (card: ScryfallCard): string | undefined => card.mana_cost || card.card_faces?.[0]?.mana_cost

/** Whether [entry] is a land: by the card when it's known, by the type line saved on the entry otherwise. */
function isLand(entry: DeckCardEntry, card: ScryfallCard | undefined): boolean {
  const type = card?.type_line ?? entry.typeLine ?? ''
  return type.split(' // ')[0].includes('Land')
}

/**
 * A card's colours, in W U B R G order: Scryfall's colours, or for a card whose faces carry them
 * (a double-faced card), the colours of its front face's mana cost. None for an unknown card.
 */
export function cardColours(card: ScryfallCard | undefined): string[] {
  if (!card) return []
  const own = card.colors ?? Object.keys(manaPips(costOf(card)))
  return COLOURS.filter((c) => own.includes(c))
}

/** Which group of the pool a card goes in: a land, one colour, several, or none. */
export function poolGroupOf(entry: DeckCardEntry, card: ScryfallCard | undefined): PoolGroupKey {
  if (isLand(entry, card)) return 'L'
  const colours = cardColours(card)
  if (colours.length === 0) return 'C'
  if (colours.length > 1) return 'M'
  return colours[0] as PoolGroupKey
}

export interface PoolGroup {
  key: PoolGroupKey
  label: string
  cards: DeckCardEntry[]
  /** Copies in the group. */
  count: number
}

/** The pool's cards by colour (see POOL_GROUPS), each group by name; empty groups left out. */
export function poolGroups(entries: DeckCardEntry[], cardsById: Map<string, ScryfallCard>): PoolGroup[] {
  return POOL_GROUPS.map((key) => {
    const cards = entries
      .filter((e) => poolGroupOf(e, cardsById.get(e.scryfallId)) === key)
      .sort((a, b) => a.name.localeCompare(b.name))
    return { key, label: POOL_GROUP_LABELS[key], cards, count: cards.reduce((n, c) => n + c.quantity, 0) }
  }).filter((g) => g.cards.length > 0)
}

export interface ColourPair {
  /** The two colours, in W U B R G order: "WU". */
  colours: string
  /** Playable cards for the pair: non-land cards in one or both colours, or colourless. */
  count: number
}

/**
 * The two-colour pairs the pool supports best: for each pair, the non-land cards (copies) whose
 * colours all fall within it — either colour, both, or none — most first; [top] of them, none with
 * nothing. Ties keep W U B R G order (WU, WB, WR, WG, UB…).
 */
export function strongestPairs(entries: DeckCardEntry[], cardsById: Map<string, ScryfallCard>, top = 3): ColourPair[] {
  const playable = entries
    .filter((e) => !isLand(e, cardsById.get(e.scryfallId)))
    .map((e) => ({ colours: cardColours(cardsById.get(e.scryfallId)), quantity: e.quantity }))
  const pairs: ColourPair[] = []
  COLOURS.forEach((a, i) => COLOURS.slice(i + 1).forEach((b) => {
    const count = playable.filter((p) => p.colours.every((c) => c === a || c === b)).reduce((n, p) => n + p.quantity, 0)
    pairs.push({ colours: a + b, count })
  }))
  return pairs.filter((p) => p.count > 0).sort((x, y) => y.count - x.count).slice(0, top)
}

/** The coloured mana symbols across the main deck's non-land cards (copies counted), by colour. */
export function mainDeckPips(entries: DeckCardEntry[], cardsById: Map<string, ScryfallCard>): Record<string, number> {
  const pips: Record<string, number> = {}
  for (const e of entries) {
    const card = cardsById.get(e.scryfallId)
    if (!card || isLand(e, card)) continue
    for (const [c, n] of Object.entries(manaPips(costOf(card)))) pips[c] = (pips[c] ?? 0) + n * e.quantity
  }
  return pips
}

/** How many basics to add: 17 lands for 40 cards, less the lands the main deck already has. */
export function basicsWanted(entries: DeckCardEntry[], cardsById: Map<string, ScryfallCard>): number {
  const lands = entries.filter((e) => isLand(e, cardsById.get(e.scryfallId))).reduce((n, e) => n + e.quantity, 0)
  return Math.max(0, LIMITED_LANDS - lands)
}

/**
 * [total] basic lands split between the colours in [pips], in proportion to their symbols, with at
 * least one of each colour used (even if that goes over [total]). Colours left out have none; with
 * no symbols at all, nothing is suggested. Rounded so the counts add up to [total]: the colours
 * whose share was rounded down most get the lands left over.
 */
export function basicLandSplit(pips: Record<string, number>, total: number): Record<string, number> {
  const used = COLOURS.filter((c) => (pips[c] ?? 0) > 0)
  if (total <= 0 || used.length === 0) return {}
  const sum = used.reduce((n, c) => n + pips[c], 0)
  const share = Object.fromEntries(used.map((c) => [c, (total * pips[c]) / sum]))
  const counts: Record<string, number> = Object.fromEntries(used.map((c) => [c, Math.max(1, Math.floor(share[c]))]))
  const added = () => used.reduce((n, c) => n + counts[c], 0)
  // Short: one more to the colour furthest under its share. Over: one fewer from the furthest over.
  while (added() < total) {
    const c = used.reduce((best, x) => (share[x] - counts[x] > share[best] - counts[best] ? x : best))
    counts[c]++
  }
  while (added() > total) {
    const over = used.filter((c) => counts[c] > 1)
    if (over.length === 0) break
    const c = over.reduce((best, x) => (share[x] - counts[x] < share[best] - counts[best] ? x : best))
    counts[c]--
  }
  return counts
}

/**
 * Every card the deck holds — its main deck and its pool — one row per printing, copies added
 * together. What "Add pool to a binder" copies once the event is over.
 */
export function poolCopies(deck: Deck): DeckCardEntry[] {
  const rows = new Map<string, DeckCardEntry>()
  for (const e of [...deck.cards, ...(deck.sideboard ?? [])]) {
    const had = rows.get(e.scryfallId)
    rows.set(e.scryfallId, had ? { ...had, quantity: had.quantity + e.quantity } : { ...e })
  }
  return [...rows.values()]
}

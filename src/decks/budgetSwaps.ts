// Budget swaps: for a deck's priciest cards, cheaper ones that do the same job — the same Scryfall
// Tagger role, or with no role, the same type at about the same mana value — in the commander's
// colours and legal in the format. Mirrors the Android app's DeckDetailViewModel.findBudgetSwaps.

import type { DeckCardEntry } from '../types/models'
import { cardNameKeys } from './comboPieces'
import { isLandType } from './deckAnalysis'

/** In US dollars, like the prices they're held against; shown in the chosen currency. */
export const BUDGET_THRESHOLDS = [2, 5, 10, 20]
/** The priciest cards looked at. */
export const MAX_BUDGET_SWAPS = 8
export const ALTERNATIVES_PER_SWAP = 4
/** Alternatives must cost under this fraction of the original — a swap has to actually save money. */
export const BUDGET_PRICE_FRACTION = 0.4

/** The jobs a swap is matched on, in the order the phone checks them, with Scryfall's otag for each. */
export const BUDGET_ROLES = [
  { id: 'ramp', otag: 'ramp', label: 'ramp' },
  { id: 'draw', otag: 'draw', label: 'card draw' },
  { id: 'removal', otag: 'removal', label: 'removal' },
  { id: 'board-wipe', otag: 'board-wipe', label: 'board wipes' },
] as const
export type BudgetRole = (typeof BUDGET_ROLES)[number]

/** The first of the swap jobs among a card's tag ids, or null. */
export const budgetRoleOf = (tagIds: string[]): BudgetRole | null => BUDGET_ROLES.find((r) => tagIds.includes(r.id)) ?? null

/** The deck's non-land, non-commander cards costing [thresholdUsd] or more, priciest first. */
export function budgetCandidates(
  cards: DeckCardEntry[],
  priceOf: (scryfallId: string) => number | null,
  commanderIds: Set<string>,
  thresholdUsd: number,
): { entry: DeckCardEntry; price: number }[] {
  return cards
    .filter((c) => !commanderIds.has(c.scryfallId) && !isLandType(c.typeLine))
    .flatMap((entry) => {
      const price = priceOf(entry.scryfallId)
      return price !== null && price >= thresholdUsd ? [{ entry, price }] : []
    })
    .sort((a, b) => b.price - a.price)
    .slice(0, MAX_BUDGET_SWAPS)
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land']
const primaryType = (typeLine: string | null | undefined) =>
  TYPE_ORDER.find((t) => (typeLine ?? '').toLowerCase().includes(t.toLowerCase())) ?? 'Other'

/**
 * The Scryfall search for cheaper cards doing [name]'s job: its role's otag, or its type within one
 * of its mana value; inside [identity] (e.g. "wub", "c" for colourless); under 40% of [price] (at
 * least 25¢); legal in [format]; not the card itself. Searched in EDHREC order.
 */
export function budgetSwapQuery(opts: {
  name: string
  price: number
  role: BudgetRole | null
  typeLine: string | null | undefined
  cmc: number | null | undefined
  identity: string
  format: string
}): string {
  const cmc = Math.trunc(opts.cmc ?? 0)
  const job = opts.role
    ? `otag:${opts.role.otag}`
    : `t:${primaryType(opts.typeLine).toLowerCase()} mv>=${Math.max(cmc - 1, 0)} mv<=${cmc + 1}`
  const ceiling = Math.max(opts.price * BUDGET_PRICE_FRACTION, 0.25).toFixed(2)
  return `${job} id<=${opts.identity || 'c'} usd<${ceiling} f:${opts.format.toLowerCase()} -!"${opts.name.replace(/"/g, '')}"`
}

/** The colour identity to search within: the commanders', or with none, the candidates' own. */
export function swapIdentity(commanderColors: string[][], candidateColors: string[][]): string {
  const source = commanderColors.length > 0 ? commanderColors : candidateColors
  const letters = [...new Set(source.flat())].map((c) => c.toLowerCase())
  return ['w', 'u', 'b', 'r', 'g'].filter((c) => letters.includes(c)).join('') || 'c'
}

/** [found] without cards the deck or its Considering list already has, the first few. */
export function freshAlternatives<T extends { name: string }>(found: T[], alreadyHave: string[]): T[] {
  const have = new Set(alreadyHave.flatMap(cardNameKeys))
  return found.filter((c) => !cardNameKeys(c.name).some((k) => have.has(k))).slice(0, ALTERNATIVES_PER_SWAP)
}

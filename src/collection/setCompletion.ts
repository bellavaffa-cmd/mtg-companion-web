// Set completion: for every set the user owns cards from, how many of its cards they have. A card
// here is a printing (Scryfall's card_count for a set counts printings, showcase and borderless
// versions included), so owning a set's Lightning Bolt in one art and not the other is one of two.
// Owned means what All cards counts as owned: copies in owned binders and in decks, not proxies.
// Mirrors the Android app's data/SetCompletion.kt.

import type { Collection, Deck } from '../types/models'
import { proxyCopies } from '../decks/proxies'

/** A set as Scryfall describes it. [cardCount]: how many printings it has; [releasedAt]: "2024-08-02". */
export interface SetInfo {
  code: string
  name: string
  cardCount: number
  releasedAt?: string | null
  iconSvgUri?: string | null
  /** Scryfall's set_type: "expansion", "commander", "token"… (newSets.ts leaves some out). */
  setType?: string | null
  /** Only on MTG Arena or Magic Online. */
  digital?: boolean
}

/** How much of [set] the user has: [owned] of its printings. */
export interface SetProgress { set: SetInfo; owned: number }

/** 0..1; 0 when the set's size isn't known. */
export const setFraction = (p: SetProgress) => (p.set.cardCount <= 0 ? 0 : Math.min(1, Math.max(0, p.owned / p.set.cardCount)))
/** Whole percent, rounded down so a set shows 100% only when it's complete. */
export const setPercent = (p: SetProgress) => (p.set.cardCount <= 0 ? 0 : Math.min(100, Math.max(0, Math.floor((p.owned * 100) / p.set.cardCount))))
export const setComplete = (p: SetProgress) => p.set.cardCount >= 1 && p.owned >= p.set.cardCount

export type SetSort = 'PERCENT' | 'NAME' | 'RELEASE'
export const SET_SORTS: SetSort[] = ['PERCENT', 'NAME', 'RELEASE']
export const SET_SORT_LABELS: Record<SetSort, string> = { PERCENT: 'Most complete', NAME: 'Name', RELEASE: 'Newest' }

/**
 * Progress in every set the user owns a card from. [ownedSets]: each owned printing's set code, by
 * scryfallId (a printing whose set isn't known yet is left out). [sets]: Scryfall's sets, by code;
 * a set missing from it is still listed, under its code, with its size unknown.
 */
export function setProgress(ownedSets: Map<string, string>, sets: Map<string, SetInfo>): SetProgress[] {
  const byCode = new Map<string, Set<string>>()
  for (const [id, raw] of ownedSets) {
    const code = raw.toLowerCase()
    if (!code.trim()) continue
    byCode.set(code, (byCode.get(code) ?? new Set()).add(id))
  }
  return [...byCode].map(([code, ids]) => ({ set: sets.get(code) ?? { code, name: code.toUpperCase(), cardCount: 0 }, owned: ids.size }))
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byName = (a: SetProgress, b: SetProgress) => cmp(a.set.name.toLowerCase(), b.set.name.toLowerCase())

/** [list] in the chosen order; ties go by name. */
export function sortedSets(list: SetProgress[], sort: SetSort): SetProgress[] {
  const out = [...list]
  if (sort === 'PERCENT') return out.sort((a, b) => setFraction(b) - setFraction(a) || b.owned - a.owned || byName(a, b))
  if (sort === 'NAME') return out.sort(byName)
  return out.sort((a, b) => cmp(b.set.releasedAt ?? '', a.set.releasedAt ?? '') || byName(a, b))
}

/** A set's printings the user doesn't own, by scryfallId, in the set's order. */
export function missingFromSet<T>(setCards: T[], owned: Set<string>, id: (card: T) => string): T[] {
  return setCards.filter((c) => !owned.has(id(c)))
}

/**
 * Real copies held of each printing, by scryfallId, counted as All cards counts them: owned binders
 * (the Unsorted pile too) and every deck's cards, proxies left out. Wishlists don't count.
 */
export function ownedPrintings(collections: Collection[], decks: Deck[]): Map<string, number> {
  const out = new Map<string, number>()
  const add = (id: string, n: number) => { if (n > 0) out.set(id, (out.get(id) ?? 0) + n) }
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) add(e.scryfallId, e.quantity + e.foilQuantity)
  }
  for (const d of decks) for (const e of d.cards) add(e.scryfallId, e.quantity - proxyCopies(d, e))
  return out
}

/*
 * Is the trade fair? Both sides' totals at today's prices (Scryfall's, in US dollars — shown in the
 * chosen currency), the difference, how the two sides compare for the balance bar, and — when it's
 * uneven — the cards that would even it out: from the side that's short, the cards the other person
 * wants (their wishlist) that the user has for trade or spare, or the cards the user wants that they
 * have, closest to the gap first. Cards with no price are counted and said, never guessed.
 *
 * Pure, so it can be tested. Mirrors the Android app's data/social/TradeFairness.kt, with the same
 * tests (tests/social/tradeFairness.test.ts ↔ TradeFairnessTest.kt).
 */

import type { TradeCard } from './api'
import type { TradeMatch } from './more'

/** A card's prices in US dollars: regular and foil (null: none). */
export interface CardPrice { usd: number | null; foil: number | null }
export type PriceBook = Map<string, CardPrice>

/** One copy's price: the foil price for a foil copy (else the regular one), the regular price otherwise (else the foil one). */
export function unitPrice(card: Pick<TradeCard, 'scryfallId' | 'foil'>, prices: PriceBook): number | null {
  const p = prices.get(card.scryfallId)
  if (!p) return null
  return card.foil ? p.foil ?? p.usd : p.usd ?? p.foil
}

/** A side's total in US dollars, and how many of its copies have no price (left out of the total). */
export interface SideTotal { sum: number; unpriced: number }

export function sideTotal(cards: TradeCard[], prices: PriceBook): SideTotal {
  let sum = 0
  let unpriced = 0
  for (const c of cards) {
    const each = unitPrice(c, prices)
    if (each == null) unpriced += c.quantity
    else sum += each * c.quantity
  }
  return { sum, unpriced }
}

/** Within $2, or a tenth of the bigger side, either way is fair. */
export const isFair = (diff: number, a: number, b: number): boolean => Math.abs(diff) <= Math.max(2, 0.1 * Math.max(a, b))

export interface Fairness {
  get: SideTotal
  give: SideTotal
  /** What the user gets less what they give: above 0, they get more. */
  diff: number
  fair: boolean
  /** Copies with no price, both sides. */
  unpriced: number
  /** The share of the value the user gets, 0–1, for the balance bar (0.5: even). */
  getShare: number
}

/** Both sides compared — or null when nothing on either side has a price, so there's no verdict to give. */
export function fairness(get: TradeCard[], give: TradeCard[], prices: PriceBook): Fairness | null {
  const g = sideTotal(get, prices)
  const v = sideTotal(give, prices)
  if (g.sum === 0 && v.sum === 0) return null
  const diff = g.sum - v.sum
  return { get: g, give: v, diff, fair: isFair(diff, g.sum, v.sum), unpriced: g.unpriced + v.unpriced, getShare: g.sum / (g.sum + v.sum) }
}

/** "Even — a fair trade", "Within $1.50 — a fair trade", "You give $12.00 more", "You get $3.00 more". [money]: US dollars written in the chosen currency. */
export function verdictLine(f: Fairness, money: (usd: number) => string): string {
  if (f.fair) return Math.abs(f.diff) < 0.005 ? 'Even — a fair trade' : `Within ${money(Math.abs(f.diff))} — a fair trade`
  return f.diff > 0 ? `You get ${money(f.diff)} more` : `You give ${money(-f.diff)} more`
}

/** "2 cards have no price and are left out." — or null when every card has one. */
export const unpricedLine = (n: number): string | null =>
  n <= 0 ? null : `${n} ${n === 1 ? 'card has no price and is' : 'cards have no price and are'} left out.`

/**
 * Which list a card would go on to even the trade out: 'want' (ask them for more — the user gives
 * more), 'give' (offer more — the user gets more); null when it's fair already.
 */
export function shortSide(f: Fairness | null): 'want' | 'give' | null {
  if (!f || f.fair) return null
  return f.diff < 0 ? 'want' : 'give'
}

/** A card that would even the trade out, and its price for one copy. */
export interface Suggestion { card: TradeCard; price: number }

const lower = (s: string) => s.trim().toLowerCase()

/**
 * The cards that would even the trade out for [side], from the friend's trade [match]: their cards
 * the user wants ('want'), or the user's cards on their wishlist that are marked for trade or that no
 * deck of the user's plays ('give'; [decksUse]: the names the decks use, lower case — spares.ts).
 */
export function candidatesFor(side: 'want' | 'give', match: TradeMatch | null | undefined, decksUse: Set<string>): TradeCard[] {
  if (!match) return []
  const strip = ({ forTrade: _mark, ...card }: TradeCard & { forTrade?: boolean }): TradeCard => { void _mark; return card }
  if (side === 'want') return match.they_have.map(strip)
  return match.they_want.filter((c) => c.forTrade || !decksUse.has(lower(c.name))).map(strip)
}

/**
 * Up to [max] of [candidates] that would close a [gap] (US dollars), closest to it first (then the
 * cheaper, then by name). A card already in the trade ([inTrade], either side), one with no price,
 * or a second printing of the same card is left out.
 */
export function evenOut(gap: number, candidates: TradeCard[], inTrade: TradeCard[], prices: PriceBook, max = 3): Suggestion[] {
  const taken = new Set(inTrade.map((c) => lower(c.name)))
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const card of candidates) {
    const key = lower(card.name)
    if (taken.has(key) || seen.has(key)) continue
    const price = unitPrice(card, prices)
    if (price == null || price <= 0) continue
    seen.add(key)
    out.push({ card: { ...card, quantity: 1 }, price })
  }
  const target = Math.abs(gap)
  return out
    .sort((a, b) => (Math.abs(a.price - target) - Math.abs(b.price - target)) || (a.price - b.price) || (lower(a.card.name) < lower(b.card.name) ? -1 : lower(a.card.name) > lower(b.card.name) ? 1 : 0))
    .slice(0, max)
}

/** "To even it out, ask Priya for one of these" / "To even it out, offer one of these". */
export const evenOutTitle = (side: 'want' | 'give', name: string): string =>
  side === 'want' ? `To even it out, ask ${name} for one of these` : 'To even it out, offer one of these'

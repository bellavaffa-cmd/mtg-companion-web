// Which of the user's cards moved in price: each owned card's price (US dollars) noted once a day,
// alongside the collection's value (see valueHistory.ts), for the last month. Kept in this browser.
// Mirrors the Android app's data/PriceMovers.kt.

import { useEffect, useState } from 'react'

/** A card the user owns (or did), by printing: [copies] as of the last note — 0 once it's gone. */
export interface PricedCard { id: string; name: string; imageUrl: string | null; copies: number }

/** One day's prices, in the same order as PriceStore.cards; null where there was none. */
export interface PriceDay { date: string; prices: (number | null)[] }

export interface PriceStore { cards: PricedCard[]; days: PriceDay[] }

/** One card's move: [from] and [to] per copy; [change] is what it did to the collection's value. */
export interface Mover { card: PricedCard; from: number; to: number; change: number; percent: number }

/** The biggest risers and fallers since [since]. */
export interface Movers { since: string; up: Mover[]; down: Mover[] }

/** How far back the movers look. */
export const MOVER_RANGES = [
  { id: '1D', days: 1 },
  { id: '7D', days: 7 },
  { id: '30D', days: 30 },
] as const
export type MoverRangeId = (typeof MOVER_RANGES)[number]['id']

/** How many days of prices are kept. */
export const PRICE_DAYS_KEPT = 31

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * [store] with [date]'s prices of [owned] noted (a later note that day replaces the earlier). Cards
 * no longer owned stay while they have prices in the days kept, at 0 copies; days older than
 * PRICE_DAYS_KEPT go.
 */
export function withPrices(store: PriceStore, date: string, owned: PricedCard[], prices: Map<string, number>): PriceStore {
  const ownedById = new Map(owned.map((c) => [c.id, c]))
  const known = new Set(store.cards.map((c) => c.id))
  const cards = [...store.cards.map((old) => ownedById.get(old.id) ?? { ...old, copies: 0 }), ...owned.filter((o) => !known.has(o.id))]
  const widened = store.days
    .filter((d) => d.date !== date)
    .map((d) => ({ ...d, prices: [...d.prices, ...Array<null>(cards.length - d.prices.length).fill(null)] }))
  const since = addDays(date, -PRICE_DAYS_KEPT)
  const days = [...widened, { date, prices: cards.map((c) => prices.get(c.id) ?? null) }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((d) => d.date >= since)
  // A card that's gone and has no price left in the days kept is dropped from every list.
  const keep = cards.map((_, i) => i).filter((i) => cards[i].copies > 0 || days.some((d) => d.prices[i] != null))
  return { cards: keep.map((i) => cards[i]), days: days.map((d) => ({ ...d, prices: keep.map((i) => d.prices[i] ?? null) })) }
}

/**
 * The owned cards whose price moved most since [range] ago — by what it did to the collection's
 * value. Measured from the oldest note within the range (a shorter history counts from its start);
 * null until there are two days to compare.
 */
export function moversOf(store: PriceStore, range: MoverRangeId, limit = 10): Movers | null {
  const latest = store.days[store.days.length - 1]
  if (!latest) return null
  const target = addDays(latest.date, -(MOVER_RANGES.find((r) => r.id === range)?.days ?? 7))
  const base = store.days.find((d) => d.date >= target && d.date < latest.date)
  if (!base) return null
  const moves: Mover[] = []
  store.cards.forEach((card, i) => {
    const from = base.prices[i]
    const to = latest.prices[i]
    if (card.copies <= 0 || from == null || to == null || Math.abs(to - from) < 0.01) return
    moves.push({ card, from, to, change: (to - from) * card.copies, percent: from > 0 ? ((to - from) / from) * 100 : 0 })
  })
  return {
    since: base.date,
    up: moves.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, limit),
    down: moves.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, limit),
  }
}

const KEY = 'mtgweb_card_prices'
const listeners = new Set<() => void>()
let store: PriceStore = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { cards: { id: string; n: string; i: string | null; c: number }[]; days: { d: string; p: (number | null)[] }[] } | null
    if (!raw) return { cards: [], days: [] }
    // Prices are kept in cents, to keep it small.
    return {
      cards: raw.cards.map((c) => ({ id: c.id, name: c.n, imageUrl: c.i, copies: c.c })),
      days: raw.days.map((d) => ({ date: d.d, prices: d.p.map((p) => (p == null ? null : p / 100)) })),
    }
  } catch {
    return { cards: [], days: [] }
  }
})()

/** Notes [date]'s prices of the owned cards. */
export function recordPrices(date: string, owned: PricedCard[], prices: Map<string, number>) {
  store = withPrices(store, date, owned, prices)
  try {
    localStorage.setItem(KEY, JSON.stringify({
      cards: store.cards.map((c) => ({ id: c.id, n: c.name, i: c.imageUrl, c: c.copies })),
      days: store.days.map((d) => ({ d: d.date, p: d.prices.map((p) => (p == null ? null : Math.round(p * 100))) })),
    }))
  } catch { /* storage full: this visit only */ }
  listeners.forEach((l) => l())
}

/** The price log, re-rendering when a day is noted. */
export function usePriceStore(): PriceStore {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return store
}

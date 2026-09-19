// The collection's value over time: one point a day, the owned binders' value (in US dollars, like
// every price the app keeps) as Home last worked it out that day. Kept in this browser. Mirrors the
// Android app's data/ValueHistory.kt.

import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { Collection } from '../types/models'

/** [date]: "2026-09-20". [cards]: how many cards the value is of. */
export interface ValuePoint { date: string; usd: number; cards: number }

export interface ValueChange { from: ValuePoint; to: ValuePoint; usd: number; percent: number | null }

/** The stretches the chart can show: the last [days] (null: everything). */
export const VALUE_RANGES = [
  { id: '1M', days: 30 },
  { id: '3M', days: 91 },
  { id: '1Y', days: 365 },
  { id: 'All', days: null },
] as const
export type ValueRangeId = (typeof VALUE_RANGES)[number]['id']

/** About three years of days. */
export const KEEP = 1100

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The points within [range] of the newest one, oldest first. */
export function pointsIn(points: ValuePoint[], range: ValueRangeId): ValuePoint[] {
  const last = points[points.length - 1]
  const days = VALUE_RANGES.find((r) => r.id === range)?.days ?? null
  if (!last || days == null) return points
  const since = addDays(last.date, -days)
  return points.filter((p) => p.date >= since)
}

/** Change from the first to the last of [points]; null under two points. */
export function changeOf(points: ValuePoint[]): ValueChange | null {
  if (points.length < 2) return null
  const from = points[0]
  const to = points[points.length - 1]
  return { from, to, usd: to.usd - from.usd, percent: from.usd > 0 ? ((to.usd - from.usd) / from.usd) * 100 : null }
}

/** [points] with [point] in its day's place (a later value that day replaces the earlier), oldest first, at most [keep]. */
export function withPoint(points: ValuePoint[], point: ValuePoint, keep = KEEP): ValuePoint[] {
  return [...points.filter((p) => p.date !== point.date), point].sort((a, b) => a.date.localeCompare(b.date)).slice(-keep)
}

/** Today in this browser's time zone, "2026-09-20". */
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const HISTORY_KEY = 'mtgweb_value_history'
const listeners = new Set<() => void>()
let history: ValuePoint[] = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as { d: string; v: number; n: number }[]
    return raw.map((p) => ({ date: p.d, usd: p.v, cards: p.n }))
  } catch {
    return []
  }
})()

/** Notes today's value of the owned binders. */
export function recordValue(usd: number, cards: number) {
  history = withPoint(history, { date: today(), usd: Math.round(usd * 100) / 100, cards })
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.map((p) => ({ d: p.date, v: p.usd, n: p.cards })))) } catch { /* this visit only */ }
  listeners.forEach((l) => l())
}

/** The value history, oldest first, re-rendering when a point is added. */
export function useValueHistory(): ValuePoint[] {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return history
}

/** What the owned binders hold: scryfallId → copies (wishlists don't count). */
export function ownedQuantities(collections: Collection[]): Map<string, number> {
  const q = new Map<string, number>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) q.set(e.scryfallId, (q.get(e.scryfallId) ?? 0) + e.quantity + e.foilQuantity)
  }
  return q
}

/** A worked-out value, kept for a while so Home doesn't ask Scryfall again on every visit. */
let lastValue: { key: string; at: number; usd: number; cards: number } | null = null
const VALUE_FRESH_MS = 60 * 60 * 1000

/**
 * The owned binders' value in US dollars (null while it's worked out, or with nothing to value),
 * noted in the value history once a day when Scryfall sent (nearly) every card.
 */
export function useCollectionValue(collections: Collection[]): { usd: number; cards: number } | null {
  const quantities = ownedQuantities(collections)
  const key = [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => `${id}:${n}`).join(',')
  const cached = lastValue && lastValue.key === key && Date.now() - lastValue.at < VALUE_FRESH_MS ? lastValue : null
  const [value, setValue] = useState<{ usd: number; cards: number } | null>(cached)
  useEffect(() => {
    if (!key) { setValue(null); return }
    if (cached) { setValue(cached); return }
    let cancelled = false
    const ids = [...quantities.keys()]
    void getCardsByIds(ids).then((cards) => {
      if (cancelled || cards.length === 0) return
      let usd = 0
      for (const c of cards) usd += Number(c.prices?.usd ?? 0) * (quantities.get(c.id) ?? 0)
      const count = [...quantities.values()].reduce((a, b) => a + b, 0)
      lastValue = { key, at: Date.now(), usd, cards: count }
      setValue({ usd, cards: count })
      // Only a full answer counts: a dropped request mustn't read as a crash in value.
      if (cards.length >= ids.length * 0.98) recordValue(usd, count)
    })
    return () => { cancelled = true }
    // key stands for the quantities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return value
}

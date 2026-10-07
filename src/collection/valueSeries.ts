// The whole collection's value over time, worked out from each card's own price history
// (cardPriceHistory.ts) and the copies owned now: for each day on the chart, every owned card at the
// price it had that day. Nothing is made up — a card counts from the first day this browser saved its
// price, and the line starts on the first day any of them was saved. Shown by day, week or month,
// with the cards that rose and fell most and each binder's change. Pure, so it can be tested.
// Mirrors the Android app's data/ValueSeries.kt, with the same tests
// (tests/collection/valueSeries.test.ts ↔ ValueSeriesTest.kt).

import type { Collection } from '../types/models'
import type { PriceTrack } from './cardPriceHistory'

/** Copies of one printing in one binder. */
export interface Holding { id: string; name: string; imageUrl: string | null; binderId: string; binderName: string; copies: number }

/** The stretches the chart offers: the last [days] (null: all of the history). */
export const SERIES_RANGES = [
  { id: '1M', days: 30 },
  { id: '6M', days: 182 },
  { id: '1Y', days: 365 },
  { id: 'All', days: null },
] as const
export type SeriesRangeId = (typeof SERIES_RANGES)[number]['id']

/** How far apart the chart's points are. */
export type Bucket = 'day' | 'week' | 'month'
export const BUCKET_LABELS: Record<Bucket, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' }

/** One point: the value on [day] (an epoch day), of the [priced] copies that had a price then, out of [copies]. */
export interface SeriesPoint { day: number; usd: number; priced: number; copies: number }

export interface ValueSeries {
  points: SeriesPoint[]
  bucket: Bucket
  /** The first day any owned card's price was saved. */
  historyStart: number
  /** Copies owned now that have no saved price at all. */
  unpriced: number
  /** Owned cards (printings) whose first saved price came after the chart's first day. */
  lateCards: number
}

/** One card's move over the range: per-copy [from] and [to], and what it did to the value ([change]). */
export interface ValueMover { id: string; name: string; imageUrl: string | null; copies: number; from: number; to: number; change: number; percent: number | null; sinceDay: number }

/** A binder's value on the last day, and how much it changed (cards with a price on both days). */
export interface BinderValue { id: string; name: string; usd: number; change: number }

/** The owned binders' copies (not wishlists, not samples): one holding per printing per binder. */
export function holdingsOf(collections: Collection[]): Holding[] {
  const out: Holding[] = []
  for (const c of collections) {
    if (c.type === 'WISHLIST' || c.sample) continue
    for (const e of c.entries) {
      const copies = e.quantity + e.foilQuantity
      if (copies > 0) out.push({ id: e.scryfallId, name: e.name, imageUrl: e.imageUrl, binderId: c.id, binderName: c.name, copies })
    }
  }
  return out
}

/** The first day [track] had a US dollar price; null if it never had one. */
export function firstPricedDay(track: PriceTrack | undefined): number | null {
  return track?.points.find((p) => p.usd != null)?.day ?? null
}

/**
 * The US dollar price [track] had on each of [days] (sorted, oldest first): the price noted last on
 * or before that day — after the last day the card was seen, its last price. Null before its first.
 */
export function pricesOn(track: PriceTrack | undefined, days: number[]): (number | null)[] {
  const out: (number | null)[] = []
  const points = track?.points ?? []
  let i = -1
  for (const d of days) {
    while (i + 1 < points.length && points[i + 1].day <= d) i++
    out.push(i >= 0 ? points[i].usd : null)
  }
  return out
}

export const priceOn = (track: PriceTrack | undefined, day: number) => pricesOn(track, [day])[0]

/** The days the chart's points sit on, between [start] and [end]: the first day, then each bucket's last. */
export function bucketDays(start: number, end: number, bucket: Bucket): number[] {
  if (end < start) return []
  const days = [start]
  for (let d = start; d <= end; d++) {
    const last = d === end || bucketKey(d, bucket) !== bucketKey(d + 1, bucket)
    if (last && d !== start) days.push(d)
  }
  return days
}

/** Which day, week (Monday first) or month [day] falls in. */
export function bucketKey(day: number, bucket: Bucket): number {
  switch (bucket) {
    case 'day': return day
    // Epoch day 0 was a Thursday: +3 puts Mondays on a multiple of 7.
    case 'week': return Math.floor((day + 3) / 7)
    case 'month': {
      const d = new Date(day * 86_400_000)
      return d.getUTCFullYear() * 12 + d.getUTCMonth()
    }
  }
}

/** Daily for a month, weekly up to a year, monthly beyond. */
export function bucketFor(range: SeriesRangeId, spanDays: number): Bucket {
  if (range === '1M') return 'day'
  if (range === '6M' || range === '1Y') return 'week'
  return spanDays <= 62 ? 'day' : spanDays <= 400 ? 'week' : 'month'
}

/**
 * The collection's value over [range], ending on the last day prices were saved (never after
 * [today]); null when no owned card has a saved price.
 */
export function valueSeries(tracks: Map<string, PriceTrack>, holdings: Holding[], range: SeriesRangeId, today: number): ValueSeries | null {
  const copies = new Map<string, number>()
  for (const h of holdings) copies.set(h.id, (copies.get(h.id) ?? 0) + h.copies)
  let historyStart: number | null = null
  let end: number | null = null
  let unpriced = 0
  for (const [id, n] of copies) {
    const t = tracks.get(id)
    const first = firstPricedDay(t)
    if (first == null || !t) { unpriced += n; continue }
    if (historyStart == null || first < historyStart) historyStart = first
    if (end == null || t.lastDay > end) end = t.lastDay
  }
  if (historyStart == null || end == null) return null
  end = Math.min(end, today)
  if (end < historyStart) return null
  const days = SERIES_RANGES.find((r) => r.id === range)?.days ?? null
  const start = days == null ? historyStart : Math.max(historyStart, end - (days - 1))
  const bucket = bucketFor(range, end - start)
  const at = bucketDays(start, end, bucket)
  const usd = at.map(() => 0)
  const priced = at.map(() => 0)
  let total = 0
  let lateCards = 0
  for (const [id, n] of copies) {
    total += n
    const t = tracks.get(id)
    if (!t) continue
    const first = firstPricedDay(t)
    if (first != null && first > start) lateCards++
    pricesOn(t, at).forEach((p, i) => {
      if (p == null) return
      usd[i] += p * n
      priced[i] += n
    })
  }
  const points = at.map((day, i) => ({ day, usd: Math.round(usd[i] * 100) / 100, priced: priced[i], copies: total }))
  return { points, bucket, historyStart, unpriced, lateCards }
}

/** How the value moved from [fromDay] to [toDay], counting only cards with a price on both days. */
export function likeForLike(tracks: Map<string, PriceTrack>, holdings: Holding[], fromDay: number, toDay: number): { from: number; change: number; percent: number | null } {
  let from = 0
  let change = 0
  for (const h of holdings) {
    const [a, b] = pricesOn(tracks.get(h.id), [fromDay, toDay])
    if (a == null || b == null) continue
    from += a * h.copies
    change += (b - a) * h.copies
  }
  return { from, change, percent: from > 0 ? (change / from) * 100 : null }
}

/**
 * The cards that rose and fell most from [fromDay] to [toDay], by what they did to the value: each
 * from its price on [fromDay], or the first one saved after it. At most [limit] each way.
 */
export function valueMovers(tracks: Map<string, PriceTrack>, holdings: Holding[], fromDay: number, toDay: number, limit = 5): { risers: ValueMover[]; fallers: ValueMover[] } {
  const byId = new Map<string, Holding & { total: number }>()
  for (const h of holdings) {
    const had = byId.get(h.id)
    byId.set(h.id, had ? { ...had, total: had.total + h.copies } : { ...h, total: h.copies })
  }
  const all: ValueMover[] = []
  for (const [id, h] of byId) {
    const t = tracks.get(id)
    const first = firstPricedDay(t)
    if (first == null || first > toDay) continue
    const since = Math.max(fromDay, first)
    const [from, to] = pricesOn(t, [since, toDay])
    if (from == null || to == null || from === to) continue
    const change = Math.round((to - from) * h.total * 100) / 100
    if (change === 0) continue
    all.push({ id, name: h.name, imageUrl: h.imageUrl, copies: h.total, from, to, change, percent: from > 0 ? ((to - from) / from) * 100 : null, sinceDay: since })
  }
  const byName = (a: ValueMover, b: ValueMover) => a.name.localeCompare(b.name)
  return {
    risers: all.filter((m) => m.change > 0).sort((a, b) => b.change - a.change || byName(a, b)).slice(0, limit),
    fallers: all.filter((m) => m.change < 0).sort((a, b) => a.change - b.change || byName(a, b)).slice(0, limit),
  }
}

/** Each binder's value on [toDay], and its change since [fromDay] (cards with a price on both days); dearest first. */
export function binderValues(tracks: Map<string, PriceTrack>, holdings: Holding[], fromDay: number, toDay: number): BinderValue[] {
  const out = new Map<string, BinderValue>()
  for (const h of holdings) {
    const b = out.get(h.binderId) ?? { id: h.binderId, name: h.binderName, usd: 0, change: 0 }
    const [from, to] = pricesOn(tracks.get(h.id), [fromDay, toDay])
    if (to != null) b.usd += to * h.copies
    if (from != null && to != null) b.change += (to - from) * h.copies
    out.set(h.binderId, b)
  }
  const round = (v: number) => Math.round(v * 100) / 100
  return [...out.values()]
    .map((b) => ({ ...b, usd: round(b.usd), change: round(b.change) }))
    .sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name))
}

/**
 * The trend in words, for screen readers: "Collection value from 12 Sep to 7 Oct: up $76.00 (6.2%),
 * from $1,234.00 to $1,310.00. Lowest $1,200.00 on 20 Sep; highest $1,320.00 on 5 Oct."
 */
export function trendSummary(points: SeriesPoint[], money: (usd: number) => string, day: (epochDay: number) => string): string {
  if (points.length === 0) return 'No collection value saved yet.'
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length === 1) return `Collection value on ${day(last.day)}: ${money(last.usd)}.`
  const change = last.usd - first.usd
  const percent = first.usd > 0 ? ` (${Math.abs((change / first.usd) * 100).toFixed(1)}%)` : ''
  const move = change > 0 ? `up ${money(change)}${percent}` : change < 0 ? `down ${money(-change)}${percent}` : 'no change'
  const low = points.reduce((a, b) => (b.usd < a.usd ? b : a))
  const high = points.reduce((a, b) => (b.usd > a.usd ? b : a))
  return `Collection value from ${day(first.day)} to ${day(last.day)}: ${move}, from ${money(first.usd)} to ${money(last.usd)}. ` +
    `Lowest ${money(low.usd)} on ${day(low.day)}; highest ${money(high.usd)} on ${day(high.day)}.`
}

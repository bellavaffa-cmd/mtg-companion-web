// Each card's own price over time, noted in this browser whenever the app already fetches the prices
// of the user's cards (Home working out the collection's value, the price-alert check). Kept for the
// last year, per printing. Nothing goes to a server: a browser's history starts the day it first
// sees the card, and fills in day by day. Mirrors the Android app's data/CardPriceHistory.kt.
//
// Kept in the same shape as the phone's card_price_history.json, only the days a price changed:
//   {"v":1,"cards":{"<scryfallId>":{"l":20364,"p":[[20000,123,456,110],[20012,130,null,110]]}}}
// "l" is the last day the card was seen (an epoch day: days since 1970-01-01); "p" its points, oldest
// first, each [day, usd, usd_foil, eur] in cents (null where Scryfall had no price). A point's
// prices hold until the next point, or to "l". The store is priceHistoryStore.ts (IndexedDB).

/** One day's prices: US dollars (non-foil and foil) and euros; null where there was none. */
export interface PricePoint { day: number; usd: number | null; usdFoil: number | null; eur: number | null }

/** One card's history: the points where its prices changed, oldest first, seen up to [lastDay]. */
export interface PriceTrack { points: PricePoint[]; lastDay: number }

/** Which of a card's prices a chart shows. */
export type PriceKind = 'usd' | 'usdFoil' | 'eur'
export const PRICE_KINDS: PriceKind[] = ['usd', 'usdFoil', 'eur']
export const PRICE_KIND_LABELS: Record<PriceKind, string> = { usd: 'Normal', usdFoil: 'Foil', eur: 'Cardmarket' }

/** How many days of a card's prices are kept. */
export const PRICE_HISTORY_DAYS = 365

const cents = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100)

const samePrices = (a: PricePoint, b: PricePoint) => a.usd === b.usd && a.usdFoil === b.usdFoil && a.eur === b.eur

/** The first day of a track (its oldest point), or its last day when it has none. */
export const firstDay = (t: PriceTrack) => t.points[0]?.day ?? t.lastDay

/** How many days a track covers, counting the first and the last. */
export const trackDays = (t: PriceTrack) => t.lastDay - firstDay(t) + 1

/** Today in this browser's time zone as an epoch day, like the phone's LocalDate.now().toEpochDay(). */
export function epochDay(date = new Date()): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

/**
 * [track] with [seen] noted: a new point only when a price changed (a later note the same day
 * replaces that day's), and nothing older than [keepDays] before it — except the price that held at
 * the start of that window, moved up to its first day. A note older than the last one is ignored.
 */
export function withDay(track: PriceTrack | undefined, seen: PricePoint, keepDays = PRICE_HISTORY_DAYS): PriceTrack {
  const p: PricePoint = { day: seen.day, usd: cents(seen.usd), usdFoil: cents(seen.usdFoil), eur: cents(seen.eur) }
  if (!track || track.points.length === 0) return { points: [p], lastDay: p.day }
  if (p.day < track.lastDay) return track
  const last = track.points[track.points.length - 1]
  let next: PricePoint[]
  if (last.day === p.day) {
    // Noted again today: today's own point is replaced — or dropped, if it's back to yesterday's.
    const before = track.points.slice(0, -1)
    next = before.length > 0 && samePrices(before[before.length - 1], p) ? before : [...before, p]
  } else if (samePrices(last, p)) {
    next = track.points
  } else {
    next = [...track.points, p]
  }
  const start = p.day - (keepDays - 1)
  const held = [...next].reverse().find((q) => q.day <= start)
  next = [...(held ? [{ ...held, day: start }] : []), ...next.filter((q) => q.day > start)]
  return { points: next, lastDay: p.day }
}

/** The [kind] prices to draw, [day, price], oldest first, running on to the last day the card was seen. */
export function priceSeries(track: PriceTrack, kind: PriceKind): [number, number][] {
  const series = track.points.flatMap((p): [number, number][] => (p[kind] == null ? [] : [[p.day, p[kind]!]]))
  if (series.length === 0) return series
  const holdsToEnd = track.points[track.points.length - 1][kind] != null
  const end = series[series.length - 1]
  return holdsToEnd && end[0] < track.lastDay ? [...series, [track.lastDay, end[1]]] : series
}

/** From the first price to the last over a stretch. */
export interface PriceMove { fromDay: number; from: number; toDay: number; to: number; change: number; percent: number | null }

/** How [series] moved from its first price to its last; null when empty. */
export function priceMove(series: [number, number][]): PriceMove | null {
  if (series.length === 0) return null
  const [fromDay, from] = series[0]
  const [toDay, to] = series[series.length - 1]
  return { fromDay, from, toDay, to, change: to - from, percent: from > 0 ? ((to - from) / from) * 100 : null }
}

/** The prices this history has any of, in the order a chart offers them. */
export const kindsIn = (track: PriceTrack): PriceKind[] => PRICE_KINDS.filter((k) => track.points.some((p) => p[k] != null))

/** Scryfall's prices for a card, as it sends them. */
export interface ScryfallPrices { usd?: string | null; usd_foil?: string | null; eur?: string | null }

const num = (v: string | null | undefined) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** [prices] as a point on [day]; null when Scryfall gave none of the three. */
export function pricePointOf(day: number, prices: ScryfallPrices | null | undefined): PricePoint | null {
  const usd = num(prices?.usd)
  const usdFoil = num(prices?.usd_foil)
  const eur = num(prices?.eur)
  return usd == null && usdFoil == null && eur == null ? null : { day, usd, usdFoil, eur }
}

const sameTrack = (a: PriceTrack, b: PriceTrack) =>
  a === b || (a.lastDay === b.lastDay && a.points.length === b.points.length && a.points.every((p, i) => p.day === b.points[i].day && samePrices(p, b.points[i])))

/** [tracks] with [today]'s [prices] (scryfallId → Scryfall's prices) noted. The same map when nothing changed. */
export function withPricesNoted(tracks: Map<string, PriceTrack>, today: number, prices: Map<string, ScryfallPrices | null | undefined>): Map<string, PriceTrack> {
  let out: Map<string, PriceTrack> | null = null
  for (const [id, p] of prices) {
    const point = pricePointOf(today, p)
    if (!point) continue
    const had = tracks.get(id)
    const next = withDay(had, point)
    if (!had || !sameTrack(next, had)) (out ??= new Map(tracks)).set(id, next)
  }
  return out ?? tracks
}

type StoredTrack = { l: number; p: (number | null)[][] }

/** The history as the phone writes it (see the top of this file). */
export function priceHistoryToJson(tracks: Map<string, PriceTrack>): { v: 1; cards: Record<string, StoredTrack> } {
  const c = (v: number | null) => (v == null ? null : Math.round(v * 100))
  const cards: Record<string, StoredTrack> = {}
  for (const [id, t] of tracks) cards[id] = { l: t.lastDay, p: t.points.map((p) => [p.day, c(p.usd), c(p.usdFoil), c(p.eur)]) }
  return { v: 1, cards }
}

/** Reads the shape [priceHistoryToJson] writes; anything it can't read is left out. */
export function priceHistoryFromJson(json: unknown): Map<string, PriceTrack> {
  const out = new Map<string, PriceTrack>()
  const cards = (json as { cards?: unknown } | null)?.cards
  if (!cards || typeof cards !== 'object') return out
  const price = (v: unknown) => (typeof v === 'number' ? v / 100 : null)
  for (const [id, raw] of Object.entries(cards as Record<string, unknown>)) {
    const c = raw as Partial<StoredTrack> | null
    if (!c || !Array.isArray(c.p)) continue
    const points = c.p.flatMap((a): PricePoint[] => (Array.isArray(a) && a.length >= 4 && typeof a[0] === 'number' ? [{ day: a[0], usd: price(a[1]), usdFoil: price(a[2]), eur: price(a[3]) }] : []))
    if (points.length > 0) out.set(id, { points, lastDay: typeof c.l === 'number' ? c.l : points[points.length - 1].day })
  }
  return out
}

// Price targets on the Wishlist: a wishlist card's price alert (CollectionEntry.priceAlert — "tell
// me when it's at or under this"), with two options of its own, and what the Wishlist shows about
// them. When an alert goes off is still priceAlertRules.ts; this is the rest:
//  - "alertAnyPrinting": any printing of the card counts — the cheapest one is checked;
//  - "alertFoilOnly": only a foil copy will do — the foil price is checked;
//  - a target from a percentage off today's price, for the target sheet and "Set targets for all…";
//  - the row's line ("Target $70 · $3.40 to go"), the week's drop and the year's low from the card's
//    own price history (cardPriceHistory.ts), left out when the history doesn't say;
//  - the "Under your price" box: the cards under their target, until "Got it" — and again when the
//    card drops further, or goes back over and comes under again (the notification's own rule).
// Mirrors the Android app's data/WishlistTargets.kt.

import type { Collection, CollectionEntry } from '../types/models'
import { alertStep, memoryKey, type AlertHit } from './priceAlertRules'
import { priceSeries, type PriceTrack } from './cardPriceHistory'
// The scanner's own rule for the same card: either face of a double-faced card counts.
import { sameCard } from '../scan/sight'

/** The chips under the target: so much off today's price. */
export const TARGET_PERCENTS = [10, 20]

/** A target [percent] under [now] (US dollars), to the cent; null without a price. */
export function targetFromPercent(now: number | null | undefined, percent: number): number | null {
  if (now == null || !(now > 0)) return null
  const p = Math.min(Math.max(percent, 0), 99)
  return Math.round(now * (100 - p)) / 100
}

/** One printing's name and prices (US dollars), for "Any printing counts". */
export interface PrintingPrice { name: string; usd: number | null; usdFoil: number | null }

/**
 * The cheapest non-foil and foil prices among [printings] that are the card [name] (each on its
 * own: the cheapest foil may be another printing than the cheapest plain one). Null where none has one.
 */
export function cheapestPrinting(name: string, printings: PrintingPrice[]): [number | null, number | null] {
  let usd: number | null = null
  let foil: number | null = null
  for (const p of printings) {
    if (!sameCard(name, p.name)) continue
    if (p.usd != null && p.usd > 0 && (usd == null || p.usd < usd)) usd = p.usd
    if (p.usdFoil != null && p.usdFoil > 0 && (foil == null || p.usdFoil < foil)) foil = p.usdFoil
  }
  return [usd, foil]
}

/**
 * The targets "Set targets for all…" sets: [percent] off today's price, for every card without a
 * target and with a price (scryfallId → US dollars).
 */
export function targetsForAll(entries: CollectionEntry[], prices: Map<string, number | null>, percent: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) {
    if ((e.priceAlert ?? 0) > 0) continue
    const target = targetFromPercent(prices.get(e.scryfallId), percent)
    if (target != null && target > 0) out.set(e.scryfallId, target)
  }
  return out
}

/**
 * [entry] with its target and options: both options are written (true or false) once a target is
 * set here, so an entry without them was saved by an app that doesn't know them. No target takes
 * the alert off and leaves the options as they were.
 */
export function withTarget(entry: CollectionEntry, usd: number | null, options?: { anyPrinting: boolean; foilOnly: boolean }): CollectionEntry {
  const next = { ...entry }
  if (usd == null || !(usd > 0)) {
    delete next.priceAlert
    return next
  }
  next.priceAlert = usd
  if (options) {
    next.alertAnyPrinting = options.anyPrinting
    next.alertFoilOnly = options.foilOnly
  }
  return next
}

/** The price history's day [days] before [today], or before: what the card cost then; null when the history doesn't go back so far. */
function priceOn(series: [number, number][], day: number): number | null {
  let at: number | null = null
  for (const [d, p] of series) {
    if (d <= day) at = p
    else break
  }
  return at
}

/**
 * How much [track]'s price (foil with [foil]) dropped over the last week, in whole percent: null
 * when it didn't drop, or the history doesn't go back a week.
 */
export function weekDrop(track: PriceTrack | null | undefined, foil: boolean, today: number): number | null {
  if (!track) return null
  const series = priceSeries(track, foil ? 'usdFoil' : 'usd')
  if (series.length === 0) return null
  const then = priceOn(series, today - 7)
  const now = series[series.length - 1][1]
  if (then == null || !(then > 0) || now >= then) return null
  const percent = Math.round(((then - now) / then) * 100)
  return percent >= 1 ? percent : null
}

/** How many days of history "lowest this year" needs before it's said. */
export const YEAR_LOW_DAYS = 30

/** The lowest [track]'s price (foil with [foil]) has been over the history kept (a year); null with under [YEAR_LOW_DAYS] of it. */
export function yearLow(track: PriceTrack | null | undefined, foil: boolean): number | null {
  if (!track || track.lastDay - (track.points[0]?.day ?? track.lastDay) + 1 < YEAR_LOW_DAYS) return null
  const series = priceSeries(track, foil ? 'usdFoil' : 'usd')
  if (series.length === 0) return null
  return Math.min(...series.map(([, p]) => p))
}

/** A price short: "$70" when it's whole, "$3.40" when it isn't. */
export function shortPrice(usd: number, money: (usd: number, whole?: boolean) => string): string {
  const full = money(usd)
  const whole = money(usd, true)
  return full.replace(/[.,]00(?=\D*$)/, '') === whole ? whole : full
}

/** A wishlist row's line under the name: the target and how far off it is. */
export function targetLine(
  target: number | null | undefined,
  price: number | null | undefined,
  dropped: number | null,
  money: (usd: number, whole?: boolean) => string,
): string {
  if (target == null || !(target > 0)) return 'No target · tap to set one'
  const t = `Target ${shortPrice(target, money)}`
  if (price == null) return t
  if (price <= target) return dropped != null ? `${t} · dropped ${dropped}% this week` : `${t} · under your price`
  return `${t} · ${shortPrice(Math.round((price - target) * 100) / 100, money)} to go`
}

/** "8 CARDS · 3 WITH A TARGET" over the Wishlist's rows (shown upper-case). */
export function targetCount(entries: CollectionEntry[]): string {
  const cards = entries.length
  const set = entries.filter((e) => (e.priceAlert ?? 0) > 0).length
  return `${cards} ${cards === 1 ? 'card' : 'cards'} · ${set} with a target`
}

/** What the Wishlist costs: each card's price × the copies wanted (at least one); null before any price is known. */
export function wishlistTotal(entries: CollectionEntry[], prices: Map<string, number | null>): number | null {
  let total = 0
  let any = false
  for (const e of entries) {
    const p = prices.get(e.scryfallId)
    if (p == null) continue
    any = true
    total += p * Math.max(1, e.quantity + e.foilQuantity)
  }
  return any ? Math.round(total * 100) / 100 : null
}

/**
 * The "Under your price" box: wishlist cards under their target now ([hits]), less the ones the user
 * said "Got it" to ([gotIt]: memory key → the price then) — unless it's dropped further since.
 */
export function underYourPrice(hits: AlertHit[], gotIt: Record<string, number>): AlertHit[] {
  return hits.filter((h) => h.watch.direction === 'BELOW' && alertStep(h.watch, h.price, gotIt[memoryKey(h.watch)] ?? null).kind === 'tell')
}

/** [gotIt] with [shown] said "Got it" to. */
export function withGotIt(gotIt: Record<string, number>, shown: AlertHit[]): Record<string, number> {
  const next = { ...gotIt }
  for (const h of shown) next[memoryKey(h.watch)] = h.price
  return next
}

/**
 * [gotIt] less cards no longer under their target ([hits]: all that are, once prices are in) — so
 * one that goes back over and comes under again is shown again. The same object when nothing goes.
 */
export function gotItKept(gotIt: Record<string, number>, hits: AlertHit[]): Record<string, number> {
  const under = new Set(hits.filter((h) => h.watch.direction === 'BELOW').map((h) => memoryKey(h.watch)))
  const keys = Object.keys(gotIt)
  if (keys.every((k) => under.has(k))) return gotIt
  return Object.fromEntries(keys.filter((k) => under.has(k)).map((k) => [k, gotIt[k]]))
}

/**
 * [theirs] with each entry's alert options put back where [source] (the same binder, as this device
 * has it) has them and [theirs] doesn't say — an entry saved by an app that doesn't know them comes
 * without them. The same object when nothing changes.
 */
export function keepAlertOptionsFromOlderApp(source: Collection, theirs: Collection): Collection {
  const mine = new Map(source.entries
    .filter((e) => e.alertAnyPrinting !== undefined || e.alertFoilOnly !== undefined)
    .map((e) => [e.scryfallId, e]))
  const lacking = (e: CollectionEntry) => {
    const m = mine.get(e.scryfallId)
    return !!m && ((e.alertAnyPrinting === undefined && m.alertAnyPrinting !== undefined) || (e.alertFoilOnly === undefined && m.alertFoilOnly !== undefined))
  }
  if (mine.size === 0 || !theirs.entries.some(lacking)) return theirs
  return {
    ...theirs,
    entries: theirs.entries.map((e) => {
      if (!lacking(e)) return e
      const m = mine.get(e.scryfallId)!
      return {
        ...e,
        ...(e.alertAnyPrinting === undefined && m.alertAnyPrinting !== undefined ? { alertAnyPrinting: m.alertAnyPrinting } : {}),
        ...(e.alertFoilOnly === undefined && m.alertFoilOnly !== undefined ? { alertFoilOnly: m.alertFoilOnly } : {}),
      }
    }),
  }
}

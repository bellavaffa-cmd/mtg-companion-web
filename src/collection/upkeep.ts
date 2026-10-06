// Upkeep: how tidy the storage is — "92% of copies have a place" — and the few things worth doing
// this week, each opening the page that does it:
//  - copies with no place (and, when it's known, where most came from: "Most came from last week's
//    import") → Put away;
//  - places with something worth having in them not checked in 90 days → Check;
//  - loans overdue → Remind;
//  - boxes 90% full or more → Split;
//  - deck pull lists started and not finished → Carry on.
// The Android app can also say the count once a week, in a notification; here it's the Upkeep page
// and its count on the Storage tab.
//
// Pure, so it can be tested. Mirrors the Android app's data/Upkeep.kt rule for rule, with the same
// tests (tests/collection/upkeep.test.ts ↔ UpkeepTest.kt).

import type { Collection, Deck } from '../types/models'
import type { PriceTrack } from './cardPriceHistory'
import { unitPrice } from './valueByPlace'
import { nearlyFull, roomLine, spaceOf, spacePercent } from './boxSpace'
import { loanPeople, type NightDay } from './loans'
import { pulledCopies, pullList } from './pullList'
import { placedPercent } from './storageSetup'
import { cardsIn, lentByEntry, lentCopies, lentOf, lentTag, loansOf, placedCopies, placeAndInside, placesOf, placeTree, stillOut, storageSummary } from './storagePlaces'

/** A place not checked for this many days, with something of value in it, is worth checking. */
export const CHECK_AFTER_DAYS = 90
/** At most this many places to check at once — the most valuable. */
export const MAX_CHECKS = 3

const DAY_MS = 86_400_000

export type UpkeepKind = 'PUT_AWAY' | 'CHECK' | 'REMIND' | 'SPLIT' | 'CARRY_ON'

/**
 * One thing worth doing: "Red box is 96% full" / "Room for about 28 more" / Split. [placeId] for
 * Check and Split, [personKey] (LoanPerson.key) for Remind, [deckId] for Carry on.
 */
export interface UpkeepItem {
  kind: UpkeepKind
  title: string
  detail: string
  action: string
  placeId?: string
  personKey?: string
  deckId?: string
}

/** The last import in this browser: when, how many copies, and into which binder. */
export interface ImportNote { at: number; copies: number; collectionId: string }

/** A deck's pull list with some rows ticked ([ticked], pullProgress.ts), and since when — left out when not known. */
export interface PullUnderway { deckId: string; ticked: string[]; startedAt?: number }

export interface UpkeepReport { percent: number; total: number; placed: number; items: UpkeepItem[] }

/** "4 things worth doing this week"; "Nothing to do this week" when there's none. */
export function upkeepHeadline(count: number): string {
  if (count === 0) return 'Nothing to do this week'
  return count === 1 ? '1 thing worth doing this week' : `${count} things worth doing this week`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A day as a number — the device's own calendar, or [utc]'s (for tests) — with its parts. */
function dayOf(ms: number, utc: boolean): { n: number; date: number; month: number; weekday: number } {
  const d = new Date(ms)
  const [y, m, date, weekday] = utc ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCDay()] : [d.getFullYear(), d.getMonth(), d.getDate(), d.getDay()]
  return { n: Math.round(Date.UTC(y, m, date) / DAY_MS), date, month: m, weekday }
}

/** When an import was, as "Most came from …": "today's import", "yesterday's import", "this week's import", "last week's import", "the import on 3 Oct". */
export function importWhen(at: number, now: number, utc = false): string {
  const d = dayOf(at, utc)
  const days = dayOf(now, utc).n - d.n
  if (days <= 0) return "today's import"
  if (days === 1) return "yesterday's import"
  if (days < 7) return "this week's import"
  if (days < 14) return "last week's import"
  return `the import on ${d.date} ${MONTHS[d.month]}`
}

/** When a pull list was started: "today", "yesterday", "Tuesday" within the week, else "3 Oct". */
export function startedWhen(at: number, now: number, utc = false): string {
  const d = dayOf(at, utc)
  const days = dayOf(now, utc).n - d.n
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return WEEKDAYS[d.weekday]
  return `${d.date} ${MONTHS[d.month]}`
}

/** "half done" and the like, for a pull list [pulled] of [total] through. */
export function pullStage(pulled: number, total: number): string {
  const share = total > 0 ? pulled / total : 0
  if (share >= 0.75) return 'nearly done'
  if (share >= 0.4) return 'half done'
  return 'started'
}

/** "Krenko deck" — a deck called "Krenko deck" isn't "Krenko deck deck". */
export const deckTitle = (name: string): string => (/\bdeck$/i.test(name.trim()) ? name.trim() : `${name.trim()} deck`)

/** "Priya's", "James'". */
export const possessive = (name: string): string => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`)

/**
 * Where most of the copies with no place came from: the last import when it brought in as many as
 * half of them ("Most came from last week's import"), else the binder holding most of them ("Most are
 * in Unsorted"), else the binders holding them ("In Unsorted and Trade binder"). '' when none.
 */
export function unplacedHint(collections: Collection[], decks: Deck[], lastImport: ImportNote | null, now: number, utc = false): string {
  const known = new Set(placesOf(collections).map((p) => p.id))
  const lent = lentByEntry(lentCopies(collections, decks))
  const byBinder = new Map<string, number>()
  let all = 0
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      if (lentTag(e)) continue
      const copies = e.quantity + (e.foilQuantity ?? 0)
      const placed = placedCopies(e).filter((l) => known.has(l.placeId)).reduce((n, l) => n + l.qty, 0)
      const out = lentOf(lent, c.id, e)
      const n = copies - placed - out.plain - out.foil
      if (n <= 0) continue
      byBinder.set(c.id, (byBinder.get(c.id) ?? 0) + n)
      all += n
    }
  }
  if (all <= 0) return ''
  if (lastImport && lastImport.copies * 2 >= all && (byBinder.get(lastImport.collectionId) ?? 0) * 2 >= all) {
    return `Most came from ${importWhen(lastImport.at, now, utc)}`
  }
  const name = (id: string) => collections.find((c) => c.id === id)?.name ?? 'a binder'
  const sorted = [...byBinder].sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  if (!top) return ''
  if (top[1] * 2 > all) return `Most are in ${name(top[0])}`
  const names = sorted.map(([id]) => name(id))
  return names.length === 2 ? `In ${names[0]} and ${names[1]}` : `In ${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/** One copy's price in US dollars (foil or not), null when not known. */
export type PriceOf = (scryfallId: string, foil: boolean) => number | null | undefined

/** One copy's price from the prices noted for the price history (priceHistoryStore.ts): the latest known. */
export function priceFromHistory(tracks: Map<string, PriceTrack>): PriceOf {
  return (id, foil) => {
    const points = tracks.get(id)?.points ?? []
    const p = [...points].reverse().find((x) => x.usd != null || x.usdFoil != null)
    return unitPrice(p ? { set: '', number: '', usd: p.usd, usdFoil: p.usdFoil } : undefined, foil)
  }
}

/** What's in [placeId] and every place inside it is worth, in US dollars (copies with no price count nothing). */
export function valueWithin(collections: Collection[], placeId: string, price: PriceOf): number {
  let usd = 0
  for (const id of placeAndInside(placesOf(collections), placeId)) {
    for (const c of cardsIn(collections, id)) usd += (price(c.entry.scryfallId, !!c.line.foil) ?? 0) * c.line.qty
  }
  return usd
}

const dollars = (usd: number) => `$${Math.round(usd).toLocaleString('en-GB')}`

export interface UpkeepInput {
  collections: Collection[]
  decks: Deck[]
  now: number
  /** The device's day, "2026-10-06". */
  today: string
  /** Game nights, for loans due at the next one. */
  nights?: NightDay[]
  pulls?: PullUnderway[]
  lastImport?: ImportNote | null
  price?: PriceOf
  /** Writes an amount the way the app shows prices. */
  money?: (usd: number) => string
  /** Count days in UTC rather than the device's own calendar (for tests). */
  utc?: boolean
}

/** Everything worth doing this week. */
export function upkeep({ collections, decks, now, today, nights = [], pulls = [], lastImport = null, price = () => null, money = dollars, utc = false }: UpkeepInput): UpkeepReport {
  const summary = storageSummary(collections, decks)
  const places = placesOf(collections)
  const items: UpkeepItem[] = []

  if (summary.unplaced > 0) {
    items.push({
      kind: 'PUT_AWAY',
      title: `${summary.unplaced} ${summary.unplaced === 1 ? 'copy has' : 'copies have'} no place`,
      detail: unplacedHint(collections, decks, lastImport, now, utc),
      action: 'Put away',
    })
  }

  const stale = places.filter((p) => p.kind !== 'DECK_BOX').flatMap((p) => {
    const since = p.lastChecked ?? (p.createdAt > 0 ? p.createdAt : null)
    if (since == null) return []
    const days = Math.floor((now - since) / DAY_MS)
    if (days < CHECK_AFTER_DAYS) return []
    // Only the place's own copies: a shelf's boxes are checked one by one.
    const value = cardsIn(collections, p.id).reduce((n, c) => n + (price(c.entry.scryfallId, !!c.line.foil) ?? 0) * c.line.qty, 0)
    return value > 0 ? [{ p, days, value }] : []
  }).sort((a, b) => b.value - a.value).slice(0, MAX_CHECKS)
  for (const { p, days, value } of stale) {
    items.push({
      kind: 'CHECK',
      title: p.lastChecked == null ? `${p.name} never checked` : `${p.name} not checked in ${days} days`,
      detail: `${money(value)} inside`,
      action: 'Check',
      placeId: p.id,
    })
  }

  for (const person of loanPeople(loansOf(collections), today, nights)) {
    if (person.overdue <= 0) continue
    const usd = person.loans.reduce((n, l) => n + l.cards.reduce((m, c) => m + (price(c.scryfallId, !!c.foil) ?? 0) * stillOut(c), 0), 0)
    const cards = `${person.copies} ${person.copies === 1 ? 'card' : 'cards'}`
    items.push({
      kind: 'REMIND',
      title: `${possessive(person.name)} ${person.loans.length === 1 ? 'loan is' : 'loans are'} ${person.overdue} ${person.overdue === 1 ? 'day' : 'days'} late`,
      detail: usd > 0 ? `${cards} · ${money(usd)}` : cards,
      action: 'Remind',
      personKey: person.key,
    })
  }

  for (const { place: p } of placeTree(places)) {
    if (p.kind === 'BINDER') continue
    const space = spaceOf(p, collections)
    if (!space || !nearlyFull(space)) continue
    items.push({ kind: 'SPLIT', title: `${p.name} is ${spacePercent(space)}% full`, detail: roomLine(space).replace(/\.$/, ''), action: 'Split', placeId: p.id })
  }

  for (const u of [...pulls].sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))) {
    const deck = decks.find((d) => d.id === u.deckId)
    if (!deck) continue
    const list = pullList(deck, collections, decks)
    const pulled = pulledCopies(list.groups.flatMap((g) => g.rows), new Set(u.ticked))
    if (pulled <= 0 || pulled >= list.total) continue
    const started = u.startedAt != null ? `, started ${startedWhen(u.startedAt, now, utc)}` : ''
    items.push({
      kind: 'CARRY_ON',
      title: `${deckTitle(deck.name)} pull list ${pullStage(pulled, list.total)}`,
      detail: `${pulled} of ${list.total} pulled${started}`,
      action: 'Carry on',
      deckId: deck.id,
    })
  }

  return { percent: placedPercent(summary), total: summary.total, placed: summary.placed, items }
}

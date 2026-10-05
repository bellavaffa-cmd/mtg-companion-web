// Checking a place: scan everything in a box, a section of it or a binder, and see what's where it
// should be, what's missing (listed here, not scanned) and what's extra (scanned here, but listed
// somewhere else or not at all).
//  - A scan counts against the copies listed here by printing when the scanner was sure of it, by
//    name otherwise; and by finish when it says foil or plain — the scanner can't see foil, so its
//    scans match either and the results say so.
//  - Missing copies stay where they're listed until the user says otherwise: Mark No place yet takes
//    their place away, Remove from collection takes them out of the collection.
//  - Record them here gives the extra cards this place: a copy with no place first, then one from
//    another place (as putting a card away does); a card only a deck has is taken out of the deck
//    only when the user says so, and a card not in the collection is added to the Unsorted pile.
//  - Save results notes when the place was last checked, on the place ("lastChecked", milliseconds).
//    It only ever moves on: two devices' checks merge to the later one, and a place saved by an app
//    that doesn't know about it keeps it (see mergePlaceLists and keepLastChecked in storagePlaces.ts).
//
// Pure, so it can be tested. Mirrors the Android app's data/PlaceCheck.kt rule for rule, with the
// same tests (tests/collection/placeCheck.test.ts ↔ PlaceCheckTest.kt).

import type { Collection, CollectionEntry, CopyPlace, Deck } from '../types/models'
import { proxyCopies } from '../decks/proxies'
import {
  addedHere, cardsIn, moveCopies, parentsOf, placeAndInside, placedCopies, placesOf, placeTree, pocketLabel, putAway,
  sameCardName, savePlace, suggestSpot, tidied, unplacedCopies, type Spot,
} from './storagePlaces'
import { realCopiesOf } from './unsorted'

/** What's being checked: a place, or one section of it. */
export interface CheckScope { placeId: string; section: string | null }

/** One card scanned while checking. [foil] null: the scanner couldn't tell. [exact]: it was sure of the printing. */
export interface CheckScan {
  scryfallId: string
  name: string
  imageUrl: string | null
  foil: boolean | null
  exact: boolean
}

/**
 * What a scan turned out to be: HERE "belongs here"; SECTION "should be in Blue" (this place, another
 * section); UNPLACED "no place yet"; ELSEWHERE "listed in Red box › Blue"; DECK "listed in Krenko
 * deck"; EXTRA "one more than listed here" or "another printing is listed here"; UNKNOWN "not in your
 * collection".
 */
export type CheckKind = 'HERE' | 'SECTION' | 'UNPLACED' | 'ELSEWHERE' | 'DECK' | 'EXTRA' | 'UNKNOWN'

export interface CheckLine {
  scan: CheckScan
  kind: CheckKind
  label: string
  /** DECK: the deck that lists it. */
  deckId?: string
}

/** Copies listed at one spot in the place: what's expected, or (in the results) what wasn't scanned. */
export interface ListedCopies {
  collectionId: string
  scryfallId: string
  name: string
  line: CopyPlace
  qty: number
}

export interface CheckResult {
  /** Every scan, in the order scanned, with what it was. */
  lines: CheckLine[]
  /** Copies listed in what's checked. */
  expected: number
  /** Scans that belong here. */
  here: number
  /** Copies listed here and not scanned, spot by spot. */
  missing: ListedCopies[]
  missingCount: number
  /** Scans that don't belong here. */
  extra: CheckLine[]
  /** Some scans couldn't tell foil, so foil and plain copies were counted together. */
  foilIgnored: boolean
}

const sameSection = (a: string | undefined, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/** The place ids a check covers: the place and the places inside it, or only the place for one section. */
function scopeIds(collections: Collection[], scope: CheckScope): Set<string> {
  return scope.section !== null ? new Set([scope.placeId]) : placeAndInside(placesOf(collections), scope.placeId)
}

/** Every line of copies listed in what's checked, place by place (in tree order), each by card name. */
export function listedIn(collections: Collection[], scope: CheckScope): ListedCopies[] {
  const ids = scopeIds(collections, scope)
  const order = [scope.placeId, ...placeTree(placesOf(collections)).map((n) => n.place.id).filter((id) => id !== scope.placeId && ids.has(id))]
  return order.flatMap((id) => cardsIn(collections, id))
    .filter((c) => scope.section === null || sameSection(c.line.section, scope.section))
    .map((c) => ({ collectionId: c.collectionId, scryfallId: c.entry.scryfallId, name: c.entry.name, line: c.line, qty: c.line.qty }))
}

/** Whether a copy of [scryfallId] / [name] is the card scanned: the same printing when it was sure, the same card otherwise. */
const isCard = (scan: CheckScan, scryfallId: string, name: string) => (scan.exact ? scryfallId === scan.scryfallId : sameCardName(name, scan.name))

const ownedOnly = (collections: Collection[]) => collections.filter((c) => c.type !== 'WISHLIST')

/** "listed in Krenko deck" — or "listed in Goblin deck" for a deck already called that. */
const deckWords = (name: string) => (/\bdeck$/i.test(name.trim()) ? `listed in ${name.trim()}` : `listed in ${name.trim()} deck`)

/** Where a scan that doesn't belong here is listed instead. [listed]: what's checked, with what's left of each. */
function elsewhere(collections: Collection[], decks: Deck[], scope: CheckScope, scan: CheckScan, listed: ListedCopies[]): Omit<CheckLine, 'scan'> {
  const places = placesOf(collections)
  const byId = new Map(places.map((p) => [p.id, p]))
  const ids = scopeIds(collections, scope)
  // In this place, another section.
  if (scope.section !== null) {
    for (const c of cardsIn(collections, scope.placeId)) {
      if (!isCard(scan, c.entry.scryfallId, c.entry.name) || sameSection(c.line.section, scope.section)) continue
      if (scan.foil !== null && !!c.line.foil !== scan.foil) continue
      const place = byId.get(scope.placeId)
      return { kind: 'SECTION', label: c.line.section ? `should be in ${c.line.section}` : `listed in ${place?.name ?? 'this place'}, no section` }
    }
  }
  const mine = ownedOnly(collections)
  // A copy with no place yet.
  for (const c of mine) for (const e of c.entries) {
    if (!isCard(scan, e.scryfallId, e.name)) continue
    const free = unplacedCopies(knownOnly(e, places.map((p) => p.id)))
    if ((scan.foil === true ? free.foil : scan.foil === false ? free.plain : free.plain + free.foil) > 0) return { kind: 'UNPLACED', label: 'no place yet' }
  }
  // Another place.
  for (const node of placeTree(places)) {
    if (ids.has(node.place.id)) continue
    for (const c of cardsIn(collections, node.place.id)) {
      if (!isCard(scan, c.entry.scryfallId, c.entry.name)) continue
      if (scan.foil !== null && !!c.line.foil !== scan.foil) continue
      const path = [...parentsOf(places, node.place.id).map((p) => p.name), node.place.name].join(' › ')
      return { kind: 'ELSEWHERE', label: `listed in ${c.line.section ? `${path} › ${c.line.section}` : path}` }
    }
  }
  // A deck.
  for (const d of decks) {
    if (realCopiesOf(d).some((e) => isCard(scan, e.scryfallId, e.name))) return { kind: 'DECK', label: deckWords(d.name), deckId: d.id }
  }
  if (listed.some((l) => isCard(scan, l.scryfallId, l.name))) return { kind: 'EXTRA', label: 'one more than listed here' }
  if (listed.some((l) => sameCardName(l.name, scan.name))) return { kind: 'EXTRA', label: 'another printing is listed here' }
  return { kind: 'UNKNOWN', label: 'not in your collection' }
}

/** [e] with only the lines in places that still exist — a line in a deleted place has no place. */
function knownOnly(e: CollectionEntry, known: string[]): CollectionEntry {
  const placed = placedCopies(e)
  return placed.every((p) => known.includes(p.placeId)) ? e : { ...e, places: placed.filter((p) => known.includes(p.placeId)) }
}

/** Which scans match first: sure of the printing and the finish, then of the printing, then the rest. */
const sureness = (scan: CheckScan) => (scan.exact ? 0 : 2) + (scan.foil === null ? 1 : 0)

/**
 * The check so far: each scan matched against the copies listed in what's checked — the scans sure
 * of their printing first, each in the order scanned; that printing first (any printing of the card
 * when the scanner wasn't sure), plain before foil when it couldn't tell — then what's left over.
 */
export function reconcile(collections: Collection[], decks: Deck[], scope: CheckScope, scans: CheckScan[]): CheckResult {
  const listed = listedIn(collections, scope)
  const left = listed.map((l) => l.qty)
  const lines: (CheckLine | null)[] = scans.map(() => null)
  // Scans sure of their printing and finish claim their copies first, then the ones that aren't.
  const order = scans.map((scan, i) => ({ scan, i })).sort((a, b) => sureness(a.scan) - sureness(b.scan) || a.i - b.i)
  for (const { scan, i } of order) {
    let found = -1
    const passes: ((l: ListedCopies) => boolean)[] = [
      (l) => l.scryfallId === scan.scryfallId,
      ...(scan.exact ? [] : [(l: ListedCopies) => sameCardName(l.name, scan.name)]),
    ]
    const finishes = scan.foil === null ? [false, true] : [scan.foil]
    search: for (const pass of passes) {
      for (const foil of finishes) {
        found = listed.findIndex((l, i) => left[i] > 0 && !!l.line.foil === foil && pass(l))
        if (found >= 0) break search
      }
    }
    if (found >= 0) {
      left[found]--
      lines[i] = { scan, kind: 'HERE', label: 'belongs here' }
    } else {
      lines[i] = { scan, ...elsewhere(collections, decks, scope, scan, listed) }
    }
  }
  const missing = listed.flatMap((l, i) => (left[i] > 0 ? [{ ...l, qty: left[i] }] : []))
  const done = lines as CheckLine[]
  return {
    lines: done,
    expected: listed.reduce((n, l) => n + l.qty, 0),
    here: done.filter((l) => l.kind === 'HERE').length,
    missing,
    missingCount: missing.reduce((n, m) => n + m.qty, 0),
    extra: done.filter((l) => l.kind !== 'HERE'),
    foilIgnored: scans.some((s) => s.foil === null),
  }
}

/** Where a missing line is, short: "Red", "Page 3, slot 5", or '' when it's just in the place. */
export const listedWhere = (l: ListedCopies): string =>
  l.line.page && l.line.slot ? pocketLabel(l.line.page, l.line.slot) : l.line.section ?? ''

// ---- What to do about it ----

function mapEntry(collections: Collection[], collectionId: string, scryfallId: string, fn: (e: CollectionEntry) => CollectionEntry): Collection[] {
  return collections.map((c) => (c.id !== collectionId ? c : { ...c, entries: c.entries.map((e) => (e.scryfallId === scryfallId ? fn(e) : e)) }))
}

/** Mark No place yet: the missing copies keep being in the collection, with no place. */
export function markNoPlace(collections: Collection[], missing: ListedCopies[]): Collection[] {
  let out = collections
  for (const m of missing) out = mapEntry(out, m.collectionId, m.scryfallId, (e) => moveCopies(e, m.line, null, m.qty).entry)
  return out
}

/** Remove from collection: the missing copies go, and an entry left with none goes too. */
export function removeMissing(collections: Collection[], missing: ListedCopies[]): Collection[] {
  let out = collections
  for (const m of missing) {
    const c = out.find((x) => x.id === m.collectionId)
    const e = c?.entries.find((x) => x.scryfallId === m.scryfallId)
    if (!c || !e) continue
    const { entry, moved } = moveCopies(e, m.line, null, m.qty)
    if (moved === 0) continue
    const foil = !!m.line.foil
    const smaller = tidied({ ...entry, quantity: entry.quantity - (foil ? 0 : moved), foilQuantity: (entry.foilQuantity ?? 0) - (foil ? moved : 0) })
    const gone = smaller.quantity <= 0 && (smaller.foilQuantity ?? 0) <= 0
    out = out.map((x) => (x.id !== c.id ? x : {
      ...x,
      entries: gone ? x.entries.filter((y) => y.scryfallId !== e.scryfallId) : x.entries.map((y) => (y.scryfallId === e.scryfallId ? smaller : y)),
    }))
  }
  return out
}

/** One copy of [scan]'s card taken out of the deck [deckId] — its real copies, not its proxies. */
function takeFromDeck(decks: Deck[], deckId: string, scan: CheckScan): { decks: Deck[]; taken: boolean } {
  const deck = decks.find((d) => d.id === deckId)
  if (!deck) return { decks, taken: false }
  const real = (e: Deck['cards'][number]) => e.quantity - proxyCopies(deck, e) > 0
  const card = deck.cards.find((e) => e.scryfallId === scan.scryfallId && real(e)) ?? deck.cards.find((e) => sameCardName(e.name, scan.name) && real(e))
  if (!card) return { decks, taken: false }
  const cards = card.quantity <= 1
    ? deck.cards.filter((e) => e !== card)
    : deck.cards.map((e) => (e !== card ? e : {
      ...e,
      quantity: e.quantity - 1,
      ...(e.proxyQuantity !== undefined && e.proxyQuantity !== null ? { proxyQuantity: Math.min(e.proxyQuantity, e.quantity - 1) } : {}),
    }))
  return { decks: decks.map((d) => (d.id === deckId ? { ...d, cards } : d)), taken: true }
}

/** Where a recorded card goes: the section checked, a binder's pocket (or none, for a binder in order), or just the place. */
function spotFor(collections: Collection[], scope: CheckScope): Spot {
  const place = placesOf(collections).find((p) => p.id === scope.placeId)
  if (scope.section !== null) return { placeId: scope.placeId, section: scope.section }
  if (place?.kind === 'BINDER') return suggestSpot(place, null, collections).spot
  return { placeId: scope.placeId }
}

/**
 * Record them here: each extra scan given this place. A card listed in another section of this place
 * moves section; a copy with no place gets this one, else a copy from another place moves here (as
 * putting a card away does); a card only a deck has comes out of the deck only when [takeFromDecks];
 * one more than listed here, or one not in the collection, is added to the Unsorted pile, here.
 * Also how many were recorded and how many were left in their decks.
 */
export function recordHere(
  collections: Collection[], decks: Deck[], scope: CheckScope, extras: CheckLine[], takeFromDecks: boolean,
): { collections: Collection[]; decks: Deck[]; recorded: number; leftInDecks: number } {
  let cols = collections
  let ds = decks
  let recorded = 0
  let leftInDecks = 0
  for (const x of extras) {
    if (x.kind === 'HERE') continue
    const { scan } = x
    const foil = scan.foil ?? false
    const spot = spotFor(cols, scope)
    const newEntry: CollectionEntry = { scryfallId: scan.scryfallId, name: scan.name, imageUrl: scan.imageUrl, quantity: 0, foilQuantity: 0 }
    if (x.kind === 'DECK') {
      if (!takeFromDecks || !x.deckId) { leftInDecks++; continue }
      const out = takeFromDeck(ds, x.deckId, scan)
      if (!out.taken) { leftInDecks++; continue }
      ds = out.decks
      cols = addedHere(cols, { id: scan.scryfallId }, spot, newEntry, foil).collections
      recorded++
      continue
    }
    if (x.kind === 'SECTION') {
      const other = cardsIn(cols, scope.placeId).find((c) =>
        isCard(scan, c.entry.scryfallId, c.entry.name) && !sameSection(c.line.section, scope.section) && (scan.foil === null || !!c.line.foil === scan.foil))
      if (other) {
        cols = mapEntry(cols, other.collectionId, other.entry.scryfallId, (e) => moveCopies(e, other.line, spot, 1).entry)
        recorded++
        continue
      }
    }
    const o = putAway(cols, { id: scan.scryfallId, name: scan.name }, spot, newEntry, foil)
    cols = o.result === 'here' ? addedHere(cols, { id: scan.scryfallId }, spot, newEntry, foil).collections : o.collections
    recorded++
  }
  return { collections: cols, decks: ds, recorded, leftInDecks }
}

/** Save results: the place was checked at [at]. */
export function markChecked(collections: Collection[], placeId: string, at: number): Collection[] {
  const place = placesOf(collections).find((p) => p.id === placeId)
  if (!place) return collections
  return savePlace(collections, { ...place, lastChecked: Math.max(at, place.lastChecked ?? 0) })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** When a place was last checked, as the place page says it: "today", "yesterday", "3 days ago", "5 Oct 2026". */
export function lastCheckedLabel(at: number, now: number): string {
  const a = new Date(at)
  const b = new Date(now)
  const days = Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`
}

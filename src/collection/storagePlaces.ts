// Storage places: the boxes, binders and shelves the cards physically sit in, and which copies are
// where. Places nest ("Shelf, study › Red box"); a binder has pages of pockets, a box has sections
// and may have a sorting rule that suggests where a new card goes ("Red › around “L”").
//
// Where things are kept, as JSON (see types/models.ts):
//  - The places themselves: the Unsorted pile's "storagePlaces" — the pile is always there and has
//    the same id on every device, so they sync with the library like any binder does.
//  - Which copies are where: each binder entry's "places", [{placeId, qty, foil?, section?, page?,
//    slot?}]. Never more than the entry's copies, plain and foil apart; the rest have no place yet.
//  - Physical decks and copies out on loan count as places of their own, read from the decks and the
//    loans (the Unsorted pile's "loans", see loans.ts) rather than stored — and, until they're turned
//    into loans, copies tagged "lent to …".
//
// Pure, so it can be tested. Mirrors the Android app's data/StoragePlaces.kt rule for rule, with the
// same tests (tests/collection/storagePlaces.test.ts ↔ StoragePlacesTest.kt).

import {
  isUnsorted, UNSORTED_COLLECTION_ID,
  type Collection, type CollectionEntry, type CopyPlace, type Deck, type Loan, type LoanCard, type PlaceKind, type SortRule, type StoragePlace,
} from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { realCopiesOf, withUnsortedPile } from './unsorted'

export const PLACE_KINDS: PlaceKind[] = ['BOX', 'BINDER', 'DECK_BOX', 'SHELF', 'OTHER']
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = { BOX: 'Box', BINDER: 'Binder', DECK_BOX: 'Deck box', SHELF: 'Shelf', OTHER: 'Other' }
export const SORT_RULES: SortRule[] = ['COLOUR', 'SET', 'TYPE', 'NAME']
export const SORT_RULE_LABELS: Record<SortRule, string> = {
  COLOUR: 'By colour, then A–Z', SET: 'By set, then number', TYPE: 'By type, then A–Z', NAME: 'A–Z',
}
/** The same, inside a line: "Bulk · by colour, then A–Z". */
const SORT_RULE_SHORT: Record<SortRule, string> = {
  COLOUR: 'by colour, then A–Z', SET: 'by set, then number', TYPE: 'by type, then A–Z', NAME: 'A–Z',
}
/** A binder's pockets per page unless it says otherwise. */
export const DEFAULT_POCKETS = 9
export const COLOUR_SECTIONS = ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolour', 'Colourless', 'Lands']
export const TYPE_SECTIONS = ['Creatures', 'Planeswalkers', 'Battles', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Other']

/** The sections a new box sorted by [rule] starts with. */
export const defaultSections = (rule: SortRule | null | undefined): string[] =>
  rule === 'COLOUR' ? COLOUR_SECTIONS : rule === 'TYPE' ? TYPE_SECTIONS : []

export const pocketsOf = (place: StoragePlace): number =>
  place.pocketsPerPage && place.pocketsPerPage > 0 ? place.pocketsPerPage : DEFAULT_POCKETS

// ---- The places ----

/** The user's places, kept on the Unsorted pile. */
export function placesOf(collections: Collection[]): StoragePlace[] {
  return collections.find(isUnsorted)?.storagePlaces ?? []
}

/** [collections] with the places set to [places] (on the Unsorted pile, made if it isn't there). */
export function withPlaceList(collections: Collection[], places: StoragePlace[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, storagePlaces: places } : c))
}

/** A place written as both apps write it: optional fields left out when not set. */
export function storagePlace(p: StoragePlace): StoragePlace {
  return {
    id: p.id,
    name: p.name,
    kind: PLACE_KINDS.includes(p.kind) ? p.kind : 'OTHER',
    ...(p.parentId ? { parentId: p.parentId } : {}),
    ...(p.note?.trim() ? { note: p.note.trim() } : {}),
    ...(p.sections && p.sections.length > 0 ? { sections: p.sections } : {}),
    ...(p.pocketsPerPage && p.pocketsPerPage > 0 ? { pocketsPerPage: p.pocketsPerPage } : {}),
    ...(p.sortRule && SORT_RULES.includes(p.sortRule) ? { sortRule: p.sortRule } : {}),
    createdAt: p.createdAt,
    ...(p.lastChecked && p.lastChecked > 0 ? { lastChecked: p.lastChecked } : {}),
    // A size taken off stays as 0, so an older app's save can be told from it (keepPlaceSizes).
    ...(typeof p.capacity === 'number' ? { capacity: Math.max(0, p.capacity) } : {}),
    ...(typeof p.pages === 'number' ? { pages: Math.max(0, p.pages) } : {}),
  }
}

/** [collections] with [place] added, or put in place of the one with its id. */
export function savePlace(collections: Collection[], place: StoragePlace): Collection[] {
  const places = placesOf(collections)
  const clean = storagePlace(place)
  const next = places.some((p) => p.id === place.id) ? places.map((p) => (p.id === place.id ? clean : p)) : [...places, clean]
  return withPlaceList(collections, next)
}

/** Whether [id]'s chain of parents comes back round to it (two devices each moved one into the other). */
function inLoop(byId: Map<string, StoragePlace>, id: string): boolean {
  const seen = new Set<string>()
  let p = byId.get(id)?.parentId
  while (p && byId.has(p)) {
    if (p === id) return true
    if (seen.has(p)) return false
    seen.add(p)
    p = byId.get(p)!.parentId
  }
  return false
}

/** The place [id] sits in, or null at the top — also for a parent that's gone, or a loop. */
export function parentOf(places: StoragePlace[], id: string): string | null {
  const byId = new Map(places.map((p) => [p.id, p]))
  const parent = byId.get(id)?.parentId
  return parent && byId.has(parent) && !inLoop(byId, id) ? parent : null
}

const byAge = (a: StoragePlace, b: StoragePlace) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export interface PlaceNode { place: StoragePlace; depth: number }

/** Every place, each followed by the places inside it, oldest first at each level. */
export function placeTree(places: StoragePlace[]): PlaceNode[] {
  const kids = new Map<string | null, StoragePlace[]>()
  for (const p of places) {
    const parent = parentOf(places, p.id)
    kids.set(parent, [...(kids.get(parent) ?? []), p])
  }
  const out: PlaceNode[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const p of [...(kids.get(parent) ?? [])].sort(byAge)) {
      out.push({ place: p, depth })
      walk(p.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** The places directly inside [id] (null: the top level), oldest first. */
export const childrenOf = (places: StoragePlace[], id: string | null): StoragePlace[] =>
  places.filter((p) => parentOf(places, p.id) === id).sort(byAge)

/** [id] and every place inside it, however deep. */
export function placeAndInside(places: StoragePlace[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of places) {
      const parent = parentOf(places, p.id)
      if (parent && out.has(parent) && !out.has(p.id)) { out.add(p.id); grew = true }
    }
  }
  return out
}

/** The places [id] sits in, outermost first. */
export function parentsOf(places: StoragePlace[], id: string): StoragePlace[] {
  const out: StoragePlace[] = []
  let p = parentOf(places, id)
  while (p) {
    const place = places.find((x) => x.id === p)
    if (!place || out.includes(place)) break
    out.unshift(place)
    p = parentOf(places, p)
  }
  return out
}

/** "Shelf, study › Red box". */
export function placePath(places: StoragePlace[], id: string): string {
  const place = places.find((p) => p.id === id)
  return [...parentsOf(places, id), ...(place ? [place] : [])].map((p) => p.name).join(' › ')
}

/** Whether [id] can go inside [parentId] (null: the top level) — not inside itself or a place within it. */
export const canMoveInto = (places: StoragePlace[], id: string, parentId: string | null): boolean =>
  parentId === null || (places.some((p) => p.id === parentId) && !placeAndInside(places, id).has(parentId))

/** "Bulk · by colour, then A–Z", "Binder · 9 per page". */
export function placeSubtitle(place: StoragePlace): string {
  const parts = [place.note?.trim() || PLACE_KIND_LABELS[place.kind] || 'Other']
  if (place.kind === 'BINDER') parts.push(`${pocketsOf(place)} per page`)
  if (place.sortRule) parts.push(SORT_RULE_SHORT[place.sortRule])
  return parts.join(' · ')
}

/**
 * [collections] without the place [id]: the places inside it move up to where it was, and its
 * copies have no place any more.
 */
export function deletePlace(collections: Collection[], id: string): Collection[] {
  const places = placesOf(collections)
  const gone = places.find((p) => p.id === id)
  if (!gone) return collections
  const up = parentOf(places, id)
  const next = places.filter((p) => p.id !== id).map((p) => {
    if (p.parentId !== id) return p
    const { parentId: _old, ...rest } = p
    return up ? { ...rest, parentId: up } : rest
  })
  const emptied = collections.map((c) => {
    if (!c.entries.some((e) => e.places?.some((p) => p.placeId === id))) return c
    return { ...c, entries: c.entries.map((e) => (e.places?.some((p) => p.placeId === id) ? withPlaces(e, (e.places ?? []).filter((p) => p.placeId !== id)) : e)) }
  })
  return withPlaceList(emptied, next)
}

// ---- Copies and their places ----

/** Where in a place: a box's section, or a binder's page and pocket. */
export interface Spot {
  placeId: string
  section?: string
  page?: number
  slot?: number
}

const sameSpot = (a: Spot, b: Spot) =>
  a.placeId === b.placeId && (a.section ?? '') === (b.section ?? '') && (a.page ?? 0) === (b.page ?? 0) && (a.slot ?? 0) === (b.slot ?? 0)
const sameLine = (a: CopyPlace, b: CopyPlace) => sameSpot(a, b) && !!a.foil === !!b.foil

/** What tells two lines apart: the place, the spot in it and the finish. */
export const copyKey = (c: CopyPlace): string => [c.placeId, c.foil ? 'foil' : '', c.section ?? '', c.page ?? '', c.slot ?? ''].join('|')

/** A line written as both apps write it: optional fields left out when not said. */
export function copyPlace(spot: Spot, qty: number, foil: boolean): CopyPlace {
  const out: CopyPlace = { placeId: spot.placeId, qty }
  if (foil) out.foil = true
  if (spot.section) out.section = spot.section
  if (spot.page && spot.page > 0) out.page = spot.page
  if (spot.slot && spot.slot > 0) out.slot = spot.slot
  return out
}

type Counts = Pick<CollectionEntry, 'quantity' | 'foilQuantity'>

/**
 * [places] as kept: one line per spot and finish, none at zero, and no more than the entry's copies —
 * plain and foil apart, the first lines keeping theirs.
 */
export function tidyPlaces(entry: Counts, places: CopyPlace[]): CopyPlace[] {
  const merged: CopyPlace[] = []
  for (const p of places) {
    if (!(p.qty > 0)) continue
    const i = merged.findIndex((m) => sameLine(m, p))
    if (i >= 0) merged[i] = { ...merged[i], qty: merged[i].qty + p.qty }
    else merged.push(copyPlace(p, p.qty, !!p.foil))
  }
  let plain = Math.max(0, entry.quantity)
  let foil = Math.max(0, entry.foilQuantity ?? 0)
  const out: CopyPlace[] = []
  for (const p of merged) {
    const take = Math.min(p.qty, p.foil ? foil : plain)
    if (take <= 0) continue
    out.push(take === p.qty ? p : { ...p, qty: take })
    if (p.foil) foil -= take
    else plain -= take
  }
  return out
}

/** The entry's copies that have a place, as they stand (see tidyPlaces). */
export const placedCopies = (entry: CollectionEntry): CopyPlace[] => tidyPlaces(entry, entry.places ?? [])

/** How many of the entry's copies have no place, plain and foil. */
export function unplacedCopies(entry: CollectionEntry): { plain: number; foil: number } {
  const placed = placedCopies(entry)
  const sum = (foil: boolean) => placed.filter((p) => !!p.foil === foil).reduce((n, p) => n + p.qty, 0)
  return { plain: entry.quantity - sum(false), foil: (entry.foilQuantity ?? 0) - sum(true) }
}

/**
 * [entry] with its places set to [places], tidied. Once an entry has had places it keeps the key, as
 * [] when none are left — see CollectionEntry.places.
 */
export function withPlaces(entry: CollectionEntry, places: CopyPlace[]): CollectionEntry {
  const tidy = tidyPlaces(entry, places)
  if (tidy.length === 0 && entry.places === undefined) return entry
  return { ...entry, places: tidy }
}

/** [entry] with its places tidied to its copies (after its counts changed). */
export const tidied = (entry: CollectionEntry): CollectionEntry =>
  entry.places === undefined ? entry : withPlaces(entry, entry.places)

/** Gives up to [count] of the entry's copies with no place — foil ones if [foil] — the spot [to]. */
export function placeCopies(entry: CollectionEntry, to: Spot, count: number, foil: boolean): { entry: CollectionEntry; moved: number } {
  const free = unplacedCopies(entry)
  const n = Math.min(count, foil ? free.foil : free.plain)
  if (n <= 0) return { entry, moved: 0 }
  return { entry: withPlaces(entry, [...placedCopies(entry), copyPlace(to, n, foil)]), moved: n }
}

/**
 * Moves up to [count] copies from the line [from] — or, when null, from the copies with no place
 * (foil ones if [foil]) — to the spot [to], or to no place when null.
 */
export function moveCopies(entry: CollectionEntry, from: CopyPlace | null, to: Spot | null, count: number, foil = false): { entry: CollectionEntry; moved: number } {
  if (from === null) return to ? placeCopies(entry, to, count, foil) : { entry, moved: 0 }
  const placed = placedCopies(entry)
  const i = placed.findIndex((p) => sameLine(p, from))
  if (i < 0) return { entry, moved: 0 }
  const n = Math.min(count, placed[i].qty)
  if (n <= 0) return { entry, moved: 0 }
  const rest = placed.map((p, j) => (j === i ? { ...p, qty: p.qty - n } : p))
  return { entry: withPlaces(entry, to ? [...rest, copyPlace(to, n, !!from.foil)] : rest), moved: n }
}

/**
 * When [plain] and [foil] copies of [entry] go to another binder in the app: the places that go with
 * them and the ones that stay. Copies with no place go first, then the last lines'.
 */
export function splitPlaces(entry: CollectionEntry, plain: number, foil: number): { staying: CopyPlace[]; going: CopyPlace[] } {
  const placed = placedCopies(entry)
  const free = unplacedCopies(entry)
  let plainLeft = Math.max(0, plain - free.plain)
  let foilLeft = Math.max(0, foil - free.foil)
  const staying = placed.map((p) => ({ ...p }))
  const going: CopyPlace[] = []
  for (let i = staying.length - 1; i >= 0; i--) {
    const p = staying[i]
    const take = Math.min(p.foil ? foilLeft : plainLeft, p.qty)
    if (take <= 0) continue
    staying[i] = { ...p, qty: p.qty - take }
    going.unshift(copyPlace(p, take, !!p.foil))
    if (p.foil) foilLeft -= take
    else plainLeft -= take
  }
  return { staying: staying.filter((p) => p.qty > 0), going }
}

// ---- Copies out on loan ----

/** A tag of the user's that says the copies are out on loan: "lent", "lent to Sam". */
export const lentTag = (entry: { userTags?: string[] }): string | null =>
  (entry.userTags ?? []).find((t) => /^lent\b/i.test(t.trim())) ?? null

const owned = (collections: Collection[]) => collections.filter((c) => c.type !== 'WISHLIST')

/** The user's loans, kept on the Unsorted pile (see collection/loans.ts). */
export function loansOf(collections: Collection[]): Loan[] {
  return collections.find(isUnsorted)?.loans ?? []
}

/** Copies of a loan's card not back yet. */
export const stillOut = (card: LoanCard): number => Math.max(0, card.qty - Math.max(0, card.back ?? 0))

/** Whether some of a loan's cards are still out. */
export const isOpen = (loan: Loan): boolean => loan.cards.some((c) => stillOut(c) > 0)

/**
 * Copies of one loan's card that count as lent out now: [qty] of them, from the binder [collectionId]
 * (where they were found — a card lent from a binder) or from the card's deck.
 */
export interface LentCopy { loan: Loan; card: LoanCard; qty: number; collectionId?: string }

const nameKeyOf = (name: string) => name.trim().toLowerCase()
const entryKey = (collectionId: string, scryfallId: string, foil: boolean) => `${collectionId}|${scryfallId}|${foil ? 'foil' : ''}`
const deckKey = (deckId: string, name: string) => `${deckId}|${nameKeyOf(name)}`

/**
 * Every copy out on loan that's still there to be lent: a card lent from a binder is one of its
 * entry's copies with no place (lending took it off its place), a card lent from a deck one of the
 * deck's real copies. A loan can't count more copies than that — the oldest loans first — so one whose
 * copies were since removed from the collection counts only what's left. A card whose binder has gone
 * is looked for in the others, the Unsorted pile first.
 */
export function lentCopies(collections: Collection[], decks: Deck[] = []): LentCopy[] {
  const loans = loansOf(collections).filter(isOpen)
  if (loans.length === 0) return []
  const known = new Set(placesOf(collections).map((p) => p.id))
  const budget = new Map<string, number>()
  const add = (key: string, n: number) => { if (n > 0) budget.set(key, (budget.get(key) ?? 0) + n) }
  const piles = [...owned(collections).filter(isUnsorted), ...owned(collections).filter((c) => !isUnsorted(c))]
  for (const c of piles) {
    for (const e of c.entries) {
      const clean = placedCopies(e).every((p) => known.has(p.placeId)) ? e : withPlaces(e, placedCopies(e).filter((p) => known.has(p.placeId)))
      const free = unplacedCopies(clean)
      add(entryKey(c.id, e.scryfallId, false), free.plain)
      add(entryKey(c.id, e.scryfallId, true), free.foil)
    }
  }
  for (const d of decks) for (const e of realCopiesOf(d)) add(deckKey(d.id, e.name), e.quantity)
  const take = (key: string, want: number): number => {
    const n = Math.min(want, budget.get(key) ?? 0)
    if (n > 0) budget.set(key, (budget.get(key) ?? 0) - n)
    return n
  }
  const out: LentCopy[] = []
  for (const loan of [...loans].sort((a, b) => a.lentAt - b.lentAt)) {
    for (const card of loan.cards) {
      const want = stillOut(card)
      if (want <= 0) continue
      if (card.deckId) {
        const got = take(deckKey(card.deckId, card.name), want)
        if (got > 0) out.push({ loan, card, qty: got })
        continue
      }
      let left = want
      const order = [...piles.filter((c) => c.id === card.collectionId), ...piles.filter((c) => c.id !== card.collectionId)]
      for (const c of order) {
        if (left <= 0) break
        const got = take(entryKey(c.id, card.scryfallId, !!card.foil), left)
        if (got <= 0) continue
        left -= got
        out.push({ loan, card, qty: got, collectionId: c.id })
      }
    }
  }
  return out
}

/** How many copies of each binder entry are out on loan, by "collectionId|scryfallId|foil" ("" for plain). */
export function lentByEntry(lent: LentCopy[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of lent) {
    if (!l.collectionId) continue
    const key = entryKey(l.collectionId, l.card.scryfallId, !!l.card.foil)
    out.set(key, (out.get(key) ?? 0) + l.qty)
  }
  return out
}

/** Copies of [entry] (in [collectionId]) out on loan, plain and foil, from [lentByEntry]. */
export function lentOf(lent: Map<string, number>, collectionId: string, entry: CollectionEntry): { plain: number; foil: number } {
  return { plain: lent.get(entryKey(collectionId, entry.scryfallId, false)) ?? 0, foil: lent.get(entryKey(collectionId, entry.scryfallId, true)) ?? 0 }
}

// ---- How much has a place ----

export interface StorageSummary {
  /** Every copy owned: in binders, the Unsorted pile and physical decks. */
  total: number
  /** Those with a place: a storage place, a deck box, or lent out. */
  placed: number
  unplaced: number
  /** Real copies in physical decks (not proxies), less those lent out from them. */
  inDecks: number
  /** Copies out on loan, and copies with no other place whose entry is tagged "lent …". */
  lent: number
  /** Copies in each place itself — not counting the places inside it — by id. */
  own: Record<string, number>
}

export function storageSummary(collections: Collection[], decks: Deck[]): StorageSummary {
  const known = new Set(placesOf(collections).map((p) => p.id))
  const lentNow = lentCopies(collections, decks)
  const byEntry = lentByEntry(lentNow)
  const own: Record<string, number> = {}
  let total = 0
  let inPlaces = 0
  let lent = 0
  for (const c of owned(collections)) {
    for (const e of c.entries) {
      const copies = e.quantity + (e.foilQuantity ?? 0)
      if (copies <= 0) continue
      total += copies
      let here = 0
      for (const p of placedCopies(e)) {
        if (!known.has(p.placeId)) continue
        own[p.placeId] = (own[p.placeId] ?? 0) + p.qty
        here += p.qty
      }
      inPlaces += here
      const loaned = lentOf(byEntry, c.id, e)
      lent += loaned.plain + loaned.foil
      if (lentTag(e)) lent += copies - here - loaned.plain - loaned.foil
    }
  }
  const fromDecks = lentNow.filter((l) => l.card.deckId).reduce((n, l) => n + l.qty, 0)
  const inDecks = decks.reduce((n, d) => n + realCopiesOf(d).reduce((m, e) => m + e.quantity, 0), 0) - fromDecks
  total += inDecks + fromDecks
  lent += fromDecks
  const placed = inPlaces + inDecks + lent
  return { total, placed, unplaced: total - placed, inDecks, lent, own }
}

/** Copies in [id] and every place inside it. */
export function copiesWithin(summary: StorageSummary, places: StoragePlace[], id: string): number {
  let n = 0
  for (const p of placeAndInside(places, id)) n += summary.own[p] ?? 0
  return n
}

/** Copies of one entry at one spot of a place. */
export interface PlacedCard {
  collectionId: string
  entry: CollectionEntry
  line: CopyPlace
}

/** Every line of copies kept in [placeId] itself, by card name. */
export function cardsIn(collections: Collection[], placeId: string): PlacedCard[] {
  const out: PlacedCard[] = []
  for (const c of owned(collections)) {
    for (const e of c.entries) {
      for (const line of placedCopies(e)) if (line.placeId === placeId) out.push({ collectionId: c.id, entry: e, line })
    }
  }
  return out.sort((a, b) => a.entry.name.localeCompare(b.entry.name))
}

export interface SectionGroup {
  /** null: copies with no section said. */
  name: string | null
  copies: number
  cards: PlacedCard[]
}

/** A box's sections with their cards: its own sections in order (even empty), then any others used, then copies in none. */
export function sectionsOf(place: StoragePlace, cards: PlacedCard[]): SectionGroup[] {
  const names = [...(place.sections ?? [])]
  for (const c of cards) {
    const s = c.line.section
    if (s && !names.some((n) => n.toLowerCase() === s.toLowerCase())) names.push(s)
  }
  const groups: SectionGroup[] = names.map((name) => {
    const inIt = cards.filter((c) => (c.line.section ?? '').toLowerCase() === name.toLowerCase())
    return { name, copies: inIt.reduce((n, c) => n + c.line.qty, 0), cards: inIt }
  })
  const loose = cards.filter((c) => !c.line.section)
  if (loose.length > 0) groups.push({ name: null, copies: loose.reduce((n, c) => n + c.line.qty, 0), cards: loose })
  return groups
}

export interface BinderPage { page: number; slots: PlacedCard[][] }

/** A binder's pages, each with its pockets, up to the last page used; and copies in no pocket. */
export function pagesOf(place: StoragePlace, cards: PlacedCard[]): { pages: BinderPage[]; loose: PlacedCard[] } {
  const pockets = pocketsOf(place)
  const inPockets = cards.filter((c) => c.line.page && c.line.slot)
  const last = inPockets.reduce((n, c) => Math.max(n, c.line.page!), 0)
  const pages: BinderPage[] = []
  for (let page = 1; page <= last; page++) {
    const slots: PlacedCard[][] = Array.from({ length: Math.max(pockets, ...inPockets.filter((c) => c.line.page === page).map((c) => c.line.slot!)) }, () => [])
    for (const c of inPockets) if (c.line.page === page) slots[c.line.slot! - 1].push(c)
    pages.push({ page, slots })
  }
  return { pages, loose: cards.filter((c) => !(c.line.page && c.line.slot)) }
}

/** The pocket after the last one used in a binder: page 1, pocket 1 for an empty one. */
export function nextPocket(place: StoragePlace, collections: Collection[]): { page: number; slot: number } {
  let page = 0
  let slot = 0
  for (const c of cardsIn(collections, place.id)) {
    const p = c.line.page ?? 0
    const s = c.line.slot ?? 0
    if (p > page || (p === page && s > slot)) { page = p; slot = s }
  }
  if (page === 0) return { page: 1, slot: 1 }
  return slot >= pocketsOf(place) ? { page: page + 1, slot: 1 } : { page, slot: slot + 1 }
}

// ---- Where a card is ----

export type WhereLine =
  | { kind: 'place'; title: string; detail: string; qty: number; placeId: string; collectionId: string; scryfallId: string; line: CopyPlace }
  | { kind: 'deck'; title: string; detail: string; qty: number; deckId: string }
  /** Copies out on loan ([loanId]), or tagged "lent …" (no loan). */
  | { kind: 'lent'; title: string; detail: string; qty: number; loanId?: string }
  | { kind: 'none'; title: string; detail: string; qty: number }

const nameKeys = (n: string) => { const full = n.trim().toLowerCase(); return [full, full.split(' // ')[0].trim()] }

/** Whether two names are the same card: case aside, and either face of a double-faced card. */
export function sameCardName(a: string, b: string): boolean {
  const ka = nameKeys(a)
  return nameKeys(b).some((k) => ka.includes(k))
}

/** "Page 3, slot 5". */
export const pocketLabel = (page: number, slot: number) => `Page ${page}, slot ${slot}`

/**
 * Where a loan's card came from, short: "Red box › Red", "Atraxa deck", or the binder it had no place
 * in ("Unsorted"). "Somewhere" when that's all gone.
 */
export function loanCardFrom(card: LoanCard, collections: Collection[], decks: Deck[]): string {
  if (card.deckId) {
    const deck = decks.find((d) => d.id === card.deckId)
    return deck ? `${deck.name} deck` : 'a deck'
  }
  const place = card.placeId ? placesOf(collections).find((p) => p.id === card.placeId) : undefined
  if (place) return card.section ? `${place.name} › ${card.section}` : place.name
  return collections.find((c) => c.id === card.collectionId)?.name ?? 'Somewhere'
}

/**
 * Where every copy of the card called [name] is (any printing): a line per spot in a place, one per
 * physical deck (less the copies lent out from it), one per loan, and the ones with no place yet.
 * With their total.
 */
export function whereItIs(collections: Collection[], decks: Deck[], name: string): { lines: WhereLine[]; total: number } {
  const places = placesOf(collections)
  const byId = new Map(places.map((p) => [p.id, p]))
  const lent = lentCopies(collections, decks).filter((l) => sameCardName(l.card.name, name))
  const byEntry = lentByEntry(lent)
  const lines: WhereLine[] = []
  let tagged = 0
  let lentWords = ''
  let none = 0
  const noneIn: string[] = []
  for (const c of owned(collections)) {
    for (const e of c.entries) {
      if (!sameCardName(e.name, name)) continue
      const copies = e.quantity + (e.foilQuantity ?? 0)
      if (copies <= 0) continue
      let here = 0
      for (const line of placedCopies(e)) {
        const place = byId.get(line.placeId)
        if (!place) continue
        here += line.qty
        const parents = parentsOf(places, place.id).map((p) => p.name).join(' › ')
        const hint = line.section && place.sortRule ? positionHint(place.sortRule, { name: e.name }) : null
        const detail = [parents, line.page && line.slot ? pocketLabel(line.page, line.slot) : '', hint ?? '', line.foil ? 'foil' : '']
          .filter(Boolean).join(' · ')
        lines.push({
          kind: 'place', title: line.section ? `${place.name} › ${line.section}` : place.name, detail, qty: line.qty,
          placeId: place.id, collectionId: c.id, scryfallId: e.scryfallId, line,
        })
      }
      const loaned = lentOf(byEntry, c.id, e)
      const left = copies - here - loaned.plain - loaned.foil
      if (left <= 0) continue
      const tag = lentTag(e)
      if (tag) {
        tagged += left
        lentWords = lentWords || tag
      } else {
        none += left
        if (!noneIn.includes(c.name)) noneIn.push(c.name)
      }
    }
  }
  for (const d of decks) {
    const qty = realCopiesOf(d).filter((e) => sameCardName(e.name, name)).reduce((n, e) => n + e.quantity, 0) - lentFromDeck(lent, d.id, name)
    if (qty > 0) lines.push({ kind: 'deck', title: `Deck: ${d.name}`, detail: 'In its deck box', qty, deckId: d.id })
  }
  const loanIds = [...new Set(lent.map((l) => l.loan.id))]
  for (const id of loanIds) {
    const mine = lent.filter((l) => l.loan.id === id)
    const from = [...new Set(mine.map((l) => loanCardFrom(l.card, collections, decks)))].join(', ')
    lines.push({ kind: 'lent', title: `Lent to ${mine[0].loan.to}`, detail: `From ${from}`, qty: mine.reduce((n, l) => n + l.qty, 0), loanId: id })
  }
  if (tagged > 0) lines.push({ kind: 'lent', title: 'Lent out', detail: lentWords.charAt(0).toUpperCase() + lentWords.slice(1), qty: tagged })
  if (none > 0) lines.push({ kind: 'none', title: 'No place yet', detail: `In ${noneIn.join(', ')}`, qty: none })
  return { lines, total: lines.reduce((n, l) => n + l.qty, 0) }
}

/** How many of a deck's real copies of the card called [name] are out on loan. */
export function lentFromDeck(lent: LentCopy[], deckId: string, name: string): number {
  return lent.filter((l) => l.card.deckId === deckId && sameCardName(l.card.name, name)).reduce((n, l) => n + l.qty, 0)
}

/**
 * Where a printing's binder copies are kept, short — "Red box ×2 · Trade binder ×1" — for beside "In 2
 * decks and 1 binder". '' when none has a place.
 */
export function keptInLabel(collections: Collection[], scryfallId: string): string {
  const places = placesOf(collections)
  const counts = new Map<string, number>()
  for (const c of owned(collections)) {
    for (const e of c.entries) {
      if (e.scryfallId !== scryfallId) continue
      for (const line of placedCopies(e)) {
        const name = places.find((p) => p.id === line.placeId)?.name
        if (name) counts.set(name, (counts.get(name) ?? 0) + line.qty)
      }
    }
  }
  return [...counts].map(([name, n]) => `${name} ×${n}`).join(' · ')
}

/** Where one entry's copies are kept, short — "Red box ×2 · Trade binder ×1"; '' when none has a place. */
export function keptLabel(entry: CollectionEntry, places: StoragePlace[]): string {
  const counts = new Map<string, number>()
  for (const line of placedCopies(entry)) {
    const name = places.find((p) => p.id === line.placeId)?.name
    if (name) counts.set(name, (counts.get(name) ?? 0) + line.qty)
  }
  return [...counts].map(([name, n]) => `${name} ×${n}`).join(' · ')
}

// ---- Sorting rules: where a new card goes ----

/** What a sorting rule needs to know about a card. */
export interface CardFacts {
  name: string
  /** The card's colours (its front face's, for a double-faced card), as WUBRG letters. */
  colors?: string[] | null
  typeLine?: string | null
  /** The set code. */
  set?: string | null
  collectorNumber?: string | null
}

/** A Scryfall card's facts for the sorting rules: a double-faced card's front face's colours. */
export function cardFactsOf(card: ScryfallCard): CardFacts {
  return {
    name: card.name,
    colors: card.colors ?? card.card_faces?.[0]?.colors ?? [],
    typeLine: card.type_line ?? card.card_faces?.[0]?.type_line ?? null,
    set: card.set ?? null,
    collectorNumber: card.collector_number ?? null,
  }
}

const COLOUR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const frontType = (f: CardFacts) => (f.typeLine ?? '').split(' // ')[0]

/** White … Green, Multicolour, Colourless — or Lands for a land. */
export function colourSection(f: CardFacts): string {
  if (/\bLand\b/.test(frontType(f))) return 'Lands'
  const colours = (f.colors ?? []).filter((c) => c in COLOUR_NAMES)
  if (colours.length > 1) return 'Multicolour'
  if (colours.length === 1) return COLOUR_NAMES[colours[0]]
  return 'Colourless'
}

const TYPE_ORDER: [string, string][] = [
  ['Creature', 'Creatures'], ['Planeswalker', 'Planeswalkers'], ['Battle', 'Battles'], ['Instant', 'Instants'],
  ['Sorcery', 'Sorceries'], ['Artifact', 'Artifacts'], ['Enchantment', 'Enchantments'], ['Land', 'Lands'],
]

/** Creatures, Planeswalkers, … Lands, or Other — the first that fits. */
export function typeSection(f: CardFacts): string {
  const line = frontType(f)
  return TYPE_ORDER.find(([word]) => new RegExp(`\\b${word}\\b`).test(line))?.[1] ?? 'Other'
}

/** The letter a name files under: A–Z, or # for anything else. */
export function letterOf(name: string): string {
  const c = name.trim().charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

/** Whether a section named like "A–F", "A-F" or "A" holds names starting [letter]. */
function sectionHoldsLetter(section: string, letter: string): boolean {
  const range = /^([A-Z])\s*[–-]\s*([A-Z])$/i.exec(section.trim())
  if (range) return letter >= range[1].toUpperCase() && letter <= range[2].toUpperCase()
  return section.trim().toUpperCase() === letter
}

/** Where in its section a card goes: "around “L”", or "around #117" by set. */
export function positionHint(rule: SortRule, f: CardFacts): string | null {
  if (rule === 'SET') return f.collectorNumber ? `around #${f.collectorNumber}` : null
  return `around “${letterOf(f.name)}”`
}

/** The section [rule] puts a card in, spelled as the box spells it when it has one by that name. */
export function ruleSection(rule: SortRule, f: CardFacts, sections: string[] = []): string | null {
  if (rule === 'NAME') return sections.find((s) => sectionHoldsLetter(s, letterOf(f.name))) ?? null
  const section = rule === 'COLOUR' ? colourSection(f) : rule === 'TYPE' ? typeSection(f) : (f.set ?? '').toUpperCase() || null
  if (!section) return null
  return sections.find((s) => s.toLowerCase() === section.toLowerCase()) ?? section
}

/** Where a card should go in [place], and that as words: "Red › around “L”", "Page 3, slot 6". */
export function suggestSpot(place: StoragePlace, f: CardFacts | null, collections: Collection[]): { spot: Spot; hint: string | null } {
  if (place.kind === 'BINDER') {
    // A binder in order: the card waits beside it, to be fitted in with Add cards in order (binderPages.ts).
    if (place.sortRule) return { spot: { placeId: place.id }, hint: null }
    const { page, slot } = nextPocket(place, collections)
    return { spot: { placeId: place.id, page, slot }, hint: pocketLabel(page, slot) }
  }
  if (place.sortRule && f) {
    const section = ruleSection(place.sortRule, f, place.sections ?? [])
    const hint = [section, positionHint(place.sortRule, f)].filter(Boolean).join(' › ')
    return { spot: section ? { placeId: place.id, section } : { placeId: place.id }, hint: hint || null }
  }
  return { spot: { placeId: place.id }, hint: null }
}

// ---- Putting cards away ----

export type PutAwayResult = 'placed' | 'moved' | 'here' | 'new'

/** One card put away, as much as Undo needs to take it back. */
export interface PutAwayStep {
  collectionId: string
  scryfallId: string
  /** The line the copy came from, or null: it had no place (or, when [added], it's new). */
  from: CopyPlace | null
  /** Where it went: one copy. */
  to: CopyPlace
  /** A new copy, added to the collection. */
  added: boolean
}

export interface PutAwayOutcome {
  collections: Collection[]
  result: PutAwayResult
  /** "moved from Unsorted", "moved from Trade binder", "already here", "new to collection". */
  label: string
  step: PutAwayStep | null
}

function mapEntry(collections: Collection[], collectionId: string, scryfallId: string, fn: (e: CollectionEntry) => CollectionEntry): Collection[] {
  return collections.map((c) => (c.id !== collectionId ? c : { ...c, entries: c.entries.map((e) => (e.scryfallId === scryfallId ? fn(e) : e)) }))
}

/**
 * One scanned card put away into [to]. A copy the user owns with no place gets it (the Unsorted pile's
 * first, that printing before others); failing that, a copy in another place moves here (never one
 * in a deck — those are in their deck boxes); a card already here stays; and a card not owned at all
 * is added to the Unsorted pile, here. [newEntry] is the entry to add then, with no copies yet.
 */
export function putAway(collections: Collection[], card: { id: string; name: string }, to: Spot, newEntry: CollectionEntry, foil = false): PutAwayOutcome {
  const places = placesOf(collections)
  const known = new Set(places.map((p) => p.id))
  const here = placeAndInside(places, to.placeId)
  const byId = new Map(places.map((p) => [p.id, p]))
  const mine = owned(collections)
  // The Unsorted pile first, then the binders; that printing before other printings.
  const piles = [...mine.filter(isUnsorted), ...mine.filter((c) => !isUnsorted(c))]
  const candidates: { c: Collection; e: CollectionEntry }[] = []
  for (const exact of [true, false]) {
    for (const c of piles) {
      for (const e of c.entries) {
        if (e.quantity + (e.foilQuantity ?? 0) <= 0) continue
        if (exact ? e.scryfallId === card.id : e.scryfallId !== card.id && sameCardName(e.name, card.name)) candidates.push({ c, e })
      }
    }
  }
  const finishes = foil ? [true, false] : [false, true]
  const knownOnly = (e: CollectionEntry) => (placedCopies(e).every((p) => known.has(p.placeId)) ? e : withPlaces(e, placedCopies(e).filter((p) => known.has(p.placeId))))
  // Copies out on loan have no place, but they aren't here to put away.
  const lent = lentByEntry(lentCopies(collections))

  // A copy with no place.
  for (const f of finishes) {
    for (const { c, e } of candidates) {
      const clean = knownOnly(e)
      const free = unplacedCopies(clean)
      const out = lentOf(lent, c.id, e)
      if ((f ? free.foil - out.foil : free.plain - out.plain) <= 0) continue
      const { entry } = placeCopies(clean, to, 1, f)
      return {
        collections: mapEntry(collections, c.id, e.scryfallId, () => entry),
        result: 'placed',
        label: isUnsorted(c) ? 'moved from Unsorted' : 'given a place',
        step: { collectionId: c.id, scryfallId: e.scryfallId, from: null, to: copyPlace(to, 1, f), added: false },
      }
    }
  }
  // A copy somewhere else.
  for (const f of finishes) {
    for (const { c, e } of candidates) {
      const line = placedCopies(e).find((p) => !!p.foil === f && known.has(p.placeId) && !here.has(p.placeId))
      if (!line) continue
      const { entry } = moveCopies(e, line, to, 1)
      return {
        collections: mapEntry(collections, c.id, e.scryfallId, () => entry),
        result: 'moved',
        label: `moved from ${byId.get(line.placeId)?.name ?? 'another place'}`,
        step: { collectionId: c.id, scryfallId: e.scryfallId, from: copyPlace(line, 1, f), to: copyPlace(to, 1, f), added: false },
      }
    }
  }
  if (candidates.some(({ e }) => placedCopies(e).some((p) => here.has(p.placeId)))) {
    return { collections, result: 'here', label: 'already here', step: null }
  }
  return { ...addedHere(collections, card, to, newEntry, foil), result: 'new', label: 'new to collection' }
}

/** A new copy of [card] added to the Unsorted pile, kept at [to] — for a card already here that's really another copy too. */
export function addedHere(collections: Collection[], card: { id: string }, to: Spot, newEntry: CollectionEntry, foil = false): { collections: Collection[]; step: PutAwayStep } {
  const withPile = withUnsortedPile(collections)
  const step: PutAwayStep = { collectionId: UNSORTED_COLLECTION_ID, scryfallId: card.id, from: null, to: copyPlace(to, 1, foil), added: true }
  const next = withPile.map((c) => {
    if (!isUnsorted(c)) return c
    const had = c.entries.find((e) => e.scryfallId === card.id)
    const grown = had
      ? { ...had, quantity: had.quantity + (foil ? 0 : 1), foilQuantity: (had.foilQuantity ?? 0) + (foil ? 1 : 0) }
      : { ...newEntry, scryfallId: card.id, quantity: foil ? 0 : 1, foilQuantity: foil ? 1 : 0 }
    const placed = withPlaces(grown, [...placedCopies(grown), copyPlace(to, 1, foil)])
    return { ...c, entries: had ? c.entries.map((e) => (e === had ? placed : e)) : [...c.entries, placed] }
  })
  return { collections: next, step }
}

/** [collections] with [step] taken back: the copy goes back where it was, or out of the collection if it was new. */
export function undoPutAway(collections: Collection[], step: PutAwayStep): Collection[] {
  const c = collections.find((x) => x.id === step.collectionId)
  const e = c?.entries.find((x) => x.scryfallId === step.scryfallId)
  if (!c || !e) return collections
  if (!step.added) return mapEntry(collections, c.id, e.scryfallId, (entry) => moveCopies(entry, step.to, step.from, 1, !!step.to.foil).entry)
  const unplaced = moveCopies(e, step.to, null, 1).entry
  const foil = !!step.to.foil
  const smaller = tidied({ ...unplaced, quantity: unplaced.quantity - (foil ? 0 : 1), foilQuantity: (unplaced.foilQuantity ?? 0) - (foil ? 1 : 0) })
  const gone = smaller.quantity <= 0 && (smaller.foilQuantity ?? 0) <= 0
  return collections.map((x) => (x.id !== c.id ? x : {
    ...x,
    entries: gone ? x.entries.filter((y) => y.scryfallId !== e.scryfallId) : x.entries.map((y) => (y.scryfallId === e.scryfallId ? smaller : y)),
  }))
}

/**
 * Gives up to [count] copies of the card called [name] that have no place the spot [to] — copies of
 * the printing [preferId] first, the Unsorted pile's before the binders', plain before foil. Copies
 * out on loan, or tagged as lent out, are left alone. Also how many it gave.
 */
export function placeUnplaced(collections: Collection[], name: string, preferId: string | null, to: Spot, count: number): { collections: Collection[]; moved: number } {
  const known = new Set(placesOf(collections).map((p) => p.id))
  const mine = owned(collections)
  const piles = [...mine.filter(isUnsorted), ...mine.filter((c) => !isUnsorted(c))]
  const order: { c: Collection; e: CollectionEntry }[] = []
  for (const exact of [true, false]) {
    for (const c of piles) for (const e of c.entries) {
      if (!sameCardName(e.name, name) || lentTag(e)) continue
      if ((e.scryfallId === preferId) === exact) order.push({ c, e })
    }
  }
  let left = count
  let out = collections
  // Copies out on loan have no place, but they aren't here to be given one.
  const lent = lentByEntry(lentCopies(collections))
  for (const foil of [false, true]) {
    for (const { c, e } of order) {
      if (left <= 0) break
      const current = out.find((x) => x.id === c.id)?.entries.find((x) => x.scryfallId === e.scryfallId)
      if (!current) continue
      const clean = placedCopies(current).every((p) => known.has(p.placeId)) ? current : withPlaces(current, placedCopies(current).filter((p) => known.has(p.placeId)))
      const free = unplacedCopies(clean)
      const away = lentOf(lent, c.id, e)
      const { entry, moved } = placeCopies(clean, to, Math.min(left, foil ? free.foil - away.foil : free.plain - away.plain), foil)
      if (moved === 0) continue
      left -= moved
      out = mapEntry(out, c.id, e.scryfallId, () => entry)
    }
  }
  return { collections: out, moved: count - left }
}

// ---- Sync: merging two devices' places ----

/**
 * Whether [c] was written by an app that doesn't know about places: no "places" or "storagePlaces"
 * key anywhere in it. Such an app drops the keys when it saves a binder; its version is taken as
 * leaving the places as they were.
 */
export const writtenWithoutPlaces = (c: Collection): boolean =>
  c.storagePlaces === undefined && c.entries.every((e) => e.places === undefined)

/**
 * [theirs] with the places [source] knows put back, when [theirs] was written by an app that doesn't
 * know about them (see writtenWithoutPlaces) — the same object otherwise.
 */
export function keepPlacesFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (!writtenWithoutPlaces(theirs) || writtenWithoutPlaces(source)) return theirs
  const kept = new Map(source.entries.filter((e) => e.places !== undefined).map((e) => [e.scryfallId, e.places!]))
  return {
    ...theirs,
    ...(source.storagePlaces !== undefined ? { storagePlaces: source.storagePlaces } : {}),
    entries: theirs.entries.map((e) => (kept.has(e.scryfallId) ? withPlaces(e, kept.get(e.scryfallId)!) : e)),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/**
 * Merges an entry's lines of places like the entries themselves: a line added on one side is kept,
 * one removed on one side stays removed, and counts both sides changed add up. Left out (undefined)
 * when no side has the key.
 */
export function mergeCopyPlaces(base: CopyPlace[] | undefined, mine: CopyPlace[] | undefined, theirs: CopyPlace[] | undefined): CopyPlace[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((p) => [copyKey(p), p]))
  const m = new Map((mine ?? []).map((p) => [copyKey(p), p]))
  const t = new Map((theirs ?? []).map((p) => [copyKey(p), p]))
  const baseKeys = [...b.keys()]
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((k) => !b.has(k)).sort()
  const out: CopyPlace[] = []
  for (const key of [...baseKeys, ...added]) {
    const bp = b.get(key)
    const mp = m.get(key)
    const tp = t.get(key)
    if (bp && (!mp || !tp)) continue
    if (!bp) {
      const qty = Math.max(mp?.qty ?? 0, tp?.qty ?? 0)
      if (qty > 0) out.push({ ...(tp ?? mp)!, qty })
      continue
    }
    const summed = tp!.qty + (mp!.qty - bp.qty)
    const qty = summed <= 0 && mp!.qty > 0 && tp!.qty > 0 ? Math.min(mp!.qty, tp!.qty) : Math.max(0, summed)
    if (qty > 0) out.push({ ...tp!, qty })
  }
  return out
}

/**
 * Merges two devices' lists of places: one made on either side is kept, one deleted on either side
 * stays deleted, and each field goes to whoever changed it (the more recent edit when both did).
 * Left out (undefined) when no side has the key.
 */
export function mergePlaceLists(base: StoragePlace[] | undefined, mine: StoragePlace[] | undefined, theirs: StoragePlace[] | undefined, minePreferred: boolean): StoragePlace[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((p) => [p.id, p]))
  const m = new Map((mine ?? []).map((p) => [p.id, p]))
  const t = new Map((theirs ?? []).map((p) => [p.id, p]))
  const baseIds = [...b.keys()]
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((id) => !b.has(id)).sort()
  const out: StoragePlace[] = []
  for (const id of [...baseIds, ...added]) {
    const bp = b.get(id)
    const mp = m.get(id)
    const tp = t.get(id)
    if (bp && (!mp || !tp)) continue
    if (!bp) { out.push((tp ?? mp)!); continue }
    out.push(storagePlace({
      id,
      name: pick(bp.name, mp!.name, tp!.name, minePreferred),
      kind: pick(bp.kind, mp!.kind, tp!.kind, minePreferred),
      parentId: pick(bp.parentId, mp!.parentId, tp!.parentId, minePreferred),
      note: pick(bp.note, mp!.note, tp!.note, minePreferred),
      sections: pick(bp.sections, mp!.sections, tp!.sections, minePreferred),
      pocketsPerPage: pick(bp.pocketsPerPage, mp!.pocketsPerPage, tp!.pocketsPerPage, minePreferred),
      sortRule: pick(bp.sortRule, mp!.sortRule, tp!.sortRule, minePreferred),
      createdAt: Math.min(mp!.createdAt, tp!.createdAt),
      // Only ever moves on, so the later check wins — and a side that dropped it didn't clear it.
      lastChecked: Math.max(bp.lastChecked ?? 0, mp!.lastChecked ?? 0, tp!.lastChecked ?? 0) || undefined,
      capacity: pick(bp.capacity, mp!.capacity, tp!.capacity, minePreferred),
      pages: pick(bp.pages, mp!.pages, tp!.pages, minePreferred),
    }))
  }
  return out
}

/**
 * [theirs] with each place's "lastChecked" no older than [source]'s — a place saved by an app that
 * doesn't know about checks comes without it. The same object when nothing changes.
 */
export function keepLastChecked(source: Collection, theirs: Collection): Collection {
  if (!theirs.storagePlaces || !source.storagePlaces) return theirs
  const mine = new Map(source.storagePlaces.map((p) => [p.id, p.lastChecked ?? 0]))
  if (!theirs.storagePlaces.some((p) => (mine.get(p.id) ?? 0) > (p.lastChecked ?? 0))) return theirs
  return {
    ...theirs,
    storagePlaces: theirs.storagePlaces.map((p) => ((mine.get(p.id) ?? 0) > (p.lastChecked ?? 0) ? { ...p, lastChecked: mine.get(p.id)! } : p)),
  }
}

/**
 * [theirs] with each place's size ("capacity", a binder's "pages") put back where [source] has one and
 * [theirs] doesn't say — a place saved by an app that doesn't know about sizes comes without them. A
 * size taken off is kept as 0, so it isn't put back. The same object when nothing changes.
 */
export function keepPlaceSizes(source: Collection, theirs: Collection): Collection {
  if (!theirs.storagePlaces || !source.storagePlaces) return theirs
  const mine = new Map(source.storagePlaces.map((p) => [p.id, p]))
  const lost = (p: StoragePlace) => {
    const m = mine.get(p.id)
    return !!m && ((p.capacity === undefined && m.capacity !== undefined) || (p.pages === undefined && m.pages !== undefined))
  }
  if (!theirs.storagePlaces.some(lost)) return theirs
  return {
    ...theirs,
    storagePlaces: theirs.storagePlaces.map((p) => {
      if (!lost(p)) return p
      const m = mine.get(p.id)!
      return { ...p, ...(p.capacity === undefined && m.capacity !== undefined ? { capacity: m.capacity } : {}), ...(p.pages === undefined && m.pages !== undefined ? { pages: m.pages } : {}) }
    }),
  }
}

// ---- The Advanced filters' "Place" ----

/** The filter's value for copies with no place yet. */
export const NO_PLACE = 'none'

/** The places holding copies of an entry — each with the places it sits in — and how many have none. */
export function placeFactsOf(entry: CollectionEntry, places: StoragePlace[]): { places: string[]; unplaced: number } {
  const known = new Set(places.map((p) => p.id))
  const out: string[] = []
  let here = 0
  for (const line of placedCopies(entry)) {
    if (!known.has(line.placeId)) continue
    here += line.qty
    for (const id of [...parentsOf(places, line.placeId).map((p) => p.id), line.placeId]) if (!out.includes(id)) out.push(id)
  }
  const copies = entry.quantity + (entry.foilQuantity ?? 0)
  return { places: out, unplaced: lentTag(entry) ? 0 : Math.max(0, copies - here) }
}

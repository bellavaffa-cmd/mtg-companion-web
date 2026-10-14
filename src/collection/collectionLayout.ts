// The Collection's layout: one header and four tabs — Cards, Binders, Storage, Wishlist — always there,
// no tile home in front. Here, pure so it can be tested:
//  - the tabs, and how the old routes (?tab=all, sets, shared, the home's tiles) map onto them;
//  - where a card's copies are, as the chips on a card row say it ("Blue box › Instants ×2",
//    "Talrand deck ×1", "Lent to Sam ×1", "No place yet · Put away") — one formatter for every row;
//  - the Cards tab's Group by (none, set, binder, place) and its quick filters (Lent out, For sale,
//    No place yet, Graded);
//  - the small counts on the Binders and Storage rows ("kept in 3 places", "in 2 binders").
// Mirrors the Android app's data/CollectionLayout.kt rule for rule (tests:
// tests/collection/collectionLayout.test.ts ↔ CollectionLayoutTest.kt, the same cases).

import type { Collection, CollectionEntry, Deck, StoragePlace } from '../types/models'
import { isUnsorted } from '../types/models'
import type { FindChip } from './findAnything'
import { gradedOf } from './graded'
import { forSaleOf } from './selling'
import { lentByEntry, lentCopies, lentOf, lentTag, placeAndInside, placedCopies, placesOf } from './storagePlaces'
import { ownedCopies } from './ownedCopies'
import { deckTitle } from './upkeep'

/** The Collection's four tabs, in order; the key is ?tab= and what's remembered. */
export type CollectionTab = 'cards' | 'binders' | 'storage' | 'wishlist'
export const COLLECTION_TABS: CollectionTab[] = ['cards', 'binders', 'storage', 'wishlist']
export const TAB_LABELS: Record<CollectionTab, string> = { cards: 'Cards', binders: 'Binders', storage: 'Storage', wishlist: 'Wishlist' }
export const isCollectionTab = (key: string | null | undefined): key is CollectionTab => COLLECTION_TABS.includes(key as CollectionTab)

/** The Cards tab's Group by. */
export type CardGroupBy = 'none' | 'set' | 'binder' | 'place'
export const GROUP_BYS: CardGroupBy[] = ['none', 'set', 'binder', 'place']
export const GROUP_BY_LABELS: Record<CardGroupBy, string> = { none: 'None', set: 'Set', binder: 'Binder', place: 'Place' }
export const groupByOf = (key: string | null | undefined): CardGroupBy => (GROUP_BYS.includes(key as CardGroupBy) ? key as CardGroupBy : 'none')

/** The Cards tab's quick filters; one at a time. */
export type QuickFilter = 'lent' | 'sale' | 'noplace' | 'graded'
export const QUICK_FILTERS: QuickFilter[] = ['lent', 'sale', 'noplace', 'graded']
export const QUICK_LABELS: Record<QuickFilter, string> = { lent: 'Lent out', sale: 'For sale', noplace: 'No place yet', graded: 'Graded' }
/** The full screen each one's "Manage…" opens. */
export const QUICK_MANAGE: Record<QuickFilter, string> = { lent: 'Loans', sale: 'To sell', noplace: 'Put cards away', graded: 'Graded cards' }
export const quickOf = (key: string | null | undefined): QuickFilter | null => (QUICK_FILTERS.includes(key as QuickFilter) ? key as QuickFilter : null)

/** Where the Collection opens: a tab, and on Cards a grouping or quick filter. [shared]: what friends share (from the header's menu). */
export interface CollectionRoute { tab: CollectionTab; group?: CardGroupBy; quick?: QuickFilter; shared?: boolean }

/**
 * The tab an old or new route means: the old tabs (all, binders, storage, sets, shared) and the old
 * home's tiles (sealed, loans, sell, graded, wishlist) keep working. Null: no tab said (open the one
 * used last) or one not known.
 */
export function collectionRoute(tab: string | null | undefined): CollectionRoute | null {
  switch (tab?.trim().toLowerCase()) {
    case 'cards': case 'all': return { tab: 'cards' }
    case 'sets': return { tab: 'cards', group: 'set' }
    case 'binders': case 'goals': return { tab: 'binders' }
    case 'storage': case 'sealed': return { tab: 'storage' }
    case 'wishlist': return { tab: 'wishlist' }
    case 'loans': case 'lent': return { tab: 'cards', quick: 'lent' }
    case 'sell': case 'sale': return { tab: 'cards', quick: 'sale' }
    case 'graded': return { tab: 'cards', quick: 'graded' }
    case 'noplace': return { tab: 'cards', quick: 'noplace' }
    case 'shared': return { tab: 'cards', shared: true }
    default: return null
  }
}

/** The tab to open: the route's, else the one used last, else Cards. */
export const startTab = (route: CollectionRoute | null, remembered: string | null | undefined): CollectionTab =>
  route?.tab ?? (isCollectionTab(remembered) ? remembered : 'cards')

// ---- Where a card's copies are: the chips on a card row ----

export type LocationKind = 'place' | 'deck' | 'lent' | 'none'

/** Some of a card's copies in one spot: a place's section or a binder page, a deck, a loan (no loanTo: tagged "lent"), or none. */
export interface LocationChip {
  kind: LocationKind
  qty: number
  place?: string
  placeId?: string
  section?: string
  page?: number
  deck?: string
  deckId?: string
  loanTo?: string
  loanId?: string
}

const count = (n: number) => n.toLocaleString('en-GB')
const copies = (n: number) => `${count(n)} ${n === 1 ? 'copy' : 'copies'}`

/** A chip's words: "Blue box › Instants ×2", "Talrand deck ×1", "Lent to Sam ×1", "No place yet · Put away". */
export function chipText(chip: LocationChip): string {
  switch (chip.kind) {
    case 'place': return `${chip.section ? `${chip.place} › ${chip.section}` : chip.place ?? ''} ×${count(chip.qty)}`
    case 'deck': return `${deckTitle(chip.deck ?? '')} ×${count(chip.qty)}`
    case 'lent': return `${chip.loanTo ? `Lent to ${chip.loanTo}` : 'Lent out'} ×${count(chip.qty)}`
    case 'none': return 'No place yet · Put away'
  }
}

/** What a screen reader says for a chip: "Stored in Blue box, Instants section, 2 copies". */
export function chipDescription(chip: LocationChip): string {
  switch (chip.kind) {
    case 'place': return `Stored in ${chip.place}${chip.section ? `, ${chip.section} section` : ''}${chip.page ? `, page ${chip.page}` : ''}, ${copies(chip.qty)}`
    case 'deck': return `In ${deckTitle(chip.deck ?? '')}, ${copies(chip.qty)}`
    case 'lent': return `${chip.loanTo ? `Lent to ${chip.loanTo}` : 'Lent out'}, ${copies(chip.qty)}`
    case 'none': return `No place yet, ${copies(chip.qty)}. Put away`
  }
}

/** What a screen reader says for a Find anything chip, in the same words as a row's. */
export function findChipDescription(chip: FindChip): string {
  switch (chip.kind) {
    case 'place': {
      const parts = chip.label.split(' › ')
      return `Stored in ${parts[0]}${parts.length > 1 ? `, ${parts.slice(1).join(' › ')} section` : ''}, ${copies(chip.qty)}`
    }
    case 'deck': return `In ${chip.label}, ${copies(chip.qty)}`
    case 'none': return `No place yet, ${copies(chip.qty)}`
    default: return `${chip.label}, ${copies(chip.qty)}`
  }
}

/** A place's page, at a box's section or a binder's page (a card row's place chip). */
export const placeLink = (id: string, section?: string, page?: number) => {
  const p = new URLSearchParams()
  if (section) p.set('section', section)
  if (page) p.set('page', String(page))
  const qs = p.toString()
  return `/collections/place/${id}${qs ? `?${qs}` : ''}`
}

/** At most this many chips on a row, then "+N". */
export const ROW_CHIPS_MAX = 2

/**
 * The chips a row shows and how many more there are ("+N"). The amber No place yet chip is always
 * shown — it's what to do about the card — taking the last of the [max] spots when there are others.
 */
export function shownChips(chips: LocationChip[], max = ROW_CHIPS_MAX): { shown: LocationChip[]; more: number } {
  const none = chips.find((c) => c.kind === 'none')
  const rest = chips.filter((c) => c.kind !== 'none')
  const room = Math.max(0, none ? max - 1 : max)
  const shown = [...rest.slice(0, room), ...(none ? [none] : [])]
  return { shown, more: chips.length - shown.length }
}

/** "+3", said: "3 more places". */
export const moreChipsDescription = (more: number) => `${more} more ${more === 1 ? 'place' : 'places'}`

const ORDER: LocationKind[] = ['place', 'deck', 'lent', 'none']

class ChipBuild {
  chips = new Map<string, LocationChip>()
  add(c: LocationChip) {
    if (c.qty <= 0) return
    const key = [c.kind, c.placeId ?? '', c.section ?? '', c.deckId ?? '', c.loanId ?? '', c.loanTo ?? ''].join('|')
    const had = this.chips.get(key)
    if (!had) { this.chips.set(key, { ...c }); return }
    const pages = [had.page, c.page].filter((p): p is number => p != null)
    this.chips.set(key, { ...had, qty: had.qty + c.qty, page: pages.length ? Math.min(...pages) : undefined })
  }
  list(): LocationChip[] {
    // A stable sort: chips of a kind keep the order they were found in.
    return [...this.chips.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  }
}

const nameKey = (name: string) => name.trim().toLowerCase()

/**
 * Every owned printing's chips, by scryfallId, in one walk over the library: a chip per place and
 * section its binder copies are in, per deck holding real owned copies (ownedCopies: a physical deck's,
 * a proxy deck's swapped-in ones; less those lent from it),
 * per loan, copies tagged "lent", and the copies with no place yet. The same rules as Where it is and
 * Find anything, a printing at a time. Graded copies are kept apart and have none.
 */
export function locationIndex(collections: Collection[], decks: Deck[]): Map<string, LocationChip[]> {
  const places = new Map(placesOf(collections).map((p) => [p.id, p]))
  const lent = lentCopies(collections, decks)
  const byEntry = lentByEntry(lent)
  const out = new Map<string, ChipBuild>()
  const of = (id: string) => { let b = out.get(id); if (!b) { b = new ChipBuild(); out.set(id, b) } return b }
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) for (const chip of entryChips(c.id, e, places, byEntry)) of(e.scryfallId).add(chip)
  }
  const fromDeck = new Map<string, number>()
  for (const l of lent) {
    if (!l.card.deckId) continue
    const k = `${l.card.deckId}|${l.card.scryfallId}|${nameKey(l.card.name)}`
    fromDeck.set(k, (fromDeck.get(k) ?? 0) + l.qty)
  }
  // A deck's real owned copies (ownedCopies): a physical deck's, and the real copies swapped into a proxy deck.
  for (const d of decks) for (const e of d.cards) {
    const real = ownedCopies(d, e)
    if (real <= 0) continue
    const k = `${d.id}|${e.scryfallId}|${nameKey(e.name)}`
    const less = fromDeck.get(k) ?? 0
    fromDeck.delete(k)
    of(e.scryfallId).add({ kind: 'deck', qty: real - less, deck: d.name, deckId: d.id })
  }
  for (const l of lent) of(l.card.scryfallId).add({ kind: 'lent', qty: l.qty, loanTo: l.loan.to, loanId: l.loan.id })
  return new Map([...out].map(([id, b]) => [id, b.list()]))
}

/**
 * One binder entry's chips — for a binder's own card rows: its copies in each place, those tagged
 * "lent" and those with no place yet. [lent]: lentByEntry. Loans show on the printing's chips
 * (locationIndex); here lent copies just aren't counted as having no place.
 */
export function entryChips(collectionId: string, entry: CollectionEntry, places: Map<string, StoragePlace>, lent: Map<string, number>): LocationChip[] {
  const total = Math.max(0, entry.quantity) + Math.max(0, entry.foilQuantity ?? 0)
  if (total <= 0) return []
  const b = new ChipBuild()
  let here = 0
  for (const line of placedCopies(entry)) {
    const place = places.get(line.placeId)
    if (!place) continue
    here += line.qty
    b.add({ kind: 'place', qty: line.qty, place: place.name, placeId: place.id, section: line.section ?? undefined, page: line.page ?? undefined })
  }
  const out = lentOf(lent, collectionId, entry)
  const left = total - here - out.plain - out.foil
  if (left > 0) b.add(lentTag(entry) ? { kind: 'lent', qty: left } : { kind: 'none', qty: left })
  return b.list()
}

// ---- Cards tab: Group by ----

/** A group of rows under its header: "Dominaria" with "41/92", "Blue box", "No place yet". */
export interface LayoutGroup<T> { key: string; title: string; detail: string | null; items: T[] }
/** One group a card goes in. A card can be in more than one (two binders). */
export interface GroupKey { key: string; title: string }

/** The key that sorts last: no set known, no binder, no place yet. */
export const GROUP_NONE = ''
/** The last group's title when grouping by place. */
export const NO_PLACE_TITLE = 'No place yet'

/**
 * [items] in groups by [keysOf] — each item in every group it names, in its order there — groups A–Z
 * by title, the empty key last. [detailOf]: a group's line (a set's "41/92"). With no keys an item
 * goes in the [noneTitle] group.
 */
export function groupLayout<T>(items: T[], keysOf: (item: T) => GroupKey[], noneTitle: string, detailOf: (key: string) => string | null = () => null): LayoutGroup<T>[] {
  const groups = new Map<string, { title: string; items: T[] }>()
  for (const item of items) {
    const seen = new Set<string>()
    let keys = keysOf(item).filter((k) => (seen.has(k.key) ? false : (seen.add(k.key), true)))
    if (keys.length === 0) keys = [{ key: GROUP_NONE, title: noneTitle }]
    for (const k of keys) {
      let g = groups.get(k.key)
      if (!g) { g = { title: k.title, items: [] }; groups.set(k.key, g) }
      g.items.push(item)
    }
  }
  const lower = (s: string) => s.toLowerCase()
  return [...groups]
    .sort(([ka, a], [kb, b]) => (ka === GROUP_NONE ? 1 : 0) - (kb === GROUP_NONE ? 1 : 0) || (lower(a.title) < lower(b.title) ? -1 : lower(a.title) > lower(b.title) ? 1 : 0))
    .map(([key, g]) => ({ key, title: g.title, detail: key === GROUP_NONE ? null : detailOf(key), items: g.items }))
}

/** By set: the printing's set (code and name), one group a set. */
export const setKeys = (set: { code: string; name: string } | null | undefined): GroupKey[] =>
  !set || !set.code.trim() ? [] : [{ key: set.code.toLowerCase(), title: set.name.trim() || set.code.toUpperCase() }]

/** A set group's line: "41/92" — printings owned of its size; just the count when its size isn't known. */
export const setGroupDetail = (owned: number, total: number): string => (total > 0 ? `${count(owned)}/${count(total)}` : count(owned))

/** By place: each place the chips name (a box, not its sections), each deck, "Lent out", and No place yet last. */
export const placeKeys = (chips: LocationChip[]): GroupKey[] => chips.map((c) => {
  switch (c.kind) {
    case 'place': return { key: `place:${c.placeId}`, title: c.place ?? '' }
    case 'deck': return { key: `deck:${c.deckId}`, title: deckTitle(c.deck ?? '') }
    case 'lent': return { key: 'lent', title: 'Lent out' }
    case 'none': return { key: GROUP_NONE, title: NO_PLACE_TITLE }
  }
})

/** By binder: each binder holding copies, and each deck. */
export const binderKeys = (sources: { kind: 'binder' | 'deck'; id: string; name: string }[]): GroupKey[] =>
  sources.map((s) => (s.kind === 'deck' ? { key: `deck:${s.id}`, title: deckTitle(s.name) } : { key: `binder:${s.id}`, title: s.name }))

// ---- Cards tab: quick filters ----

/** The printings each quick filter keeps, by scryfallId; [gradedNames]: cards with a graded copy, by name. */
export interface QuickSets { lent: Set<string>; sale: Set<string>; noplace: Set<string>; graded: Set<string>; gradedNames: Set<string> }

/** What each quick filter keeps, from the library and its chips (locationIndex). */
export function quickSets(collections: Collection[], chips: Map<string, LocationChip[]>): QuickSets {
  const sale = new Set<string>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) if (forSaleOf(e) > 0) sale.add(e.scryfallId)
  }
  const lent = new Set<string>()
  const noplace = new Set<string>()
  for (const [id, list] of chips) {
    if (list.some((c) => c.kind === 'lent')) lent.add(id)
    if (list.some((c) => c.kind === 'none')) noplace.add(id)
  }
  const graded = gradedOf(collections)
  return { lent, sale, noplace, graded: new Set(graded.map((g) => g.scryfallId)), gradedNames: new Set(graded.map((g) => nameKey(g.name))) }
}

/** Whether a card passes the quick filter [quick] (null: none on). */
export function passesQuick(quick: QuickFilter | null, scryfallId: string, name: string, sets: QuickSets): boolean {
  switch (quick) {
    case null: return true
    case 'lent': return sets.lent.has(scryfallId)
    case 'sale': return sets.sale.has(scryfallId)
    case 'noplace': return sets.noplace.has(scryfallId)
    // A slab is kept apart from the raw copies: any printing of a card with one is shown.
    case 'graded': return sets.graded.has(scryfallId) || sets.gradedNames.has(nameKey(name)) || sets.gradedNames.has(nameKey(name).split(' // ')[0])
  }
}

/** How many cards each quick filter would keep, for its chip. */
export const quickCount = (quick: QuickFilter, cards: { scryfallId: string; name: string }[], sets: QuickSets): number =>
  cards.reduce((n, c) => n + (passesQuick(quick, c.scryfallId, c.name, sets) ? 1 : 0), 0)

// ---- Binders and Storage rows ----

/** How many places a binder's copies are kept in (places that are still there). */
export function placesUsed(collection: Collection, known: Set<string>): number {
  const used = new Set<string>()
  for (const e of collection.entries) for (const line of placedCopies(e)) if (known.has(line.placeId)) used.add(line.placeId)
  return used.size
}

/** "kept in 3 places", "kept in 1 place", "no place yet" (nothing placed, but cards), "" for an empty binder. */
export const keptInPlacesLine = (places: number, cards: number): string =>
  places > 0 ? `kept in ${count(places)} ${places === 1 ? 'place' : 'places'}` : cards > 0 ? 'no place yet' : ''

/** The binders (not the Unsorted pile, not a wishlist) with copies in each place itself, by place id. */
export function bindersByPlace(collections: Collection[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const c of collections) {
    if (c.type === 'WISHLIST' || isUnsorted(c)) continue
    for (const e of c.entries) for (const line of placedCopies(e)) {
      let s = out.get(line.placeId)
      if (!s) { s = new Set(); out.set(line.placeId, s) }
      s.add(c.id)
    }
  }
  return out
}

/** Binders with copies in a place or any place inside it. */
export function bindersIn(byPlace: Map<string, Set<string>>, places: StoragePlace[], id: string): number {
  const all = new Set<string>()
  for (const p of placeAndInside(places, id)) for (const b of byPlace.get(p) ?? []) all.add(b)
  return all.size
}

/** "in 2 binders"; "" for none. */
export const inBindersLine = (n: number): string => (n <= 0 ? '' : `in ${count(n)} ${n === 1 ? 'binder' : 'binders'}`)

/** The header's chip: "Needs attention · 3"; null (hidden) at 0. */
export const needsAttentionLabel = (n: number): string | null => (n <= 0 ? null : `Needs attention · ${count(n)}`)

// ---- The last tab, on this device ----

const TAB_KEY = 'manabind.collectionTab'

/** The Collection's last tab on this device; null when none (or storage is blocked). */
export function lastTab(): string | null {
  try { return localStorage.getItem(TAB_KEY) } catch { return null }
}

export function rememberTab(tab: CollectionTab): void {
  try { localStorage.setItem(TAB_KEY, tab) } catch { /* private window: it opens on Cards next time */ }
}

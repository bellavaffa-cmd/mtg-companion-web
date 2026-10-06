// Getting started with storage: three steps from an empty Storage tab to places with labels on them.
//  1. What the cards are kept in — rough numbers of binders (and their pockets per page), bulk boxes
//     (and how they're sorted), a shelf or cupboard to group the rest. Deck boxes come by themselves:
//     each physical deck is its own.
//  2. Their names ("Binder 1", "Box 1"…, changed as the user likes).
//  3. Labels to print, then putting cards away one box at a time, with how far that's got.
//
// Pure, so it can be tested. Mirrors the Android app's data/StorageSetup.kt rule for rule, with the
// same tests (tests/collection/storageSetup.test.ts ↔ StorageSetupTest.kt).

import type { Collection, Deck, PlaceKind, SortRule, StoragePlace } from '../types/models'
import { DEFAULT_POCKETS, defaultSections, savePlace, SORT_RULES, storagePlace, type StorageSummary } from './storagePlaces'
import { holdsOwnCopies } from './unsorted'

/** Step 1's numbers. [boxRule]: how the bulk boxes are sorted; null, not sorted. */
export interface SetupCounts {
  binders: number
  pockets: number
  boxes: number
  boxRule: SortRule | null
  shelves: number
}

export const DEFAULT_SETUP: SetupCounts = { binders: 2, pockets: DEFAULT_POCKETS, boxes: 3, boxRule: 'COLOUR', shelves: 1 }

/** The pockets per page step 1 offers, in turn. */
export const SETUP_POCKETS = [9, 12, 18, 4]

/** The pockets after [n] in SETUP_POCKETS. */
export const nextPockets = (n: number): number => SETUP_POCKETS[(SETUP_POCKETS.indexOf(n) + 1) % SETUP_POCKETS.length]

/** The sorting rule after [rule] for step 1's bulk boxes: by colour, by set, by type, A–Z, not sorted. */
export function nextBoxRule(rule: SortRule | null): SortRule | null {
  const all: (SortRule | null)[] = [...SORT_RULES, null]
  return all[(all.indexOf(rule) + 1) % all.length]
}

/** One place step 2 names. [key]: "binder-1", "box-2", "shelf-1". */
export interface SetupDraft { key: string; kind: PlaceKind; name: string }

/** A name not already taken (case aside): [base], or "[base] 2", "[base] 3"… */
function freeName(base: string, taken: Set<string>): string {
  let name = base
  let n = 2
  while (taken.has(name.toLowerCase())) name = `${base} ${n++}`
  taken.add(name.toLowerCase())
  return name
}

/**
 * The places [counts] makes, named — shelves first, then binders, then boxes: "Shelf", "Binder 1",
 * "Binder 2", "Box 1"… ("Binder" alone when there's one), none the same as one of [existing].
 */
export function setupDrafts(counts: SetupCounts, existing: StoragePlace[] = []): SetupDraft[] {
  const taken = new Set(existing.map((p) => p.name.trim().toLowerCase()))
  const out: SetupDraft[] = []
  const add = (kind: PlaceKind, prefix: string, word: string, n: number) => {
    for (let i = 1; i <= Math.max(0, n); i++) out.push({ key: `${prefix}-${i}`, kind, name: freeName(n === 1 ? word : `${word} ${i}`, taken) })
  }
  add('SHELF', 'shelf', 'Shelf', counts.shelves)
  add('BINDER', 'binder', 'Binder', counts.binders)
  add('BOX', 'box', 'Box', counts.boxes)
  return out
}

/**
 * The places themselves: each draft with its name ([names] by key, blank keeping the draft's), binders
 * with their pockets, boxes sorted by [counts.boxRule] with that rule's sections, and the binders and
 * boxes inside the first shelf when there is one. Made in order, one millisecond apart from [now].
 */
export function setupPlaces(counts: SetupCounts, drafts: SetupDraft[], names: Record<string, string>, now: number, newId: () => string): StoragePlace[] {
  const ids = new Map(drafts.map((d) => [d.key, newId()]))
  const shelfDraft = drafts.find((d) => d.kind === 'SHELF')
  const shelf = shelfDraft ? ids.get(shelfDraft.key) : undefined
  return drafts.map((d, i) => {
    const sections = d.kind === 'BOX' ? defaultSections(counts.boxRule) : []
    return storagePlace({
      id: ids.get(d.key)!,
      name: names[d.key]?.trim() || d.name,
      kind: d.kind,
      ...(d.kind !== 'SHELF' && shelf ? { parentId: shelf } : {}),
      ...(sections.length > 0 ? { sections } : {}),
      ...(d.kind === 'BINDER' && counts.pockets !== DEFAULT_POCKETS ? { pocketsPerPage: counts.pockets } : {}),
      ...(d.kind === 'BOX' && counts.boxRule ? { sortRule: counts.boxRule } : {}),
      createdAt: now + i,
    })
  })
}

/** [collections] with [made] added to the places. */
export const applySetup = (collections: Collection[], made: StoragePlace[]): Collection[] =>
  made.reduce((c, p) => savePlace(c, p), collections)

/** How many physical decks there are — each its own deck box. */
export const deckBoxCount = (decks: Deck[]): number => decks.filter(holdsOwnCopies).length

/** "92%": the share of copies with a place, rounded down — 100% only when every one has. */
export const placedPercent = (summary: Pick<StorageSummary, 'total' | 'placed'>): number =>
  summary.total <= 0 ? 0 : Math.floor((summary.placed * 100) / summary.total)

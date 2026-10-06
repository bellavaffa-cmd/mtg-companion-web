// Import with locations: a CSV from this app or another (ManaBox's "Binder Name", a "Location",
// "Folder" or "Box" column, this app's own "Place") says where each card is kept. The import shows
// each value of that column with its copies — "Binder 1" 288, "Box R" 612, blank 118 — and the user
// matches each to one of their places, a new place, or no place yet; the copies are then given those
// places as they're added.
//
// Pure, so it can be tested. Mirrors the Android app's data/ImportPlaces.kt rule for rule, with the
// same tests (tests/collection/importPlaces.test.ts ↔ ImportPlacesTest.kt).

import type { Collection, PlaceKind, StoragePlace } from '../types/models'
import type { ListLine } from './cardListText'
import { placeCopies, placePath, placesOf, savePlace } from './storagePlaces'

/** Copies one line of an import said were kept at [value] (as the file spells it). */
export interface ImportedLocation { value: string; qty: number; foil: boolean }

/** The headers that say where a card is kept, best first (lower case). */
const LOCATION_HEADERS = [
  'place', 'places', 'location', 'locations', 'storage location', 'storage place', 'storage',
  'binder name', 'binder', 'folder name', 'folder', 'box', 'box name',
]

/** Any other header with one of these words, unless it's about the kind or an id ("Binder Type"). */
const LOCATION_WORD = /\b(binder|location|folder|storage)\b/
const NOT_LOCATION = /\b(type|id|count|quantity)\b/

/** Which of a CSV's (lower-cased) headers says where cards are kept; -1 when none does. */
export function locationColumnIn(header: string[]): number {
  const trimmed = header.map((h) => h.trim().toLowerCase())
  for (const name of LOCATION_HEADERS) {
    const i = trimmed.indexOf(name)
    if (i >= 0) return i
  }
  return trimmed.findIndex((h) => LOCATION_WORD.test(h) && !NOT_LOCATION.test(h))
}

/** The key a location value is matched by: trimmed, case aside. '' for blank. */
export const locationKey = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase()

/** One value of the location column and how many copies it holds. [value] '' for the rows that leave it blank. */
export interface LocationCount { value: string; copies: number }

/** Each value of the location column with its copies, in the order the file has them; the blank ones last. None when no line says. */
export function locationCounts(lines: ListLine[]): LocationCount[] {
  if (!lines.some((l) => locationKey(l.location))) return []
  const counts = new Map<string, LocationCount>()
  let blank = 0
  for (const l of lines) {
    const key = locationKey(l.location)
    if (!key) { blank += l.quantity; continue }
    const had = counts.get(key)
    counts.set(key, had ? { ...had, copies: had.copies + l.quantity } : { value: l.location!.trim(), copies: l.quantity })
  }
  return [...counts.values(), ...(blank > 0 ? [{ value: '', copies: blank }] : [])]
}

/** Where a location value's copies go: one of the user's places, a new place by that name, or no place yet. */
export type PlaceTarget = { kind: 'place'; placeId: string } | { kind: 'new' } | { kind: 'none' }

/**
 * What each value starts matched to, by locationKey: the place with that name (or path, "Shelf ›
 * Red box") — so this app's own export comes back where it was — else a new place; blank, no place.
 */
export function suggestTargets(counts: LocationCount[], places: StoragePlace[]): Map<string, PlaceTarget> {
  const out = new Map<string, PlaceTarget>()
  for (const c of counts) {
    const key = locationKey(c.value)
    if (!key) { out.set(key, { kind: 'none' }); continue }
    const match = places.find((p) => locationKey(p.name) === key) ?? places.find((p) => locationKey(placePath(places, p.id)) === key)
    out.set(key, match ? { kind: 'place', placeId: match.id } : { kind: 'new' })
  }
  return out
}

/** What a new place made from [value] is: a binder, a deck box, a shelf or a box, by its words — else by the column's ("Binder Name"). */
export function importedPlaceKind(value: string, column: string | null | undefined): PlaceKind {
  const v = value.toLowerCase()
  if (/\bbinders?\b/.test(v)) return 'BINDER'
  if (/\bdeck ?box(es)?\b/.test(v)) return 'DECK_BOX'
  if (/\b(shelf|shelves|cupboard|drawer|cabinet)\b/.test(v)) return 'SHELF'
  if (/\bbox(es)?\b/.test(v)) return 'BOX'
  if ((column ?? '').toLowerCase().includes('binder')) return 'BINDER'
  return 'BOX'
}

/** One card's copies an import added to [collectionId], and where the list said they're kept. */
export interface ImportedPlacement { scryfallId: string; locations: ImportedLocation[] }

/**
 * [collections] after an import into [collectionId]: a new place made for each value matched to
 * 'new' (its kind from its words, see importedPlaceKind), and the imported copies given the place
 * their value is matched to — up to the entry's copies with no place, plain and foil apart. Values
 * left out of [targets] or matched to no place stay with no place.
 */
export function applyImportedPlaces(
  collections: Collection[],
  collectionId: string,
  placements: ImportedPlacement[],
  targets: Map<string, PlaceTarget>,
  column: string | null | undefined,
  now: number,
  newId: () => string,
): Collection[] {
  if (!placements.some((p) => p.locations.length > 0)) return collections
  let out = collections
  const places = placesOf(out)
  // The values matched to a new place, each made once, in the file's order.
  const ids = new Map<string, string>()
  let made = 0
  for (const p of placements) {
    for (const l of p.locations) {
      const key = locationKey(l.value)
      if (!key || ids.has(key)) continue
      const t = targets.get(key)
      if (t?.kind === 'place') {
        if (places.some((x) => x.id === t.placeId)) ids.set(key, t.placeId)
      } else if (t?.kind === 'new') {
        const id = newId()
        out = savePlace(out, { id, name: l.value.trim(), kind: importedPlaceKind(l.value, column), createdAt: now + made++ })
        ids.set(key, id)
      }
    }
  }
  if (ids.size === 0) return out
  return out.map((c) => {
    if (c.id !== collectionId) return c
    return {
      ...c,
      entries: c.entries.map((e) => {
        const p = placements.find((x) => x.scryfallId === e.scryfallId)
        if (!p) return e
        let entry = e
        for (const l of p.locations) {
          const id = ids.get(locationKey(l.value))
          if (!id) continue
          entry = placeCopies(entry, { placeId: id }, l.qty, l.foil).entry
        }
        return entry
      }),
    }
  })
}

/** How many of [counts]' values go to a new place. */
export const newPlaceCount = (counts: LocationCount[], targets: Map<string, PlaceTarget>): number =>
  counts.filter((c) => locationKey(c.value) && targets.get(locationKey(c.value))?.kind === 'new').length

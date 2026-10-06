// Photos of your copy: front and back pictures of one particular copy of a card, with what it was
// bought for and where, and when it was photographed — for insurance, a sale or a grading
// submission. The photos and those details stay in the browser that took them (copyPhotoStore.ts, in
// IndexedDB; the Android app keeps its own on the phone): they aren't synced. The copy's condition is
// the binder entry's (CollectionEntry.condition), which does sync.
//
// A copy is told apart by its printing, its finish and its number among the copies of that printing
// and finish — copy 1, copy 2… counted through the Unsorted pile first, then the binders. Photos go in
// the Value by place PDF report beside the cards they're of. "Ask for photos when adding a card worth
// over $X" is a setting kept in the browser too.
//
// Pure, so it can be tested. Mirrors the Android app's data/CopyPhotos.kt rule for rule, with the same
// tests (tests/collection/copyPhotos.test.ts ↔ CopyPhotosTest.kt).

import { isUnsorted, type Collection, type CopyPlace, type StoragePlace } from '../types/models'
import { placedCopies, placesOf, sameCardName } from './storagePlaces'

/** The key a copy's photos are kept under: "scryfallId|foil|2" ("" for a plain copy). */
export const photoKey = (scryfallId: string, foil: boolean, n: number): string => `${scryfallId}|${foil ? 'foil' : ''}|${n}`

/**
 * One copy of a card: its key (photoKey), printing, finish and number, the binder it's in, and where
 * it's kept — "Rares binder p2 s1", "Red box › Red", "No place yet". [placeId] null with no place.
 */
export interface CopyRef {
  key: string
  collectionId: string
  scryfallId: string
  name: string
  foil: boolean
  n: number
  placeId: string | null
  where: string
  condition: string | null
}

/** "Rares binder p2 s1", "Red box › Red", "Red box". */
export function copySpotLabel(place: StoragePlace, line: CopyPlace): string {
  if (line.page && line.slot) return `${place.name} p${line.page} s${line.slot}`
  if (line.section) return `${place.name} › ${line.section}`
  return place.name
}

/**
 * Every copy owned of the card called [name] (any printing), one by one: the Unsorted pile's, then the
 * binders'; in each entry the plain copies, then the foils — those with a place first, in the order of
 * its lines.
 */
export function copiesOfCard(collections: Collection[], name: string): CopyRef[] {
  const places = new Map(placesOf(collections).map((p) => [p.id, p]))
  const mine = collections.filter((c) => c.type !== 'WISHLIST')
  const counted = new Map<string, number>()
  const out: CopyRef[] = []
  for (const c of [...mine.filter(isUnsorted), ...mine.filter((x) => !isUnsorted(x))]) {
    for (const e of c.entries) {
      if (!sameCardName(e.name, name)) continue
      const lines = placedCopies(e).filter((l) => places.has(l.placeId))
      for (const foil of [false, true]) {
        let left = foil ? e.foilQuantity ?? 0 : e.quantity
        const add = (placeId: string | null, where: string) => {
          const k = `${e.scryfallId}|${foil}`
          const n = (counted.get(k) ?? 0) + 1
          counted.set(k, n)
          out.push({ key: photoKey(e.scryfallId, foil, n), collectionId: c.id, scryfallId: e.scryfallId, name: e.name, foil, n, placeId, where, condition: e.condition ?? null })
        }
        for (const line of lines.filter((l) => !!l.foil === foil)) {
          for (let i = Math.max(0, Math.min(line.qty, left)); i > 0; i--) {
            add(line.placeId, copySpotLabel(places.get(line.placeId)!, line))
            left--
          }
        }
        for (; left > 0; left--) add(null, 'No place yet')
      }
    }
  }
  return out
}

/**
 * A copy's photos and details, kept in the browser. [front] and [back]: the photos' ids in the store
 * (left out: none taken); [boughtUsd]: what it cost, in US dollars; [photographedAt]: when the photos
 * were last taken, in milliseconds.
 */
export interface CopyPhoto {
  key: string
  scryfallId: string
  name: string
  foil?: boolean
  front?: string
  back?: string
  boughtUsd?: number
  boughtWhere?: string
  photographedAt?: number
}

export const hasPhotos = (p: CopyPhoto): boolean => !!(p.front || p.back)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "5 Oct 2026" for the calendar day "2026-10-05". */
export function photoDayLabel(day: string): string {
  const parts = day.split('-').map((p) => Number(p))
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p)) || parts[1] < 1 || parts[1] > 12) return day
  return `${parts[2]} ${MONTHS[parts[1] - 1]} ${parts[0]}`
}

/** "$58 · Card shop", "$58", "Card shop", or "" — [money] writes the dollars in the user's currency. */
export function boughtLabel(photo: CopyPhoto | null | undefined, money: (usd: number) => string): string {
  return [photo?.boughtUsd !== undefined ? money(photo.boughtUsd) : null, photo?.boughtWhere?.trim() || null].filter(Boolean).join(' · ')
}

/** Whether to ask for photos of a card just added: it's worth over the setting ([over], US dollars; null: never ask). */
export const askForPhotos = (usd: number | null | undefined, over: number | null | undefined): boolean =>
  over != null && over >= 0 && usd != null && usd > over

/** The photos to put in the report: copies still owned ([owned] scryfallIds) with a photo, by name. */
export function photosForReport(photos: CopyPhoto[], owned: ReadonlySet<string>): CopyPhoto[] {
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return photos.filter((p) => hasPhotos(p) && owned.has(p.scryfallId))
    .sort((a, b) => byText(a.name.toLowerCase(), b.name.toLowerCase()) || byText(a.key, b.key))
}

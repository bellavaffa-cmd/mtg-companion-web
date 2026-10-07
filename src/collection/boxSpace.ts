// Box space: how full a place is. A place can have a size — a box (or a shelf, or anything but a
// binder) the cards it holds (StoragePlace.capacity), a binder its pages (StoragePlace.pages) of
// pockets — and then shows "96% full · 612 of 640" and "Room for about 28 more". Putting cards away
// and sorting a pile warn when a box will overflow, and a full box sorted into sections can be split
// into two on whole sections ("Red box" keeps White, Blue, Black; "Red box 2" takes Red, Green…), the
// copies in the sections that go moving with them.
//
// Pure, so it can be tested. Mirrors the Android app's data/BoxSpace.kt rule for rule, with the same
// tests (tests/collection/boxSpace.test.ts ↔ BoxSpaceTest.kt).

import type { Collection, StoragePlace } from '../types/models'
import type { CopyMove } from './copyHistory'
import { binderPockets, looseCopies } from './binderPages'
import { pileDestination, type SortSession } from './sortPiles'
import {
  cardsIn, placedCopies, placesOf, placeTree, pocketsOf, sectionsOf, storagePlace, withPlaceList, withPlaces,
  type PlacedCard, type SectionGroup,
} from './storagePlaces'

/** A place this full (per cent) or more is shown as nearly full. */
export const NEARLY_FULL = 90

/** How many cards [place] holds: a binder's pages × its pockets, anything else its capacity. Null when no size is set. */
export function placeSize(place: StoragePlace): number | null {
  if (place.kind === 'BINDER') return place.pages && place.pages > 0 ? place.pages * pocketsOf(place) : null
  return place.capacity && place.capacity > 0 ? place.capacity : null
}

/** What a size is counted in: "pockets" for a binder, "cards" for anything else. */
export const sizeUnit = (place: StoragePlace): string => (place.kind === 'BINDER' ? 'pockets' : 'cards')

/** [place] with its size set to [n] — a binder's pages, anything else's cards; 0 takes the size off. */
export const withSize = (place: StoragePlace, n: number): StoragePlace =>
  place.kind === 'BINDER' ? { ...place, pages: Math.max(0, n) } : { ...place, capacity: Math.max(0, n) }

/** The number the size is set by: a binder's pages, anything else's cards; null when not set. */
export function sizeSetting(place: StoragePlace): number | null {
  const n = place.kind === 'BINDER' ? place.pages : place.capacity
  return n && n > 0 ? n : null
}

/**
 * How much of a place is used by [cards] (cardsIn — the copies in it itself): a binder's pockets in use
 * and the copies waiting beside it for one, anything else's copies.
 */
export function spaceUsed(place: StoragePlace, cards: PlacedCard[]): number {
  if (place.kind === 'BINDER') return binderPockets(place, cards).length + looseCopies(place, cards).length
  return cards.reduce((n, c) => n + c.line.qty, 0)
}

/** How full a place is: [used] of [size]. */
export interface Space { placeId: string; used: number; size: number }

/** Per cent full, rounded: 96. */
export const spacePercent = (s: Space): number => (s.size > 0 ? Math.round((s.used * 100) / s.size) : 0)
/** Room left; below 0 when it's over. */
export const spaceRoom = (s: Space): number => s.size - s.used
export const nearlyFull = (s: Space): boolean => s.size > 0 && s.used * 100 >= s.size * NEARLY_FULL

/** How full [place] is, or null when it has no size. */
export function spaceOf(place: StoragePlace, collections: Collection[], cards?: PlacedCard[]): Space | null {
  const size = placeSize(place)
  if (size === null) return null
  // [cards]: the place's own copies when the caller has them already (cardsByPlace), in any order.
  return { placeId: place.id, used: spaceUsed(place, cards ?? cardsIn(collections, place.id)), size }
}

/** "96% full · 612 of 640" when nearly full, else "288 of 360 pockets" (a binder) or "312 of 640". */
export function spaceLabel(place: StoragePlace, space: Space): string {
  const of = `${space.used} of ${space.size}${place.kind === 'BINDER' ? ' pockets' : ''}`
  return nearlyFull(space) ? `${spacePercent(space)}% full · ${of}` : of
}

/** "Room for about 28 more. Your last pile added 38." — "Full." or "Over by 4." when there's no room. */
export function roomLine(space: Space, lastPile: number | null = null): string {
  const r = spaceRoom(space)
  const room = r > 0 ? `Room for about ${r} more.` : r === 0 ? 'Full.' : `Over by ${-r}.`
  return lastPile && lastPile > 0 ? `${room} Your last pile added ${lastPile}.` : room
}

/** Moves of a card that go together, as one pile: no more than this apart. */
export const PILE_GAP_MS = 30 * 60 * 1000

/**
 * How many copies the last pile put into [placeId] (the copy history, collection/copyHistory.ts —
 * oldest first): the cards added or put away into it within half an hour of each other, back from the
 * latest. Null when none have been.
 */
export function lastPileAdded(log: CopyMove[], placeId: string): number | null {
  const into = log.filter((m) => (m.kind === 'ADDED' || m.kind === 'PUT_AWAY') && (m.places ?? [])[0] === placeId)
  if (into.length === 0) return null
  let total = 0
  let after = into[into.length - 1].at
  for (let i = into.length - 1; i >= 0; i--) {
    if (after - into[i].at > PILE_GAP_MS) break
    total += into[i].qty
    after = into[i].at
  }
  return total
}

// ---- Overflowing ----

/** A place that won't hold what's going in: [adding] cards with room for [room] (0 or less: full already). */
export interface Overflow { placeId: string; name: string; adding: number; room: number }

/** The places that [adding] (cards going in, by place id) would overflow, in tree order. */
export function overflows(collections: Collection[], adding: Map<string, number>): Overflow[] {
  const out: Overflow[] = []
  for (const node of placeTree(placesOf(collections))) {
    const n = adding.get(node.place.id) ?? 0
    if (n <= 0) continue
    const space = spaceOf(node.place, collections)
    if (!space) continue
    if (n > spaceRoom(space)) out.push({ placeId: node.place.id, name: node.place.name, adding: n, room: spaceRoom(space) })
  }
  return out
}

/** "Red box will overflow: room for about 28, this adds 38." or "Red box is full already." */
export function overflowLine(o: Overflow): string {
  if (o.room <= 0) return `${o.name} is full already${o.room < 0 ? ` (over by ${-o.room})` : ''}.`
  return `${o.name} will overflow: room for about ${o.room}, this adds ${o.adding}.`
}

/** The cards a sort session files into each place (collection/sortPiles.ts), by place id. */
export function pileAdds(collections: Collection[], session: SortSession): Map<string, number> {
  const out = new Map<string, number>()
  for (const scan of session.scans) {
    const { spot } = pileDestination(session.rules[scan.pile], scan.facts, collections)
    if (!spot) continue
    out.set(spot.placeId, (out.get(spot.placeId) ?? 0) + 1)
  }
  return out
}

// ---- Splitting a box ----

/** A box split in two: the sections that stay and the ones that go to the new box, and the copies each way. */
export interface SplitPlan { stay: SectionGroup[]; go: SectionGroup[]; stayCopies: number; goCopies: number }

/**
 * Where to split [place] (its [cards], cardsIn) into two boxes: on whole sections, in their order —
 * the first ones stay, the rest go — as near half and half as the sections allow (the earlier split
 * when two are as near). Copies in no section stay. Null when it has fewer than two sections.
 */
export function planSplit(place: StoragePlace, cards: PlacedCard[]): SplitPlan | null {
  const all = sectionsOf(place, cards)
  const named = all.filter((s) => s.name !== null)
  if (named.length < 2) return null
  const loose = all.filter((s) => s.name === null).reduce((n, s) => n + s.copies, 0)
  const total = named.reduce((n, s) => n + s.copies, 0)
  let best = 1
  let bestGap = Infinity
  let run = 0
  for (let k = 1; k < named.length; k++) {
    run += named[k - 1].copies
    const gap = Math.abs(total - 2 * run)
    if (gap < bestGap) { bestGap = gap; best = k }
  }
  const stay = named.slice(0, best)
  const go = named.slice(best)
  const sum = (list: SectionGroup[]) => list.reduce((n, s) => n + s.copies, 0)
  return { stay, go, stayCopies: sum(stay) + loose, goCopies: sum(go) }
}

/** "Red box 2" for "Red box" (and "Red box 3" when that's taken, or for "Red box 2"). */
export function nextBoxName(places: StoragePlace[], name: string): string {
  const base = name.trim().replace(/\s+\d+$/, '') || name.trim()
  const taken = new Set(places.map((p) => p.name.trim().toLowerCase()))
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}

/** "White, Blue, Black · 289". */
export const splitSideLabel = (sections: SectionGroup[], copies: number): string =>
  `${sections.map((s) => s.name).filter((n): n is string => n !== null).join(', ')} · ${copies}`

/**
 * [collections] with the box [placeId] split by [plan]: a new box [newId] beside it (same kind, rule,
 * size and note, named by nextBoxName) takes the sections that go, and the copies in them move to it,
 * in the same sections. The same list when the box isn't there.
 */
export function splitBox(collections: Collection[], placeId: string, plan: SplitPlan, newId: string, now: number): Collection[] {
  const places = placesOf(collections)
  const place = places.find((p) => p.id === placeId)
  if (!place) return collections
  const going = plan.go.map((s) => s.name).filter((n): n is string => n !== null)
  const goingKeys = new Set(going.map((n) => n.toLowerCase()))
  const goes = (l: { placeId: string; section?: string }) => l.placeId === placeId && goingKeys.has((l.section ?? '').toLowerCase())
  const { lastChecked: _checked, ...rest } = place
  const made = storagePlace({ ...rest, id: newId, name: nextBoxName(places, place.name), sections: going, createdAt: now })
  const kept = storagePlace({ ...place, ...(place.sections ? { sections: place.sections.filter((s) => !goingKeys.has(s.toLowerCase())) } : {}) })
  const moved = collections.map((c) => {
    if (!c.entries.some((e) => (e.places ?? []).some(goes))) return c
    return {
      ...c,
      entries: c.entries.map((e) => {
        const lines = placedCopies(e)
        if (!lines.some(goes)) return e
        return withPlaces(e, lines.map((l) => (goes(l) ? { ...l, placeId: newId } : l)))
      }),
    }
  })
  return withPlaceList(moved, places.flatMap((p) => (p.id === placeId ? [kept, made] : [p])))
}

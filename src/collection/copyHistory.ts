// A copy's history: where a card has been — added, put away, moved, pulled into a deck, put back,
// lent, returned, checked, sold — as an append-only log kept on this device only (it isn't synced:
// each device remembers what was done on it). "History" on a card's Where it is shows its moves;
// "Recent moves" on a place's page shows the moves in and out of it. Kept for a year (pruneMoves).
//
// The log is written where the moves are made (copyHistoryStore.ts keeps it in the browser); this
// file is the pure part — the entries, their words and the pruning.
//
// Pure, so it can be tested. Mirrors the Android app's data/CopyHistory.kt rule for rule, with the same
// tests (tests/collection/copyHistory.test.ts ↔ CopyHistoryTest.kt).

import { sameCardName } from './storagePlaces'

export type MoveKind = 'ADDED' | 'PUT_AWAY' | 'MOVED' | 'PULLED' | 'PUT_BACK' | 'LENT' | 'RETURNED' | 'CHECKED' | 'SOLD'

/**
 * One move of one card's copies. [title] and [detail] are the words shown ("Put away in Red box",
 * "from Unsorted, by scanning"); [places] the ids of the places it touched, for a place's Recent moves.
 */
export interface CopyMove {
  at: number
  kind: MoveKind
  name: string
  scryfallId?: string
  qty: number
  title: string
  detail?: string
  places?: string[]
}

/** How long moves are kept. */
export const KEEP_MOVES_MS = 365 * 24 * 60 * 60 * 1000
/** At most this many moves are kept, the newest. */
export const MAX_MOVES = 5000

/** [log] without moves older than a year, and no more than MAX_MOVES — the newest kept. Oldest first. */
export function pruneMoves(log: CopyMove[], now: number): CopyMove[] {
  const kept = log.filter((m) => m.at >= now - KEEP_MOVES_MS)
  return kept.length > MAX_MOVES ? kept.slice(kept.length - MAX_MOVES) : kept
}

/** [log] with [moves] added after it (oldest first, by time), then pruned. */
export function appendMoves(log: CopyMove[], moves: CopyMove[], now: number): CopyMove[] {
  if (moves.length === 0) return pruneMoves(log, now)
  const all = [...log, ...moves.map(tidyMove)]
  // Stable: moves at the same moment keep the order they were made in.
  return pruneMoves(all.map((m, i) => ({ m, i })).sort((a, b) => a.m.at - b.m.at || a.i - b.i).map((x) => x.m), now)
}

/** A move as kept: optional fields left out when empty. */
export function tidyMove(m: CopyMove): CopyMove {
  return {
    at: m.at,
    kind: m.kind,
    name: m.name,
    ...(m.scryfallId ? { scryfallId: m.scryfallId } : {}),
    qty: Math.max(1, m.qty),
    title: m.title,
    ...(m.detail ? { detail: m.detail } : {}),
    ...(m.places && m.places.some(Boolean) ? { places: [...new Set(m.places.filter(Boolean))] } : {}),
  }
}

/** The moves of the card called [name] (any printing), newest first. */
export const movesOfCard = (log: CopyMove[], name: string): CopyMove[] =>
  log.filter((m) => sameCardName(m.name, name)).reverse()

/** The moves in and out of [placeIds] (a place and those inside it), newest first, at most [limit]. */
export const movesOfPlace = (log: CopyMove[], placeIds: Set<string>, limit = 20): CopyMove[] =>
  log.filter((m) => m.places?.some((p) => placeIds.has(p))).reverse().slice(0, limit)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The day of a move, as the list shows it: "Today", "Yesterday", "12 Sep", or "12 Sep 2025" in another
 * year. [day] and [today] are calendar days ("2026-09-12") on this device.
 */
export function moveDay(day: string, today: string): string {
  if (day === today) return 'Today'
  const ms = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
  if (Math.round((ms(today) - ms(day)) / 86_400_000) === 1) return 'Yesterday'
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`
}

// ---- The words for each move ----

const times = (qty: number) => (qty > 1 ? ` ×${qty}` : '')

/** "Added to your collection" — from where, when said ("from a trade with Priya", "Booster box, Duskmourn"). */
export const addedMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, to: { id: string; name: string } | null, from?: string): CopyMove =>
  tidyMove({
    at, kind: 'ADDED', name: card.name, scryfallId: card.scryfallId, qty,
    title: `Added to your collection${times(qty)}`,
    detail: [to ? `into ${to.name}` : '', from ?? ''].filter(Boolean).join(' · '),
    places: to ? [to.id] : [],
  })

/** "Put away in Red box" — "from Unsorted, by scanning". */
export const putAwayMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, to: { id: string; name: string }, from: { id: string; name: string } | null, how?: string): CopyMove =>
  tidyMove({
    at, kind: 'PUT_AWAY', name: card.name, scryfallId: card.scryfallId, qty,
    title: `Put away in ${to.name}${times(qty)}`,
    detail: [`from ${from?.name ?? 'no place'}`, how ?? ''].filter(Boolean).join(', '),
    places: [to.id, ...(from ? [from.id] : [])],
  })

/** "Moved to Trade binder" — "from Red box", or "Taken off its place" when it goes to none. */
export const movedMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, from: { id: string; name: string } | null, to: { id: string; name: string } | null): CopyMove =>
  tidyMove({
    at, kind: 'MOVED', name: card.name, scryfallId: card.scryfallId, qty,
    title: to ? `Moved to ${to.name}${times(qty)}` : `Taken off its place${times(qty)}`,
    detail: from ? `from ${from.name}` : 'from no place',
    places: [...(from ? [from.id] : []), ...(to ? [to.id] : [])],
  })

/** "Pulled into Atraxa deck" — "from Red box › Colourless". */
export const pulledMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, deck: string, from: { id: string; name: string } | null): CopyMove =>
  tidyMove({
    at, kind: 'PULLED', name: card.name, scryfallId: card.scryfallId, qty,
    title: `Pulled into ${deck} deck${times(qty)}`,
    detail: from ? `from ${from.name}` : 'from no place',
    places: from ? [from.id] : [],
  })

/** "Put back in Red box" — "from Atraxa deck". */
export const putBackMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, deck: string, to: { id: string; name: string } | null): CopyMove =>
  tidyMove({
    at, kind: 'PUT_BACK', name: card.name, scryfallId: card.scryfallId, qty,
    title: to ? `Put back in ${to.name}${times(qty)}` : `Taken out of ${deck} deck${times(qty)}`,
    detail: `from ${deck} deck`,
    places: to ? [to.id] : [],
  })

/** "Lent to Sam" — "from Atraxa deck · back by next game night". */
export const lentMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, to: string, from: string, fromPlaceId: string | null, due: string | null): CopyMove =>
  tidyMove({
    at, kind: 'LENT', name: card.name, scryfallId: card.scryfallId, qty,
    title: `Lent to ${to}${times(qty)}`,
    detail: [`from ${from}`, due ? due.charAt(0).toLowerCase() + due.slice(1) : ''].filter(Boolean).join(' · '),
    places: fromPlaceId ? [fromPlaceId] : [],
  })

/** "Back from Sam" — "into Rares binder". */
export const returnedMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, from: string, to: string, toPlaceId: string | null): CopyMove =>
  tidyMove({
    at, kind: 'RETURNED', name: card.name, scryfallId: card.scryfallId, qty,
    title: `Back from ${from}${times(qty)}`,
    detail: `into ${to}`,
    places: toPlaceId ? [toPlaceId] : [],
  })

/** "Checked in Red box" — "where it should be". */
export const checkedMove = (at: number, card: { name: string; scryfallId?: string }, place: { id: string; name: string }, result: string): CopyMove =>
  tidyMove({ at, kind: 'CHECKED', name: card.name, scryfallId: card.scryfallId, qty: 1, title: `Checked in ${place.name}`, detail: result, places: [place.id] })

/** "Sold" — "to Priya", "from Trade binder". */
export const soldMove = (at: number, card: { name: string; scryfallId?: string }, qty: number, detail: string, fromPlaceId: string | null): CopyMove =>
  tidyMove({ at, kind: 'SOLD', name: card.name, scryfallId: card.scryfallId, qty, title: `Sold${times(qty)}`, detail, places: fromPlaceId ? [fromPlaceId] : [] })

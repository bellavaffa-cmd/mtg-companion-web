/**
 * The seat you're sitting in, remembered so you can get back to it.
 *
 * Taking a seat is a QR scan, and the code is on someone else's phone across the table — so leaving
 * the remote (to look up a card, or by pressing back) used to mean asking them to show it again.
 * Leaving the screen doesn't leave the seat: the table still has your name, so the way back is worth
 * keeping. Only "Leave this seat", the table ending, or someone else taking the seat forgets it.
 */

const KEY = 'mtgweb_remote_seat'

/** Long enough for a game night, short enough that yesterday's table isn't still offered. */
const STALE_MS = 12 * 60 * 60 * 1000

export interface SeatMemory {
  matchId: string
  seat: number
  /** When we last knew the seat was ours. */
  at: number
}

export function rememberSeat(matchId: string, seat: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ matchId, seat, at: Date.now() } satisfies SeatMemory))
  } catch {
    // Private mode: the way back just isn't offered.
  }
}

export function forgetSeat(): void {
  try { localStorage.removeItem(KEY) } catch { /* nothing to forget */ }
}

/** The seat to offer a way back to, or null when there isn't one worth offering. */
export function rememberedSeat(now = Date.now()): SeatMemory | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const seat = JSON.parse(raw) as SeatMemory
    if (!seat?.matchId || !Number.isFinite(seat.seat)) return null
    if (now - seat.at > STALE_MS) { forgetSeat(); return null }
    return seat
  } catch {
    return null
  }
}

/** Where the remote for [seat] lives. */
export const remotePath = (seat: SeatMemory) => `/remote/${seat.matchId}/${seat.seat}`

/**
 * The scanning list: one row per scan, newest first, in the order the cards went past the camera.
 * A card read twice shows twice — that's the point, since a double scan and a card read wrongly
 * both have to be findable — and the rows say which copy they are. Copies are added together only
 * when the pile is put into a binder or deck. Mirrors the Android app's data/ScanLog.kt.
 */

import type { ScryfallCard } from '../types/scryfall'

/** [id] counts up per scan, so rows stay apart even when they're the same card. */
export interface ScanRow {
  id: number
  card: ScryfallCard
  foil: boolean
  /**
   * Whether the printing was read off the card (its set code and collector number) rather than
   * guessed from the name. A guess is the card's usual printing, which may not be the one in hand.
   */
  exact?: boolean
  /** When it was scanned (ms), for spotting a card read twice in the same breath. */
  at: number
}

/** A repeat within this long of the card's last scan reads as the camera catching it twice. */
export const DOUBLE_MS = 8000

/** Which copy of its card this row is, counting from the first scan. 1 the first time. */
export function copyNumber(rows: ScanRow[], row: ScanRow): number {
  return rows.filter((r) => r.card.id === row.card.id && r.id <= row.id).length
}

/** Whether the same card was scanned again within [withinMs] — the camera catching one card twice. */
export function scannedTwiceOver(rows: ScanRow[], row: ScanRow, withinMs = DOUBLE_MS): boolean {
  const before = rows.filter((r) => r.card.id === row.card.id && r.id < row.id)
  const last = before[0] // rows are newest first, so the first match is the closest earlier scan
  return !!last && row.at - last.at <= withinMs
}

/** The cards scanned more than once, by card id. */
export function repeatedCards(rows: ScanRow[]): Set<string> {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.card.id)) twice.add(row.card.id)
    seen.add(row.card.id)
  }
  return twice
}

/** Just the rows of cards scanned more than once — "show me what I may have double-scanned". */
export function onlyRepeats(rows: ScanRow[]): ScanRow[] {
  const twice = repeatedCards(rows)
  return rows.filter((r) => twice.has(r.card.id))
}

/** What goes into a binder or deck: the rows added together, oldest scan first. */
export function grouped(rows: ScanRow[]): { card: ScryfallCard; foil: boolean; quantity: number }[] {
  const out: { card: ScryfallCard; foil: boolean; quantity: number }[] = []
  for (const row of [...rows].reverse()) {
    const had = out.find((g) => g.card.id === row.card.id && g.foil === row.foil)
    if (had) had.quantity += 1
    else out.push({ card: row.card, foil: row.foil, quantity: 1 })
  }
  return out
}

/** How many cards are in the pile, however many rows they take. */
export const totalScanned = (rows: ScanRow[]) => rows.length

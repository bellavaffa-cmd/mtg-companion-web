/**
 * Seat arrangements for the life counter — a port of the Android app's TableLayouts.kt, so both
 * apps offer the same seatings with the same ids.
 *
 * [facing] is the edge of the screen a seat's player sits at, with the device lying flat in the
 * middle of the table; a tile is turned so the bottom of its content points at that edge.
 */
export type SeatFacing = 'BOTTOM' | 'LEFT' | 'TOP' | 'RIGHT'

/** One cell of a table layout. A null [seat] is an empty place at the table, drawn as a blank. */
export interface SeatCell { seat: number | null; facing: SeatFacing }
export interface TableRow { cells: SeatCell[] }
export interface TableLayout { id: string; rows: TableRow[] }

export const DEFAULT_LAYOUT_ID = '4-grid'

const full = (seat: number | null, facing: SeatFacing): TableRow => ({ cells: [{ seat, facing }] })
const pair = (left: number | null, right: number | null): TableRow => ({
  cells: [{ seat: left, facing: 'LEFT' }, { seat: right, facing: 'RIGHT' }],
})

/**
 * [pairs] side-by-side rows. Seats are numbered in turn order clockwise around the table: bottom
 * seat if any, up the left side, across the top, down the right side.
 */
function columns(id: string, pairs: number, top = false, bottom = false): TableLayout {
  let next = 1
  const bottomSeat = bottom ? next++ : null
  const leftSeats = Array.from({ length: pairs }, () => next++).reverse()
  const topSeat = top ? next++ : null
  const rightSeats = Array.from({ length: pairs }, () => next++)
  const rows: TableRow[] = []
  if (topSeat !== null) rows.push(full(topSeat, 'TOP'))
  for (let i = 0; i < pairs; i++) rows.push(pair(leftSeats[i], rightSeats[i]))
  if (bottomSeat !== null) rows.push(full(bottomSeat, 'BOTTOM'))
  return { id, rows }
}

export const TABLE_LAYOUTS: TableLayout[] = [
  { id: '1-solo', rows: [full(1, 'BOTTOM')] },

  { id: '2-facing', rows: [full(2, 'TOP'), full(1, 'BOTTOM')] },
  { id: '2-sides', rows: [pair(1, 2)] },

  columns('3-top', 1, true),
  columns('3-bottom', 1, false, true),
  { id: '3-gap', rows: [pair(2, 3), pair(1, null)] },

  columns(DEFAULT_LAYOUT_ID, 2),
  columns('4-ends', 1, true, true),

  columns('5-top', 2, true),
  columns('5-bottom', 2, false, true),

  columns('6-grid', 3),
  columns('6-ends', 2, true, true),

  columns('7-top', 3, true),
  columns('7-bottom', 3, false, true),

  columns('8-grid', 4),
  columns('8-ends', 3, true, true),

  columns('9-top', 4, true),
  columns('9-bottom', 4, false, true),

  columns('10-grid', 5),
  columns('10-ends', 4, true, true),
]

export function layoutById(id: string): TableLayout {
  return TABLE_LAYOUTS.find((l) => l.id === id) ?? TABLE_LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID)!
}

export function playerCount(layout: TableLayout): number {
  return layout.rows.reduce((n, row) => n + row.cells.filter((c) => c.seat !== null).length, 0)
}

/** Spoken name for the seating picker, e.g. "4 players, one at each end". */
export function layoutDescription(layout: TableLayout): string {
  const count = playerCount(layout)
  const players = count === 1 ? '1 player' : `${count} players`
  const shape: Record<string, string> = {
    facing: 'facing each other',
    sides: 'side by side',
    top: 'one at the top',
    bottom: 'one at the bottom',
    gap: 'with an empty seat',
    grid: 'in a grid',
    ends: 'one at each end',
  }
  const s = shape[layout.id.slice(layout.id.indexOf('-') + 1)]
  return s ? `${players}, ${s}` : players
}

/** A stretch of the table: one full-length end seat, or a run of rows whose two seats face each other. */
export type TableSection = { kind: 'end'; cell: SeatCell } | { kind: 'pairs'; rows: TableRow[] }

/** Groups the layout's rows into end seats and runs of facing pairs, top to bottom (portrait). */
export function sections(layout: TableLayout): TableSection[] {
  const out: TableSection[] = []
  let run: TableRow[] = []
  for (const row of layout.rows) {
    if (row.cells.length >= 2) {
      run.push(row)
    } else {
      if (run.length > 0) { out.push({ kind: 'pairs', rows: run }); run = [] }
      if (row.cells[0]) out.push({ kind: 'end', cell: row.cells[0] })
    }
  }
  if (run.length > 0) out.push({ kind: 'pairs', rows: run })
  return out
}

/**
 * Where a seat's edge ends up once the device is turned a quarter turn on the table. Players don't
 * move, so each tile follows its player to the new screen edge.
 */
export function turned(facing: SeatFacing, clockwise: boolean): SeatFacing {
  const cw: Record<SeatFacing, SeatFacing> = { TOP: 'RIGHT', RIGHT: 'BOTTOM', BOTTOM: 'LEFT', LEFT: 'TOP' }
  const ccw: Record<SeatFacing, SeatFacing> = { TOP: 'LEFT', LEFT: 'BOTTOM', BOTTOM: 'RIGHT', RIGHT: 'TOP' }
  return clockwise ? cw[facing] : ccw[facing]
}

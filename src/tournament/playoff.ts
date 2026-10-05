// After the Swiss rounds: a single-elimination top 8, 4 or 2, seeded by the standings (1 v 8, 4 v 5,
// 2 v 7, 3 v 6, so the top two seeds can only meet in the final), or for Commander pods a final table
// where the top 4 play one game. Saved with the event as Tournament.playoff; an event saved before
// this has none. Pure. Mirrors the Android app's data/tournament/Playoff.kt.

import {
  activePlayers, currentRound, roundComplete, standings, type EventFormat, type ResultChoice, type TableResult, type Tournament,
} from './tournament'

export type PlayoffKind = 'BRACKET' | 'FINAL_TABLE'

/** One playoff table: its players (null: waiting on an earlier match), higher seed first, and its result. */
export interface PlayoffMatch {
  players: (string | null)[]
  result: TableResult | null
}

export interface Playoff {
  kind: PlayoffKind
  /** How many made the cut. */
  size: number
  /** Round by round, the first round first; each round's matches in bracket order. */
  rounds: PlayoffMatch[][]
}

/** The cuts a 1v1 event can make. */
export const BRACKET_SIZES = [8, 4, 2]

/** Seeds in bracket order for a bracket of [size] (a power of two): 8 gives 1, 8, 4, 5, 2, 7, 3, 6. */
export function seedOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const n = order.length * 2
    order = order.flatMap((s) => [s, n + 1 - s])
  }
  return order
}

/** Whether [t] can cut to a playoff now: its Swiss rounds are all played (or it's finished) and none has been made. */
export function canCut(t: Tournament): boolean {
  if (t.playoff || t.rounds.length === 0 || !roundComplete(currentRound(t))) return false
  return t.finished || t.rounds.length >= t.roundCount
}

/** The cuts [t] can make: tops that fit its players still in (Swiss), or a final table of up to 4 (pods). */
export function cutSizes(t: Tournament): number[] {
  const n = activePlayers(t).length
  if (t.format === 'PODS') return n >= 2 ? [Math.min(4, n)] : []
  return BRACKET_SIZES.filter((s) => s <= n)
}

/** How many rounds a playoff of [size] has. */
export const playoffRoundCount = (kind: PlayoffKind, size: number) => (kind === 'FINAL_TABLE' ? 1 : Math.round(Math.log2(size)))

/** [t] cut to its top [size]: seeded by the standings (dropped players don't make it), the Swiss finished. */
export function startPlayoff(t: Tournament, size: number): Tournament {
  if (!canCut(t) || !cutSizes(t).includes(size)) return t
  const seeds = standings(t).filter((s) => !s.dropped).slice(0, size).map((s) => s.id)
  if (t.format === 'PODS') {
    return { ...t, finished: true, playoff: { kind: 'FINAL_TABLE', size, rounds: [[{ players: seeds, result: null }]] } }
  }
  const order = seedOrder(size)
  const first: PlayoffMatch[] = []
  for (let i = 0; i < order.length; i += 2) first.push({ players: [seeds[order[i] - 1], seeds[order[i + 1] - 1]], result: null })
  const rounds: PlayoffMatch[][] = [first]
  for (let n = size / 4; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, () => ({ players: [null, null], result: null })))
  return { ...t, finished: true, playoff: { kind: 'BRACKET', size, rounds } }
}

/** Who won [match], or null while it has no result. */
export function matchWinner(match: PlayoffMatch): string | null {
  const r = match.result
  if (!r) return null
  let best = 0
  let winner: string | null = null
  for (let i = 0; i < match.players.length; i++) {
    const w = r.wins[i] ?? 0
    if (w > best) { best = w; winner = match.players[i] }
    else if (w === best) winner = null
  }
  return winner
}

/** The results a bracket match can be given, from the first player's side: no draws, someone goes through. */
export function playoffChoices(bestOf: number): ResultChoice[] {
  return bestOf === 1
    ? [{ label: '1–0', wins: [1, 0], draws: 0 }, { label: '0–1', wins: [0, 1], draws: 0 }]
    : [
      { label: '2–0', wins: [2, 0], draws: 0 },
      { label: '2–1', wins: [2, 1], draws: 0 },
      { label: '1–2', wins: [1, 2], draws: 0 },
      { label: '0–2', wins: [0, 2], draws: 0 },
    ]
}

/** Whether match [index] of round [round] can still change: both players known, and the match it feeds not yet played. */
export function playoffEditable(p: Playoff, round: number, index: number): boolean {
  const match = p.rounds[round]?.[index]
  if (!match || match.players.some((x) => x == null)) return false
  const next = p.rounds[round + 1]?.[Math.floor(index / 2)]
  return !next?.result
}

/**
 * [t] with playoff match [index] of round [round] given [result] (null clears it). Its winner goes
 * through to the next round; a match whose next one has been played is settled and doesn't change.
 */
export function withPlayoffResult(t: Tournament, round: number, index: number, result: TableResult | null): Tournament {
  const p = t.playoff
  if (!p || !playoffEditable(p, round, index)) return t
  const rounds = p.rounds.map((r) => r.map((m) => ({ ...m, players: [...m.players] })))
  rounds[round][index].result = result
  const next = rounds[round + 1]?.[Math.floor(index / 2)]
  if (next) next.players[index % 2] = matchWinner(rounds[round][index])
  return { ...t, playoff: { ...p, rounds } }
}

/** The event's champion: the playoff's last winner, or null while it isn't decided (or there's no playoff). */
export function playoffChampion(t: Tournament): string | null {
  const last = t.playoff?.rounds[t.playoff.rounds.length - 1]
  return last?.length === 1 ? matchWinner(last[0]) : null
}

/** "Quarterfinals", "Semifinals", "Final", "Final table". */
export function playoffRoundName(p: Playoff, round: number): string {
  if (p.kind === 'FINAL_TABLE') return 'Final table'
  const matches = p.rounds[round]?.length ?? 1
  return matches === 1 ? 'Final' : matches === 2 ? 'Semifinals' : matches === 4 ? 'Quarterfinals' : `Top ${matches * 2}`
}

/** "Cut to top 8", "Final table (top 4)". */
export const cutLabel = (format: EventFormat, size: number) => (format === 'PODS' ? `Final table (top ${size})` : `Cut to top ${size}`)

/** "Top 8", "Final table" — what an event with a playoff is up to, before a champion. */
export const playoffLabel = (p: Playoff) => (p.kind === 'FINAL_TABLE' ? 'Final table' : `Top ${p.size}`)

/** A playoff as read back from storage: null for an event saved before playoffs, or anything malformed. */
export function parsePlayoff(raw: unknown): Playoff | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if ((o.kind !== 'BRACKET' && o.kind !== 'FINAL_TABLE') || typeof o.size !== 'number' || !Array.isArray(o.rounds)) return null
  const ok = o.rounds.every((r) => Array.isArray(r) && r.every((m) => m && typeof m === 'object' && Array.isArray((m as PlayoffMatch).players)))
  return ok ? { kind: o.kind, size: o.size, rounds: o.rounds as PlayoffMatch[][] } : null
}

/** "Finished", "Top 8", "Champion: Ana" — an event's status once its playoff is in. */
export function playoffStatus(t: Tournament, nameOf: (id: string) => string): string | null {
  if (!t.playoff) return null
  const champion = playoffChampion(t)
  return champion ? `Champion: ${nameOf(champion)}` : playoffLabel(t.playoff)
}

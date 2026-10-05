// Mulligans in real games: how many a player took (saved as GameResult.mulligans), the hand it left
// them, and a deck's or a playgroup's mulligan rate and how often a game is won after one. Pure.
// Mirrors the Android app's data/Mulligans.kt.

import type { GameResult } from '../types/models'

/** The most mulligans there are: down to no cards. */
export const MAX_MULLIGANS = 7

/** A mulligan count read from storage or the wire: a whole number from 0 to 7, else not recorded. */
export function cleanMulligans(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_MULLIGANS ? raw : null
}

/**
 * The cards kept after [mulligans]: seven, less one for each — but in a multiplayer game
 * ([freeFirst]) the first mulligan is free.
 */
export function handSize(mulligans: number, freeFirst: boolean): number {
  const counted = freeFirst ? Math.max(0, mulligans - 1) : mulligans
  return Math.max(0, 7 - counted)
}

/** "Kept 7", "1 mulligan, to 6", "2 mulligans, to 6" (multiplayer). */
export function mulliganText(mulligans: number, freeFirst: boolean): string {
  if (mulligans <= 0) return 'Kept 7'
  return `${mulligans} ${mulligans === 1 ? 'mulligan' : 'mulligans'}, to ${handSize(mulligans, freeFirst)}`
}

export interface MulliganStats {
  /** Games with mulligans recorded. */
  recorded: number
  /** Of those, games with at least one mulligan. */
  mulliganed: number
  /** Share of recorded games with a mulligan, 0 to 100. */
  rate: number
  /** Wins in games with a mulligan. */
  winsAfter: number
  /** Win rate in games with a mulligan, 0 to 100; null with none. */
  winRateAfter: number | null
  /** Win rate in games kept at seven, 0 to 100; null with none. */
  winRateKept: number | null
}

const percent = (part: number, whole: number) => Math.floor((part * 100) / whole)

/** Mulligans over [results]; games without a mulligan count recorded don't count. */
export function mulliganStats(results: GameResult[]): MulliganStats {
  const recorded = results.filter((g) => cleanMulligans(g.mulligans) != null)
  const after = recorded.filter((g) => g.mulligans! > 0)
  const kept = recorded.filter((g) => g.mulligans === 0)
  const winsAfter = after.filter((g) => g.result === 'WIN').length
  return {
    recorded: recorded.length,
    mulliganed: after.length,
    rate: recorded.length ? percent(after.length, recorded.length) : 0,
    winsAfter,
    winRateAfter: after.length ? percent(winsAfter, after.length) : null,
    winRateKept: kept.length ? percent(kept.filter((g) => g.result === 'WIN').length, kept.length) : null,
  }
}

/** "Mulligan in 25% of 8 games · won 50% after one" — or null with nothing recorded. */
export function mulliganSummary(s: MulliganStats): string | null {
  if (s.recorded === 0) return null
  const games = `${s.recorded} ${s.recorded === 1 ? 'game' : 'games'}`
  return `Mulligan in ${s.rate}% of ${games}${s.winRateAfter != null ? ` · won ${s.winRateAfter}% after one` : ''}`
}

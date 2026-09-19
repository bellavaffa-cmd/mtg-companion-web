// A deck's games, summed up for its Stats: the record, recent form, how long games run, and how it
// does against each commander and each person it has faced. Mirrors the Android app's
// data/GameStats.kt.

import type { GameResult } from '../types/models'

/** Games against one commander, or one person. */
export interface Matchup {
  name: string
  games: number
  wins: number
  losses: number
}

export interface GameStats {
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number
  /** The last ten results, newest first. */
  recent: GameResult['result'][]
  /** The current run of one result, e.g. { result: 'WIN', count: 3 }. Null under two games. */
  streak: { result: GameResult['result']; count: number } | null
  /** Averages over the games that kept time; null when none did. */
  averageMinutes: number | null
  averageTurns: number | null
  commanders: Matchup[]
  opponents: Matchup[]
}

/** Most-faced first; ties by name. At most [limit]. */
function matchups(results: GameResult[], keys: (g: GameResult) => string[], limit: number): Matchup[] {
  const byKey = new Map<string, { name: string; games: GameResult[] }>()
  for (const g of results) {
    // One game counts once against a name, however often it's listed.
    const seen = new Set<string>()
    for (const raw of keys(g)) {
      const name = raw.trim()
      const key = name.toLowerCase()
      if (!name || seen.has(key)) continue
      seen.add(key)
      const entry = byKey.get(key) ?? { name, games: [] }
      entry.games.push(g)
      byKey.set(key, entry)
    }
  }
  return [...byKey.values()]
    .map(({ name, games }) => ({ name, games: games.length, wins: games.filter((g) => g.result === 'WIN').length, losses: games.filter((g) => g.result === 'LOSS').length }))
    .sort((a, b) => b.games - a.games || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .slice(0, limit)
}

const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

export function gameStats(results: GameResult[], limit = 5): GameStats {
  const newest = [...results].sort((a, b) => b.playedAt - a.playedAt)
  let streak: GameStats['streak'] = null
  if (newest.length >= 2) {
    let count = 0
    while (count < newest.length && newest[count].result === newest[0].result) count++
    if (count >= 2) streak = { result: newest[0].result, count }
  }
  const wins = results.filter((g) => g.result === 'WIN').length
  return {
    games: results.length,
    wins,
    losses: results.filter((g) => g.result === 'LOSS').length,
    draws: results.filter((g) => g.result === 'DRAW').length,
    winRate: results.length ? Math.floor((wins * 100) / results.length) : 0,
    recent: newest.slice(0, 10).map((g) => g.result),
    streak,
    averageMinutes: average(results.flatMap((g) => (g.minutes && g.minutes > 0 ? [g.minutes] : []))),
    averageTurns: average(results.flatMap((g) => (g.turns && g.turns > 0 ? [g.turns] : []))),
    commanders: matchups(results, (g) => g.commanders ?? [], limit),
    opponents: matchups(results, (g) => (g.opponent ?? '').split(','), limit),
  }
}

/** "2–1" (or "2–1–1" with draws). */
export const matchupRecord = (m: Matchup) => `${m.wins}–${m.losses}${m.games - m.wins - m.losses > 0 ? `–${m.games - m.wins - m.losses}` : ''}`

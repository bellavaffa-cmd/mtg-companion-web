// The playgroup: every deck's games together — your overall record, how you do against each person
// and each commander, which decks do best, who beats you most, and your streaks. Built on a deck's
// own game stats (gameStats.ts). Mirrors the Android app's data/PlaygroupStats.kt.

import type { Deck, GameResult } from '../types/models'
import { gameStats, type Matchup } from './gameStats'

/** Games a deck needs before it's ranked, and before a player or commander can be your nemesis. */
export const MIN_GAMES = 3

/** One deck's games. */
export interface DeckRecord {
  deckId: string
  name: string
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number
}

export interface PlaygroupStats {
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number
  /** The current run of one result, e.g. { result: 'WIN', count: 3 }. Null under two games. */
  streak: { result: GameResult['result']; count: number } | null
  /** The most wins in a row, ever. */
  longestWinStreak: number
  /** Averages over the games that kept time; null when none did. */
  averageMinutes: number | null
  averageTurns: number | null
  /** Everyone you've played, most-played first. */
  opponents: Matchup[]
  /** Every commander you've faced, most-faced first. */
  commanders: Matchup[]
  /** Decks with at least MIN_GAMES games, best win rate first. */
  ranked: DeckRecord[]
  /** Decks with fewer, most-played first. */
  unranked: DeckRecord[]
  /** The person and the commander you do worst against (MIN_GAMES or more, more losses than wins). */
  nemesis: Matchup | null
  nemesisCommander: Matchup | null
}

const rate = (wins: number, games: number) => (games ? Math.floor((wins * 100) / games) : 0)

/** The most wins in a row among [results], oldest to newest. */
export function longestWinStreak(results: GameResult[]): number {
  let best = 0
  let run = 0
  for (const g of [...results].sort((a, b) => a.playedAt - b.playedAt)) {
    run = g.result === 'WIN' ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

/**
 * The matchup you do worst against: the lowest share of wins, then the most losses, then the most
 * games. Only ones with [min] games or more and a losing record count — a nemesis beats you.
 */
export function nemesisOf(matchups: Matchup[], min = MIN_GAMES): Matchup | null {
  const share = (m: Matchup) => m.wins / m.games
  const candidates = matchups.filter((m) => m.games >= min && m.losses > m.wins)
  candidates.sort((a, b) => share(a) - share(b) || b.losses - a.losses || b.games - a.games || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return candidates[0] ?? null
}

export function playgroupStats(decks: Deck[]): PlaygroupStats {
  const all = decks.flatMap((d) => d.gameResults ?? [])
  const overall = gameStats(all, Number.MAX_SAFE_INTEGER)
  const records: DeckRecord[] = decks
    .filter((d) => (d.gameResults ?? []).length > 0)
    .map((d) => {
      const s = gameStats(d.gameResults, 0)
      return { deckId: d.id, name: d.name, games: s.games, wins: s.wins, losses: s.losses, draws: s.draws, winRate: s.winRate }
    })
  const byName = (a: DeckRecord, b: DeckRecord) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  return {
    games: overall.games,
    wins: overall.wins,
    losses: overall.losses,
    draws: overall.draws,
    winRate: rate(overall.wins, overall.games),
    streak: overall.streak,
    longestWinStreak: longestWinStreak(all),
    averageMinutes: overall.averageMinutes,
    averageTurns: overall.averageTurns,
    opponents: overall.opponents,
    commanders: overall.commanders,
    ranked: records
      .filter((r) => r.games >= MIN_GAMES)
      .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games || byName(a, b)),
    unranked: records.filter((r) => r.games < MIN_GAMES).sort((a, b) => b.games - a.games || byName(a, b)),
    nemesis: nemesisOf(overall.opponents),
    nemesisCommander: nemesisOf(overall.commanders),
  }
}

// A pod's shared game log, summed up for the whole group: each player's record, the commanders
// played most and winning most, each player's nemesis, how long games run, and the latest games.
// The games come from the pod_games server function (MtgCompanionApp/supabase/migrations/
// 20261005000000_pod_games.sql). Mirrors the Android app's data/PodStats.kt.

import type { GameResult } from '../types/models'
import type { Matchup } from './gameStats'
import { MIN_GAMES, nemesisOf } from './playgroupStats'

export type PodResult = 'WIN' | 'LOSS' | 'DRAW'

/** One seat in a pod game: a pod member (by account) or a guest (by name). */
export interface PodPlayer {
  userId: string | null
  name: string
  commander: string | null
  deck: string | null
  result: PodResult
  /** Where they finished (1 = won, 2 = second…), when it was recorded. For league points (league.ts). */
  place?: number | null
  /** Whether they knocked out the first player of the game. */
  firstBlood?: boolean
}

export interface PodGame {
  id: string
  clientId: string
  recordedBy: string
  /** Milliseconds since 1970. */
  playedAt: number
  format: string
  turns: number | null
  minutes: number | null
  players: PodPlayer[]
}

/** One player's games in the pod. */
export interface PlayerRecord {
  /** "u:<userId>" for a member, "n:<lower-case name>" for a guest. */
  key: string
  userId: string | null
  /** The name they had in their newest game. */
  name: string
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number
}

/** Games one commander was played in, by anyone. */
export interface CommanderRecord {
  name: string
  games: number
  wins: number
  winRate: number
}

/** Who a player does worst against. */
export interface PlayerNemesis {
  player: PlayerRecord
  nemesis: Matchup
}

export interface PodStats {
  games: number
  /** Everyone who has played, most games first. */
  players: PlayerRecord[]
  /** Commanders with MIN_GAMES or more games, most-played first. */
  mostPlayed: CommanderRecord[]
  /** The same commanders, best win rate first. */
  best: CommanderRecord[]
  /** Each player who has a nemesis, in the order of [players]. */
  nemeses: PlayerNemesis[]
  /** Averages over the games that kept time; null when none did. */
  averageMinutes: number | null
  averageTurns: number | null
  /** The newest games, at most LATEST. */
  latest: PodGame[]
}

/** How many games the latest list shows. */
export const LATEST = 10

/** Who a seat is: a member by their account, anyone else by their name (any case, trimmed). */
export const playerKey = (p: Pick<PodPlayer, 'userId' | 'name'>) => (p.userId ? `u:${p.userId}` : `n:${p.name.trim().toLowerCase()}`)

const rate = (wins: number, games: number) => (games ? Math.floor((wins * 100) / games) : 0)
const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
const byName = (a: { name: string }, b: { name: string }) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())

export function podStats(games: PodGame[]): PodStats {
  const newest = [...games].sort((a, b) => b.playedAt - a.playedAt)
  const players = new Map<string, PlayerRecord>()
  const commanders = new Map<string, CommanderRecord>()
  // Per player, how they did against each opponent: one game counts once against each other seat.
  const against = new Map<string, Map<string, Matchup>>()

  for (const g of newest) {
    // A name listed twice in one game counts once.
    const seats = g.players.filter((p, i, all) => all.findIndex((q) => playerKey(q) === playerKey(p)) === i)
    for (const p of seats) {
      const key = playerKey(p)
      const r = players.get(key) ?? { key, userId: p.userId, name: p.name.trim(), games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 }
      r.games++
      if (p.result === 'WIN') r.wins++
      else if (p.result === 'LOSS') r.losses++
      else r.draws++
      players.set(key, r)

      const commander = p.commander?.trim()
      if (commander) {
        const c = commanders.get(commander.toLowerCase()) ?? { name: commander, games: 0, wins: 0, winRate: 0 }
        c.games++
        if (p.result === 'WIN') c.wins++
        commanders.set(commander.toLowerCase(), c)
      }

      const mine = against.get(key) ?? new Map<string, Matchup>()
      for (const o of seats) {
        const other = playerKey(o)
        if (other === key) continue
        const m = mine.get(other) ?? { name: o.name.trim(), games: 0, wins: 0, losses: 0 }
        m.games++
        if (p.result === 'WIN') m.wins++
        else if (p.result === 'LOSS') m.losses++
        mine.set(other, m)
      }
      against.set(key, mine)
    }
  }

  const playerList = [...players.values()]
    .map((r) => ({ ...r, winRate: rate(r.wins, r.games) }))
    .sort((a, b) => b.games - a.games || b.wins - a.wins || byName(a, b))
  const ranked = [...commanders.values()].map((c) => ({ ...c, winRate: rate(c.wins, c.games) })).filter((c) => c.games >= MIN_GAMES)
  return {
    games: games.length,
    players: playerList,
    mostPlayed: [...ranked].sort((a, b) => b.games - a.games || b.wins - a.wins || byName(a, b)),
    best: [...ranked].sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games || byName(a, b)),
    nemeses: playerList.flatMap((player) => {
      const nemesis = nemesisOf([...(against.get(player.key)?.values() ?? [])])
      return nemesis ? [{ player, nemesis }] : []
    }),
    averageMinutes: average(games.flatMap((g) => (g.minutes && g.minutes > 0 ? [g.minutes] : []))),
    averageTurns: average(games.flatMap((g) => (g.turns && g.turns > 0 ? [g.turns] : []))),
    latest: newest.slice(0, LATEST),
  }
}

/** Whoever recorded a game can delete it, and so can the pod's owner. */
export const canDeletePodGame = (game: PodGame, me: string, podOwner: string) => game.recordedBy === me || podOwner === me

/**
 * The game as a result on the user's own deck, the way the life counter logs one: the other players'
 * names joined ", ", and their commanders. Null when [me] isn't one of the players.
 */
export function deckResultOf(
  game: Pick<PodGame, 'playedAt' | 'turns' | 'minutes' | 'players'>,
  me: string,
  id: string,
): GameResult | null {
  const mine = game.players.find((p) => p.userId === me)
  if (!mine) return null
  const others = game.players.filter((p) => p !== mine)
  return {
    id,
    result: mine.result,
    opponent: others.map((p) => p.name.trim()).join(', ') || null,
    playedAt: game.playedAt,
    turns: game.turns && game.turns > 0 ? game.turns : null,
    minutes: game.minutes && game.minutes > 0 ? game.minutes : null,
    commanders: others.flatMap((p) => (p.commander?.trim() ? [p.commander.trim()] : [])),
  }
}

/**
 * Checks a game before recording it: answers what's wrong, in words for the screen, or null.
 * The server checks the same (2–10 players, names 1–40 characters, at most one winner).
 */
export function podGameProblem(players: Pick<PodPlayer, 'userId' | 'name' | 'result' | 'firstBlood'>[]): string | null {
  if (players.length < 2) return 'Pick at least two players.'
  if (players.length > 10) return 'A game holds up to 10 players.'
  if (players.some((p) => !p.name.trim())) return 'Every guest needs a name.'
  if (players.some((p) => p.name.trim().length > 40)) return 'Keep names to 40 characters.'
  const keys = players.map(playerKey)
  if (new Set(keys).size !== keys.length) return 'Someone is in the game twice.'
  if (players.filter((p) => p.result === 'WIN').length > 1) return 'Only one player can win.'
  if (players.filter((p) => p.firstBlood).length > 1) return 'Only one player can draw first blood.'
  return null
}

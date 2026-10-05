// The games played at this table, kept in this browser: who sat where, what they played, who won
// and how long it took. And, for a table owner playing without a remote of their own, their seat's
// game saved to their deck. Mirrors the Android app's ui/lifecounter/TableGames.kt.

import { useEffect, useState } from 'react'
import type { GameResult } from '../types/models'
import { displayName, gameClockOf, lossReason, startingLifeFor, type Game, type LifeSettings } from './game'
import { buildGameLog, parseGameLog, type ChartSeat, type GameLog } from './lifeChart'
import { clockElapsed, gameMinutes } from './tableExtras'

/**
 * One seat in a finished game. [out]: why they lost (LIFE, POISON…), null for the winner. [me]: the
 * table owner's seat. [mulligans]: how many they took, when recorded. [colorIndex]: their seat colour,
 * for the chart (absent from games kept before it).
 */
export interface TableGamePlayer {
  seat: number; name: string; commander: string | null; out: string | null; me: boolean; mulligans?: number | null; colorIndex?: number
}

/** A finished game. [id] is the table's game id, so a result changed by an undo replaces it rather than adding one. */
export interface TableGame {
  id: string
  endedAt: number
  turns: number
  minutes: number
  /** Null when nobody was left standing. */
  winnerSeat: number | null
  players: TableGamePlayer[]
  /** Life over the game, for its chart and recap (lifeChart.ts); absent from games kept before it. */
  log?: GameLog | null
}

/** How many games the table keeps. */
export const TABLE_GAMES_KEPT = 50

/** [games] with [game] in its place (newest first), at most TABLE_GAMES_KEPT. */
export function withTableGame(games: TableGame[], game: TableGame): TableGame[] {
  return [game, ...games.filter((g) => g.id !== game.id)].sort((a, b) => b.endedAt - a.endedAt).slice(0, TABLE_GAMES_KEPT)
}

/** The id a table-owner's result is saved under on their deck: one per game, however often it's re-saved. */
export const meResultId = (gameId: string) => `table-${gameId}`

/** A finished [game] as the table keeps it; [now] is when it ended. */
export function tableGameOf(game: Game, settings: LifeSettings, winnerSeat: number | null, now = Date.now()): TableGame {
  const lastAt = game.history[0]?.at ?? now
  return {
    id: game.gameId ?? String(game.startedAt ?? now),
    endedAt: now,
    turns: game.turnNumber,
    // From the game clock, up to the last thing that happened: time paused doesn't count.
    minutes: gameMinutes(clockElapsed(gameClockOf(game), lastAt)),
    winnerSeat,
    players: game.players.map((p) => ({
      seat: p.id,
      name: displayName(p),
      commander: p.commander ?? null,
      out: lossReason(p, settings.autoKill),
      me: p.id === settings.meSeat && !p.linked,
      mulligans: p.mulligans ?? null,
      colorIndex: p.colorIndex,
    })),
    log: gameLogOf(game, settings, lastAt),
  }
}

/** [game]'s log for its chart and recap, from its history; [endAt]: when it ended. */
export function gameLogOf(game: Game, settings: LifeSettings, endAt = Date.now()): GameLog {
  const clock = gameClockOf(game)
  const life = startingLifeFor(settings, game.players.length)
  const endMs = clockElapsed(clock, endAt)
  const entries = [
    ...[...game.history].reverse().map((h) => ({
      seat: h.playerId, ms: h.ms ?? Math.max(0, h.at - (game.startedAt ?? h.at)), turn: h.turn ?? game.turnNumber,
      life: h.life ?? null, ...(h.out !== undefined ? { out: h.out } : {}), turnStart: !!h.turnStart, first: !!h.first,
    })),
    // Where everyone ended up, in case the last change isn't in the history (cleared, or older than it keeps).
    ...game.players.map((p) => ({ seat: p.id, ms: endMs, turn: game.turnNumber, life: p.life, out: lossReason(p, true) })),
  ]
  const damage = game.players.flatMap((p) => {
    const from = new Map<number, number>()
    for (const [k, v] of [...Object.entries(p.commanderDamage), ...Object.entries(p.partnerDamage ?? {})]) from.set(Number(k), (from.get(Number(k)) ?? 0) + v)
    return [...from].map(([f, amount]) => ({ to: p.id, from: f, amount }))
  })
  return buildGameLog(
    entries,
    game.players.map((p) => ({ seat: p.id, life })),
    game.players.map((p) => ({ seat: p.id, out: lossReason(p, settings.autoKill) })),
    damage,
    endMs,
    settings.turnTracker && game.players.length > 1,
    // Seat 1 opens a new game; choosing who goes first is in the history, and starts the turns over.
    1,
  )
}

/**
 * The table owner's result for [game], to save to their deck — or null when there's nothing to
 * save: no seat is theirs, or someone joined that seat from a phone. A phone that joins saves the
 * result itself, and the same account on both would save the game twice.
 */
export function meResultOf(game: TableGame, meSeat: number | null | undefined, seatLinked: boolean): GameResult | null {
  if (meSeat == null || seatLinked) return null
  if (!game.players.some((p) => p.seat === meSeat)) return null
  const others = game.players.filter((p) => p.seat !== meSeat)
  return {
    id: meResultId(game.id),
    result: game.winnerSeat === meSeat ? 'WIN' : game.winnerSeat == null ? 'DRAW' : 'LOSS',
    opponent: others.map((p) => p.name).join(', ') || null,
    playedAt: game.endedAt,
    turns: game.turns > 0 ? game.turns : null,
    minutes: game.minutes > 0 ? game.minutes : null,
    commanders: others.flatMap((p) => (p.commander ? [p.commander] : [])),
    ...(meSeat != null && game.players.find((p) => p.seat === meSeat)?.mulligans != null
      ? { mulligans: game.players.find((p) => p.seat === meSeat)!.mulligans }
      : {}),
  }
}

const GAMES_KEY = 'mtgweb_table_games'
const listeners = new Set<() => void>()
let games: TableGame[] = (() => {
  try {
    // A game kept before the chart has no log; a malformed one is dropped rather than drawn.
    return (JSON.parse(localStorage.getItem(GAMES_KEY) ?? '[]') as TableGame[]).map((g) => ({ ...g, log: parseGameLog(g.log) }))
  } catch { return [] }
})()

function setGames(next: TableGame[]) {
  games = next
  try { localStorage.setItem(GAMES_KEY, JSON.stringify(games)) } catch { /* this visit only */ }
  listeners.forEach((l) => l())
}

export const recordTableGame = (game: TableGame) => setGames(withTableGame(games, game))
export const deleteTableGame = (id: string) => setGames(games.filter((g) => g.id !== id))
export const clearTableGames = () => setGames([])

/** The games played at this table, newest first. */
export function useTableGames(): TableGame[] {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return games
}

/** A kept game's seats for its chart: names, and the seat colours it was played in (seat order for older games). */
export const chartSeats = (g: TableGame): ChartSeat[] =>
  g.players.map((p) => ({ seat: p.seat, name: p.name, colorIndex: p.colorIndex ?? p.seat - 1 }))

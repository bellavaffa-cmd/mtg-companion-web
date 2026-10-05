// Game night: who's here and what they're playing, split into fair pods, each pod's game started on
// the life counter and its winner noted. Everything here is plain logic, kept apart from the page
// (GameNightPage.tsx) so it can be tested; the same seed gives the same pods on the phone. Mirrors
// the Android app's ui/lifecounter/GameNight.kt — same JSON keys, same numbers.

import type { GameResult } from '../types/models'
import { TABLE_LAYOUTS, playerCount } from './tableLayouts'

/** Commander pods of 3–4, or 1v1 pairs. */
export type NightFormat = 'COMMANDER' | 'DUEL'

/** ME: the user. FRIEND: a friend with an account. GUEST: a name typed in. */
export type NightPlayerKind = 'ME' | 'FRIEND' | 'GUEST'

export interface NightPlayer {
  id: string
  name: string
  kind: NightPlayerKind
  /** A friend's account. */
  userId?: string | null
  /** The user's own deck: their games go onto it. */
  deckId?: string | null
  /** A friend's shared deck (its item id). */
  sharedDeckId?: string | null
  /** What they're playing, as shown. */
  deck: string | null
  commander: string | null
  /** Power bracket 1–5; null: not known, counted as the middle (3). */
  bracket: number | null
}

/** A pod: its players by id, when its game was started, and who won (a player id) once known. */
export interface NightPod {
  id: string
  playerIds: string[]
  startedAt: number | null
  winnerId: string | null
}

export interface GameNight {
  id: string
  createdAt: number
  format: NightFormat
  /** The seed the pods were last split with. */
  seed: number
  players: NightPlayer[]
  pods: NightPod[]
}

/** The bracket a player counts as: theirs, or the middle when nobody knows. */
export const UNKNOWN_BRACKET = 3
export const bracketOf = (p: Pick<NightPlayer, 'bracket'>) => p.bracket ?? UNKNOWN_BRACKET

/** What one pairing that also played together last night costs, against the power spread. */
export const REPEAT_COST = 1

/** How many shuffles the split starts from; each one is then improved by swapping players. */
const RESTARTS = 24

/** A night starts over (keeping its players) once it's this old. */
export const NIGHT_STALE_MS = 20 * 60 * 60 * 1000

/**
 * A small seeded random number generator (mulberry32), giving 0 ≤ n < 1. Plain 32-bit integer
 * steps, so the phone's copy gives the very same numbers.
 */
export function seededRandom(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The pod sizes for [n] players. Commander: as even as possible, 3 or 4 each (6 → 3+3, 7 → 4+3,
 * 9 → 3+3+3); five or fewer play as one pod, since five can't split into 3–4. 1v1: pairs, and a
 * three-way game when there's an odd one out.
 */
export function podSizes(n: number, format: NightFormat): number[] {
  if (n <= 0) return []
  if (format === 'DUEL') {
    if (n < 4) return [n]
    return n % 2 === 0 ? Array(n / 2).fill(2) : [...Array((n - 3) / 2).fill(2), 3]
  }
  if (n <= 5) return [n]
  const k = Math.ceil(n / 4)
  const base = Math.floor(n / k)
  const extra = n % k
  return Array.from({ length: k }, (_, i) => (i < extra ? base + 1 : base))
}

/** Who a player is from one night to the next: you, a friend's account, or a guest's name. */
export function playerKey(p: Pick<NightPlayer, 'kind' | 'userId' | 'name'>): string {
  if (p.kind === 'ME') return 'me'
  if (p.kind === 'FRIEND' && p.userId) return `u:${p.userId}`
  return `g:${p.name.trim().toLowerCase()}`
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Every two players who shared a pod on [night], by [playerKey]. */
export function pairingsOf(night: GameNight | null | undefined): Set<string> {
  const pairs = new Set<string>()
  if (!night) return pairs
  const byId = new Map(night.players.map((p) => [p.id, playerKey(p)]))
  for (const pod of night.pods) {
    const keys = pod.playerIds.map((id) => byId.get(id)).filter((k): k is string => !!k)
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) pairs.add(pairKey(keys[i], keys[j]))
  }
  return pairs
}

/** How far apart a pod's brackets are: the sum of each one's squared distance from the pod's average. */
export function powerSpread(brackets: number[]): number {
  if (brackets.length < 2) return 0
  let sum = 0
  for (const b of brackets) sum += b
  const mean = sum / brackets.length
  let spread = 0
  for (const b of brackets) spread += (b - mean) * (b - mean)
  return spread
}

/** How many pairings in [keys] (one pod's player keys) played together last night. */
export function repeatsIn(keys: string[], previous: Set<string>): number {
  let n = 0
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (previous.has(pairKey(keys[i], keys[j]))) n++
  return n
}

/** What a split costs: every pod's power spread, plus [REPEAT_COST] for each pairing repeated from last night. */
function splitCost(pods: number[][], brackets: number[], keys: string[], previous: Set<string>): number {
  let cost = 0
  for (const pod of pods) {
    cost += powerSpread(pod.map((i) => brackets[i]))
    if (previous.size > 0) cost += REPEAT_COST * repeatsIn(pod.map((i) => keys[i]), previous)
  }
  return cost
}

const EPSILON = 1e-9

/**
 * Splits [players] into pods for [format]: players close in power together, and — where it costs
 * no more than that — not the same pairings as last night ([previous], from [pairingsOf]). Tries
 * [RESTARTS] seeded shuffles, improves each by swapping players between pods while that helps,
 * and keeps the cheapest. The same players, seed and last night always give the same pods: each
 * pod's players in the order they were added, the pods in order of their first player.
 */
export function splitPods(players: NightPlayer[], format: NightFormat, seed: number, previous: Set<string> = new Set()): string[][] {
  const n = players.length
  const sizes = podSizes(n, format)
  if (sizes.length <= 1) return n === 0 ? [] : [players.map((p) => p.id)]
  const brackets = players.map(bracketOf)
  const keys = players.map(playerKey)
  const random = seededRandom(seed)
  let best: number[][] | null = null
  let bestCost = Infinity
  for (let r = 0; r < RESTARTS; r++) {
    const order = players.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const t = order[i]; order[i] = order[j]; order[j] = t
    }
    const pods: number[][] = []
    let at = 0
    for (const size of sizes) { pods.push(order.slice(at, at + size)); at += size }
    let cost = splitCost(pods, brackets, keys, previous)
    let improved = true
    while (improved) {
      improved = false
      for (let a = 0; a < pods.length; a++) {
        for (let b = a + 1; b < pods.length; b++) {
          for (let i = 0; i < pods[a].length; i++) {
            for (let j = 0; j < pods[b].length; j++) {
              const x = pods[a][i]; pods[a][i] = pods[b][j]; pods[b][j] = x
              const c = splitCost(pods, brackets, keys, previous)
              if (c < cost - EPSILON) { cost = c; improved = true } else { pods[b][j] = pods[a][i]; pods[a][i] = x }
            }
          }
        }
      }
    }
    if (cost < bestCost - EPSILON) { bestCost = cost; best = pods.map((p) => [...p]) }
  }
  return best!
    .map((pod) => [...pod].sort((x, y) => x - y))
    .sort((x, y) => x[0] - y[0])
    .map((pod) => pod.map((i) => players[i].id))
}

/** A new seed for a reshuffle. */
export const newSeed = () => Math.floor(Math.random() * 0x7fffffff)

/** [night] split afresh with [seed]: new pods, no results. */
export function withPods(night: GameNight, seed: number, previous: GameNight | null): GameNight {
  const groups = splitPods(night.players, night.format, seed, pairingsOf(previous))
  return { ...night, seed, pods: groups.map((ids, i) => ({ id: `${seed}-${i + 1}`, playerIds: ids, startedAt: null, winnerId: null })) }
}

/**
 * [pods] with [playerId] moved into the pod at [toIndex] — or into a pod of their own when
 * [toIndex] is past the last. A pod left empty goes; a pod whose players changed loses its result.
 */
export function movePlayer(pods: NightPod[], playerId: string, toIndex: number, newPodId: string): NightPod[] {
  const from = pods.findIndex((p) => p.playerIds.includes(playerId))
  if (from === toIndex) return pods
  const reset = (p: NightPod): NightPod => ({ ...p, startedAt: null, winnerId: null })
  const next = pods.map((p, i) => (i === from ? reset({ ...p, playerIds: p.playerIds.filter((id) => id !== playerId) }) : p))
  if (toIndex >= pods.length) next.push({ id: newPodId, playerIds: [playerId], startedAt: null, winnerId: null })
  else next[toIndex] = reset({ ...next[toIndex], playerIds: [...next[toIndex].playerIds, playerId] })
  return next.filter((p) => p.playerIds.length > 0)
}

/** The players in no pod yet (added after the split). */
export const unseated = (night: GameNight): NightPlayer[] =>
  night.players.filter((p) => !night.pods.some((pod) => pod.playerIds.includes(p.id)))

/** [night] without [playerId]: off the list and out of their pod. */
export function withoutPlayer(night: GameNight, playerId: string): GameNight {
  return {
    ...night,
    players: night.players.filter((p) => p.id !== playerId),
    pods: night.pods
      .map((p) => (p.playerIds.includes(playerId) ? { ...p, playerIds: p.playerIds.filter((id) => id !== playerId), winnerId: p.winnerId === playerId ? null : p.winnerId } : p))
      .filter((p) => p.playerIds.length > 0),
  }
}

/** A pod's average bracket, to one decimal ("2.7"). */
export function podPower(pod: NightPod, players: NightPlayer[]): string {
  const brackets = pod.playerIds.map((id) => players.find((p) => p.id === id)).filter((p) => !!p).map(bracketOf)
  if (brackets.length === 0) return '–'
  return (brackets.reduce((a, b) => a + b, 0) / brackets.length).toFixed(1)
}

// ---- Suggesting a deck ----

/** One of the user's decks, as the suggestion sees it: [bracket] when it's been estimated. */
export interface DeckChoice {
  id: string
  name: string
  gameMode: string
  bracket: number | null
  /** When it was last played (its newest game result), 0 for never. */
  lastPlayed: number
}

/** Whether a deck of [gameMode] suits a night of [format]. */
export const deckFitsFormat = (gameMode: string, format: NightFormat) =>
  format === 'COMMANDER' ? gameMode === 'COMMANDER' : gameMode !== 'COMMANDER' && gameMode !== 'BRAWL'

/**
 * The user's decks best first for tonight: those of the night's format (all of them when none
 * are), closest in bracket to the average of the others' known brackets, then the one played
 * longest ago, then by name. [others]: the other players' brackets, null where not known.
 */
export function suggestedDecks(decks: DeckChoice[], format: NightFormat, others: (number | null)[]): DeckChoice[] {
  const fitting = decks.filter((d) => deckFitsFormat(d.gameMode, format))
  const pool = fitting.length > 0 ? fitting : decks
  const known = others.filter((b): b is number => b != null)
  const target = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null
  const distance = (d: DeckChoice) => (target == null ? 0 : Math.abs((d.bracket ?? UNKNOWN_BRACKET) - target))
  return [...pool].sort((a, b) =>
    distance(a) - distance(b) || a.lastPlayed - b.lastPlayed || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** The next suggestion after [currentId] (the first when it isn't one), so asking again offers another. */
export function nextSuggestion(ordered: DeckChoice[], currentId: string | null | undefined): DeckChoice | null {
  if (ordered.length === 0) return null
  const at = ordered.findIndex((d) => d.id === currentId)
  return ordered[(at + 1) % ordered.length]
}

// ---- The life counter, and each pod's result ----

/** What the life counter is opened with for a pod: the seats' names and commanders, and which seat is the user's. */
export interface TableSeed {
  players: { name: string; commander: string | null }[]
  /** The user's seat (1-based), or null when they aren't in this pod. */
  meSeat: number | null
  /** Where the user's game is saved. */
  meDeckId: string | null
}

export function tableSeedOf(pod: NightPod, players: NightPlayer[]): TableSeed {
  const seated = pod.playerIds.map((id) => players.find((p) => p.id === id)).filter((p): p is NightPlayer => !!p)
  const me = seated.findIndex((p) => p.kind === 'ME')
  return {
    players: seated.map((p) => ({ name: p.name, commander: p.commander })),
    meSeat: me >= 0 ? me + 1 : null,
    meDeckId: me >= 0 ? seated[me].deckId ?? null : null,
  }
}

/** The life counter's seating for [count] players: [currentId] when it already seats that many, else the first that does. */
export function layoutIdFor(count: number, currentId: string): string {
  const current = TABLE_LAYOUTS.find((l) => l.id === currentId)
  if (current && playerCount(current) === count) return currentId
  return TABLE_LAYOUTS.find((l) => playerCount(l) === count)?.id ?? currentId
}

/** A finished life counter game, as much of it as a pod's result needs (see tableGames.ts). */
export interface PlayedGame {
  endedAt: number
  winnerSeat: number | null
  players: { seat: number; name: string }[]
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The life counter game [pod] played, if any: the newest one that ended after the pod started with
 * the pod's players at it, by name. Null when there's none yet.
 */
export function podGame<G extends PlayedGame>(pod: NightPod, players: NightPlayer[], games: G[]): G | null {
  if (pod.startedAt == null) return null
  const names = pod.playerIds.map((id) => players.find((p) => p.id === id)?.name).filter((n): n is string => !!n)
  let found: G | null = null
  for (const g of games) {
    if (g.endedAt < pod.startedAt || g.players.length !== names.length) continue
    if (!names.every((n) => g.players.some((p) => sameName(p.name, n)))) continue
    if (!found || g.endedAt > found.endedAt) found = g
  }
  return found
}

/**
 * Who won [pod]: from its life counter game when there is one (null when nobody was left
 * standing), otherwise whoever was tapped as the winner. Undefined while it isn't known.
 */
export function podWinner(pod: NightPod, players: NightPlayer[], games: PlayedGame[]): { winnerId: string | null; fromTable: boolean } | undefined {
  const game = podGame(pod, players, games)
  if (game) {
    const name = game.players.find((p) => p.seat === game.winnerSeat)?.name
    const winner = name == null ? null : pod.playerIds.map((id) => players.find((p) => p.id === id)).find((p) => p && sameName(p.name, name))
    return { winnerId: winner?.id ?? null, fromTable: true }
  }
  return pod.winnerId ? { winnerId: pod.winnerId, fromTable: false } : undefined
}

/** The id a winner tapped on game night is saved under on the user's deck — one per pod. */
export const nightResultId = (nightId: string, podId: string) => `night-${nightId}-${podId}`

/**
 * The user's game in [pod] with [winnerId] tapped as its winner, for the deck they played — or null
 * when they weren't in it or played no deck of theirs. Saved under [nightResultId], so tapping
 * another winner replaces it. (A game played on the life counter is saved by the table instead.)
 */
export function nightResultOf(nightId: string, pod: NightPod, players: NightPlayer[], winnerId: string, now: number): { deckId: string; result: GameResult } | null {
  const seated = pod.playerIds.map((id) => players.find((p) => p.id === id)).filter((p): p is NightPlayer => !!p)
  const me = seated.find((p) => p.kind === 'ME')
  if (!me?.deckId) return null
  const others = seated.filter((p) => p !== me)
  return {
    deckId: me.deckId,
    result: {
      id: nightResultId(nightId, pod.id),
      result: winnerId === me.id ? 'WIN' : 'LOSS',
      opponent: others.map((p) => p.name).join(', ') || null,
      playedAt: now,
      turns: null,
      minutes: null,
      commanders: others.flatMap((p) => (p.commander ? [p.commander] : [])),
    },
  }
}

/** A fresh night, or [from]'s players (with what they played) on a new night. */
export function newNight(id: string, now: number, from?: GameNight | null): GameNight {
  return { id, createdAt: now, format: from?.format ?? 'COMMANDER', seed: 0, players: from?.players ?? [], pods: [] }
}

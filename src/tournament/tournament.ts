// Small tournaments run from one device, with no server: 1v1 Swiss or Commander pods — pairings,
// byes, results, the round clock, standings and tiebreakers. Pure: no storage, no clock of its own.
// Mirrors the Android app's data/Tournament.kt — the same seed gives the same pairings in both.
//
// Scoring. 1v1 Swiss: a match win is 3 points, a draw 1, a loss 0; a bye is a 2–0 win. Ties are
// broken by the standard MTG tiebreakers: opponents' match-win % (OMW%), game-win % (GW%) and
// opponents' game-win % (OGW%), each percentage floored at 33%; byes don't count as opponents.
// Commander pods: the winner of a pod game gets 3 points, a drawn pod gives everyone in it 1, the
// rest 0; ties are broken by the average points of everyone you've shared a pod with. Players
// still tied keep the event's seeded order.

export type EventFormat = 'SWISS' | 'PODS'

/** A player in an event. [userId]: the friend they were picked from, if they were. */
export interface EventPlayer {
  id: string
  name: string
  userId: string | null
  dropped: boolean
}

/**
 * One table's result: games won by each player, in the table's [players] order, and drawn games.
 * A pod's winner has 1 and the rest 0; a drawn pod is all 0 with draws 1.
 */
export interface TableResult {
  wins: number[]
  draws: number
}

/** One table in a round. A table of one is a bye, its result already in. */
export interface EventTable {
  players: string[]
  result: TableResult | null
}

/** The round clock: running until [endsAt], or paused with [leftMs] to go. Neither: not started. */
export interface RoundTimer {
  endsAt: number | null
  leftMs: number | null
}

export interface EventRound {
  number: number
  tables: EventTable[]
  timer: RoundTimer
}

export interface Tournament {
  id: string
  name: string
  format: EventFormat
  /** 1 or 3 games a match (1v1 Swiss only). */
  bestOf: number
  /** The rounds planned. */
  roundCount: number
  roundMinutes: number
  /** Shuffles the seating; the same seed always gives the same event. */
  seed: number
  createdAt: number
  players: EventPlayer[]
  /** The rounds paired so far, oldest first. Only the last one's results can still change. */
  rounds: EventRound[]
  finished: boolean
}

export const MIN_PLAYERS = 4
export const MAX_PLAYERS = 32

export const FORMAT_LABELS: Record<EventFormat, string> = { SWISS: '1v1 Swiss', PODS: 'Commander pods' }

/** "1v1 Swiss · best of 3", "Commander pods". */
export function formatLabel(t: Pick<Tournament, 'format' | 'bestOf'>): string {
  return t.format === 'SWISS' ? `${FORMAT_LABELS.SWISS} · best of ${t.bestOf}` : FORMAT_LABELS.PODS
}

/** A round's length unless changed: 50 minutes for 1v1, 75 for pods. */
export const defaultRoundMinutes = (format: EventFormat) => (format === 'SWISS' ? 50 : 75)

/**
 * Rounds to suggest for [players]: Swiss needs ceil(log2 n) to find one unbeaten player. Pods meet
 * three others at a time, so one fewer (at least 2).
 */
export function suggestedRounds(format: EventFormat, players: number): number {
  let swiss = 0
  while (2 ** swiss < players) swiss++
  return format === 'SWISS' ? Math.max(1, swiss) : Math.max(2, swiss - 1)
}

// --- The seeded shuffle -------------------------------------------------------------------------

/** Mulberry32: a small seeded generator, written the same way in both apps. Numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [items] shuffled (Fisher–Yates) by [seed]. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const next = seededRandom(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

// --- Making an event ----------------------------------------------------------------------------

export interface NewEvent {
  id: string
  name: string
  format: EventFormat
  bestOf: number
  roundCount: number
  roundMinutes: number
  seed: number
  createdAt: number
  players: { name: string; userId: string | null }[]
}

/** A new event, nobody paired yet. Players are p1, p2… in the order they were added. */
export function newTournament(e: NewEvent): Tournament {
  return {
    id: e.id,
    name: e.name.trim(),
    format: e.format,
    bestOf: e.format === 'SWISS' ? e.bestOf : 1,
    roundCount: Math.max(1, e.roundCount),
    roundMinutes: Math.max(1, e.roundMinutes),
    seed: e.seed,
    createdAt: e.createdAt,
    players: e.players.map((p, i) => ({ id: `p${i + 1}`, name: p.name.trim(), userId: p.userId, dropped: false })),
    rounds: [],
    finished: false,
  }
}

/** Why [names] can't start an event, or null when they can. */
export function playersProblem(names: string[]): string | null {
  const clean = names.map((n) => n.trim().toLowerCase())
  if (clean.length < MIN_PLAYERS) return `Add at least ${MIN_PLAYERS} players`
  if (clean.length > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players`
  if (clean.some((n) => !n)) return 'Every player needs a name'
  if (new Set(clean).size !== clean.length) return 'Two players have the same name'
  return null
}

// --- Results ------------------------------------------------------------------------------------

export interface ResultChoice {
  label: string
  wins: number[]
  draws: number
}

/** The results a 1v1 table can be given, from the first player's side. */
export function matchChoices(bestOf: number): ResultChoice[] {
  return bestOf === 1
    ? [
      { label: '1–0', wins: [1, 0], draws: 0 },
      { label: '0–1', wins: [0, 1], draws: 0 },
      { label: 'Draw', wins: [0, 0], draws: 1 },
    ]
    : [
      { label: '2–0', wins: [2, 0], draws: 0 },
      { label: '2–1', wins: [2, 1], draws: 0 },
      { label: '1–2', wins: [1, 2], draws: 0 },
      { label: '0–2', wins: [0, 2], draws: 0 },
      { label: '1–1', wins: [1, 1], draws: 0 },
      { label: 'Draw', wins: [0, 0], draws: 1 },
    ]
}

/** A pod's result: [winner] (a player id) won, or nobody did — a draw. */
export function podResult(players: string[], winner: string | null): TableResult {
  return winner == null ? { wins: players.map(() => 0), draws: 1 } : { wins: players.map((p) => (p === winner ? 1 : 0)), draws: 0 }
}

/** A bye's result: a 2–0 win in Swiss, a pod won in pods. */
export const byeResult = (format: EventFormat): TableResult => ({ wins: [format === 'SWISS' ? 2 : 1], draws: 0 })

export const sameResult = (a: TableResult | null, b: TableResult | null) =>
  a != null && b != null && a.draws === b.draws && a.wins.length === b.wins.length && a.wins.every((w, i) => w === b.wins[i])

/** "Alice won", "Draw", "2–1" — a table's result in a few characters. */
export function resultText(t: Tournament, table: EventTable): string | null {
  const r = table.result
  if (!r) return null
  if (table.players.length === 1) return 'Bye'
  if (t.format === 'SWISS') return r.wins[0] === 0 && r.wins[1] === 0 && r.draws > 0 ? 'Draw' : `${r.wins[0]}–${r.wins[1]}${r.draws > 0 ? `–${r.draws}` : ''}`
  const winner = table.players.find((_, i) => r.wins[i] > 0)
  return winner ? `${playerName(t, winner)} won` : 'Draw'
}

export const playerName = (t: Tournament, id: string) => t.players.find((p) => p.id === id)?.name ?? '?'

/** The current round: the last one paired. */
export const currentRound = (t: Tournament): EventRound | null => t.rounds[t.rounds.length - 1] ?? null

/** Every table of the current round has its result. */
export const roundComplete = (round: EventRound | null) => round == null || round.tables.every((tb) => tb.result != null)

/** [t] with table [index] of the current round given [result] (null clears it). Earlier rounds are settled. */
export function withResult(t: Tournament, index: number, result: TableResult | null): Tournament {
  const round = currentRound(t)
  if (!round || t.finished || round.tables[index] == null || round.tables[index].players.length < 2) return t
  const tables = round.tables.map((tb, i) => (i === index ? { ...tb, result } : tb))
  return { ...t, rounds: [...t.rounds.slice(0, -1), { ...round, tables }] }
}

/** [t] with player [id] dropped (or back in): they aren't paired from the next round on. */
export const withDropped = (t: Tournament, id: string, dropped: boolean): Tournament =>
  ({ ...t, players: t.players.map((p) => (p.id === id ? { ...p, dropped } : p)) })

export const activePlayers = (t: Tournament) => t.players.filter((p) => !p.dropped)

/** The next round can be paired: this one's results are all in, rounds are left and two can play. */
export const canPairNext = (t: Tournament) =>
  !t.finished && roundComplete(currentRound(t)) && t.rounds.length < t.roundCount && activePlayers(t).length >= 2

/** The event can end: at least one round is played and its results are all in. */
export const canFinish = (t: Tournament) => !t.finished && t.rounds.length > 0 && roundComplete(currentRound(t))

// --- Standings ----------------------------------------------------------------------------------

/** The lowest a match-win or game-win percentage counts as, as in MTG tournaments. */
export const PERCENT_FLOOR = 0.33

export interface Standing {
  id: string
  name: string
  dropped: boolean
  /** Match points (Swiss) or pod points. */
  points: number
  wins: number
  losses: number
  draws: number
  byes: number
  /** Swiss tiebreakers, 0 to 1. */
  omw: number
  gw: number
  ogw: number
  /** Pods' tiebreaker: the average points of everyone met in a pod. */
  oppPoints: number
}

interface Tally {
  points: number
  matches: number
  wins: number
  losses: number
  draws: number
  byes: number
  gamePoints: number
  games: number
  opponents: string[]
}

function tallies(t: Tournament): Map<string, Tally> {
  const out = new Map<string, Tally>()
  for (const p of t.players) out.set(p.id, { points: 0, matches: 0, wins: 0, losses: 0, draws: 0, byes: 0, gamePoints: 0, games: 0, opponents: [] })
  for (const round of t.rounds) {
    for (const table of round.tables) {
      const r = table.result
      if (!r) continue
      if (table.players.length === 1) {
        const me = out.get(table.players[0])
        if (!me) continue
        me.points += 3
        me.matches++
        me.wins++
        me.byes++
        // A Swiss bye is two games won.
        if (t.format === 'SWISS') { me.gamePoints += 6; me.games += 2 }
        continue
      }
      const podDraw = r.wins.every((w) => w === 0)
      table.players.forEach((id, i) => {
        const me = out.get(id)
        if (!me) return
        const others = table.players.filter((o) => o !== id)
        me.opponents.push(...others)
        me.matches++
        if (t.format === 'SWISS') {
          const mine = r.wins[i] ?? 0
          const theirs = r.wins[1 - i] ?? 0
          me.games += mine + theirs + r.draws
          me.gamePoints += 3 * mine + r.draws
          if (mine > theirs) { me.wins++; me.points += 3 }
          else if (mine < theirs) me.losses++
          else { me.draws++; me.points += 1 }
        } else if (podDraw) {
          me.draws++
          me.points += 1
        } else if ((r.wins[i] ?? 0) > 0) {
          me.wins++
          me.points += 3
        } else {
          me.losses++
        }
      })
    }
  }
  return out
}

const average = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

/** Each player's place, best first: points, then the format's tiebreakers, then the seeded order. */
export function standings(t: Tournament): Standing[] {
  const all = tallies(t)
  const mwp = (x: Tally) => (x.matches === 0 ? PERCENT_FLOOR : Math.max(PERCENT_FLOOR, x.points / (3 * x.matches)))
  const gwp = (x: Tally) => (x.games === 0 ? PERCENT_FLOOR : Math.max(PERCENT_FLOOR, x.gamePoints / (3 * x.games)))
  const seat = new Map(seededShuffle(t.players.map((p) => p.id), t.seed).map((id, i) => [id, i]))
  const rows: Standing[] = t.players.map((p) => {
    const x = all.get(p.id)!
    const opps = x.opponents.map((o) => all.get(o)!).filter((o) => o != null)
    const swiss = t.format === 'SWISS'
    return {
      id: p.id,
      name: p.name,
      dropped: p.dropped,
      points: x.points,
      wins: x.wins,
      losses: x.losses,
      draws: x.draws,
      byes: x.byes,
      omw: swiss ? average(opps.map(mwp)) : 0,
      gw: swiss ? gwp(x) : 0,
      ogw: swiss ? average(opps.map(gwp)) : 0,
      oppPoints: swiss ? 0 : average(opps.map((o) => o.points)),
    }
  })
  return rows.sort((a, b) =>
    b.points - a.points
    || b.omw - a.omw
    || b.gw - a.gw
    || b.ogw - a.ogw
    || b.oppPoints - a.oppPoints
    || seat.get(a.id)! - seat.get(b.id)!)
}

/** "55.6%": a tiebreaker to one decimal place, rounded the same way in both apps. */
export function percentText(x: number): string {
  const tenths = Math.round(x * 1000)
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`
}

/** "4.3": an average to one decimal place. */
export function oneDecimal(x: number): string {
  const tenths = Math.round(x * 10)
  return `${Math.floor(tenths / 10)}.${tenths % 10}`
}

/** "3–1–0": wins, losses, draws. */
export const recordText = (s: Standing) => `${s.wins}–${s.losses}–${s.draws}`

/** The standings as plain text, to copy or share. */
export function standingsText(t: Tournament): string {
  const heading = t.finished ? 'Final standings' : t.rounds.length === 0 ? 'Standings' : `Standings after round ${t.rounds.length}`
  const lines = standings(t).map((s, i) => {
    const tiebreaks = t.format === 'SWISS'
      ? `OMW ${percentText(s.omw)} · GW ${percentText(s.gw)} · OGW ${percentText(s.ogw)}`
      : `Opp. avg ${oneDecimal(s.oppPoints)}`
    return `${i + 1}. ${s.name} — ${s.points} pts · ${recordText(s)} · ${tiebreaks}${s.dropped ? ' · dropped' : ''}`
  })
  return [t.name, `${formatLabel(t)} · ${t.players.length} players · ${t.rounds.length} ${t.rounds.length === 1 ? 'round' : 'rounds'}`, heading, '', ...lines].join('\n')
}

// --- Pairings -----------------------------------------------------------------------------------

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** How often each two players have shared a table. */
function meetings(t: Tournament): Map<string, number> {
  const met = new Map<string, number>()
  for (const round of t.rounds) {
    for (const table of round.tables) {
      for (let i = 0; i < table.players.length; i++) {
        for (let j = i + 1; j < table.players.length; j++) {
          const k = pairKey(table.players[i], table.players[j])
          met.set(k, (met.get(k) ?? 0) + 1)
        }
      }
    }
  }
  return met
}

/** How long the pairing search may look for a way round repeats before settling for one more. */
const MAX_PAIRING_STEPS = 20_000

/**
 * [ids] (best first) in pairs, each player with the nearest below them they haven't played,
 * allowing at most [repeats] rematches — or null when that can't be done.
 */
function pairUp(ids: string[], met: Map<string, number>, repeats: number, steps: { n: number }): [string, string][] | null {
  if (ids.length === 0) return []
  const [first, ...others] = ids
  for (let i = 0; i < others.length; i++) {
    if (++steps.n > MAX_PAIRING_STEPS) return null
    const rematch = (met.get(pairKey(first, others[i])) ?? 0) > 0
    if (rematch && repeats === 0) continue
    const rest = pairUp(others.filter((_, j) => j !== i), met, repeats - (rematch ? 1 : 0), steps)
    if (rest) return [[first, others[i]], ...rest]
    if (steps.n > MAX_PAIRING_STEPS) return null
  }
  return null
}

/**
 * Swiss pairings for [order] (the active players, best first): within score groups, floating down
 * where a group is odd, and no rematch unless there's no way round it. An odd player out gets a bye
 * — the lowest-placed player who hasn't had one.
 */
function swissTables(t: Tournament, order: string[]): EventTable[] {
  const met = meetings(t)
  const hadBye = new Set(t.rounds.flatMap((r) => r.tables.filter((tb) => tb.players.length === 1).map((tb) => tb.players[0])))
  let byes: (string | null)[] = [null]
  if (order.length % 2 === 1) {
    const fromBottom = [...order].reverse()
    const fresh = fromBottom.filter((id) => !hadBye.has(id))
    byes = fresh.length > 0 ? fresh : fromBottom
  }
  for (let repeats = 0; repeats <= order.length; repeats++) {
    for (const bye of byes) {
      const pairs = pairUp(order.filter((id) => id !== bye), met, repeats, { n: 0 })
      if (!pairs) continue
      const tables: EventTable[] = pairs.map((p) => ({ players: p, result: null }))
      return bye == null ? tables : [...tables, { players: [bye], result: byeResult('SWISS') }]
    }
  }
  return []
}

/** Pod sizes for [n] players: fours, with threes making up the rest (five: a three and a two). */
export function podSizes(n: number): number[] {
  if (n <= 0) return []
  if (n < 3) return [n]
  if (n === 5) return [3, 2]
  const threes = (4 - (n % 4)) % 4
  return [...Array<number>((n - 3 * threes) / 4).fill(4), ...Array<number>(threes).fill(3)]
}

/** How far down the standings a pod looks for someone its players haven't met. */
const POD_WINDOW = 8

/** Pods for [order] (best first): grouped by standing, each seat going to whoever nearby has met the pod least. */
function podTables(t: Tournament, order: string[]): EventTable[] {
  const met = meetings(t)
  const left = [...order]
  return podSizes(order.length).map((size) => {
    const pod = [left.shift()!]
    while (pod.length < size) {
      let best = 0
      let bestCost = Infinity
      for (let i = 0; i < Math.min(POD_WINDOW, left.length); i++) {
        const cost = pod.reduce((sum, p) => sum + (met.get(pairKey(p, left[i])) ?? 0), 0)
        if (cost < bestCost) { best = i; bestCost = cost }
      }
      pod.push(left.splice(best, 1)[0])
    }
    return { players: pod, result: pod.length === 1 ? byeResult('PODS') : null }
  })
}

/** [t] with its next round paired (round 1 in the seeded order), or [t] when it can't be. */
export function pairNextRound(t: Tournament): Tournament {
  if (!canPairNext(t)) return t
  const order = standings(t).filter((s) => !s.dropped).map((s) => s.id)
  const tables = t.format === 'SWISS' ? swissTables(t, order) : podTables(t, order)
  const round: EventRound = { number: t.rounds.length + 1, tables, timer: { endsAt: null, leftMs: null } }
  return { ...t, rounds: [...t.rounds, round] }
}

// --- The round clock ----------------------------------------------------------------------------

/** Time left on [timer] at [now]: negative once it's run out. */
export function timeLeft(timer: RoundTimer, minutes: number, now: number): number {
  if (timer.endsAt != null) return timer.endsAt - now
  return timer.leftMs ?? minutes * 60_000
}

export const timerRunning = (timer: RoundTimer) => timer.endsAt != null

export const startTimer = (timer: RoundTimer, minutes: number, now: number): RoundTimer =>
  (timer.endsAt != null ? timer : { endsAt: now + timeLeft(timer, minutes, now), leftMs: null })

export const pauseTimer = (timer: RoundTimer, minutes: number, now: number): RoundTimer =>
  (timer.endsAt == null ? timer : { endsAt: null, leftMs: timeLeft(timer, minutes, now) })

export const RESET_TIMER: RoundTimer = { endsAt: null, leftMs: null }

/** [t] with the current round's clock set to [timer]. */
export function withTimer(t: Tournament, timer: RoundTimer): Tournament {
  const round = currentRound(t)
  if (!round) return t
  return { ...t, rounds: [...t.rounds.slice(0, -1), { ...round, timer }] }
}

/** "49:05", "-2:30": the round clock, in minutes and seconds. */
export function clockText(ms: number): string {
  const total = Math.ceil(Math.abs(ms) / 1000)
  const sign = ms < 0 && total > 0 ? '-' : ''
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** What a table does once the clock runs out. */
export const extraTurnsText = (format: EventFormat) => (format === 'SWISS' ? '5 extra turns' : 'Finish the turn cycle')

// --- Saved events -------------------------------------------------------------------------------

/** "Round 2 of 4", "Not started", "Finished". */
export function statusText(t: Tournament): string {
  if (t.finished) return 'Finished'
  if (t.rounds.length === 0) return 'Not started'
  return `Round ${t.rounds.length} of ${t.roundCount}`
}

/** [events] with [t] in its place, newest first. */
export const withEvent = (events: Tournament[], t: Tournament): Tournament[] =>
  [t, ...events.filter((e) => e.id !== t.id)].sort((a, b) => b.createdAt - a.createdAt)

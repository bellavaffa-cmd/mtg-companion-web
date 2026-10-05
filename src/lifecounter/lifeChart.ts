// A finished game's life totals over its turns (or its time), and a short recap: who dealt the most
// commander damage, the biggest swing in one turn, the longest turn and who was knocked out when.
// Built from the game's history (each entry notes the player's life after it) into a small log that
// is kept with the table's game. Pure. Mirrors the Android app's ui/lifecounter/LifeChart.kt — the
// same log, series and recap from the same entries.

/** One player's life after something changed it. [ms]: game-clock time; [turn]: the round. */
export interface LifePoint { seat: number; ms: number; turn: number; life: number }
/** When a player went out, and why (LIFE, POISON, COMMANDER_DAMAGE, KILLED). */
export interface Knockout { seat: number; ms: number; turn: number; reason: string }
/** When a turn began, and whose it was. */
export interface TurnStart { seat: number; turn: number; ms: number }
/** Commander damage [to] took from [from]'s commanders (both partners together). */
export interface DamageTotal { to: number; from: number; amount: number }

/** A seat as the chart shows it: its name and seat colour. */
export interface ChartSeat { seat: number; name: string; colorIndex: number }

/** What a finished game keeps for its chart and recap. */
export interface GameLog {
  start: { seat: number; life: number }[]
  /** Oldest first. */
  points: LifePoint[]
  outs: Knockout[]
  /** Empty when the table didn't track turns. */
  turns: TurnStart[]
  damage: DamageTotal[]
  /** The game clock when it ended. */
  endMs: number
}

/**
 * One line of the game's history, as each app reads its own: who it was about, when, in which round,
 * their life after it and whether that had them out (with automatic knock-outs on), whether it
 * began a turn, and whether that was a new first player (which starts the turns over).
 */
export interface LogEntry {
  seat: number | null
  ms: number
  turn: number
  life?: number | null
  out?: string | null
  turnStart?: boolean
  first?: boolean
}

/** Points kept with a game; past this, only the last of each player's points in each round stays. */
export const LOG_POINT_LIMIT = 300

/** [points] cut down to [limit]: the last point of each player in each round, then the newest. */
export function compactPoints(points: LifePoint[], limit = LOG_POINT_LIMIT): LifePoint[] {
  if (points.length <= limit) return points
  const lastOf = new Map<string, number>()
  points.forEach((p, i) => lastOf.set(`${p.seat}:${p.turn}`, i))
  const kept = points.filter((p, i) => lastOf.get(`${p.seat}:${p.turn}`) === i)
  return kept.length <= limit ? kept : kept.slice(kept.length - limit)
}

/**
 * The log of a game from its history [entries] (oldest first). [start]: each seat's starting life;
 * [finalOuts]: why each seat is out at the end (null: still in); [firstSeat]: who started.
 */
export function buildGameLog(
  entries: LogEntry[],
  start: { seat: number; life: number }[],
  finalOuts: { seat: number; out: string | null }[],
  damage: DamageTotal[],
  endMs: number,
  turnsTracked: boolean,
  firstSeat: number,
): GameLog {
  const life = new Map(start.map((s) => [s.seat, s.life]))
  const points: LifePoint[] = []
  const wasOut = new Map<number, boolean>()
  const wentOut = new Map<number, LogEntry>()
  let turns: TurnStart[] = turnsTracked ? [{ seat: firstSeat, turn: 1, ms: 0 }] : []
  for (const e of entries) {
    if (e.seat != null && e.life != null && life.get(e.seat) !== e.life) {
      life.set(e.seat, e.life)
      points.push({ seat: e.seat, ms: e.ms, turn: e.turn, life: e.life })
    }
    if (e.seat != null && e.out !== undefined) {
      const out = e.out != null
      if (out && !wasOut.get(e.seat)) wentOut.set(e.seat, e)
      wasOut.set(e.seat, out)
    }
    if (turnsTracked && e.turnStart && e.seat != null) {
      // A new first player starts the count over.
      if (e.first) turns = []
      turns.push({ seat: e.seat, turn: e.turn, ms: e.ms })
    }
  }
  const lastTurn = Math.max(1, ...entries.map((e) => e.turn))
  const outs = finalOuts
    .filter((o): o is { seat: number; out: string } => o.out != null)
    .map((o) => {
      const e = wentOut.get(o.seat)
      return { seat: o.seat, ms: e?.ms ?? endMs, turn: e?.turn ?? lastTurn, reason: o.out }
    })
    .sort((a, b) => a.ms - b.ms || a.seat - b.seat)
  return {
    start,
    points: compactPoints(points),
    outs,
    turns,
    damage: damage.filter((d) => d.amount > 0),
    endMs,
  }
}

/** The last round anything in [log] happened in, at least 1. */
export function lastTurnOf(log: GameLog): number {
  return Math.max(1, ...log.points.map((p) => p.turn), ...log.outs.map((o) => o.turn), ...log.turns.map((t) => t.turn))
}

/** Seat [seat]'s life at the end of round [turn] (round 0: the start). */
export function lifeAtEndOf(log: GameLog, seat: number, turn: number): number {
  let life = log.start.find((s) => s.seat === seat)?.life ?? 0
  for (const p of log.points) if (p.seat === seat && p.turn <= turn) life = p.life
  return life
}

export interface ChartSeries { seat: number; points: { x: number; life: number }[] }
export interface LifeChart {
  series: ChartSeries[]
  /** x runs from 0 to this: rounds, or game-clock milliseconds. */
  xMax: number
  yMin: number
  yMax: number
}

/**
 * Each player's line: by round ([by] 'turn', x = the round, life at its end) or by time ('time',
 * x = game-clock ms, a step at each change). A player's line stops where they went out.
 */
export function lifeChart(log: GameLog, by: 'turn' | 'time'): LifeChart {
  const lastTurn = lastTurnOf(log)
  const series: ChartSeries[] = log.start.map(({ seat, life }) => {
    const out = log.outs.find((o) => o.seat === seat)
    if (by === 'turn') {
      const end = out ? out.turn : lastTurn
      const points = [{ x: 0, life }]
      for (let k = 1; k <= end; k++) points.push({ x: k, life: lifeAtEndOf(log, seat, k) })
      return { seat, points }
    }
    const end = out ? out.ms : log.endMs
    const points = [{ x: 0, life }]
    for (const p of log.points) if (p.seat === seat && p.ms <= end) points.push({ x: p.ms, life: p.life })
    const last = points[points.length - 1]
    if (end > last.x) points.push({ x: end, life: last.life })
    return { seat, points }
  })
  const lives = series.flatMap((s) => s.points.map((p) => p.life))
  return {
    series,
    xMax: by === 'turn' ? lastTurn : Math.max(1, log.endMs),
    yMin: Math.min(0, ...lives),
    yMax: Math.max(1, ...lives),
  }
}

export interface GameRecap {
  /** Who dealt the most commander damage, in total. */
  mostCommanderDamage: { seat: number; amount: number } | null
  /** The biggest change in one player's life over one round. */
  biggestSwing: { seat: number; turn: number; delta: number } | null
  /** The longest turn, when the table tracked turns. */
  longestTurn: { seat: number; turn: number; ms: number } | null
  /** Who went out, first first. */
  knockouts: Knockout[]
}

export function gameRecap(log: GameLog): GameRecap {
  const dealt = new Map<number, number>()
  for (const d of log.damage) dealt.set(d.from, (dealt.get(d.from) ?? 0) + d.amount)
  let most: GameRecap['mostCommanderDamage'] = null
  for (const [seat, amount] of [...dealt].sort((a, b) => a[0] - b[0])) {
    if (amount > 0 && (!most || amount > most.amount)) most = { seat, amount }
  }

  let swing: GameRecap['biggestSwing'] = null
  const lastTurn = lastTurnOf(log)
  for (let turn = 1; turn <= lastTurn; turn++) {
    for (const { seat } of [...log.start].sort((a, b) => a.seat - b.seat)) {
      const delta = lifeAtEndOf(log, seat, turn) - lifeAtEndOf(log, seat, turn - 1)
      if (delta !== 0 && (!swing || Math.abs(delta) > Math.abs(swing.delta))) swing = { seat, turn, delta }
    }
  }

  let longest: GameRecap['longestTurn'] = null
  const turns = [...log.turns].sort((a, b) => a.ms - b.ms)
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]
    const ms = (i + 1 < turns.length ? turns[i + 1].ms : log.endMs) - t.ms
    if (ms > 0 && (!longest || ms > longest.ms)) longest = { seat: t.seat, turn: t.turn, ms }
  }

  return { mostCommanderDamage: most, biggestSwing: swing, longestTurn: longest, knockouts: [...log.outs].sort((a, b) => a.ms - b.ms || a.seat - b.seat) }
}

/** "12:05", "1:02:30": a length of game-clock time. */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** Why someone went out, as a few words. */
export function outText(reason: string): string {
  switch (reason) {
    case 'LIFE': return 'out of life'
    case 'POISON': return 'poisoned'
    case 'COMMANDER_DAMAGE': return 'commander damage'
    default: return 'knocked out'
  }
}

/**
 * The recap as short lines, [nameOf] giving each seat's name: "Ana dealt the most commander
 * damage: 23", "Biggest swing: Ben, −12 in round 4", "Longest turn: Cat's, round 3 (6:40)",
 * "Ben went out in round 5 (out of life)".
 */
export function recapLines(recap: GameRecap, nameOf: (seat: number) => string): string[] {
  const lines: string[] = []
  if (recap.mostCommanderDamage) lines.push(`${nameOf(recap.mostCommanderDamage.seat)} dealt the most commander damage: ${recap.mostCommanderDamage.amount}`)
  if (recap.biggestSwing) {
    const d = recap.biggestSwing.delta
    lines.push(`Biggest swing: ${nameOf(recap.biggestSwing.seat)}, ${d > 0 ? '+' : '−'}${Math.abs(d)} in round ${recap.biggestSwing.turn}`)
  }
  if (recap.longestTurn) lines.push(`Longest turn: ${nameOf(recap.longestTurn.seat)}'s, round ${recap.longestTurn.turn} (${durationText(recap.longestTurn.ms)})`)
  for (const k of recap.knockouts) lines.push(`${nameOf(k.seat)} went out in round ${k.turn} (${outText(k.reason)})`)
  return lines
}

/** A log read back from storage: null unless it has the shape this version writes. */
export function parseGameLog(raw: unknown): GameLog | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : null)
  const start = arr(o.start)
  const points = arr(o.points)
  if (!start || !points || typeof o.endMs !== 'number') return null
  return {
    start: start as GameLog['start'],
    points: points as LifePoint[],
    outs: (arr(o.outs) ?? []) as Knockout[],
    turns: (arr(o.turns) ?? []) as TurnStart[],
    damage: (arr(o.damage) ?? []) as DamageTotal[],
    endMs: o.endMs,
  }
}

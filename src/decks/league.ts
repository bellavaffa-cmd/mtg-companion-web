// League mode: a pod runs seasons over its shared game log (podStats.ts). A season is a name, the
// days it runs (or a number of game nights) and its scoring rules, kept on the server
// (MtgCompanionApp/supabase/migrations/20261006060000_pod_seasons.sql) so the whole pod sees the
// same season. The table — points, wins, win rate, streak, points per game night, the champion — is
// worked out here from the pod's games, the same on every device. Mirrors the Android app's
// data/League.kt: same rules, same JSON keys, same tie-breaks.

import { shortDay } from '../collection/loans'
import { playerKey, type PodGame, type PodPlayer } from './podStats'

/** What the league shows until the server has seasons (the migration isn't applied yet). */
export const LEAGUE_UNAVAILABLE = "Leagues aren't available yet"

/** Points for each thing that can happen in a game. Whole numbers 0–MAX_RULE_POINTS. */
export interface LeagueRules {
  /** Which preset these came from (LEAGUE_PRESETS), or PRESET_CUSTOM. */
  preset: string
  win: number
  /** For finishing second, when the game recorded it. */
  second: number
  /** For each player in a drawn game. */
  draw: number
  /** For playing at all. */
  played: number
  /** For knocking out the game's first player. */
  firstBlood: number
  /** Extra for a win with a deck its player hasn't played in this pod before. */
  newDeckWin: number
}

export const PRESET_STANDARD = 'standard'
export const PRESET_WINS = 'wins'
export const PRESET_EVERYONE = 'everyone'
export const PRESET_CUSTOM = 'custom'
export const MAX_RULE_POINTS = 10

export const DEFAULT_RULES: LeagueRules = { preset: PRESET_STANDARD, win: 3, second: 1, draw: 1, played: 0, firstBlood: 1, newDeckWin: 0 }

export const LEAGUE_PRESETS: { id: string; label: string; rules: LeagueRules }[] = [
  { id: PRESET_STANDARD, label: 'Standard', rules: DEFAULT_RULES },
  { id: PRESET_WINS, label: 'Wins only', rules: { preset: PRESET_WINS, win: 1, second: 0, draw: 0, played: 0, firstBlood: 0, newDeckWin: 0 } },
  { id: PRESET_EVERYONE, label: 'Everyone scores', rules: { preset: PRESET_EVERYONE, win: 3, second: 1, draw: 1, played: 1, firstBlood: 1, newDeckWin: 1 } },
]

/** The rules in words: "Win 3 · Second 1 · Draw 1 · First blood +1". */
export function rulesSummary(r: LeagueRules): string {
  return [
    `Win ${r.win}`,
    r.second > 0 ? `Second ${r.second}` : null,
    r.draw > 0 ? `Draw ${r.draw}` : null,
    r.played > 0 ? `Playing ${r.played}` : null,
    r.firstBlood > 0 ? `First blood +${r.firstBlood}` : null,
    r.newDeckWin > 0 ? `Win with a new deck +${r.newDeckWin}` : null,
  ].filter(Boolean).join(' · ')
}

/** One row of a season's table. [key] as playerKey. [streak]: "W3", "L1", "D1", or "" before any game. */
export interface LeagueStanding {
  key: string
  userId: string | null
  name: string
  rank: number
  points: number
  games: number
  wins: number
  losses: number
  draws: number
  streak: string
  firstBloods: number
  seconds: number
  newDeckWins: number
}

export const winRate = (s: Pick<LeagueStanding, 'wins' | 'games'>) => (s.games ? Math.floor((s.wins * 100) / s.games) : 0)

export interface Season {
  id: string
  podId: string
  name: string
  /** The first day, "YYYY-MM-DD". */
  startsOn: string
  /** The last day, or null to run until maxNights game nights (or until it's ended). */
  endsOn: string | null
  maxNights: number | null
  rules: LeagueRules
  createdBy: string | null
  createdAt: number
  /** When it was ended: games after it don't count. Null while it hasn't been. */
  endedAt: number | null
  /** The champion's name, kept when it ended ("Priya", or "Priya & Sam"). */
  champion: string | null
  /** The final table, kept when it ended. */
  standings: LeagueStanding[] | null
}

/** One player's points on one game night. */
export interface NightScore { key: string; userId: string | null; name: string; points: number }

/** A game night of the season: its day, its games and everyone's points that night, most first. */
export interface NightPoints { night: string; games: number; scores: NightScore[] }

export interface SeasonTable {
  /** The games that count, oldest first. */
  games: PodGame[]
  /** The game nights played, oldest first. */
  nights: string[]
  standings: LeagueStanding[]
  /** Newest night first. */
  perNight: NightPoints[]
  /** Everyone ranked first (more than one on a tie); empty before any game. */
  champions: LeagueStanding[]
}

export type SeasonStatus = 'UPCOMING' | 'RUNNING' | 'OVER' | 'ENDED'

const pad = (n: number) => String(n).padStart(2, '0')

/** The game night a game belongs to: its day where it was played (this device's calendar, or UTC), "YYYY-MM-DD". */
export function nightOf(playedAt: number, utc = false): string {
  const d = new Date(playedAt)
  return utc
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today, "YYYY-MM-DD", on this device's calendar. */
export const todayDay = () => nightOf(Date.now())

const byTime = (a: PodGame, b: PodGame) => a.playedAt - b.playedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The pod games that count for [season], oldest first: played on its days, before it was ended,
 * and — when it runs for maxNights — on its first that many game nights.
 */
export function seasonGames(season: Season, games: PodGame[], utc = false): PodGame[] {
  const inDays = games.filter((g) => {
    const night = nightOf(g.playedAt, utc)
    return night >= season.startsOn
      && (season.endsOn == null || night <= season.endsOn)
      && (season.endedAt == null || g.playedAt <= season.endedAt)
  }).sort(byTime)
  if (season.maxNights == null) return inDays
  const kept = new Set([...new Set(inDays.map((g) => nightOf(g.playedAt, utc)))].sort().slice(0, season.maxNights))
  return inDays.filter((g) => kept.has(nightOf(g.playedAt, utc)))
}

/**
 * Where [season] is on [today] ("YYYY-MM-DD"): not started yet, running, over by its own rules (its
 * last day has passed, or its game nights are all played and that last night is past) but not yet
 * ended on the server, or ended.
 */
export function seasonStatus(season: Season, games: PodGame[], today: string, utc = false): SeasonStatus {
  if (season.endedAt != null) return 'ENDED'
  if (today < season.startsOn) return 'UPCOMING'
  if (season.endsOn != null && today > season.endsOn) return 'OVER'
  if (season.maxNights != null) {
    const nights = [...new Set(seasonGames(season, games, utc).map((g) => nightOf(g.playedAt, utc)))].sort()
    if (nights.length >= season.maxNights && today > nights[nights.length - 1]) return 'OVER'
  }
  return 'RUNNING'
}

/** What a deck is known by in the log: its name, else its commander; null when neither was recorded. */
const deckLabel = (p: PodPlayer) => (p.deck ?? p.commander)?.trim().toLowerCase() || null

/** One seat's points in a game. [newDeck]: the seat won with a deck its player hadn't played in the pod before. */
export function gamePoints(p: Pick<PodPlayer, 'result' | 'place' | 'firstBlood'>, rules: LeagueRules, newDeck = false): number {
  let points = rules.played
  if (p.result === 'WIN') points += rules.win + (newDeck ? rules.newDeckWin : 0)
  else if (p.result === 'DRAW') points += rules.draw
  else if (p.place === 2) points += rules.second
  if (p.firstBlood) points += rules.firstBlood
  return points
}

/** The streak shown in the table: the newest result and how many in a row ("W3"), from results oldest first. */
export function streakOf(results: string[]): string {
  if (!results.length) return ''
  const last = results[results.length - 1]
  let count = 0
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) count++
  return (last === 'WIN' ? 'W' : last === 'LOSS' ? 'L' : 'D') + count
}

/** Higher first: points, then wins, then win rate (exactly, not rounded). Name only orders exact ties. */
function beats(a: LeagueStanding, b: LeagueStanding): number {
  if (a.points !== b.points) return b.points - a.points
  if (a.wins !== b.wins) return b.wins - a.wins
  return b.wins * a.games - a.wins * b.games
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

interface Tally {
  key: string
  userId: string | null
  name: string
  points: number
  wins: number
  losses: number
  draws: number
  firstBloods: number
  seconds: number
  newDeckWins: number
  results: string[]
}

/**
 * [season]'s table from the pod's games ([allGames], the whole log — "a new deck" looks at games
 * before the season too). Ranked by points, then wins, then win rate; players equal on all three
 * share a rank, and a shared first place makes joint champions.
 */
export function seasonTable(season: Season, allGames: PodGame[], utc = false): SeasonTable {
  const counted = seasonGames(season, allGames, utc)
  // When each player first played each deck in the pod.
  const firstPlayed = new Map<string, number>()
  for (const g of allGames) {
    for (const p of g.players) {
      const label = deckLabel(p)
      if (!label) continue
      const k = `${playerKey(p)}|${label}`
      const seen = firstPlayed.get(k)
      if (seen === undefined || g.playedAt < seen) firstPlayed.set(k, g.playedAt)
    }
  }
  const tallies = new Map<string, Tally>()
  const nights = new Map<string, { games: number; scores: Map<string, number> }>()
  for (const g of counted) {
    const night = nightOf(g.playedAt, utc)
    const n = nights.get(night) ?? { games: 0, scores: new Map<string, number>() }
    nights.set(night, n)
    n.games++
    const seats = g.players.filter((p, i, all) => all.findIndex((q) => playerKey(q) === playerKey(p)) === i)
    for (const p of seats) {
      const key = playerKey(p)
      const t = tallies.get(key) ?? { key, userId: null, name: '', points: 0, wins: 0, losses: 0, draws: 0, firstBloods: 0, seconds: 0, newDeckWins: 0, results: [] }
      tallies.set(key, t)
      t.userId = p.userId ?? t.userId
      t.name = p.name.trim()
      const label = deckLabel(p)
      const newDeck = p.result === 'WIN' && label != null && (firstPlayed.get(`${key}|${label}`) ?? Infinity) >= g.playedAt
      const points = gamePoints(p, season.rules, newDeck)
      t.points += points
      if (p.result === 'WIN') t.wins++
      else if (p.result === 'LOSS') t.losses++
      else t.draws++
      if (p.firstBlood) t.firstBloods++
      if (p.result === 'LOSS' && p.place === 2) t.seconds++
      if (newDeck) t.newDeckWins++
      t.results.push(p.result)
      n.scores.set(key, (n.scores.get(key) ?? 0) + points)
    }
  }
  const unranked: LeagueStanding[] = [...tallies.values()].map((t) => ({
    key: t.key, userId: t.userId, name: t.name, rank: 0, points: t.points, games: t.results.length,
    wins: t.wins, losses: t.losses, draws: t.draws, streak: streakOf(t.results),
    firstBloods: t.firstBloods, seconds: t.seconds, newDeckWins: t.newDeckWins,
  })).sort((a, b) => beats(a, b) || byName(a.name.toLowerCase(), b.name.toLowerCase()) || byName(a.key, b.key))
  const standings: LeagueStanding[] = []
  unranked.forEach((s, i) => {
    const rank = i > 0 && beats(unranked[i - 1], s) === 0 ? standings[i - 1].rank : i + 1
    standings.push({ ...s, rank })
  })
  const perNight = [...nights.entries()].sort((a, b) => byName(b[0], a[0])).map(([night, v]) => ({
    night,
    games: v.games,
    scores: [...v.scores.entries()].map(([key, points]) => {
      const t = tallies.get(key)!
      return { key, userId: t.userId, name: t.name, points }
    }).sort((a, b) => b.points - a.points || byName(a.name.toLowerCase(), b.name.toLowerCase())),
  }))
  return { games: counted, nights: [...nights.keys()].sort(), standings, perNight, champions: standings.filter((s) => s.rank === 1) }
}

/** "Season 1 champion: Priya", "Season 1 champions: Priya & Sam"; null with nobody to name. */
export function championLine(seasonName: string, champion: string | null | undefined): string | null {
  if (!champion?.trim()) return null
  return `${seasonName} ${champion.includes(' & ') ? 'champions' : 'champion'}: ${champion}`
}

/** The champions' names together, as kept on the server. */
export const championNames = (champions: Pick<LeagueStanding, 'name'>[]): string | null => champions.map((s) => s.name).join(' & ') || null

/** The name a new season gets: "Season 3" after two. */
export const nextSeasonName = (seasons: Season[]) => `Season ${seasons.length + 1}`

/** The season that hasn't been ended yet, if any (one at a time per pod). */
export const runningSeason = (seasons: Season[]): Season | null => seasons.find((s) => s.endedAt == null) ?? null

/** When a season runs, in words: "1 Oct – 31 Dec", "From 1 Oct, for 8 game nights", "From 1 Oct". */
export function seasonDays(season: Pick<Season, 'startsOn' | 'endsOn' | 'maxNights'>): string {
  if (season.endsOn != null) return `${shortDay(season.startsOn)} – ${shortDay(season.endsOn)}`
  if (season.maxNights != null) return `From ${shortDay(season.startsOn)}, for ${season.maxNights} game ${season.maxNights === 1 ? 'night' : 'nights'}`
  return `From ${shortDay(season.startsOn)}`
}

/** The ms at the start of the day after [day], on this device's calendar or UTC. */
function nextDayStart(day: string, utc: boolean): number {
  const [y, m, d] = day.split('-').map(Number)
  return utc ? Date.UTC(y, m - 1, d + 1) : new Date(y, m - 1, d + 1).getTime()
}

/**
 * When a season that's over by its own rules ended: the end of its last day, or of its last game
 * night — never after [now].
 */
export function seasonEndedAt(season: Season, table: SeasonTable, now: number, utc = false): number {
  const last = season.endsOn ?? (season.maxNights != null ? table.nights[table.nights.length - 1] ?? null : null)
  if (!last) return now
  return Math.min(nextDayStart(last, utc) - 1, now)
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

/** The checks before saving a season, in words for the screen, or null. Days are "YYYY-MM-DD". */
export function seasonProblem(name: string, startsOn: string, endsOn: string | null, maxNights: number | null): string | null {
  if (!name.trim()) return 'Give the season a name.'
  if (name.trim().length > 40) return 'Keep the name to 40 characters.'
  if (!isDay(startsOn)) return 'Pick the day it starts.'
  if (endsOn != null && !isDay(endsOn)) return 'Pick the day it ends.'
  if (endsOn != null && endsOn < startsOn) return 'It has to end after it starts.'
  if (maxNights != null && !(maxNights >= 1 && maxNights <= 100)) return 'A season runs for 1 to 100 game nights.'
  return null
}

/**
 * Which pod's league a game night counts for: the pod with a running season that has the most of
 * tonight's players in it (by account; the user always counts). Ties go to the first. Null when
 * no pod has a running season.
 */
export function leaguePodFor(candidates: [string, string[]][], nightUserIds: Set<string>): string | null {
  let best: string | null = null
  let most = -1
  for (const [id, members] of candidates) {
    const n = members.filter((m) => nightUserIds.has(m)).length
    if (n > most) { best = id; most = n }
  }
  return best
}

/** Whoever started a season, or the pod's owner, changes or ends it (the server checks the same). */
export const canManageSeason = (season: Season, me: string, podOwner: string) => season.createdBy === me || podOwner === me

// ---- JSON (the server's answers, and what it's sent) ----

export const rulesJson = (r: LeagueRules) => ({
  preset: r.preset, win: r.win, second: r.second, draw: r.draw, played: r.played, firstBlood: r.firstBlood, newDeckWin: r.newDeckWin,
})

const points = (o: Record<string, unknown>, key: keyof LeagueRules, fallback: number) => {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_RULE_POINTS, Math.max(0, Math.trunc(v))) : fallback
}

/** Rules from the server; anything missing takes the Standard preset's value. */
export function parseRules(o: unknown): LeagueRules {
  const d = DEFAULT_RULES
  if (!o || typeof o !== 'object') return { ...d }
  const r = o as Record<string, unknown>
  return {
    preset: typeof r.preset === 'string' && r.preset ? r.preset : PRESET_CUSTOM,
    win: points(r, 'win', d.win),
    second: points(r, 'second', d.second),
    draw: points(r, 'draw', d.draw),
    played: points(r, 'played', d.played),
    firstBlood: points(r, 'firstBlood', d.firstBlood),
    newDeckWin: points(r, 'newDeckWin', d.newDeckWin),
  }
}

/** The final table as end_pod_season keeps it. */
export const standingsJson = (standings: LeagueStanding[]) => standings.map((s) => ({
  key: s.key, userId: s.userId, name: s.name, rank: s.rank, points: s.points, games: s.games,
  wins: s.wins, losses: s.losses, draws: s.draws, streak: s.streak,
}))

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export function parseStandings(a: unknown[]): LeagueStanding[] {
  return a.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    return {
      key: String(o.key ?? ''), userId: str(o.userId), name: String(o.name ?? ''), rank: num(o.rank, i + 1),
      points: num(o.points), games: num(o.games), wins: num(o.wins), losses: num(o.losses), draws: num(o.draws),
      streak: String(o.streak ?? ''), firstBloods: 0, seconds: 0, newDeckWins: 0,
    }
  })
}

/** pod_seasons' answer, newest first. */
export function parseSeasons(raw: unknown): Season[] {
  if (!Array.isArray(raw)) return []
  return raw.map((x) => {
    const o = x as Record<string, unknown>
    return {
      id: String(o.id),
      podId: String(o.podId ?? ''),
      name: String(o.name ?? ''),
      startsOn: String(o.startsOn ?? ''),
      endsOn: str(o.endsOn),
      maxNights: typeof o.maxNights === 'number' ? o.maxNights : null,
      rules: parseRules(o.rules),
      createdBy: str(o.createdBy),
      createdAt: num(o.createdAt),
      endedAt: typeof o.endedAt === 'number' ? o.endedAt : null,
      champion: str(o.champion),
      standings: Array.isArray(o.standings) ? parseStandings(o.standings) : null,
    }
  })
}

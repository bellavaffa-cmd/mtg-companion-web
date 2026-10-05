import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { DEFAULT_LAYOUT_ID, layoutById, playerCount } from './tableLayouts'
import { avatarUrl } from '../social/api'
import { clampCounter, cleanRingBearer } from './counterRules'
import { DUNGEONS, roomOf, venture as ventureTo, type DungeonState } from './dungeons'
import {
  changedTokenCounts, clockElapsed, newClock, pauseClock, resumeClock, tokenLabel, TURN_TIMER_CHOICES,
  type GameClock, type SeatDeckInfo,
} from './tableExtras'

/** A seat colour: Display P3 where the screen supports it, with an sRGB stand-in, and its text ink. */
export interface SeatColor { p3: string; srgb: string; whiteText?: boolean }

function p3(r: number, g: number, b: number, whiteText = false): SeatColor {
  const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return { p3: `color(display-p3 ${r} ${g} ${b})`, srgb: `#${hex(r)}${hex(g)}${hex(b)}`, whiteText }
}

/** Same palette, in the same order, as the Android life counter (LifeCounterTheme.kt). */
export const PLAYER_PALETTE: SeatColor[] = [
  p3(0.922, 0.612, 1), // lilac
  p3(1, 0.776, 0), // yellow
  p3(0.957, 0.173, 0.314), // red
  p3(0.271, 0.314, 1), // blue
  p3(0, 0.8, 0.46), // green
  p3(1, 0.38, 0), // orange
  p3(0.682, 0.925, 1), // baby blue
  p3(0.42, 0.118, 1, true), // purple
  p3(1, 0, 0.902), // pink
  p3(0.784, 1, 0.302), // bright green
  p3(1, 0.957, 0.8), // sand
  p3(0, 0.71, 0.482), // sea green
  p3(0, 0.459, 1, true), // light blue
  p3(0.325, 0.412, 0.784, true), // sand blue
  p3(0.561, 0, 0.263, true), // dark red
  p3(0.349, 0.365, 0.467, true), // grey
  p3(0.616, 0.635, 0.773), // light grey
  p3(0.91, 1, 0.545), // baby green
  p3(1, 0.839, 0), // gold
]

/** The first ten palette entries are the default seat colours, in seat order. */
export const PLAYER_COLOR_COUNT = 10

export const seatColor = (index: number): SeatColor =>
  PLAYER_PALETTE[((index % PLAYER_PALETTE.length) + PLAYER_PALETTE.length) % PLAYER_PALETTE.length]

/** Someone with an account sitting at a seat, having scanned its QR code (see LinkSeat.tsx). */
export interface LinkedPlayer {
  userId: string
  username: string
  displayName: string
  avatarPath: string | null
}

export interface Player {
  id: number
  life: number
  /** Damage taken from each opponent's commander, keyed by that opponent's id. */
  commanderDamage: Record<number, number>
  poison: number
  colorIndex: number
  name: string | null
  killed: boolean
  /** The account sitting here, when someone joined the seat by QR code. */
  linked?: LinkedPlayer | null
  /** Counters beyond poison (experience, energy…), keyed by CounterKind. */
  counters?: Partial<Record<CounterKind, number>>
  /** A picture behind the tile (commander art, a profile picture, a GIF), chosen from a player's remote. */
  background?: string | null
  /** The deck the player said they're playing, from their remote. */
  deck?: string | null
  /** That deck's commander, from their remote — or set at the table (the 'seatCommander' action). */
  commander?: string | null
  /** The art of a commander set at the table, while it's the tile's background. */
  commanderArt?: string | null
  /** How many times they've cast their commander this game — the tax is two for each. */
  commanderCasts?: number
  /** They play two commanders (partners), each a commander of its own under the rules. */
  hasPartner?: boolean
  /** Damage taken from each opponent's partner, keyed by that opponent's id — apart from [commanderDamage]. */
  partnerDamage?: Record<number, number>
  /** Casts of their partner, taxed on its own. */
  partnerCasts?: number
  /** Their own victory and defeat messages; unset, the table's lists in Settings → Messages are used. */
  victoryMessage?: string | null
  defeatMessage?: string | null
  /** Poison has been counted for them this game, so "Keep zero counters" keeps it on the tile at 0. */
  poisonUsed?: boolean
  /** The tokens and start-of-turn cards of the deck played here — from the player's remote, or the table owner's own deck. */
  deckInfo?: SeatDeckInfo | null
  /** How many of each of [deckInfo]'s tokens are out, by token id. */
  tokenCounts?: Record<string, number>
  /** Where their venture marker is (dungeons.ts), and how many dungeons they've completed this game. */
  dungeon?: DungeonState | null
  dungeonsCompleted?: number
  /** Their Ring-bearer's name, once the Ring has tempted them (the 'ring' counter is how often). */
  ringBearer?: string | null
  /** Mulligans they took this game (0: kept seven); unset until someone records it. */
  mulligans?: number | null
}

/** Damage [p] has taken from [from]'s commander (slot 0) or partner (slot 1). */
export const damageFrom = (p: Player, from: number, slot = 0) =>
  (slot === 1 ? p.partnerDamage?.[from] : p.commanderDamage[from]) ?? 0

/** Every commander-damage total [p] carries — each one on its own, since 21 from either partner is lethal. */
const damageTotals = (p: Player) => [...Object.values(p.commanderDamage), ...Object.values(p.partnerDamage ?? {})]

/**
 * Counters a player can keep besides poison. Storm is cleared when the turn passes. Speed stops at 4
 * and the Ring at 4 (counterRules.ts). Android's PlayerCounter, in its order.
 */
export const COUNTER_KINDS = ['experience', 'energy', 'charge', 'storm', 'tokens', 'loyalty', 'rad', 'speed', 'ring'] as const
export type CounterKind = (typeof COUNTER_KINDS)[number]
export const COUNTER_INFO: Record<CounterKind, { label: string; icon: string }> = {
  experience: { label: 'Experience', icon: 'school' },
  energy: { label: 'Energy', icon: 'bolt' },
  charge: { label: 'Charge', icon: 'battery_charging_full' },
  storm: { label: 'Storm', icon: 'thunderstorm' },
  tokens: { label: 'Tokens', icon: 'toll' },
  loyalty: { label: 'Loyalty', icon: 'shield' },
  rad: { label: 'Rad', icon: 'science' },
  speed: { label: 'Speed', icon: 'speed' },
  ring: { label: 'The Ring', icon: 'trip_origin' },
}
export const counterOf = (p: Player, kind: CounterKind) => p.counters?.[kind] ?? 0

/** Close to losing: 8+ poison, or 18+ damage from one commander. */
export function inDanger(p: Player): boolean {
  return p.poison >= 8 || damageTotals(p).some((d) => d >= 18)
}

export const displayName = (p: Player) => p.linked?.displayName ?? p.name ?? `Player ${p.id}`

export type LossReason = 'LIFE' | 'POISON' | 'COMMANDER_DAMAGE' | 'KILLED'

export function lossReason(p: Player, autoKill: boolean): LossReason | null {
  if (p.killed) return 'KILLED'
  if (!autoKill) return null
  if (damageTotals(p).some((d) => d >= 21)) return 'COMMANDER_DAMAGE'
  if (p.poison >= 10) return 'POISON'
  if (p.life <= 0) return 'LIFE'
  return null
}

/** Counters that can be pinned to every tile: poison, then the others. Android's PlayerCounter, in its order. */
export const PINNABLE_COUNTERS = ['poison', ...COUNTER_KINDS] as const
export type PinnableCounter = (typeof PINNABLE_COUNTERS)[number]
export const pinnableLabel = (k: PinnableCounter) => (k === 'poison' ? 'Poison' : COUNTER_INFO[k].label)

/**
 * How the life counter behaves and looks, kept between games. The same settings, defaults and
 * meanings as the Android app's LifeCounterSettings (named as the web always named the first few).
 */
export interface LifeSettings {
  layoutId: string
  multiplayerStartingLife: number
  twoPlayerStartingLife: number
  turnTracker: boolean
  /** Minutes a turn may take before the device buzzes (see TURN_TIMER_CHOICES); 0 is off. Needs the turn tracker. */
  turnTimerMinutes: number
  /** At the start of a player's turn, their deck's "at the beginning of your …" cards show on their tile. */
  triggerReminders: boolean
  /** Every new game opens with a high roll for who goes first. */
  highRollAtStart: boolean
  autoKill: boolean
  commanderDamageCostsLife: boolean
  /** Poison, other counters and commander tax on the tile once they're above 0. */
  countersOnTile: boolean
  /** Counters someone has used stay on the tile after dropping back to 0. */
  keepZeroCounters: boolean
  /** Shown on every tile in every game regardless of value. */
  pinnedCounters: PinnableCounter[]
  showCommanderDamageOnTile: boolean
  playerNamesOnTile: boolean
  /** Draw defeat/victory messages from the lists below instead of a plain "Defeated"/"Victory!". */
  saltyMessages: boolean
  /** The drawn messages change every few seconds. */
  cycleMessages: boolean
  /** Each new game deals the seats random colours. */
  shuffleColors: boolean
  /** Top half adds / bottom half subtracts, instead of right adds / left subtracts. */
  verticalTapAreas: boolean
  /** Hides the + and − hints on each tile. */
  minimalist: boolean
  /** Underlines 6 and 9 so they can't be misread from across the table. */
  underlineSixNine: boolean
  /** A red glow while life is below 10. */
  lowLifeWarning: boolean
  /** What one tap adds or takes away. */
  tapAmount: number
  longPressAmount: number
  defeatMessages: string[]
  commanderDefeatMessages: string[]
  poisonDefeatMessages: string[]
  victoryMessages: string[]
  /** Players who joined a seat by QR code can change their own seat from their phone. */
  remotes: boolean
  /** The table owner's own seat, when they play without a phone of their own — see tableGames.ts meResultOf. */
  meSeat?: number | null
  /** The deck their games there are saved to. */
  meDeckId?: string | null
}

export const DEFAULT_DEFEAT_MESSAGES = ['Defeated', 'Out of the game', 'Better luck next game', 'Off to the graveyard', "That's the game for you"]
export const DEFAULT_COMMANDER_DEFEAT_MESSAGES = ['Taken out by a commander', '21 and done', 'Commander damage claims another']
export const DEFAULT_POISON_DEFEAT_MESSAGES = ['Poisoned', 'Ten counters too many', 'A toxic ending']
export const DEFAULT_VICTORY_MESSAGES = ['Victory!', 'Last one standing', 'The table is yours', 'Winner']

export const DEFAULT_SETTINGS: LifeSettings = {
  layoutId: DEFAULT_LAYOUT_ID,
  multiplayerStartingLife: 40,
  twoPlayerStartingLife: 20,
  turnTracker: false,
  turnTimerMinutes: 0,
  triggerReminders: true,
  highRollAtStart: false,
  autoKill: true,
  commanderDamageCostsLife: true,
  countersOnTile: true,
  keepZeroCounters: false,
  pinnedCounters: [],
  showCommanderDamageOnTile: true,
  playerNamesOnTile: true,
  saltyMessages: true,
  cycleMessages: false,
  shuffleColors: false,
  verticalTapAreas: false,
  minimalist: false,
  underlineSixNine: true,
  lowLifeWarning: true,
  tapAmount: 1,
  longPressAmount: 10,
  defeatMessages: DEFAULT_DEFEAT_MESSAGES,
  commanderDefeatMessages: DEFAULT_COMMANDER_DEFEAT_MESSAGES,
  poisonDefeatMessages: DEFAULT_POISON_DEFEAT_MESSAGES,
  victoryMessages: DEFAULT_VICTORY_MESSAGES,
  remotes: true,
}

/** Tap and long-press amounts the settings take: 1 to 999. */
export const clampAmount = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 999 ? n : fallback

/**
 * Settings as stored by any version: whatever's missing (everything added since) takes its
 * default, and whatever's the wrong shape is put right rather than breaking the table.
 */
export function normalizeSettings(raw: unknown): LifeSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = { ...DEFAULT_SETTINGS, ...o } as LifeSettings
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof LifeSettings)[]) {
    const d = DEFAULT_SETTINGS[key]
    if (typeof d === 'boolean' && typeof s[key] !== 'boolean') (s as unknown as Record<string, unknown>)[key] = d
  }
  const strings = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : d)
  return {
    ...s,
    tapAmount: clampAmount(s.tapAmount, DEFAULT_SETTINGS.tapAmount),
    longPressAmount: clampAmount(s.longPressAmount, DEFAULT_SETTINGS.longPressAmount),
    turnTimerMinutes: TURN_TIMER_CHOICES.includes(s.turnTimerMinutes) ? s.turnTimerMinutes : 0,
    pinnedCounters: Array.isArray(s.pinnedCounters)
      ? PINNABLE_COUNTERS.filter((k) => (s.pinnedCounters as unknown[]).includes(k))
      : [],
    defeatMessages: strings(s.defeatMessages, DEFAULT_DEFEAT_MESSAGES),
    commanderDefeatMessages: strings(s.commanderDefeatMessages, DEFAULT_COMMANDER_DEFEAT_MESSAGES),
    poisonDefeatMessages: strings(s.poisonDefeatMessages, DEFAULT_POISON_DEFEAT_MESSAGES),
    victoryMessages: strings(s.victoryMessages, DEFAULT_VICTORY_MESSAGES),
  }
}

/** Settings → Reset settings: everything back to its default, but the seating and whose seat is yours. */
export const resetSettings = (s: LifeSettings): LifeSettings =>
  ({ ...DEFAULT_SETTINGS, layoutId: s.layoutId, meSeat: s.meSeat, meDeckId: s.meDeckId })

/** A whole number for a game, from its id — so a message drawn for it holds steady for the game. */
export function gameNumberOf(gameId: string | undefined): number {
  let h = 0
  for (const ch of gameId ?? '') h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

const floorMod = (a: number, n: number) => ((a % n) + n) % n

/** One message from [list] for [playerId] in game [gameNumber], moving on with [tick] while cycling. */
export function pickMessage(list: string[], fallback: string, playerId: number, gameNumber: number, tick: number): string {
  return list.length === 0 ? fallback : list[floorMod(playerId * 31 + gameNumber * 17 + tick, list.length)]
}

/**
 * What a player who is out reads on their tile: their own message, else one drawn from the list for
 * why they lost (with salty messages on), else plainly "Defeated".
 */
export function defeatMessageFor(p: Player, reason: LossReason, s: LifeSettings, gameNumber: number, tick: number): string {
  if (p.defeatMessage) return p.defeatMessage
  if (!s.saltyMessages) return 'Defeated'
  const list = reason === 'COMMANDER_DAMAGE' ? s.commanderDefeatMessages : reason === 'POISON' ? s.poisonDefeatMessages : s.defeatMessages
  return pickMessage(list, 'Defeated', p.id, gameNumber, tick)
}

/** What the last player standing reads on their tile. */
export function victoryMessageFor(p: Player, s: LifeSettings, gameNumber: number, tick: number): string {
  if (p.victoryMessage) return p.victoryMessage
  if (!s.saltyMessages) return 'Victory!'
  return pickMessage(s.victoryMessages, 'Victory!', p.id, gameNumber, tick)
}

/** The counters a tile shows, per Settings → Counters on player card. */
export function tileCounters(p: Player, s: LifeSettings): PinnableCounter[] {
  return PINNABLE_COUNTERS.filter((k) => {
    if (s.pinnedCounters.includes(k)) return true
    if (!s.countersOnTile) return false
    if (k === 'poison') return p.poison > 0 || (s.keepZeroCounters && !!p.poisonUsed)
    return counterOf(p, k) > 0 || (s.keepZeroCounters && p.counters?.[k] !== undefined)
  })
}

/** Low life: below 10 and still in it, with the warning on. */
export const lowLife = (p: Player, s: LifeSettings) => s.lowLifeWarning && p.life >= 1 && p.life <= 9

/** Whether a new game opens with a high roll: asked for in Settings, and someone to roll against. */
export const wantsHighRoll = (s: LifeSettings, players: number) => s.highRollAtStart && players > 1

/** The seat colours a new game deals: in seat order, or shuffled with "Shuffle player colors" on. */
export function dealColors(count: number, shuffle: boolean, random: () => number = Math.random): number[] {
  const colors = Array.from({ length: PLAYER_COLOR_COUNT }, (_, i) => i)
  if (shuffle) {
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[colors[i], colors[j]] = [colors[j], colors[i]]
    }
  }
  return Array.from({ length: count }, (_, i) => colors[i % colors.length])
}

export const startingLifeFor = (s: LifeSettings, players: number) =>
  players <= 2 ? s.twoPlayerStartingLife : s.multiplayerStartingLife

/**
 * One thing that happened, for the history sheet. [playerId] is null for table-wide events. The
 * rest is for the life chart (lifeChart.ts), absent from entries saved before it: the round, the
 * game clock, that player's life after it and whether it had them out (automatic knock-outs on),
 * and whether it began a turn ([first]: a new first player).
 */
export interface HistoryEntry {
  id: number
  at: number
  playerId: number | null
  text: string
  turn?: number
  ms?: number
  life?: number
  out?: LossReason | null
  turnStart?: boolean
  first?: boolean
}

export type DayNight = 'DAY' | 'NIGHT'

export interface Game {
  layoutId: string
  players: Player[]
  turnPlayerId: number
  /**
   * How many rounds the table has played, not how many seats have had a go: it goes up when play
   * comes back round to whoever started (see nextTurnFrom), which is what a "turn" means at a table.
   */
  turnNumber: number
  /** Who started, so a round can be measured from them. Undefined in games saved before this. */
  firstPlayerId?: number
  /** Newest first, capped — see HISTORY_LIMIT. */
  history: HistoryEntry[]
  monarchId: number | null
  initiativeId: number | null
  /** Null until someone starts tracking day and night. */
  dayNight: DayNight | null
  /** Whether anyone has changed anything yet — a new starting life applies at once to an untouched game. */
  touched: boolean
  /** The table players join by QR code, once the host has shown one. */
  match?: { id: string; code: string } | null
  /** Tells one game from the next (a restart), so players' remotes know a new game began. */
  gameId?: string
  startedAt?: number
  /** Changes that can be taken back, newest first — see UNDO_LIMIT. */
  undo?: UndoEntry[]
  /** A card a player is showing everyone from their remote, until someone taps it away. */
  shownCard?: ShownCard | null
  /** The seat that asked everyone to hold on (they have a response), until they let go or the turn passes. */
  hold?: number | null
  /** The latest one-off thing to show everyone for a moment: a roll, an emote, a player pointed at. */
  announce?: Announce | null
  /** How long the game has been going (pausable). Its length goes into the table's games and the players' records. */
  clock?: GameClock
  /** Where the game clock stood when the current turn began, for the turn timer. */
  turnStartElapsed?: number
}

export interface ShownCard { name: string; imageUrl: string; seat: number }

/**
 * Something a player did that the table shows for a few seconds. [id] tells one from the next, so a
 * second identical roll still shows. Kept on the game so the table's screen and every remote see it.
 */
export interface Announce {
  id: string
  seat: number
  kind: 'roll' | 'coin' | 'planar' | 'emote' | 'target'
  at: number
  sides?: number
  value?: string
  emote?: EmoteId
  to?: number
}

/** Quick reactions a player can send to the table, and how they read there. */
export const EMOTES = {
  gg: '🤝 GG',
  thinking: '🤔 Thinking…',
  wait: '⏳ One sec',
  laugh: '😂',
  wow: '😮',
  sorry: '🙏 Sorry',
} as const
export type EmoteId = keyof typeof EMOTES

/** What an announcement says, as a line of text — the same on the table and on a remote. */
export function announceText(a: Announce, nameOf: (seat: number) => string): string {
  const who = nameOf(a.seat)
  switch (a.kind) {
    case 'roll': return `${who} rolled a d${a.sides}: ${a.value}`
    case 'coin': return `${who} flipped a coin: ${a.value}`
    // A planeswalk reads the same whether the die sent them or they chose to go.
    case 'planar': return a.value === 'PLANESWALK' ? `${who} planeswalked` : a.value === 'CHAOS' ? `${who} rolled Chaos!` : `${who} rolled a blank`
    case 'emote': return `${who}: ${a.emote ? EMOTES[a.emote] : ''}`
    case 'target': return `${who} points at ${a.to === undefined ? 'someone' : nameOf(a.to)}`
  }
}

/** How long an announcement stays up. */
export const ANNOUNCE_MS = 4_000
/** Older than this when it arrives (a page reopened, a phone reconnecting), it's already been seen. */
const ANNOUNCE_STALE_MS = 15_000

/**
 * The announcement to show right now: each new one for [ANNOUNCE_MS] from when it arrives, then
 * nothing. Timed from arrival rather than [Announce.at], which a remote got from another device's clock.
 */
export function useAnnouncement(latest: Announce | null): Announce | null {
  const [shown, setShown] = useState<Announce | null>(null)
  const seen = useRef<string | null>(null)
  // Kept apart from the effect: a remote gets a fresh copy of the same announcement with every
  // update, and that mustn't cancel the timer that takes it down.
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!latest || latest.id === seen.current) return
    seen.current = latest.id
    if (Date.now() - latest.at > ANNOUNCE_STALE_MS) return
    setShown(latest)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShown(null), ANNOUNCE_MS)
  }, [latest])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return shown
}

/**
 * One change that can be undone: the players it touched as they were before, and the turn if it
 * passed. [by] is the seat whose remote made it, or null for the table itself. Quick taps on the
 * same thing (life +1 +1 +1) fold into one entry, so one undo takes back the whole burst.
 */
export interface UndoEntry {
  by: number | null
  key: string
  at: number
  before: Player[]
  turn?: { turnPlayerId: number; turnNumber: number }
  historyIds: number[]
}

const UNDO_LIMIT = 60
/** Changes to the same thing within this long of each other undo together. */
const UNDO_MERGE_MS = 2_000

const newGameId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function newGame(settings: LifeSettings, random: () => number = Math.random): Game {
  const count = playerCount(layoutById(settings.layoutId))
  const life = startingLifeFor(settings, count)
  const colors = dealColors(count, !!settings.shuffleColors, random)
  return {
    layoutId: settings.layoutId,
    players: Array.from({ length: count }, (_, i) => ({
      id: i + 1, life, commanderDamage: {}, poison: 0, colorIndex: colors[i], name: null, killed: false,
    })),
    turnPlayerId: 1,
    turnNumber: 1,
    firstPlayerId: 1,
    history: [],
    monarchId: null,
    initiativeId: null,
    dayNight: null,
    touched: false,
    gameId: newGameId(),
    startedAt: Date.now(),
    undo: [],
    shownCard: null,
    hold: null,
    announce: null,
    clock: newClock(Date.now()),
    turnStartElapsed: 0,
  }
}

/** The game's clock — made up from when it started for a game saved before the clock. */
export const gameClockOf = (game: Game): GameClock => game.clock ?? newClock(game.startedAt ?? Date.now())

/** The game clock now, for the turn timer to start a turn from. */
const elapsedNow = (game: Game) => clockElapsed(gameClockOf(game), Date.now())

/**
 * Whose turn it is next, and whether that completes a round.
 *
 * Players who are out are passed over — the turn used to land on them and stick, because someone
 * who has lost has no phone to pass it on with. A round is counted from whoever started: the number
 * goes up when play comes back to them, or past them when they're out, rather than once per seat.
 */
export function nextTurnFrom(
  players: Player[],
  turnPlayerId: number,
  firstPlayerId: number,
  autoKill: boolean,
): { turnPlayerId: number; roundComplete: boolean } | null {
  const n = players.length
  if (n === 0) return null
  const ids = players.map((p) => p.id)
  const from = ids.indexOf(turnPlayerId)
  const cur = from === -1 ? 0 : from
  const start = Math.max(0, ids.indexOf(firstPlayerId))
  const out = (i: number) => !!lossReason(players[i], autoKill)

  // The next seat still in the game; if everyone is out, the turn doesn't move.
  let next = -1
  for (let step = 1; step <= n; step++) {
    const i = (cur + step) % n
    if (!out(i)) { next = i; break }
  }
  if (next === -1) return null

  // Counted from the starting seat: coming back to it, or passing it, is a new round.
  const place = (i: number) => (i - start + n) % n
  return { turnPlayerId: ids[next], roundComplete: place(next) <= place(cur) }
}

/** Whether the game is decided: at a table of two or more, at most one player is left. */
export function gameOver(game: Game, autoKill: boolean): { winnerId: number | null } | null {
  if (game.players.length < 2) return null
  const alive = game.players.filter((p) => !lossReason(p, autoKill))
  if (alive.length > 1) return null
  return { winnerId: alive[0]?.id ?? null }
}

/** How many history entries a game keeps — as many as the Android app, so a long game's chart starts at its start. */
const HISTORY_LIMIT = 500

/**
 * [by]: the seat whose remote asked for the change (see remote.ts); absent for changes made on the
 * table itself. A remote's undo only takes back its own changes.
 */
export type GameAction = { by?: number } & (
  | { type: 'new'; settings: LifeSettings }
  | { type: 'counter'; id: number; counter: CounterKind; delta: number }
  /** [partner]: whether that deck has two commanders — absent from a remote too old to say. */
  | { type: 'background'; id: number; url: string | null; deck?: string | null; commander?: string | null; partner?: boolean }
  /** Whether a player plays partners. Turning it off drops what was kept for the second commander. */
  | { type: 'partner'; id: number; on: boolean }
  /** What a seat without a phone is playing, set at the table: its commander and that commander's art. */
  | { type: 'seatCommander'; id: number; name: string | null; art: string | null }
  | { type: 'undo' }
  | { type: 'showCard'; card: ShownCard }
  | { type: 'hideCard' }
  | { type: 'life'; id: number; delta: number }
  | { type: 'setLife'; id: number; value: number }
  /** [slot] 1: from [from]'s partner rather than their commander. */
  | { type: 'commanderDamage'; id: number; from: number; delta: number; costsLife: boolean; slot?: number }
  | { type: 'poison'; id: number; delta: number }
  | { type: 'kill'; id: number }
  /** A player giving up — the same as being knocked out, said as what it was. */
  | { type: 'concede'; id: number }
  | { type: 'revive'; id: number; life: number }
  /** [slot] 1: the partner was cast. */
  | { type: 'commanderCast'; id: number; delta: number; slot?: number }
  /** [id]: the seat asking everyone to hold on, or null to let go. */
  | { type: 'hold'; id: number | null }
  /** Shows [announce] for a moment; [note] also goes in the history. */
  | { type: 'announce'; announce: Announce; note?: string }
  | { type: 'name'; id: number; name: string }
  /** A player's own victory and defeat messages; blank goes back to the table's lists. */
  | { type: 'messages'; id: number; victory?: string; defeat?: string }
  | { type: 'color'; id: number; colorIndex: number }
  | { type: 'nextTurn'; autoKill?: boolean }
  | { type: 'firstPlayer'; id: number }
  | { type: 'monarch'; id: number | null }
  | { type: 'initiative'; id: number | null }
  | { type: 'dayNight'; value: DayNight | null }
  | { type: 'clearHistory' }
  | { type: 'link'; id: number; player: LinkedPlayer | null }
  /** What the deck played at seat [id] brings (from their remote); null takes it off. */
  | { type: 'deckInfo'; id: number; info: SeatDeckInfo | null }
  /** One of seat [id]'s deck tokens up or down. */
  | { type: 'token'; id: number; tokenId: string; delta: number }
  /** The table owner's deck on their seat [seat] — and off any other seat nobody joined from a phone. */
  | { type: 'meDeck'; seat: number | null; info: SeatDeckInfo | null }
  /** Pauses or restarts the game clock. */
  | { type: 'clock'; paused: boolean }
  /** Seat [id] ventures to [to]: a room below theirs, or a dungeon to start ([undercity]: venturing into Undercity). */
  | { type: 'venture'; id: number; to: string; undercity?: boolean }
  /** Takes seat [id]'s marker out of its dungeon, without completing it. */
  | { type: 'leaveDungeon'; id: number }
  /** Puts right seat [id]'s completed-dungeons count. */
  | { type: 'dungeonsCompleted'; id: number; delta: number }
  | { type: 'ringBearer'; id: number; name: string | null }
  /** Seat [id]'s mulligans this game (null: not recorded). */
  | { type: 'mulligan'; id: number; value: number | null }
  | { type: 'match'; match: { id: string; code: string } | null }
)

/** What an undoable change is about, so quick repeats of it undo together; null if it can't be undone. */
function undoKey(action: GameAction): string | null {
  switch (action.type) {
    case 'life': return `life:${action.id}`
    case 'commanderDamage': return `cmd:${action.id}:${action.from}:${action.slot ?? 0}`
    case 'poison': return `poison:${action.id}`
    case 'counter': return `counter:${action.id}:${action.counter}`
    case 'kill': case 'concede': case 'revive': return `out:${action.id}`
    case 'commanderCast': return `cast:${action.id}:${action.slot ?? 0}`
    case 'token': return `token:${action.id}:${action.tokenId}`
    // Each step through a dungeon undoes on its own.
    case 'venture': return `venture:${action.id}:${action.to}`
    case 'leaveDungeon': case 'dungeonsCompleted': return `dungeon:${action.id}`
    case 'mulligan': return `mulligan:${action.id}`
    case 'nextTurn': return 'turn'
    default: return null
  }
}

/** Whether two versions of a player have the same life, damage, poison and counters. */
const samePlayState = (a: Player, b: Player) =>
  JSON.stringify(a.dungeon ?? null) === JSON.stringify(b.dungeon ?? null) && (a.dungeonsCompleted ?? 0) === (b.dungeonsCompleted ?? 0) &&
  (a.mulligans ?? null) === (b.mulligans ?? null) &&
  a.life === b.life && a.poison === b.poison && a.killed === b.killed &&
  (a.commanderCasts ?? 0) === (b.commanderCasts ?? 0) && (a.partnerCasts ?? 0) === (b.partnerCasts ?? 0) &&
  JSON.stringify(a.commanderDamage) === JSON.stringify(b.commanderDamage) &&
  JSON.stringify(a.partnerDamage ?? {}) === JSON.stringify(b.partnerDamage ?? {}) &&
  JSON.stringify(a.counters ?? {}) === JSON.stringify(b.counters ?? {}) &&
  JSON.stringify(a.tokenCounts ?? {}) === JSON.stringify(b.tokenCounts ?? {})

/** Plays [action], remembering how to take it back when it's an undoable change. */
export function gameReducer(game: Game, action: GameAction): Game {
  if (action.type === 'undo') return undo(game, action.by ?? null)
  const next = applyAction(game, action)
  const key = undoKey(action)
  if (key === null || next === game) return next

  const changed = game.players.filter((p) => {
    const after = next.players.find((x) => x.id === p.id)
    return after && !samePlayState(p, after)
  })
  const turnMoved = next.turnPlayerId !== game.turnPlayerId || next.turnNumber !== game.turnNumber
  if (changed.length === 0 && !turnMoved) return next
  const oldIds = new Set(game.history.map((h) => h.id))
  const historyIds = next.history.filter((h) => !oldIds.has(h.id)).map((h) => h.id)
  const now = Date.now()
  const by = action.by ?? null
  const stack = game.undo ?? []
  const top = stack[0]
  if (top && top.key === key && top.by === by && now - top.at < UNDO_MERGE_MS && !turnMoved) {
    const merged: UndoEntry = {
      ...top,
      at: now,
      before: [...top.before, ...changed.filter((p) => !top.before.some((b) => b.id === p.id))],
      historyIds: [...top.historyIds, ...historyIds],
    }
    return { ...next, undo: [merged, ...stack.slice(1)] }
  }
  const entry: UndoEntry = {
    by, key, at: now, before: changed, historyIds,
    turn: turnMoved ? { turnPlayerId: game.turnPlayerId, turnNumber: game.turnNumber } : undefined,
  }
  return { ...next, undo: [entry, ...stack].slice(0, UNDO_LIMIT) }
}

/**
 * Takes back the newest change — the newest one made from seat [by]'s remote when [by] is set. The
 * players it touched get their life, damage and counters back; who they are and how their tile
 * looks stay as they are now.
 */
function undo(game: Game, by: number | null): Game {
  const stack = game.undo ?? []
  const index = by === null ? 0 : stack.findIndex((e) => e.by === by)
  const entry = stack[index]
  if (!entry) return game
  const restore = (p: Player): Player => {
    const was = entry.before.find((b) => b.id === p.id)
    return was
      ? {
          ...p, life: was.life, poison: was.poison, killed: was.killed, commanderDamage: was.commanderDamage, counters: was.counters,
          commanderCasts: was.commanderCasts, partnerDamage: was.partnerDamage, partnerCasts: was.partnerCasts, tokenCounts: was.tokenCounts,
          dungeon: was.dungeon, dungeonsCompleted: was.dungeonsCompleted, mulligans: was.mulligans,
        }
      : p
  }
  const dropped = new Set(entry.historyIds)
  return {
    ...game,
    touched: true,
    players: game.players.map(restore),
    ...(entry.turn ? { ...entry.turn, turnStartElapsed: elapsedNow(game) } : {}),
    history: game.history.filter((h) => !dropped.has(h.id)),
    undo: stack.filter((_, i) => i !== index),
  }
}

/** Whether there's anything to undo — for seat [by]'s remote when it's set. */
export const canUndo = (game: Game, by: number | null = null) =>
  (game.undo ?? []).some((e) => by === null || e.by === by)

/**
 * Turns partners on or off for player [id]. Off drops everything kept for the second commander: the
 * damage it dealt everyone and its tax — there's no second commander for them to belong to.
 */
function setPartner(game: Game, id: number, on: boolean): Game {
  const p = game.players.find((x) => x.id === id)
  if (!p || !!p.hasPartner === on) return game
  if (on) return updatePlayer(game, id, (x) => ({ ...x, hasPartner: true }))
  return {
    ...game,
    touched: true,
    players: game.players.map((x) => {
      if (x.id === id) return { ...x, hasPartner: false, partnerCasts: 0 }
      if (!x.partnerDamage?.[id]) return x
      const { [id]: _dropped, ...rest } = x.partnerDamage
      return { ...x, partnerDamage: rest }
    }),
  }
}

/** [p] playing a deck that brings [info]: counts kept only for the tokens it still makes. */
function withDeckInfo(p: Player, info: SeatDeckInfo | null): Player {
  if (!info) return { ...p, deckInfo: null, tokenCounts: {} }
  const counts = Object.fromEntries(Object.entries(p.tokenCounts ?? {}).filter(([id]) => info.tokens.some((t) => t.id === id)))
  return { ...p, deckInfo: info, tokenCounts: counts }
}

function updatePlayer(game: Game, id: number, fn: (p: Player) => Player): Game {
  return { ...game, touched: true, players: game.players.map((p) => (p.id === id ? fn(p) : p)) }
}

/**
 * Adds an entry to the log, newest first. Ids carry on from the saved log, so they stay unique after
 * a reload. Each entry notes the round, the game clock and that player's life after it, for the chart.
 */
function note(game: Game, playerId: number | null, text: string, mark?: { turnStart?: boolean; first?: boolean }): Game {
  const id = (game.history[0]?.id ?? 0) + 1
  const now = Date.now()
  const p = playerId === null ? undefined : game.players.find((x) => x.id === playerId)
  const entry: HistoryEntry = {
    id, at: now, playerId, text, turn: game.turnNumber, ms: clockElapsed(gameClockOf(game), now),
    ...(p ? { life: p.life, out: lossReason(p, true) } : {}),
    ...(mark?.turnStart ? { turnStart: true } : {}),
    ...(mark?.first ? { first: true } : {}),
  }
  return { ...game, history: [entry, ...game.history].slice(0, HISTORY_LIMIT) }
}

const nameOf = (game: Game, id: number | null) =>
  id === null ? '' : displayName(game.players.find((p) => p.id === id) ?? { id, name: null } as Player)

function applyAction(game: Game, action: GameAction): Game {
  switch (action.type) {
    case 'new': {
      // A restart at the same table keeps who's sitting where (and the tile pictures and decks
      // they chose); a different number of seats is a new table.
      const fresh = newGame(action.settings)
      if (fresh.players.length !== game.players.length) return fresh
      // The same decks' tokens, all back in the box.
      const decks = fresh.players.map((p) => {
        const info = game.players.find((o) => o.id === p.id)?.deckInfo
        return info ? { ...p, deckInfo: info } : p
      })
      if (!game.match) return { ...fresh, players: decks }
      return {
        ...fresh,
        match: game.match,
        players: decks.map((p) => {
          const old = game.players.find((o) => o.id === p.id)
          return old?.linked
            ? { ...p, linked: old.linked, background: old.background ?? null, deck: old.deck ?? null, commander: old.commander ?? null, hasPartner: old.hasPartner }
            : p
        }),
      }
    }
    case 'undo':
      return game // handled by gameReducer
    case 'counter': {
      const p = game.players.find((x) => x.id === action.id)
      if (!p) return game
      const value = clampCounter(action.counter, counterOf(p, action.counter) + action.delta)
      if (value === counterOf(p, action.counter)) return game
      return note(
        updatePlayer(game, action.id, (x) => ({ ...x, counters: { ...x.counters, [action.counter]: value } })),
        action.id,
        `${COUNTER_INFO[action.counter].label}: ${value}`,
      )
    }
    case 'background': {
      const withBackground: Game = {
        ...game,
        players: game.players.map((p) => {
          if (p.id !== action.id) return p
          const deck = action.deck !== undefined ? action.deck : p.deck
          // An older remote sends no commander: a new deck clears the old one's.
          const commander = action.commander !== undefined ? action.commander : deck === p.deck ? p.commander : null
          return { ...p, background: action.url, deck, commander }
        }),
      }
      // A partner deck turns partners on for its player; any other deck turns them off.
      return action.partner === undefined ? withBackground : setPartner(withBackground, action.id, action.partner)
    }
    case 'partner':
      return setPartner(game, action.id, action.on)
    case 'seatCommander':
      return {
        ...game,
        players: game.players.map((p) => {
          if (p.id !== action.id || p.linked) return p
          // The commander's art goes behind a bare tile, and follows the commander while it's there.
          const background = !p.background || p.background === p.commanderArt ? action.art : p.background
          return { ...p, commander: action.name, commanderArt: action.art, background }
        }),
      }
    case 'showCard':
      return { ...game, shownCard: action.card }
    case 'hideCard':
      return game.shownCard ? { ...game, shownCard: null } : game
    case 'life': {
      const before = game.players.find((p) => p.id === action.id)?.life ?? 0
      const after = before + action.delta
      return note(
        updatePlayer(game, action.id, (p) => ({ ...p, life: after })),
        action.id,
        `${action.delta > 0 ? '+' : '−'}${Math.abs(action.delta)} life (${before} → ${after})`,
      )
    }
    case 'setLife': {
      const before = game.players.find((p) => p.id === action.id)?.life
      if (before === undefined || before === action.value) return game
      return note(updatePlayer(game, action.id, (p) => ({ ...p, life: action.value })), action.id, `Life set to ${action.value} (${before} → ${action.value})`)
    }
    case 'commanderDamage': {
      // Commander damage costs life too (unless the table tracks them separately), clamped at 0.
      const p = game.players.find((x) => x.id === action.id)
      if (!p) return game
      const partner = action.slot === 1
      // A partner's damage only while its player plays partners.
      if (partner && !game.players.find((x) => x.id === action.from)?.hasPartner) return game
      const current = damageFrom(p, action.from, partner ? 1 : 0)
      const updated = Math.max(0, current + action.delta)
      const applied = updated - current
      if (applied === 0) return game
      return note(
        updatePlayer(game, action.id, (x) => ({
          ...x,
          life: x.life - (action.costsLife ? applied : 0),
          ...(partner
            ? { partnerDamage: { ...x.partnerDamage, [action.from]: updated } }
            : { commanderDamage: { ...x.commanderDamage, [action.from]: updated } }),
        })),
        action.id,
        `${partner ? 'Partner' : 'Commander'} damage from ${nameOf(game, action.from)}: ${updated}`,
      )
    }
    case 'poison': {
      const poison = Math.max(0, (game.players.find((p) => p.id === action.id)?.poison ?? 0) + action.delta)
      return note(updatePlayer(game, action.id, (p) => ({ ...p, poison, poisonUsed: true })), action.id, `Poison: ${poison}`)
    }
    case 'kill':
      return note(updatePlayer(game, action.id, (p) => ({ ...p, killed: true })), action.id, 'Knocked out')
    case 'concede':
      if (game.players.find((p) => p.id === action.id)?.killed) return game
      // Someone who has left the game has nothing to respond with.
      return note(
        { ...updatePlayer(game, action.id, (p) => ({ ...p, killed: true })), hold: game.hold === action.id ? null : game.hold },
        action.id,
        'Conceded',
      )
    case 'commanderCast': {
      const p = game.players.find((x) => x.id === action.id)
      if (!p) return game
      const partner = action.slot === 1
      if (partner && !p.hasPartner) return game
      const before = (partner ? p.partnerCasts : p.commanderCasts) ?? 0
      const casts = Math.max(0, before + action.delta)
      if (casts === before) return game
      const what = partner ? 'partner' : 'commander'
      return note(
        updatePlayer(game, action.id, (x) => (partner ? { ...x, partnerCasts: casts } : { ...x, commanderCasts: casts })),
        action.id,
        action.delta > 0 ? `Cast their ${what} (tax ${2 * casts})` : `${partner ? 'Partner' : 'Commander'} tax back to ${2 * casts}`,
      )
    }
    case 'hold':
      return game.hold === action.id ? game : { ...game, hold: action.id }
    case 'announce': {
      const shown = { ...game, announce: action.announce }
      return action.note ? note(shown, action.announce.seat, action.note) : shown
    }
    case 'revive':
      return note(
        updatePlayer(game, action.id, (p) => ({ ...p, killed: false, life: action.life, poison: 0, commanderDamage: {}, partnerDamage: {} })),
        action.id,
        'Back in the game',
      )
    case 'name':
      return updatePlayer(game, action.id, (p) => ({ ...p, name: action.name.trim() || null }))
    case 'color':
      return updatePlayer(game, action.id, (p) => ({ ...p, colorIndex: action.colorIndex }))
    case 'messages':
      return updatePlayer(game, action.id, (p) => ({
        ...p,
        ...(action.victory !== undefined ? { victoryMessage: action.victory.trim() || null } : {}),
        ...(action.defeat !== undefined ? { defeatMessage: action.defeat.trim() || null } : {}),
      }))
    case 'nextTurn': {
      const moved = nextTurnFrom(
        game.players,
        game.turnPlayerId,
        game.firstPlayerId ?? game.players[0]?.id ?? 1,
        action.autoKill ?? true,
      )
      if (!moved) return game
      const turnNumber = moved.roundComplete ? game.turnNumber + 1 : game.turnNumber
      // Storm counts spells cast this turn.
      const players = game.players.map((p) => (p.counters?.storm ? { ...p, counters: { ...p.counters, storm: 0 } } : p))
      // A "hold on" was about the turn that just ended.
      return note(
        { ...game, touched: true, players, turnPlayerId: moved.turnPlayerId, turnNumber, hold: null, turnStartElapsed: elapsedNow(game) },
        moved.turnPlayerId,
        `Turn ${turnNumber}`,
        { turnStart: true },
      )
    }
    case 'firstPlayer':
      return note({ ...game, turnPlayerId: action.id, firstPlayerId: action.id, turnNumber: 1, turnStartElapsed: elapsedNow(game) }, action.id, 'Goes first', { turnStart: true, first: true })
    case 'monarch':
      if (game.monarchId === action.id) return game
      return note({ ...game, touched: true, monarchId: action.id }, action.id,
        action.id === null ? 'No longer anyone\'s monarch' : `Became the monarch`)
    case 'initiative':
      if (game.initiativeId === action.id) return game
      return note({ ...game, touched: true, initiativeId: action.id }, action.id,
        action.id === null ? 'Nobody has the initiative' : 'Took the initiative')
    case 'dayNight':
      if (game.dayNight === action.value) return game
      return note({ ...game, touched: true, dayNight: action.value }, null,
        action.value === null ? 'Stopped tracking day and night' : action.value === 'DAY' ? 'It became day' : 'It became night')
    case 'clearHistory':
      return { ...game, history: [] }
    case 'deckInfo':
      return { ...game, players: game.players.map((p) => (p.id === action.id ? withDeckInfo(p, action.info) : p)) }
    case 'meDeck': {
      const players = game.players.map((p) => {
        // A seat someone joined gets its deck from their remote instead.
        if (p.linked) return p
        const info = p.id === action.seat ? action.info : null
        return JSON.stringify(info ?? null) === JSON.stringify(p.deckInfo ?? null) ? p : withDeckInfo(p, info)
      })
      return players.every((p, i) => p === game.players[i]) ? game : { ...game, players }
    }
    case 'token': {
      const p = game.players.find((x) => x.id === action.id)
      const tokens = p?.deckInfo?.tokens
      if (!p || !tokens) return game
      const current = p.tokenCounts?.[action.tokenId] ?? 0
      const counts = changedTokenCounts(p.tokenCounts ?? {}, tokens, action.tokenId, action.delta)
      const updated = counts[action.tokenId] ?? 0
      if (updated === current) return game
      const token = tokens.find((t) => t.id === action.tokenId)!
      return note(updatePlayer(game, action.id, (x) => ({ ...x, tokenCounts: counts })), action.id, `${tokenLabel(token)} tokens: ${updated}`)
    }
    case 'venture': {
      const p = game.players.find((x) => x.id === action.id)
      if (!p) return game
      const v = ventureTo({ dungeon: p.dungeon ?? null, completed: p.dungeonsCompleted ?? 0 }, action.to, !!action.undercity)
      if (!v) return game
      const done = v.completed > (p.dungeonsCompleted ?? 0)
      const room = roomName(v.dungeon)
      return note(
        updatePlayer(game, action.id, (x) => ({ ...x, dungeon: v.dungeon, dungeonsCompleted: v.completed })),
        action.id,
        done ? `Completed the dungeon in ${room} (${v.completed} completed)` : `Ventured into ${room}`,
      )
    }
    case 'leaveDungeon': {
      const p = game.players.find((x) => x.id === action.id)
      if (!p?.dungeon) return game
      return updatePlayer(game, action.id, (x) => ({ ...x, dungeon: null }))
    }
    case 'dungeonsCompleted': {
      const p = game.players.find((x) => x.id === action.id)
      if (!p) return game
      const completed = Math.max(0, Math.min(99, (p.dungeonsCompleted ?? 0) + action.delta))
      if (completed === (p.dungeonsCompleted ?? 0)) return game
      return note(updatePlayer(game, action.id, (x) => ({ ...x, dungeonsCompleted: completed })), action.id, `Dungeons completed: ${completed}`)
    }
    case 'ringBearer': {
      const name = cleanRingBearer(action.name)
      const p = game.players.find((x) => x.id === action.id)
      if (!p || (p.ringBearer ?? null) === name) return game
      // A name, not a play: kept out of the history, as the Android table (which saves it as it's typed) does.
      return updatePlayer(game, action.id, (x) => ({ ...x, ringBearer: name }))
    }
    case 'mulligan': {
      const value = action.value === null ? null : Math.max(0, Math.min(7, Math.round(action.value)))
      const p = game.players.find((x) => x.id === action.id)
      if (!p || (p.mulligans ?? null) === value) return game
      return note(
        updatePlayer(game, action.id, (x) => ({ ...x, mulligans: value })),
        action.id,
        value === null ? 'Mulligans not recorded' : value === 0 ? 'Kept seven' : `Mulligans: ${value}`,
      )
    }
    case 'clock': {
      const clock = gameClockOf(game)
      const next = action.paused ? pauseClock(clock, Date.now()) : resumeClock(clock, Date.now())
      return next === clock && game.clock ? game : { ...game, clock: next }
    }
    case 'link': {
      const current = game.players.find((p) => p.id === action.id)?.linked ?? null
      if (JSON.stringify(current) === JSON.stringify(action.player)) return game
      // Someone sitting down gets their profile picture behind their tile (until they choose
      // another from their remote); whoever leaves takes their picture and deck with them.
      const oldAvatar = avatarUrl(current?.avatarPath)
      const newAvatar = avatarUrl(action.player?.avatarPath)
      return {
        ...game,
        players: game.players.map((p) => {
          if (p.id !== action.id) return p
          if (action.player?.userId === current?.userId) {
            // Same person, new profile picture: the tile follows it, unless they chose something else.
            return { ...p, linked: action.player, background: (p.background ?? null) === oldAvatar ? newAvatar : p.background }
          }
          return { ...p, linked: action.player, background: newAvatar, deck: null, commander: null, deckInfo: null, tokenCounts: {} }
        }),
      }
    }
    case 'match':
      return {
        ...game,
        match: action.match,
        players: action.match ? game.players : game.players.map((p) => (p.linked ? { ...p, linked: null, background: null, deck: null, commander: null, deckInfo: null, tokenCounts: {} } : p)),
        shownCard: action.match ? game.shownCard : null,
      }
  }
}

/**
 * Rolls a d20 for every player. A tie for highest re-rolls the whole table, so what everyone sees
 * is one clean roll with a single, highest winner.
 */
export function highRoll(ids: number[]): { rolls: Record<number, number>; winnerId: number } {
  for (;;) {
    const rolls: Record<number, number> = Object.fromEntries(ids.map((id) => [id, 1 + Math.floor(Math.random() * 20)]))
    const best = Math.max(...ids.map((id) => rolls[id]))
    const leaders = ids.filter((id) => rolls[id] === best)
    if (leaders.length === 1) return { rolls, winnerId: leaders[0] }
  }
}

/** "Lost Mine of Phandelver: Goblin Lair", for the history. */
function roomName(state: DungeonState | null): string {
  const d = state ? DUNGEON_NAMES[state.dungeon] : undefined
  const r = state ? roomOf(state) : null
  return d && r ? `${d}: ${r.name}` : 'the dungeon'
}
const DUNGEON_NAMES: Record<string, string> = Object.fromEntries(DUNGEONS.map((d) => [d.id, d.name]))

// ---- Persistence (this browser only — life counter games don't sync between devices) ----

const SETTINGS_KEY = 'mtgweb_life_settings'
const GAME_KEY = 'mtgweb_life_game'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked (private mode): the game still works, it just won't survive a reload.
  }
}

/** The life counter's saved settings, for showing the table a new game starts with (the Play tab). */
export const savedLifeSettings = (): LifeSettings => normalizeSettings(load<Partial<LifeSettings>>(SETTINGS_KEY, {}))

/** The life counter's settings and current game, kept in localStorage across reloads. */
export function useLifeCounter() {
  const [settings, setSettings] = useState<LifeSettings>(() => normalizeSettings(load<Partial<LifeSettings>>(SETTINGS_KEY, {})))
  const [game, dispatch] = useReducer(gameReducer, settings, (s) => {
    const saved = load<Game | null>(GAME_KEY, null)
    if (!saved || saved.layoutId !== s.layoutId || !Array.isArray(saved.players)) return newGame(s)
    // A game saved by an older version is missing whatever has been added since (history, the
    // monarch…), so fill those in from a fresh game rather than rendering with holes.
    return { ...newGame(s), ...saved, players: saved.players, history: saved.history ?? [], clock: gameClockOf(saved), turnStartElapsed: saved.turnStartElapsed ?? 0 }
  })

  useEffect(() => save(SETTINGS_KEY, settings), [settings])
  useEffect(() => save(GAME_KEY, game), [game])

  const updateSettings = useCallback((patch: Partial<LifeSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])

  const gameRef = useRef(game)
  gameRef.current = game
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  /** Changing the seating starts a fresh game, since the number of players may change. */
  const selectLayout = useCallback((layoutId: string) => {
    const next = { ...settingsRef.current, layoutId }
    setSettings(next)
    dispatch({ type: 'new', settings: next })
  }, [])

  /** Takes effect at once on an untouched game; mid-game it waits for the next restart. */
  const setStartingLife = useCallback((twoPlayer: boolean, life: number) => {
    const s = settingsRef.current
    const next = twoPlayer ? { ...s, twoPlayerStartingLife: life } : { ...s, multiplayerStartingLife: life }
    setSettings(next)
    if (!gameRef.current.touched) dispatch({ type: 'new', settings: next })
  }, [])

  const restart = useCallback(() => dispatch({ type: 'new', settings: settingsRef.current }), [])

  return { settings, updateSettings, selectLayout, setStartingLife, restart, game, dispatch }
}

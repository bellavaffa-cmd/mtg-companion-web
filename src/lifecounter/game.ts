import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { DEFAULT_LAYOUT_ID, layoutById, playerCount } from './tableLayouts'
import { avatarUrl } from '../social/api'

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
}

/** Counters a player can keep besides poison. Storm is cleared when the turn passes. */
export const COUNTER_KINDS = ['experience', 'energy', 'charge', 'storm', 'tokens', 'loyalty'] as const
export type CounterKind = (typeof COUNTER_KINDS)[number]
export const COUNTER_INFO: Record<CounterKind, { label: string; icon: string }> = {
  experience: { label: 'Experience', icon: 'school' },
  energy: { label: 'Energy', icon: 'bolt' },
  charge: { label: 'Charge', icon: 'battery_charging_full' },
  storm: { label: 'Storm', icon: 'thunderstorm' },
  tokens: { label: 'Tokens', icon: 'toll' },
  loyalty: { label: 'Loyalty', icon: 'shield' },
}
export const counterOf = (p: Player, kind: CounterKind) => p.counters?.[kind] ?? 0

/** Close to losing: 8+ poison, or 18+ damage from one commander. */
export function inDanger(p: Player): boolean {
  return p.poison >= 8 || Object.values(p.commanderDamage).some((d) => d >= 18)
}

export const displayName = (p: Player) => p.linked?.displayName ?? p.name ?? `Player ${p.id}`

export type LossReason = 'LIFE' | 'POISON' | 'COMMANDER_DAMAGE' | 'KILLED'

export function lossReason(p: Player, autoKill: boolean): LossReason | null {
  if (p.killed) return 'KILLED'
  if (!autoKill) return null
  if (Object.values(p.commanderDamage).some((d) => d >= 21)) return 'COMMANDER_DAMAGE'
  if (p.poison >= 10) return 'POISON'
  if (p.life <= 0) return 'LIFE'
  return null
}

export interface LifeSettings {
  layoutId: string
  multiplayerStartingLife: number
  twoPlayerStartingLife: number
  turnTracker: boolean
  autoKill: boolean
  commanderDamageCostsLife: boolean
  longPressAmount: number
  /** Players who joined a seat by QR code can change their own seat from their phone. */
  remotes: boolean
}

export const DEFAULT_SETTINGS: LifeSettings = {
  layoutId: DEFAULT_LAYOUT_ID,
  multiplayerStartingLife: 40,
  twoPlayerStartingLife: 20,
  turnTracker: false,
  autoKill: true,
  commanderDamageCostsLife: true,
  longPressAmount: 10,
  remotes: true,
}

export const startingLifeFor = (s: LifeSettings, players: number) =>
  players <= 2 ? s.twoPlayerStartingLife : s.multiplayerStartingLife

/** One thing that happened, for the history sheet. [playerId] is null for table-wide events. */
export interface HistoryEntry {
  id: number
  at: number
  playerId: number | null
  text: string
}

export type DayNight = 'DAY' | 'NIGHT'

export interface Game {
  layoutId: string
  players: Player[]
  turnPlayerId: number
  turnNumber: number
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
}

export interface ShownCard { name: string; imageUrl: string; seat: number }

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

export function newGame(settings: LifeSettings): Game {
  const count = playerCount(layoutById(settings.layoutId))
  const life = startingLifeFor(settings, count)
  return {
    layoutId: settings.layoutId,
    players: Array.from({ length: count }, (_, i) => ({
      id: i + 1, life, commanderDamage: {}, poison: 0, colorIndex: i % PLAYER_COLOR_COUNT, name: null, killed: false,
    })),
    turnPlayerId: 1,
    turnNumber: 1,
    history: [],
    monarchId: null,
    initiativeId: null,
    dayNight: null,
    touched: false,
    gameId: newGameId(),
    startedAt: Date.now(),
    undo: [],
    shownCard: null,
  }
}

/** Whether the game is decided: at a table of two or more, at most one player is left. */
export function gameOver(game: Game, autoKill: boolean): { winnerId: number | null } | null {
  if (game.players.length < 2) return null
  const alive = game.players.filter((p) => !lossReason(p, autoKill))
  if (alive.length > 1) return null
  return { winnerId: alive[0]?.id ?? null }
}

/** How many history entries a game keeps. */
const HISTORY_LIMIT = 200

/**
 * [by]: the seat whose remote asked for the change (see remote.ts); absent for changes made on the
 * table itself. A remote's undo only takes back its own changes.
 */
export type GameAction = { by?: number } & (
  | { type: 'new'; settings: LifeSettings }
  | { type: 'counter'; id: number; counter: CounterKind; delta: number }
  | { type: 'background'; id: number; url: string | null; deck?: string | null }
  | { type: 'undo' }
  | { type: 'showCard'; card: ShownCard }
  | { type: 'hideCard' }
  | { type: 'life'; id: number; delta: number }
  | { type: 'setLife'; id: number; value: number }
  | { type: 'commanderDamage'; id: number; from: number; delta: number; costsLife: boolean }
  | { type: 'poison'; id: number; delta: number }
  | { type: 'kill'; id: number }
  | { type: 'revive'; id: number; life: number }
  | { type: 'name'; id: number; name: string }
  | { type: 'color'; id: number; colorIndex: number }
  | { type: 'nextTurn' }
  | { type: 'firstPlayer'; id: number }
  | { type: 'monarch'; id: number | null }
  | { type: 'initiative'; id: number | null }
  | { type: 'dayNight'; value: DayNight | null }
  | { type: 'clearHistory' }
  | { type: 'link'; id: number; player: LinkedPlayer | null }
  | { type: 'match'; match: { id: string; code: string } | null }
)

/** What an undoable change is about, so quick repeats of it undo together; null if it can't be undone. */
function undoKey(action: GameAction): string | null {
  switch (action.type) {
    case 'life': return `life:${action.id}`
    case 'commanderDamage': return `cmd:${action.id}:${action.from}`
    case 'poison': return `poison:${action.id}`
    case 'counter': return `counter:${action.id}:${action.counter}`
    case 'kill': case 'revive': return `out:${action.id}`
    case 'nextTurn': return 'turn'
    default: return null
  }
}

/** Whether two versions of a player have the same life, damage, poison and counters. */
const samePlayState = (a: Player, b: Player) =>
  a.life === b.life && a.poison === b.poison && a.killed === b.killed &&
  JSON.stringify(a.commanderDamage) === JSON.stringify(b.commanderDamage) &&
  JSON.stringify(a.counters ?? {}) === JSON.stringify(b.counters ?? {})

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
    return was ? { ...p, life: was.life, poison: was.poison, killed: was.killed, commanderDamage: was.commanderDamage, counters: was.counters } : p
  }
  const dropped = new Set(entry.historyIds)
  return {
    ...game,
    touched: true,
    players: game.players.map(restore),
    ...(entry.turn ?? {}),
    history: game.history.filter((h) => !dropped.has(h.id)),
    undo: stack.filter((_, i) => i !== index),
  }
}

/** Whether there's anything to undo — for seat [by]'s remote when it's set. */
export const canUndo = (game: Game, by: number | null = null) =>
  (game.undo ?? []).some((e) => by === null || e.by === by)

function updatePlayer(game: Game, id: number, fn: (p: Player) => Player): Game {
  return { ...game, touched: true, players: game.players.map((p) => (p.id === id ? fn(p) : p)) }
}

/** Adds an entry to the log, newest first. Ids carry on from the saved log, so they stay unique after a reload. */
function note(game: Game, playerId: number | null, text: string): Game {
  const id = (game.history[0]?.id ?? 0) + 1
  const entry: HistoryEntry = { id, at: Date.now(), playerId, text }
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
      if (!game.match || fresh.players.length !== game.players.length) return fresh
      return {
        ...fresh,
        match: game.match,
        players: fresh.players.map((p) => {
          const old = game.players.find((o) => o.id === p.id)
          return old?.linked ? { ...p, linked: old.linked, background: old.background ?? null, deck: old.deck ?? null } : p
        }),
      }
    }
    case 'undo':
      return game // handled by gameReducer
    case 'counter': {
      const p = game.players.find((x) => x.id === action.id)
      if (!p) return game
      const value = Math.max(0, counterOf(p, action.counter) + action.delta)
      if (value === counterOf(p, action.counter)) return game
      return note(
        updatePlayer(game, action.id, (x) => ({ ...x, counters: { ...x.counters, [action.counter]: value } })),
        action.id,
        `${COUNTER_INFO[action.counter].label}: ${value}`,
      )
    }
    case 'background':
      return {
        ...game,
        players: game.players.map((p) => (p.id === action.id
          ? { ...p, background: action.url, ...(action.deck !== undefined ? { deck: action.deck } : {}) }
          : p)),
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
    case 'setLife':
      return updatePlayer(game, action.id, (p) => ({ ...p, life: action.value }))
    case 'commanderDamage': {
      // Commander damage costs life too (unless the table tracks them separately), clamped at 0.
      const p = game.players.find((x) => x.id === action.id)
      if (!p) return game
      const current = p.commanderDamage[action.from] ?? 0
      const updated = Math.max(0, current + action.delta)
      const applied = updated - current
      if (applied === 0) return game
      return note(
        updatePlayer(game, action.id, (x) => ({
          ...x,
          life: x.life - (action.costsLife ? applied : 0),
          commanderDamage: { ...x.commanderDamage, [action.from]: updated },
        })),
        action.id,
        `Commander damage from ${nameOf(game, action.from)}: ${updated}`,
      )
    }
    case 'poison': {
      const poison = Math.max(0, (game.players.find((p) => p.id === action.id)?.poison ?? 0) + action.delta)
      return note(updatePlayer(game, action.id, (p) => ({ ...p, poison })), action.id, `Poison: ${poison}`)
    }
    case 'kill':
      return note(updatePlayer(game, action.id, (p) => ({ ...p, killed: true })), action.id, 'Knocked out')
    case 'revive':
      return note(
        updatePlayer(game, action.id, (p) => ({ ...p, killed: false, life: action.life, poison: 0, commanderDamage: {} })),
        action.id,
        'Back in the game',
      )
    case 'name':
      return updatePlayer(game, action.id, (p) => ({ ...p, name: action.name.trim() || null }))
    case 'color':
      return updatePlayer(game, action.id, (p) => ({ ...p, colorIndex: action.colorIndex }))
    case 'nextTurn': {
      const ids = game.players.map((p) => p.id)
      if (ids.length === 0) return game
      const idx = ids.indexOf(game.turnPlayerId)
      const turnPlayerId = idx === -1 || idx === ids.length - 1 ? ids[0] : ids[idx + 1]
      // Storm counts spells cast this turn.
      const players = game.players.map((p) => (p.counters?.storm ? { ...p, counters: { ...p.counters, storm: 0 } } : p))
      return note(
        { ...game, touched: true, players, turnPlayerId, turnNumber: game.turnNumber + 1 },
        turnPlayerId,
        `Turn ${game.turnNumber + 1}`,
      )
    }
    case 'firstPlayer':
      return note({ ...game, turnPlayerId: action.id, turnNumber: 1 }, action.id, 'Goes first')
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
          return { ...p, linked: action.player, background: newAvatar, deck: null }
        }),
      }
    }
    case 'match':
      return {
        ...game,
        match: action.match,
        players: action.match ? game.players : game.players.map((p) => (p.linked ? { ...p, linked: null, background: null, deck: null } : p)),
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

/** The life counter's settings and current game, kept in localStorage across reloads. */
export function useLifeCounter() {
  const [settings, setSettings] = useState<LifeSettings>(() => load(SETTINGS_KEY, DEFAULT_SETTINGS))
  const [game, dispatch] = useReducer(gameReducer, settings, (s) => {
    const saved = load<Game | null>(GAME_KEY, null)
    if (!saved || saved.layoutId !== s.layoutId || !Array.isArray(saved.players)) return newGame(s)
    // A game saved by an older version is missing whatever has been added since (history, the
    // monarch…), so fill those in from a fresh game rather than rendering with holes.
    return { ...newGame(s), ...saved, players: saved.players, history: saved.history ?? [] }
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

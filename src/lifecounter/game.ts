import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { DEFAULT_LAYOUT_ID, layoutById, playerCount } from './tableLayouts'

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
}

export const DEFAULT_SETTINGS: LifeSettings = {
  layoutId: DEFAULT_LAYOUT_ID,
  multiplayerStartingLife: 40,
  twoPlayerStartingLife: 20,
  turnTracker: false,
  autoKill: true,
  commanderDamageCostsLife: true,
  longPressAmount: 10,
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
}

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
  }
}

/** How many history entries a game keeps. */
const HISTORY_LIMIT = 200

export type GameAction =
  | { type: 'new'; settings: LifeSettings }
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

export function gameReducer(game: Game, action: GameAction): Game {
  switch (action.type) {
    case 'new': {
      // A restart at the same table keeps who's sitting where; a different number of seats is a new table.
      const fresh = newGame(action.settings)
      if (!game.match || fresh.players.length !== game.players.length) return fresh
      return {
        ...fresh,
        match: game.match,
        players: fresh.players.map((p) => ({ ...p, linked: game.players.find((old) => old.id === p.id)?.linked ?? null })),
      }
    }
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
      return note(
        { ...game, touched: true, turnPlayerId, turnNumber: game.turnNumber + 1 },
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
      return { ...game, players: game.players.map((p) => (p.id === action.id ? { ...p, linked: action.player } : p)) }
    }
    case 'match':
      return {
        ...game,
        match: action.match,
        players: action.match ? game.players : game.players.map((p) => (p.linked ? { ...p, linked: null } : p)),
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

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

export interface Player {
  id: number
  life: number
  /** Damage taken from each opponent's commander, keyed by that opponent's id. */
  commanderDamage: Record<number, number>
  poison: number
  colorIndex: number
  name: string | null
  killed: boolean
}

export const displayName = (p: Player) => p.name ?? `Player ${p.id}`

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
  gameTimer: boolean
  autoKill: boolean
  commanderDamageCostsLife: boolean
  longPressAmount: number
}

export const DEFAULT_SETTINGS: LifeSettings = {
  layoutId: DEFAULT_LAYOUT_ID,
  multiplayerStartingLife: 40,
  twoPlayerStartingLife: 20,
  turnTracker: false,
  gameTimer: false,
  autoKill: true,
  commanderDamageCostsLife: true,
  longPressAmount: 10,
}

export const startingLifeFor = (s: LifeSettings, players: number) =>
  players <= 2 ? s.twoPlayerStartingLife : s.multiplayerStartingLife

export interface Game {
  layoutId: string
  players: Player[]
  turnPlayerId: number
  turnNumber: number
  turnSeconds: number
  matchSeconds: number
  timerRunning: boolean
  /** Whether anyone has changed anything yet — a new starting life applies at once to an untouched game. */
  touched: boolean
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
    turnSeconds: 0,
    matchSeconds: 0,
    timerRunning: true,
    touched: false,
  }
}

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
  | { type: 'toggleTimer' }
  | { type: 'tick' }

function updatePlayer(game: Game, id: number, fn: (p: Player) => Player): Game {
  return { ...game, touched: true, players: game.players.map((p) => (p.id === id ? fn(p) : p)) }
}

export function gameReducer(game: Game, action: GameAction): Game {
  switch (action.type) {
    case 'new':
      return newGame(action.settings)
    case 'life':
      return updatePlayer(game, action.id, (p) => ({ ...p, life: p.life + action.delta }))
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
      return updatePlayer(game, action.id, (x) => ({
        ...x,
        life: x.life - (action.costsLife ? applied : 0),
        commanderDamage: { ...x.commanderDamage, [action.from]: updated },
      }))
    }
    case 'poison':
      return updatePlayer(game, action.id, (p) => ({ ...p, poison: Math.max(0, p.poison + action.delta) }))
    case 'kill':
      return updatePlayer(game, action.id, (p) => ({ ...p, killed: true }))
    case 'revive':
      return updatePlayer(game, action.id, (p) => ({ ...p, killed: false, life: action.life, poison: 0, commanderDamage: {} }))
    case 'name':
      return updatePlayer(game, action.id, (p) => ({ ...p, name: action.name.trim() || null }))
    case 'color':
      return updatePlayer(game, action.id, (p) => ({ ...p, colorIndex: action.colorIndex }))
    case 'nextTurn': {
      const ids = game.players.map((p) => p.id)
      if (ids.length === 0) return game
      const idx = ids.indexOf(game.turnPlayerId)
      return {
        ...game,
        touched: true,
        turnPlayerId: idx === -1 || idx === ids.length - 1 ? ids[0] : ids[idx + 1],
        turnNumber: game.turnNumber + 1,
        turnSeconds: 0,
      }
    }
    case 'firstPlayer':
      return { ...game, turnPlayerId: action.id, turnNumber: 1, turnSeconds: 0, matchSeconds: 0, timerRunning: true }
    case 'toggleTimer':
      return { ...game, timerRunning: !game.timerRunning }
    case 'tick':
      return game.timerRunning ? { ...game, turnSeconds: game.turnSeconds + 1, matchSeconds: game.matchSeconds + 1 } : game
  }
}

/** Rolls a d20 for every player, rerolling only those tied for highest until one remains. */
export function highRoll(ids: number[]): { rolls: Record<number, number[]>; winnerId: number } {
  const rolls: Record<number, number[]> = Object.fromEntries(ids.map((id) => [id, []]))
  let contenders = ids
  for (;;) {
    for (const id of contenders) rolls[id].push(1 + Math.floor(Math.random() * 20))
    const best = Math.max(...contenders.map((id) => rolls[id][rolls[id].length - 1]))
    contenders = contenders.filter((id) => rolls[id][rolls[id].length - 1] === best)
    if (contenders.length === 1) return { rolls, winnerId: contenders[0] }
  }
}

export const formatElapsed = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
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
    return saved && saved.layoutId === s.layoutId && Array.isArray(saved.players) ? saved : newGame(s)
  })

  useEffect(() => save(SETTINGS_KEY, settings), [settings])
  // The timer ticks every second; writing the whole game that often is harmless at this size.
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

  const showStrip = settings.turnTracker || settings.gameTimer
  useEffect(() => {
    if (!settings.gameTimer) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') dispatch({ type: 'tick' })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [settings.gameTimer])

  return { settings, updateSettings, selectLayout, setStartingLife, restart, game, dispatch, showStrip }
}

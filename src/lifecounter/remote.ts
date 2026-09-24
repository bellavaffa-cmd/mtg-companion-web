// Players' phones as remotes for a life counter table. The table (the host's phone or tablet)
// publishes the game on its match's private channel; a player who joined a seat by QR code sends
// requests for their own seat, which the table applies (or ignores, with remotes switched off).
// The same messages go between the web app and the Android app — keep LifeCounterRemote.kt in step.
//
// Server side: publish_match_state / send_match_action in
// MtgCompanionApp/supabase/migrations/20260922000000_match_remote.sql.

import { useEffect, useRef, useState } from 'react'
import { accessToken } from '../sync/supabaseAuth'
import { watchMatch } from '../sync/realtime'
import * as api from '../social/api'
import {
  COUNTER_KINDS, canUndo, displayName, gameOver, lossReason, seatColor,
  type CounterKind, type Game, type GameAction, type LifeSettings,
} from './game'

export const REMOTE_VERSION = 1

/** Counters a remote can change: poison plus the COUNTER_KINDS. */
export type RemoteCounter = 'poison' | CounterKind
export const REMOTE_COUNTERS: RemoteCounter[] = ['poison', ...COUNTER_KINDS]

export interface RemoteSeat {
  seat: number
  name: string
  /** The seat colour (sRGB hex) and the ink that reads on it. */
  color: string
  ink: string
  life: number
  /** Why they're out of the game (LIFE, POISON, COMMANDER_DAMAGE, KILLED), or null. */
  out: string | null
  poison: number
  counters: Partial<Record<CounterKind, number>>
  /** Damage this seat has taken from each opponent's commander ([slot] 1: their partner). */
  commanderDamage: { from: number; slot: number; amount: number }[]
  background: string | null
  deck: string | null
  /** The commander of that deck ("A & B" for partners), for the other players' game records. */
  commander?: string | null
  userId: string | null
  avatarPath: string | null
  /** Whether this seat has a change of its own it could undo. */
  canUndo: boolean
  /** Whether this seat plays two commanders (a partner), so damage from each is kept apart. */
  partner: boolean
}

export interface RemoteState {
  v: number
  gameId: string
  /** False when the table's owner has switched remotes off: remotes show that and send nothing. */
  remotes: boolean
  /** Whose turn it is, when the table tracks turns. */
  turn: { seat: number; number: number } | null
  startedAt: number
  longPress: number
  players: RemoteSeat[]
  shownCard: { name: string; imageUrl: string; seat: number } | null
  /** Set once the game is decided. */
  over: { winner: number | null; turns: number; minutes: number } | null
}

export type RemoteAction =
  | { type: 'hello' }
  | { type: 'life'; delta: number }
  | { type: 'counter'; counter: RemoteCounter; delta: number }
  /** Damage this seat took from [from]'s commander. */
  | { type: 'commanderDamage'; from: number; slot: number; delta: number }
  /** Damage this seat's commander dealt to [to]. */
  | { type: 'dealtDamage'; to: number; slot: number; delta: number }
  | { type: 'endTurn' }
  | { type: 'undo' }
  | { type: 'background'; url: string | null; deck?: string | null; commander?: string | null }
  | { type: 'showCard'; name: string; imageUrl: string }
  | { type: 'hideCard' }

/** Pictures a remote may put behind its tile or show on the table: Scryfall, Giphy, profile pictures. */
export function allowedImage(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 500) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return u.hostname === 'cards.scryfall.io' || /^media\d?\.giphy\.com$/.test(u.hostname) || u.hostname === 'i.giphy.com' ||
      (u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/storage/v1/object/public/avatars/'))
  } catch {
    return false
  }
}

export function buildRemoteState(game: Game, settings: LifeSettings): RemoteState {
  const over = gameOver(game, settings.autoKill)
  const startedAt = game.startedAt ?? Date.now()
  const lastAt = game.history[0]?.at ?? startedAt
  return {
    v: REMOTE_VERSION,
    gameId: game.gameId ?? 'game',
    remotes: settings.remotes,
    turn: settings.turnTracker && game.players.length > 1 ? { seat: game.turnPlayerId, number: game.turnNumber } : null,
    startedAt,
    longPress: settings.longPressAmount,
    players: game.players.map((p) => {
      const c = seatColor(p.colorIndex)
      return {
        seat: p.id,
        name: displayName(p),
        color: c.srgb,
        ink: c.whiteText ? '#fff' : '#000',
        life: p.life,
        out: lossReason(p, settings.autoKill),
        poison: p.poison,
        counters: p.counters ?? {},
        commanderDamage: Object.entries(p.commanderDamage)
          .filter(([, amount]) => amount > 0)
          .map(([from, amount]) => ({ from: Number(from), slot: 0, amount })),
        background: p.background ?? null,
        deck: p.deck ?? null,
        commander: p.commander ?? null,
        userId: p.linked?.userId ?? null,
        avatarPath: p.linked?.avatarPath ?? null,
        canUndo: canUndo(game, p.id),
        partner: false, // the web table keeps one commander per player
      }
    }),
    shownCard: game.shownCard ?? null,
    over: over ? { winner: over.winnerId, turns: game.turnNumber, minutes: Math.max(1, Math.round((lastAt - startedAt) / 60_000)) } : null,
  }
}

const int = (v: unknown, limit: number) =>
  typeof v === 'number' && Number.isInteger(v) && v !== 0 && Math.abs(v) <= limit ? v : null

/**
 * What a request from seat [seat]'s remote does to the game, or null to ignore it (not theirs to
 * make, or malformed — the table trusts nothing it's sent beyond the seat the server stamped).
 */
export function remoteToGameAction(game: Game, settings: LifeSettings, seat: number, raw: unknown): GameAction | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const seated = (id: unknown) => typeof id === 'number' && game.players.some((p) => p.id === id)
  switch (a.type) {
    case 'life': {
      const delta = int(a.delta, 1000)
      return delta === null ? null : { type: 'life', id: seat, delta, by: seat }
    }
    case 'counter': {
      const delta = int(a.delta, 100)
      if (delta === null) return null
      if (a.counter === 'poison') return { type: 'poison', id: seat, delta, by: seat }
      if (!COUNTER_KINDS.includes(a.counter as CounterKind)) return null
      return { type: 'counter', id: seat, counter: a.counter as CounterKind, delta, by: seat }
    }
    case 'commanderDamage': {
      const delta = int(a.delta, 100)
      if (delta === null || !seated(a.from) || a.from === seat) return null
      return { type: 'commanderDamage', id: seat, from: a.from as number, delta, costsLife: settings.commanderDamageCostsLife, by: seat }
    }
    case 'dealtDamage': {
      const delta = int(a.delta, 100)
      if (delta === null || !seated(a.to) || a.to === seat) return null
      return { type: 'commanderDamage', id: a.to as number, from: seat, delta, costsLife: settings.commanderDamageCostsLife, by: seat }
    }
    case 'endTurn':
      return settings.turnTracker && game.turnPlayerId === seat ? { type: 'nextTurn', by: seat, autoKill: settings.autoKill } : null
    case 'undo':
      return { type: 'undo', by: seat }
    case 'background': {
      if (a.url !== null && !allowedImage(a.url)) return null
      const deck = typeof a.deck === 'string' ? a.deck.slice(0, 80) : a.deck === null ? null : undefined
      const commander = typeof a.commander === 'string' ? a.commander.slice(0, 150) : a.commander === null ? null : undefined
      return { type: 'background', id: seat, url: a.url as string | null, deck, commander }
    }
    case 'showCard':
      if (typeof a.name !== 'string' || !allowedImage(a.imageUrl) || new URL(a.imageUrl).hostname !== 'cards.scryfall.io') return null
      return { type: 'showCard', card: { name: a.name.slice(0, 150), imageUrl: a.imageUrl, seat } }
    case 'hideCard':
      return game.shownCard?.seat === seat ? { type: 'hideCard' } : null
    default:
      return null
  }
}

/** How long the game settles before it's sent again — a burst of taps goes out once. */
const PUBLISH_DEBOUNCE_MS = 120
/** Sent again this often even when nothing changes, so remotes can tell the table is still there. */
export const HEARTBEAT_MS = 25_000

/**
 * The table's side: while players can join (a match is open), keeps the match's channel open,
 * sends the game whenever it changes (and whenever a remote says hello), and plays remotes'
 * requests. Returns whether the channel is connected.
 */
export function useRemoteHost(game: Game, settings: LifeSettings, dispatch: (a: GameAction) => void, signedIn: boolean) {
  const [live, setLive] = useState(false)
  const matchId = signedIn ? game.match?.id ?? null : null
  const gameRef = useRef(game)
  gameRef.current = game
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const lastSent = useRef<string | null>(null)
  const publishTimer = useRef<number | undefined>(undefined)

  const publish = useRef((force: boolean) => {
    const id = gameRef.current.match?.id
    if (!id) return
    const state = JSON.stringify(buildRemoteState(gameRef.current, settingsRef.current))
    if (!force && state === lastSent.current) return
    lastSent.current = state
    void api.publishMatchState(id, JSON.parse(state)).catch(() => {
      lastSent.current = null // try again with the next change
    })
  })

  useEffect(() => {
    if (!matchId) return
    lastSent.current = null
    const stop = watchMatch(
      matchId,
      accessToken,
      (event, payload) => {
        if (event !== 'action') return
        const p = payload as { seat?: unknown; user_id?: unknown; action?: { type?: unknown } }
        const seat = typeof p.seat === 'number' ? p.seat : null
        const g = gameRef.current
        // Only the account the table has sitting at that seat.
        if (seat === null || !g.players.some((x) => x.id === seat && x.linked?.userId === p.user_id)) return
        if (p.action?.type === 'hello' || !settingsRef.current.remotes) {
          publish.current(true)
          return
        }
        const action = remoteToGameAction(g, settingsRef.current, seat, p.action)
        if (action) dispatch(action)
        else publish.current(true) // nothing changed: let the remote see the game as it is
      },
      () => publish.current(true),
      setLive,
    )
    const beat = window.setInterval(() => { if (!document.hidden) publish.current(true) }, HEARTBEAT_MS)
    return () => {
      stop()
      window.clearInterval(beat)
      setLive(false)
    }
  }, [matchId, dispatch])

  useEffect(() => {
    if (!matchId) return
    window.clearTimeout(publishTimer.current)
    publishTimer.current = window.setTimeout(() => publish.current(false), PUBLISH_DEBOUNCE_MS)
    return () => window.clearTimeout(publishTimer.current)
  }, [matchId, game, settings])

  return live
}

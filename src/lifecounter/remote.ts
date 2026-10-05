// Players' phones as remotes for a life counter table. The table (the host's phone or tablet)
// publishes the game on its match's private channel; a player who joined a seat by QR code sends
// requests for their own seat, which the table applies (or ignores, with remotes switched off).
// The same messages go between the web app and the Android app — keep LifeCounterRemote.kt in step.
//
// Server side: publish_match_state / send_match_action in
// MtgCompanionApp/supabase/migrations/20260922000000_match_remote.sql.
//
// ---- Added with the gameplay update (all optional, so old and new clients keep working) ----
//
// The same notes as at the top of the Android app's LifeCounterRemote.kt, which is the reference.
// Every addition is backwards compatible: a table ignores an action "type" it doesn't know, a remote
// ignores a state key it doesn't know, and each side reads a missing key as "not supported" (null).
//
// Remote -> table (actions, for the sender's own seat):
//   {"type":"deckInfo","deck":"Krenko Goblins"|null,
//    "tokens":[{"id":"<scryfall id>","name":"Goblin","pt":"1/1"|null}, …],
//    "triggers":[{"name":"Phyrexian Arena","step":"upkeep"|"draw"|"combat"|"end"}, …]}
//       The tokens the seat's deck makes and its "at the beginning of your …" cards. Sent when the
//       player picks a deck, and again whenever the table's state shows no "tokens" for the seat.
//       The table keeps at most 40 of each, names cut to 80 characters. Unknown steps are dropped.
//   {"type":"token","id":"<token id from deckInfo>","delta":1|-1|…}
//       One of the seat's deck tokens up or down (|delta| <= 100; never below 0). An older remote
//       still moves the plain Tokens counter with {"type":"counter","counter":"tokens",…}.
//   {"type":"holdOk"}
//       "OK, go on": any seat other than the one holding clears a "hold on" ("hold" in the state).
//       The holder itself still lets go with {"type":"hold","on":false}.
//
// Table -> remotes (keys of the published state):
//   players[i].tokens: [{"id":"…","name":"Goblin","pt":"1/1"|null,"count":3}, …]
//       Present (possibly []) once the table knows the seat's deck tokens; absent/null otherwise —
//       a remote then keeps its own counts, as before.
//   clock: {"elapsedMs":754000,"paused":false}
//       The game clock when this state was sent (time paused doesn't count). Count on from the
//       moment it arrived, unless paused. Absent from older tables: use startedAt.
//   turnTimer: {"seconds":120,"leftMs":87000} | null
//       The per-turn timer of the player whose turn it is ("turn"): leftMs left of it when this
//       state was sent, below 0 once the turn has run over. null/absent: no turn timer.
//
// ---- Added with dungeons, the new counters and mulligans (all optional, the same rules) ----
//
// Remote -> table:
//   {"type":"counter","counter":"rad"|"speed"|"ring",…}
//       Three more counter names. Speed and the Ring stop at 4. An older table doesn't know them
//       and ignores the request (it checks the name against its own list).
//   {"type":"venture","to":"<dungeon id or room id>","undercity":true|false}
//       Ventures: starts a dungeon ("lost-mine", "mad-mage", "tomb"; "undercity" only with
//       "undercity":true) or moves to a room joined below the seat's current room. Anything else is
//       ignored. Room and dungeon ids are in dungeons.ts / Dungeons.kt.
//   {"type":"leaveDungeon"}
//       Takes the seat's marker out of its dungeon without completing it.
//   {"type":"ringBearer","name":"Frodo"|null}
//       The seat's Ring-bearer (trimmed, at most 60 characters; blank or null: nobody).
//   {"type":"mulligan","value":0..7|null}
//       Mulligans the seat took this game (0: kept seven; null: not recorded).
//
// Table -> remotes, on each players[i] (absent from older tables, which read as "not tracked"):
//   counters.rad / counters.speed / counters.ring — in the existing counters object; an older
//       remote shows only the counters it knows and ignores the rest.
//   dungeon: {"id":"undercity","room":"arena"} | null    dungeonsCompleted: 2
//   ringBearer: "Frodo" | null                           mulligans: 1 | null
//
// Already in the protocol and used for the remote extras: "hold" (hold on), "target" (pointing,
// shown as an announce), "concede", "planar" (with "plane" in the state), and showCard's lookup for
// rulings (done on the phone; nothing goes to the table unless the card is shown).

import { useEffect, useRef, useState } from 'react'
import { accessToken } from '../sync/supabaseAuth'
import { watchMatch } from '../sync/realtime'
import * as api from '../social/api'
import {
  COUNTER_KINDS, EMOTES, canUndo, displayName, gameClockOf, gameOver, lossReason, seatColor,
  type Announce, type CounterKind, type DayNight, type EmoteId, type Game, type GameAction, type LifeSettings,
} from './game'
import type { PlanarFace } from './gameModes'
import { cleanMulligans } from '../decks/mulligans'
import { cleanRingBearer } from './counterRules'
import { cleanCompleted, parseDungeonState, type DungeonId } from './dungeons'
import {
  clockElapsed, gameMinutes, holdAfterOk, parseDeckInfo, parseRemoteClock, parseRemoteTokens, parseTurnTimer, turnTimeLeft,
  type RemoteClock, type RemoteToken, type RemoteTurnTimer,
} from './tableExtras'

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
  /** Times they've cast their commander — the tax is two for each. Absent from older tables. */
  commanderCasts?: number
  /** The same for their partner, when [partner]. */
  partnerCasts?: number
  /** The seat's deck tokens and how many of each are out; absent/null from a table that doesn't track them. */
  tokens?: RemoteToken[] | null
  /** Where the seat's venture marker is; absent from older tables. */
  dungeon?: { id: DungeonId; room: string } | null
  dungeonsCompleted?: number
  ringBearer?: string | null
  /** Mulligans this game; null: not recorded, absent: an older table. */
  mulligans?: number | null
}

/** The plane in play, when the table is playing Planechase. */
export interface RemotePlane { name: string; imageUrl: string | null; left: number }

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
  // Everything below is newer than the rest: an older table sends none of it, so read it as absent.
  monarch?: number | null
  initiative?: number | null
  dayNight?: DayNight | null
  /** The seat asking everyone to hold on. */
  hold?: number | null
  plane?: RemotePlane | null
  /** The latest roll, emote or pointing, shown for a moment — a new [Announce.id] is a new one. */
  announce?: Announce | null
  /** The game clock as sent; absent from an older table. */
  clock?: RemoteClock | null
  /** The turn timer, while the table runs one. */
  turnTimer?: RemoteTurnTimer | null
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
  /** [partner]: the deck has two commanders, so the table keeps them apart. */
  | { type: 'background'; url: string | null; deck?: string | null; commander?: string | null; partner?: boolean }
  | { type: 'showCard'; name: string; imageUrl: string }
  | { type: 'hideCard' }
  // Newer requests: an older table ignores them.
  /** Take the monarch, or give it up when this seat has it. */
  | { type: 'monarch'; take: boolean }
  | { type: 'initiative'; take: boolean }
  | { type: 'dayNight'; value: DayNight | null }
  /** A die the table rolls, so nobody can say the phone chose; [sides] 2 is a coin. */
  | { type: 'roll'; sides: number }
  | { type: 'planar'; what: 'roll' | 'planeswalk' }
  /** [slot] 1: the partner (absent: the commander). */
  | { type: 'commanderCast'; delta: number; slot?: number }
  | { type: 'hold'; on: boolean }
  | { type: 'emote'; emote: EmoteId }
  | { type: 'target'; to: number }
  | { type: 'concede' }
  /** The seat's deck tokens and trigger cards (see the notes at the top). */
  | { type: 'deckInfo'; deck: string | null; tokens: { id: string; name: string; pt: string | null }[]; triggers: { name: string; step: string }[] }
  /** One of the seat's deck tokens up or down. */
  | { type: 'token'; id: string; delta: number }
  /** "OK, go on": clears someone else's hold on. */
  | { type: 'holdOk' }
  // Dungeons, the Ring and mulligans (see the notes at the top).
  | { type: 'venture'; to: string; undercity?: boolean }
  | { type: 'leaveDungeon' }
  | { type: 'ringBearer'; name: string | null }
  | { type: 'mulligan'; value: number | null }

/** Dice a remote can ask the table to roll; 2 is a coin. */
export const REMOTE_DICE = [4, 6, 8, 10, 12, 20, 2]

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

/**
 * [plane]: the table's Planechase plane, which lives beside the game rather than in it. [now]: when
 * it's sent — the clock and the turn timer are measured then.
 */
export function buildRemoteState(game: Game, settings: LifeSettings, plane: RemotePlane | null = null, now = Date.now()): RemoteState {
  const over = gameOver(game, settings.autoKill)
  const startedAt = game.startedAt ?? now
  const lastAt = game.history[0]?.at ?? startedAt
  const clock = gameClockOf(game)
  const turnTracked = settings.turnTracker && game.players.length > 1
  const left = turnTracked && !over ? turnTimeLeft(settings.turnTimerMinutes, game.turnStartElapsed ?? 0, clockElapsed(clock, now)) : null
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
        commanderDamage: [
          ...Object.entries(p.commanderDamage).map(([from, amount]) => ({ from: Number(from), slot: 0, amount })),
          ...Object.entries(p.partnerDamage ?? {}).map(([from, amount]) => ({ from: Number(from), slot: 1, amount })),
        ].filter((d) => d.amount > 0),
        background: p.background ?? null,
        deck: p.deck ?? null,
        commander: p.commander ?? null,
        userId: p.linked?.userId ?? null,
        avatarPath: p.linked?.avatarPath ?? null,
        canUndo: canUndo(game, p.id),
        partner: !!p.hasPartner,
        commanderCasts: p.commanderCasts ?? 0,
        partnerCasts: p.partnerCasts ?? 0,
        ...(p.deckInfo ? { tokens: p.deckInfo.tokens.map((t) => ({ id: t.id, name: t.name, pt: t.pt ?? null, count: p.tokenCounts?.[t.id] ?? 0 })) } : {}),
        dungeon: p.dungeon ? { id: p.dungeon.dungeon, room: p.dungeon.room } : null,
        dungeonsCompleted: p.dungeonsCompleted ?? 0,
        ringBearer: p.ringBearer ?? null,
        mulligans: p.mulligans ?? null,
      }
    }),
    shownCard: game.shownCard ?? null,
    over: over ? { winner: over.winnerId, turns: game.turnNumber, minutes: gameMinutes(clockElapsed(clock, lastAt)) } : null,
    monarch: game.monarchId,
    initiative: game.initiativeId,
    dayNight: game.dayNight,
    hold: game.hold ?? null,
    plane,
    announce: game.announce ?? null,
    clock: { elapsedMs: clockElapsed(clock, now), paused: clock.pausedAt !== null },
    turnTimer: left === null ? null : { seconds: settings.turnTimerMinutes * 60, leftMs: left },
  }
}

/**
 * A published state as a remote reads it: null for anything that isn't a game this version
 * understands; the gameplay additions (seat tokens, clock, turn timer) read as absent when they're
 * missing or malformed, as from an older table.
 */
export function parseRemoteState(raw: unknown): RemoteState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== REMOTE_VERSION || !Array.isArray(o.players)) return null
  if (!o.players.every((p) => p && typeof p === 'object' && typeof (p as RemoteSeat).seat === 'number')) return null
  return {
    ...(o as unknown as RemoteState),
    players: (o.players as RemoteSeat[]).map((p) => {
      const { tokens, dungeon, dungeonsCompleted, ringBearer, mulligans, ...rest } = p
      const parsed = parseRemoteTokens(tokens)
      const marker = parseDungeonState(dungeon)
      // A table that knows dungeons, the Ring and mulligans always sends dungeonsCompleted; from an
      // older one they stay absent, so the remote doesn't offer what the table would ignore.
      const known = typeof dungeonsCompleted === 'number'
      return {
        ...rest,
        ...(parsed ? { tokens: parsed } : {}),
        ...(known
          ? {
              dungeon: marker ? { id: marker.dungeon, room: marker.room } : null,
              dungeonsCompleted: cleanCompleted(dungeonsCompleted),
              ringBearer: cleanRingBearer(ringBearer),
              mulligans: cleanMulligans(mulligans),
            }
          : {}),
      }
    }),
    clock: parseRemoteClock(o.clock),
    turnTimer: parseTurnTimer(o.turnTimer),
  }
}

const newAnnounceId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

/** Rolls [sides] (2: a coin) for [seat], as the announcement everyone sees and its history line. */
export function rollFor(seat: number, sides: number): GameAction {
  if (sides === 2) {
    const value = Math.random() < 0.5 ? 'Heads' : 'Tails'
    return { type: 'announce', announce: { id: newAnnounceId(), seat, kind: 'coin', value, at: Date.now() }, note: `Flipped a coin: ${value}` }
  }
  const value = String(1 + Math.floor(Math.random() * sides))
  return { type: 'announce', announce: { id: newAnnounceId(), seat, kind: 'roll', sides, value, at: Date.now() }, note: `Rolled a d${sides}: ${value}` }
}

/** What a planar die (or a planeswalk) did, for everyone to see. */
export function planarAnnounce(seat: number, face: PlanarFace): GameAction {
  const note = face === 'PLANESWALK' ? 'Planeswalked' : face === 'CHAOS' ? 'Rolled Chaos on the planar die' : 'Rolled a blank on the planar die'
  return { type: 'announce', announce: { id: newAnnounceId(), seat, kind: 'planar', value: face, at: Date.now() }, note }
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
  const partnered = (id: unknown) => game.players.some((p) => p.id === id && p.hasPartner)
  // Which of a player's commanders: 0 (absent, from older remotes) or 1, their partner.
  const slotOf = (v: unknown) => (v === undefined || v === 0 ? 0 : v === 1 ? 1 : null)
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
      const slot = slotOf(a.slot)
      if (delta === null || slot === null || !seated(a.from) || a.from === seat) return null
      if (slot === 1 && !partnered(a.from)) return null
      return { type: 'commanderDamage', id: seat, from: a.from as number, delta, costsLife: settings.commanderDamageCostsLife, slot, by: seat }
    }
    case 'dealtDamage': {
      const delta = int(a.delta, 100)
      const slot = slotOf(a.slot)
      if (delta === null || slot === null || !seated(a.to) || a.to === seat) return null
      if (slot === 1 && !partnered(seat)) return null
      return { type: 'commanderDamage', id: a.to as number, from: seat, delta, costsLife: settings.commanderDamageCostsLife, slot, by: seat }
    }
    case 'endTurn':
      return settings.turnTracker && game.turnPlayerId === seat ? { type: 'nextTurn', by: seat, autoKill: settings.autoKill } : null
    case 'undo':
      return { type: 'undo', by: seat }
    case 'background': {
      if (a.url !== null && !allowedImage(a.url)) return null
      const deck = typeof a.deck === 'string' ? a.deck.slice(0, 80) : a.deck === null ? null : undefined
      const commander = typeof a.commander === 'string' ? a.commander.slice(0, 150) : a.commander === null ? null : undefined
      const partner = typeof a.partner === 'boolean' ? a.partner : undefined
      return { type: 'background', id: seat, url: a.url as string | null, deck, commander, partner }
    }
    case 'showCard':
      if (typeof a.name !== 'string' || !allowedImage(a.imageUrl) || new URL(a.imageUrl).hostname !== 'cards.scryfall.io') return null
      return { type: 'showCard', card: { name: a.name.slice(0, 150), imageUrl: a.imageUrl, seat } }
    case 'hideCard':
      return game.shownCard?.seat === seat ? { type: 'hideCard' } : null
    case 'monarch':
    case 'initiative': {
      const holder = a.type === 'monarch' ? game.monarchId : game.initiativeId
      if (a.take === true) return holder === seat ? null : { type: a.type, id: seat, by: seat }
      // Only whoever has it can give it up; taking it from someone else is done by taking it.
      return a.take === false && holder === seat ? { type: a.type, id: null, by: seat } : null
    }
    case 'dayNight':
      return a.value === 'DAY' || a.value === 'NIGHT' || a.value === null ? { type: 'dayNight', value: a.value, by: seat } : null
    case 'roll':
      return typeof a.sides === 'number' && REMOTE_DICE.includes(a.sides) ? { ...rollFor(seat, a.sides), by: seat } : null
    case 'commanderCast': {
      const slot = slotOf(a.slot)
      if ((a.delta !== 1 && a.delta !== -1) || slot === null || (slot === 1 && !partnered(seat))) return null
      return { type: 'commanderCast', id: seat, delta: a.delta, slot, by: seat }
    }
    case 'hold':
      if (a.on === true) return { type: 'hold', id: seat, by: seat }
      return a.on === false && game.hold === seat ? { type: 'hold', id: null, by: seat } : null
    case 'emote':
      return typeof a.emote === 'string' && Object.hasOwn(EMOTES, a.emote)
        ? { type: 'announce', announce: { id: newAnnounceId(), seat, kind: 'emote', emote: a.emote as EmoteId, at: Date.now() }, by: seat }
        : null
    case 'target':
      return seated(a.to) && a.to !== seat
        ? { type: 'announce', announce: { id: newAnnounceId(), seat, kind: 'target', to: a.to as number, at: Date.now() }, by: seat }
        : null
    case 'concede':
      return lossReason(game.players.find((p) => p.id === seat)!, settings.autoKill) ? null : { type: 'concede', id: seat, by: seat }
    case 'deckInfo': {
      const info = parseDeckInfo(a)
      return info ? { type: 'deckInfo', id: seat, info, by: seat } : null
    }
    case 'token': {
      const delta = int(a.delta, 100)
      const p = game.players.find((x) => x.id === seat)
      if (delta === null || typeof a.id !== 'string' || !p?.deckInfo?.tokens.some((t) => t.id === a.id)) return null
      return { type: 'token', id: seat, tokenId: a.id, delta, by: seat }
    }
    case 'holdOk':
      return game.hold != null && holdAfterOk(game.hold, seat) === null ? { type: 'hold', id: null, by: seat } : null
    case 'venture':
      return typeof a.to === 'string' && a.to.length <= 40 ? { type: 'venture', id: seat, to: a.to, undercity: a.undercity === true, by: seat } : null
    case 'leaveDungeon':
      return { type: 'leaveDungeon', id: seat, by: seat }
    case 'ringBearer':
      return a.name === null || typeof a.name === 'string' ? { type: 'ringBearer', id: seat, name: cleanRingBearer(a.name), by: seat } : null
    case 'mulligan':
      return a.value === null || cleanMulligans(a.value) != null ? { type: 'mulligan', id: seat, value: a.value as number | null, by: seat } : null
    default:
      // 'planar' is played by the table's Planechase, not the game — see useRemoteHost.
      return null
  }
}

/**
 * Whether seat [seat] may roll the planar die or planeswalk: only while a plane is in play, and — when
 * the table tracks turns — only on their own turn, as the rules have it.
 */
export function mayUsePlanes(game: Game, settings: LifeSettings, seat: number, plane: RemotePlane | null): boolean {
  if (!plane) return false
  return !settings.turnTracker || game.turnPlayerId === seat
}

/** How long the game settles before it's sent again — a burst of taps goes out once. */
const PUBLISH_DEBOUNCE_MS = 120
/** Sent again this often even when nothing changes, so remotes can tell the table is still there. */
export const HEARTBEAT_MS = 25_000

/**
 * The table's side: while players can join (a match is open), keeps the match's channel open,
 * sends the game whenever it changes (and whenever a remote says hello), and plays remotes'
 * requests. Returns whether the channel is connected.
 *
 * [planes]: the table's Planechase, when it's playing — the plane to show remotes, and how to roll
 * the planar die or planeswalk for one (returning what happened, or null when it couldn't).
 */
export function useRemoteHost(
  game: Game,
  settings: LifeSettings,
  dispatch: (a: GameAction) => void,
  signedIn: boolean,
  planes?: { plane: RemotePlane | null; play: (what: 'roll' | 'planeswalk') => PlanarFace | null },
) {
  const [live, setLive] = useState(false)
  const matchId = signedIn ? game.match?.id ?? null : null
  const gameRef = useRef(game)
  gameRef.current = game
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const planesRef = useRef(planes)
  planesRef.current = planes
  const lastSent = useRef<string | null>(null)
  const publishTimer = useRef<number | undefined>(undefined)

  const publish = useRef((force: boolean) => {
    const id = gameRef.current.match?.id
    if (!id) return
    const state = JSON.stringify(buildRemoteState(gameRef.current, settingsRef.current, planesRef.current?.plane ?? null))
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
        const raw = p.action as { type?: unknown; what?: unknown }
        if (raw.type === 'planar') {
          const planesNow = planesRef.current
          const face = planesNow && mayUsePlanes(g, settingsRef.current, seat, planesNow.plane) && (raw.what === 'roll' || raw.what === 'planeswalk')
            ? planesNow.play(raw.what)
            : null
          if (face) dispatch({ ...planarAnnounce(seat, face), by: seat })
          else publish.current(true)
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
  }, [matchId, game, settings, planes?.plane])

  return live
}

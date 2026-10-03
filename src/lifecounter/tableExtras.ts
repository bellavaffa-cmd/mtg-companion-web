// What a seat's deck brings to the table, and the game's clocks — no React, so it can be tested on
// its own. Mirrors the Android app's ui/lifecounter/TableExtras.kt (same rules, same wording, same
// messages on the wire). A seat's deck tokens and its "at the beginning of…" cards come either from
// the table owner's own deck (their seat, see LifeSettings.meSeat) or from a player's remote, which
// sends them in a "deckInfo" message (see the protocol notes at the top of remote.ts).

import type { Deck, DeckCardEntry } from '../types/models'
import { displayOracleText, type ScryfallCard } from '../types/scryfall'
import { tokensNeeded } from '../decks/tokens'

// ---- Deck tokens ----

/** A token a seat's deck makes, e.g. a 1/1 Goblin. [id] is a Scryfall id of one printing of it. */
export interface SeatToken {
  id: string
  name: string
  pt?: string | null
  /** Its art, for the remote's own list; it never goes to the table. */
  art?: string | null
}

/** "Goblin 1/1". */
export const tokenLabel = (t: { name: string; pt?: string | null }) => (t.pt ? `${t.name} ${t.pt}` : t.name)

/** The tokens and the start-of-turn trigger cards of the deck played at a seat. */
export interface SeatDeckInfo { deck: string | null; tokens: SeatToken[]; triggers: TriggerCard[] }

/** "Goblin 1/1 ×3" — what a token counter on a tile says. */
export const tokenChipText = (token: SeatToken, count: number) => `${tokenLabel(token)} ×${count}`

/** The most of anything a deckInfo message may carry, and the longest a name in it may be. */
export const DECK_INFO_MAX_ITEMS = 40
export const DECK_INFO_MAX_NAME = 80

// ---- Trigger reminders ----

/** The steps of your own turn a card can ask to be remembered at, in the order they come. */
export const TRIGGER_STEPS = [
  { wire: 'upkeep', label: 'Upkeep', phrase: 'at the beginning of your upkeep' },
  { wire: 'draw', label: 'Draw step', phrase: 'at the beginning of your draw step' },
  { wire: 'combat', label: 'Combat', phrase: 'at the beginning of combat on your turn' },
  { wire: 'end', label: 'End step', phrase: 'at the beginning of your end step' },
] as const
export type TriggerStep = (typeof TRIGGER_STEPS)[number]['wire']

export const triggerStepOfWire = (wire: unknown): TriggerStep | null =>
  TRIGGER_STEPS.find((s) => s.wire === wire)?.wire ?? null

/** A card in the deck that does something at [step] of its owner's turn. */
export interface TriggerCard { name: string; step: TriggerStep }

/** The steps [oracleText] triggers at, on its owner's turn. Case doesn't matter; reminder text in brackets doesn't count. */
export function triggerStepsOf(oracleText: string | null | undefined): Set<TriggerStep> {
  if (!oracleText?.trim()) return new Set()
  const text = oracleText.replace(/\([^)]*\)/g, ' ').toLowerCase()
  return new Set(TRIGGER_STEPS.filter((s) => text.includes(s.phrase)).map((s) => s.wire))
}

/**
 * The trigger cards among [cards] (name and oracle text), once each per step, in step order and then
 * in the order the deck lists them.
 */
export function deckTriggers(cards: [string, string | null | undefined][]): TriggerCard[] {
  const seen = new Map<string, TriggerCard>()
  for (const { wire } of TRIGGER_STEPS) {
    for (const [name, text] of cards) {
      if (triggerStepsOf(text).has(wire) && !seen.has(`${wire}|${name}`)) seen.set(`${wire}|${name}`, { name, step: wire })
    }
  }
  return [...seen.values()]
}

/** One line per step: "Upkeep: Phyrexian Arena, Bitterblossom". Empty with nothing to remind. */
export function reminderLines(triggers: TriggerCard[]): string[] {
  return TRIGGER_STEPS.flatMap(({ wire, label }) => {
    const names = triggers.filter((t) => t.step === wire).map((t) => t.name)
    return names.length ? [`${label}: ${names.join(', ')}`] : []
  })
}

/**
 * What [deck] brings to the table: the tokens its cards make (emblems left out — there's nothing to
 * count) and its "at the beginning of your …" cards. [cardsById]: its cards; [tokenCardsById]: the
 * tokens' own cards, for their power and toughness and art (missing ones just go without).
 */
export function seatDeckInfoOf(
  deck: Deck,
  cardsById: Map<string, ScryfallCard>,
  tokenCardsById: Map<string, ScryfallCard> = new Map(),
  artOf: (card: ScryfallCard) => string | null = () => null,
): SeatDeckInfo {
  const tokens = tokensNeeded(deck, cardsById).filter((t) => !t.isEmblem).map((t): SeatToken => {
    // Power and toughness aren't in the app's trimmed ScryfallCard, but Scryfall sends them.
    const card = tokenCardsById.get(t.id) as (ScryfallCard & { power?: string; toughness?: string }) | undefined
    const pt = card?.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : null
    return { id: t.id, name: t.name, pt, art: card ? artOf(card) : null }
  })
  const entries = [deck.commander, deck.partnerCommander, ...deck.cards].filter((e): e is DeckCardEntry => !!e)
  const named = new Map<string, DeckCardEntry>()
  for (const e of entries) if (!named.has(e.name)) named.set(e.name, e)
  const triggers = deckTriggers([...named.values()].map((e) => {
    const card = cardsById.get(e.scryfallId)
    return [e.name, card ? displayOracleText(card) : null]
  }))
  return { deck: deck.name, tokens, triggers }
}

// ---- The game clock and the turn timer ----

/**
 * How long the game has been going, less the time it sat paused. [pausedAt] is set while it's
 * paused; [pausedMs] is the paused time already over.
 */
export interface GameClock { startedAt: number; pausedAt: number | null; pausedMs: number }

export const newClock = (now: number): GameClock => ({ startedAt: now, pausedAt: null, pausedMs: 0 })
export const clockElapsed = (c: GameClock, now: number) => Math.max(0, (c.pausedAt ?? now) - c.startedAt - c.pausedMs)
export const pauseClock = (c: GameClock, now: number): GameClock => (c.pausedAt !== null ? c : { ...c, pausedAt: now })
export const resumeClock = (c: GameClock, now: number): GameClock =>
  c.pausedAt === null ? c : { ...c, pausedAt: null, pausedMs: c.pausedMs + Math.max(0, now - c.pausedAt) }

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "4:05", or "1:02:09" past an hour. A negative time reads the same, with a minus. */
export function formatClock(ms: number): string {
  const sign = ms < 0 ? '−' : ''
  const total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${sign}${h}:${pad2(m)}:${pad2(s)}` : `${sign}${m}:${pad2(s)}`
}

/** A game's length for its records, in whole minutes and never less than one. */
export const gameMinutes = (elapsedMs: number) => Math.max(1, Math.floor(elapsedMs / 60_000))

/** The turn timer's choices in minutes; 0 is off. */
export const TURN_TIMER_CHOICES = [0, 1, 2, 3, 5]

/**
 * Time left in the turn (ms), or null with the timer off. Measured on the game clock, so pausing the
 * game pauses the turn too. Below zero once the turn has run over.
 */
export const turnTimeLeft = (limitMinutes: number, turnStartElapsed: number, elapsedNow: number): number | null =>
  limitMinutes <= 0 ? null : limitMinutes * 60_000 - (elapsedNow - turnStartElapsed)

/** How a turn timer reads: the time left, rounded up, or "+0:12" once over. */
export const turnTimerText = (leftMs: number) => (leftMs <= 0 ? `+${formatClock(-leftMs)}` : formatClock(leftMs + 999))

// ---- On the wire (see remote.ts) ----

/** A seat's deck tokens as the table publishes them, with how many of each are out. */
export interface RemoteToken { id: string; name: string; pt: string | null; count: number }

/** The game clock as the table last sent it: [elapsedMs] when it sent it. */
export interface RemoteClock { elapsedMs: number; paused: boolean }

/** The turn timer: [seconds] a turn, [leftMs] of this one left when the table sent it (below 0: over). */
export interface RemoteTurnTimer { seconds: number; leftMs: number }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback)

/** A seat's "tokens" as a remote reads them; null (not tracked by that table) when it isn't a list. */
export function parseRemoteTokens(v: unknown): RemoteToken[] | null {
  if (!Array.isArray(v)) return null
  return v.flatMap((x) => {
    const o = obj(x)
    if (!o || typeof o.id !== 'string' || o.id === '') return []
    return [{ id: o.id, name: typeof o.name === 'string' ? o.name : '', pt: typeof o.pt === 'string' && o.pt !== '' ? o.pt : null, count: Math.max(0, num(o.count)) }]
  })
}

export function parseRemoteClock(v: unknown): RemoteClock | null {
  const o = obj(v)
  return o ? { elapsedMs: Math.max(0, num(o.elapsedMs)), paused: o.paused === true } : null
}

export function parseTurnTimer(v: unknown): RemoteTurnTimer | null {
  const o = obj(v)
  const seconds = o ? num(o.seconds) : 0
  return o && seconds > 0 ? { seconds, leftMs: num(o.leftMs) } : null
}

/** The deckInfo message a remote sends for its seat. The tokens' art stays on the phone. */
export function deckInfoAction(info: SeatDeckInfo) {
  return {
    type: 'deckInfo' as const,
    deck: info.deck ?? null,
    tokens: info.tokens.slice(0, DECK_INFO_MAX_ITEMS).map((t) => ({ id: t.id, name: t.name, pt: t.pt ?? null })),
    triggers: info.triggers.slice(0, DECK_INFO_MAX_ITEMS).map((t) => ({ name: t.name, step: t.step })),
  }
}

/**
 * A deckInfo message as the table reads it — trusting no more of it than it must: at most
 * DECK_INFO_MAX_ITEMS of each, names cut to DECK_INFO_MAX_NAME, unknown steps dropped. Null when it
 * isn't one.
 */
export function parseDeckInfo(raw: unknown): SeatDeckInfo | null {
  const a = obj(raw)
  if (!a || a.type !== 'deckInfo') return null
  const text = (o: Record<string, unknown>, key: string, max: number) => {
    const v = o[key]
    if (v === null || v === undefined) return null
    const s = (typeof v === 'string' ? v : String(v)).trim().slice(0, max)
    return s === '' ? null : s
  }
  const tokens: SeatToken[] = []
  for (const x of Array.isArray(a.tokens) ? a.tokens : []) {
    const o = obj(x)
    if (!o) continue
    const id = text(o, 'id', 64)
    const name = text(o, 'name', DECK_INFO_MAX_NAME)
    if (!id || !name || tokens.some((t) => t.id === id)) continue
    tokens.push({ id, name, pt: text(o, 'pt', 12) })
  }
  const triggers: TriggerCard[] = []
  for (const x of Array.isArray(a.triggers) ? a.triggers : []) {
    const o = obj(x)
    if (!o) continue
    const name = text(o, 'name', DECK_INFO_MAX_NAME)
    const step = triggerStepOfWire(o.step)
    if (!name || !step || triggers.some((t) => t.name === name && t.step === step)) continue
    triggers.push({ name, step })
  }
  return { deck: text(a, 'deck', DECK_INFO_MAX_NAME), tokens: tokens.slice(0, DECK_INFO_MAX_ITEMS), triggers: triggers.slice(0, DECK_INFO_MAX_ITEMS) }
}

/** A change to one of the seat's deck-token counts. */
export const tokenAction = (id: string, delta: number) => ({ type: 'token' as const, id, delta })

/** [counts] after [id] goes up or down by [delta]: never below 0, and only for a token the seat's deck makes. */
export function changedTokenCounts(counts: Record<string, number>, tokens: SeatToken[], id: string, delta: number): Record<string, number> {
  if (!tokens.some((t) => t.id === id)) return counts
  const next = Math.min(999, Math.max(0, (counts[id] ?? 0) + delta))
  return { ...counts, [id]: next }
}

/**
 * Who holds the "hold on" after [seat] says "OK, go on" (the holdOk action): anyone else at the
 * table can let the game go on; the holder lets go with hold(false) as before.
 */
export const holdAfterOk = (holder: number | null | undefined, seat: number): number | null =>
  holder != null && holder !== seat ? null : holder ?? null


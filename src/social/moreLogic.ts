// The rules behind blocking, messages, trade reputation, the activity feed and cards for trade —
// kept apart from the screens so they can be tested. The Android app's twin is
// data/social/SocialMoreLogic.kt, case for case (tests/social/more.test.ts ↔ SocialMoreLogicTest.kt).

import type { Collection, CollectionEntry } from '../types/models'
import type { Trade, TradeCard } from './api'

/**
 * Whether a failed call means the server function isn't there yet (its migration not applied):
 * PostgREST answers 404 with code PGRST202. The screens then hide what needs it.
 */
export const isMissingFunction = (status: number, code: string | null | undefined) => code === 'PGRST202' || (status === 404 && !code)

// ---- Messages ----

/** One direct message, as the server sends it (send_message, get_messages and the "dm:<id>" channel). */
export interface DirectMessage {
  id: number
  conversation_id: string
  sender: string
  recipient: string
  body: string
  /** ms */
  created_at: number
}

/** The longest message the server takes. */
export const MESSAGE_MAX = 2000

/** The private Realtime channel a person's new messages arrive on. */
export const dmTopic = (userId: string) => `dm:${userId}`

/** A piece of a message: plain text, or a card name written as [[Card Name]]. */
export type MessagePart = { text: string } | { card: string }

/**
 * Splits a message into text and card links: "[[Sol Ring]]" becomes a link to Sol Ring. A name is 1
 * to 150 characters with no brackets or line breaks; anything else stays as written.
 */
export function messageParts(body: string): MessagePart[] {
  const parts: MessagePart[] = []
  const re = /\[\[([^[\]\n]{1,150})\]\]/g
  let last = 0
  for (const m of body.matchAll(re)) {
    const name = m[1].trim()
    if (!name) continue
    const at = m.index ?? 0
    if (at > last) parts.push({ text: body.slice(last, at) })
    parts.push({ card: name })
    last = at + m[0].length
  }
  if (last < body.length) parts.push({ text: body.slice(last) })
  return parts
}

/** [list] with [incoming] added: each message once (by id), oldest first. */
export function mergeMessages(list: DirectMessage[], incoming: DirectMessage[]): DirectMessage[] {
  const byId = new Map<number, DirectMessage>()
  for (const m of [...list, ...incoming]) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** A conversation's last message for the list: "You: …" for the user's own, cut to 80 characters. */
export function previewLine(last: { sender: string; body: string } | null | undefined, me: string): string {
  if (!last) return 'No messages yet'
  const text = last.body.replace(/\s+/g, ' ').trim()
  const cut = text.length > 80 ? `${text.slice(0, 79)}…` : text
  return last.sender === me ? `You: ${cut}` : cut
}

// ---- Trade reputation ----

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "March 2026", from ms (in UTC, so both apps say the same). */
export const monthYear = (ms: number) => {
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "Trades completed: 12 · since March 2026", or "No trades yet". */
export function tradesLine(total: number, sinceMs: number | null): string {
  if (total <= 0) return 'No trades yet'
  return sinceMs ? `Trades completed: ${total} · since ${monthYear(sinceMs)}` : `Trades completed: ${total}`
}

/** "3 with you", "1 with you", or "None with you yet". */
export const withYouLine = (n: number) => (n <= 0 ? 'None with you yet' : `${n} with you`)

/** "5 positive" (thumbs up after trades). */
export const positiveLine = (n: number) => `${Math.max(0, n)} positive`

/** Whether the user can give a thumbs up or down for [trade]: accepted, and their side updated. */
export function canRate(trade: Pick<Trade, 'status' | 'from_user' | 'to_user' | 'from_applied' | 'to_applied'>, me: string): boolean {
  if (trade.status !== 'accepted') return false
  return trade.from_user === me ? trade.from_applied : trade.to_user === me ? trade.to_applied : false
}

// ---- Two-way wishlist matches ----

/** "Priya has 2 cards you want, and wants 3 of yours" — or the half that applies; null for neither. */
export function matchSentence(name: string, have: number, want: number): string | null {
  const has = have > 0 ? `has ${have} ${have === 1 ? 'card' : 'cards'} you want` : null
  const wants = want > 0 ? `wants ${want} of yours` : null
  if (has && wants) return `${name} ${has}, and ${wants}`
  if (has) return `${name} ${has}`
  if (wants) return `${name} ${wants}`
  return null
}

// ---- Cards for trade ----

/** How many of an entry's copies are for trade: its "forTrade", never more than it holds. */
export function forTradeOf(entry: Pick<CollectionEntry, 'quantity' | 'foilQuantity'> & { forTrade?: number | null }): number {
  const n = Math.floor(entry.forTrade ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, Math.max(0, entry.quantity) + Math.max(0, entry.foilQuantity))
}

/**
 * [collections] with [count] copies of one binder card marked for trade (kept between 0 and its
 * copies; 0 leaves the key out). Wishlists aren't changed.
 */
export function setForTrade(collections: Collection[], collectionId: string, scryfallId: string, count: number): Collection[] {
  return collections.map((c) => {
    if (c.id !== collectionId || c.type === 'WISHLIST') return c
    return {
      ...c,
      entries: c.entries.map((e) => {
        if (e.scryfallId !== scryfallId) return e
        const n = forTradeOf({ ...e, forTrade: count })
        const { forTrade: _drop, ...rest } = e
        void _drop
        return n > 0 ? { ...rest, forTrade: n } : rest
      }),
    }
  })
}

/** One line of the user's for-trade list. */
export interface ForTradeLine {
  collectionId: string
  binder: string
  entry: CollectionEntry
  count: number
}

/** Every owned card marked for trade, by name then binder. */
export function forTradeLines(collections: Collection[]): ForTradeLine[] {
  const out: ForTradeLine[] = []
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      const count = forTradeOf(e)
      if (count > 0) out.push({ collectionId: c.id, binder: c.name, entry: e, count })
    }
  }
  return out.sort((a, b) => a.entry.name.localeCompare(b.entry.name) || a.binder.localeCompare(b.binder))
}

/**
 * One binder's for-trade copies as picks for the card picker: plain copies first, then foil, up to the
 * marked count. The picker's total for a card is its new count (see setForTrade).
 */
export function forTradePicks(c: Collection): TradeCard[] {
  const out: TradeCard[] = []
  for (const e of c.entries) {
    const n = forTradeOf(e)
    if (n <= 0) continue
    const plain = Math.min(n, Math.max(0, e.quantity))
    const foil = n - plain
    if (plain > 0) out.push({ scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, foil: false, quantity: plain, collectionId: c.id })
    if (foil > 0) out.push({ scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, foil: true, quantity: foil, collectionId: c.id })
  }
  return out
}

// ---- Activity ----

export type ActivityKind = 'shared' | 'deck_updated' | 'pod_game' | 'for_trade'

/** One item of the Activity tab, as activity_feed answers it. */
export interface ActivityItem {
  kind: ActivityKind | string
  actor: { user_id: string; username: string; display_name: string; avatar_path?: string | null }
  /** ms */
  at: number
  item_kind?: 'deck' | 'collection'
  item_id?: string
  name?: string
  cover?: string
  pod_id?: string
  pod_name?: string
  format?: string
  winner?: string
  players?: number
  count?: number
  cards?: { name: string; imageUrl?: string | null }[]
}

/** "Sol Ring, Arcane Signet and 2 more" (up to [shown] names). */
export function namesLine(names: string[], total: number, shown = 2): string {
  const listed = names.slice(0, shown)
  const more = Math.max(0, total - listed.length)
  if (listed.length === 0) return ''
  if (more > 0) return `${listed.join(', ')} and ${more} more`
  if (listed.length === 1) return listed[0]
  return `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1]}`
}

/** What an activity item says after the person's name, and a second line when there is one. */
export function activityText(item: ActivityItem): { action: string; detail: string | null } {
  switch (item.kind) {
    case 'shared':
      if (!item.item_id) return { action: item.item_kind === 'deck' ? 'shared all their decks' : 'shared their collection', detail: null }
      return { action: `shared a ${item.item_kind === 'deck' ? 'deck' : 'binder'}`, detail: item.name ?? null }
    case 'deck_updated':
      return { action: 'updated a deck', detail: item.name ?? null }
    case 'pod_game': {
      const where = item.pod_name ? `recorded a game in ${item.pod_name}` : 'recorded a game'
      const bits = [item.winner ? `${item.winner} won` : 'No winner', item.players ? `${item.players} players` : null]
      return { action: where, detail: bits.filter(Boolean).join(' · ') }
    }
    case 'for_trade': {
      const n = item.count ?? item.cards?.length ?? 0
      return { action: `marked ${n} ${n === 1 ? 'card' : 'cards'} for trade`, detail: namesLine((item.cards ?? []).map((c) => c.name), n) || null }
    }
    default:
      return { action: 'did something new', detail: null }
  }
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then "12 Mar". */
export function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  const date = new Date(ms)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()].slice(0, 3)}`
}

// ---- Reports ----

/** Why someone is reported: the server's codes, and the words for them. */
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam' },
  { id: 'abuse', label: 'Abuse or harassment' },
  { id: 'scam', label: 'Scam or a trade gone wrong' },
  { id: 'inappropriate', label: 'Something inappropriate' },
  { id: 'other', label: 'Something else' },
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]['id']

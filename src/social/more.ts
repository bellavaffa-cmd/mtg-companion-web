// Blocking and reporting, direct messages, trade reputation, the activity feed and cards for trade:
// calls to the server functions in MtgCompanionApp/supabase/migrations/20261006020000_social_more.sql.
// The Android app's twin is data/social/SocialMore.kt.
//
// Until that migration is applied the functions aren't there: socialMoreAvailable() says so, and the
// screens hide what needs them (or say "Not available yet") rather than failing.

import { useEffect, useRef, useState } from 'react'
import { accessToken } from '../sync/supabaseAuth'
import { watchDm } from '../sync/realtime'
import { useSync } from '../sync/SyncContext'
import { call, SocialError, type Profile, type TradeCard } from './api'
import type { ActivityItem, DirectMessage, ReportReason } from './moreLogic'

export interface BlockedPerson extends Profile {
  /** ms */
  blocked_at: number
}

export interface Conversation {
  id: string
  other: Profile
  last: { id: number; sender: string; body: string; created_at: number } | null
  unread: number
  /** Still friends (and not blocked): new messages can be sent. */
  can_send: boolean
}

export interface Reputation {
  /** Accepted trades, with anyone. */
  total: number
  with_you: number
  /** ms of their first trade, or null. */
  since: number | null
  positive: number
  negative: number
}

/** One card a friend (or the user) has marked for trade. */
export interface ForTradeCard {
  item_id: string
  item_name: string | null
  scryfall_id: string
  name: string
  image_url?: string | null
  for_trade: number
  quantity: number
  foil_quantity: number
  condition?: string | null
}

/** A trade line from trade_matches; [forTrade]: those copies are marked for trade. */
export interface MatchCard extends TradeCard {
  forTrade?: boolean
}

/** Wishlist matches both ways with one friend: their cards the user wants, the user's they want. */
export interface TradeMatch {
  friend: string
  they_have: MatchCard[]
  they_want: MatchCard[]
}

export type ReportItemKind = 'profile' | 'deck' | 'collection' | 'trade' | 'message'

// ---- Is it there? ----

let probe: Promise<boolean> | null = null

/** Whether the server has these functions. Asked once per page load (again after a failed ask). */
export function socialMoreAvailable(): Promise<boolean> {
  if (!probe) {
    probe = call<number>('social_more_version')
      .then((v) => typeof v === 'number' && v >= 1)
      .catch((e: unknown) => {
        if (e instanceof SocialError && e.code === 'unavailable') return false
        probe = null // offline or signed out: ask again next time
        return false
      })
  }
  return probe
}

/** The same, for a screen: null while asking. False when signed out. */
export function useSocialMore(): boolean | null {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [state, setState] = useState<{ user: string | null; ok: boolean } | null>(null)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void socialMoreAvailable().then((ok) => { if (!cancelled) setState({ user: userId, ok }) })
    return () => { cancelled = true }
  }, [userId])
  if (!userId) return false
  return state && state.user === userId ? state.ok : null
}

// ---- Blocking and reporting ----

export const blockUser = (userId: string) => call<void>('block_user', { p_user: userId })
export const unblockUser = (userId: string) => call<void>('unblock_user', { p_user: userId })
export const blockedUsers = () => call<BlockedPerson[]>('blocked_users').then((l) => l ?? [])
export const reportUser = (userId: string, reason: ReportReason, note: string, item?: { kind: ReportItemKind; id: string }) =>
  call<void>('report_user', { p_user: userId, p_reason: reason, p_note: note.trim() || null, p_item_kind: item?.kind ?? null, p_item_id: item?.id ?? null })

// ---- Messages ----

export const sendMessage = (to: string, body: string) => call<DirectMessage>('send_message', { p_to: to, p_body: body })
export const listConversations = () => call<Conversation[]>('list_conversations').then((l) => l ?? [])
/** A page of the conversation with [other], oldest first: the messages before [before] (null: the newest). */
export const getMessages = (other: string, before: number | null = null, limit = 50) =>
  call<DirectMessage[]>('get_messages', { p_with: other, p_before: before, p_limit: limit }).then((l) => l ?? [])
export const markRead = (other: string) => call<void>('mark_read', { p_with: other })
export const unreadMessages = () => call<number>('unread_messages').then((n) => n ?? 0)

/**
 * New messages for the signed-in user while a screen is open: [onMessage] for each one (theirs and the
 * user's own from another device), and [onReconnect] after a drop, so the screen can reload.
 */
export function useDirectMessages(onMessage: (m: DirectMessage) => void, onReconnect?: () => void, enabled = true) {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const handler = useRef(onMessage)
  const again = useRef(onReconnect)
  useEffect(() => { handler.current = onMessage; again.current = onReconnect })
  useEffect(() => {
    if (!userId || !enabled) return
    let joined = false
    return watchDm(
      userId,
      accessToken,
      (event, payload) => { if (event === 'message' && payload && typeof payload === 'object') handler.current(payload as DirectMessage) },
      () => { if (joined) again.current?.(); joined = true },
      () => {},
    )
  }, [userId, enabled])
}

// ---- Trade reputation ----

export const rateTrade = (tradeId: string, positive: boolean) => call<void>('rate_trade', { p_trade: tradeId, p_positive: positive })
export const tradeReputation = (userId: string) => call<Reputation | null>('trade_reputation', { p_user: userId })
/** The user's own ratings of their recent trades: trade id → thumbs up. */
export const myTradeRatings = () => call<Record<string, boolean>>('my_trade_ratings').then((r) => r ?? {})

// ---- Activity ----

/** Friends' activity, newest first: [limit] items before [before] (ms; null: now). */
export const activityFeed = (before: number | null = null, limit = 30) =>
  call<ActivityItem[]>('activity_feed', { p_before: before, p_limit: limit }).then((l) => l ?? [])

/** Tells friends' feeds the user marked these cards for trade. Failing only costs the feed entry. */
export const noteForTrade = (cards: { name: string; imageUrl?: string | null }[]) =>
  cards.length === 0 ? Promise.resolve() : call<void>('note_for_trade', { p_cards: cards.slice(0, 50) }).catch(() => {})

// ---- Cards for trade ----

/** What [owner] has marked for trade (a friend, or the user); null when they can't be seen. */
export const forTradeList = (owner: string) => call<ForTradeCard[] | null>('for_trade_list', { p_owner: owner })
export const tradeMatches = () => call<TradeMatch[]>('trade_matches').then((l) => l ?? [])

/** A friend's for-trade card as a trade line: one copy, out of the binder it's in. */
export const forTradeAsTrade = (c: ForTradeCard): TradeCard => ({
  scryfallId: c.scryfall_id,
  name: c.name,
  imageUrl: c.image_url ?? null,
  foil: c.quantity <= 0,
  quantity: 1,
  collectionId: c.item_id,
  ...(c.condition ? { condition: c.condition } : {}),
})

/** A match line as a plain trade line (without the forTrade mark the server adds). */
export const matchAsTrade = ({ forTrade: _mark, ...card }: MatchCard): TradeCard => {
  void _mark
  return card
}

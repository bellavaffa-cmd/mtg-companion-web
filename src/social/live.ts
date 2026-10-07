// Live social updates. The server pings both people's private "dm:<user id>" channel whenever a
// trade, friend request, loan, game night answer or household changes (event 'social', payload
// {what, id}: MtgCompanionApp/supabase/migrations/20261007000000_live_social_updates.sql), and the
// app reloads just that area — debounced, so a burst of pings is one reload. The Android app's twin
// is data/social/SocialLive.kt.

import type { FriendLink, Inbox, Overview, Trade, TradeStatus } from './api'
import { awaitingMyUpdate } from './tradeLogic'

export type SocialArea = 'trades' | 'friends' | 'loans' | 'nights' | 'household'

export const SOCIAL_AREAS: readonly SocialArea[] = ['trades', 'friends', 'loans', 'nights', 'household']

/** Pings that arrive together become one reload. */
export const DEBOUNCE_MS = 300
/** The fallback poll while the page is in view. */
export const POLL_MS = 60_000

/** Whether the area is part of social_overview (trades, friends), so a ping reloads it. */
export const inOverview = (area: SocialArea) => area === 'trades' || area === 'friends'

const BY_WHAT: Record<string, SocialArea> = { trade: 'trades', friends: 'friends', loan: 'loans', night: 'nights', household: 'household' }

/** The area a live event on the dm channel is about, or null for one that isn't a social change. */
export function socialAreaFor(event: string, payload: unknown): SocialArea | null {
  if (event === 'social') {
    const what = payload && typeof payload === 'object' ? (payload as { what?: unknown }).what : undefined
    return typeof what === 'string' ? BY_WHAT[what] ?? null : null
  }
  // Game nights already announce changes on the same channel (game_nights_chat.sql's night_changed).
  if (event === 'game_night') return 'nights'
  return null
}

/** Something a scheduler scheduled, which can be called off. */
export type Cancel = () => void
export type Scheduler = (delayMs: number, run: () => void) => Cancel

export const timerScheduler: Scheduler = (ms, run) => {
  const id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

/**
 * Gathers areas as pings arrive and hands them to [fire] together, [windowMs] after the first: a
 * burst (both sides of a trade, a night's answers) becomes one reload per area.
 */
export function socialDebounce(windowMs: number, fire: (areas: Set<SocialArea>) => void, schedule: Scheduler = timerScheduler) {
  let pending = new Set<SocialArea>()
  let scheduled: Cancel | null = null
  const flush = () => {
    const areas = pending
    pending = new Set()
    scheduled = null
    if (areas.size) fire(areas)
  }
  return {
    add(area: SocialArea) {
      pending.add(area)
      if (!scheduled) scheduled = schedule(windowMs, flush)
    },
    /** Drops what was waiting (signing out). */
    cancel() {
      pending = new Set()
      scheduled?.()
      scheduled = null
    },
  }
}

// ---- The user's own changes, shown at once (the server's answer replaces them on the reload) ----

const byNewest = (a: Trade, b: Trade) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)

/** [tradeId] with its new [status] (cancel, accept, decline, countered), moved to the top as just changed. */
export function withTradeStatus(o: Overview, tradeId: string, status: TradeStatus, now = new Date().toISOString()): Overview {
  return { ...o, trades: o.trades.map((t) => (t.id === tradeId ? { ...t, status, updated_at: now } : t)).sort(byNewest) }
}

/** The user's side of [tradeId] marked as done (Update my binders). */
export function withTradeApplied(o: Overview, tradeId: string, me: string): Overview {
  return {
    ...o,
    trades: o.trades.map((t) => {
      if (t.id !== tradeId) return t
      if (t.from_user === me) return { ...t, from_applied: true }
      if (t.to_user === me) return { ...t, to_applied: true }
      return t
    }),
  }
}

/** [userId]'s request accepted: now a friend. */
export function withFriendAccepted(o: Overview, userId: string): Overview {
  return { ...o, friends: o.friends.map((f): FriendLink => (f.user_id === userId ? { ...f, status: 'accepted' } : f)) }
}

/** [userId] gone from the user's friends and requests (declined, cancelled, removed, blocked). */
export function withoutFriend(o: Overview, userId: string): Overview {
  return { ...o, friends: o.friends.filter((f) => f.user_id !== userId) }
}

/** The badge's counts, from an overview: requests waiting and trades waiting on the user. */
export function inboxOf(o: Overview, me: string): Inbox {
  return {
    friend_requests: o.friends.filter((f) => f.incoming && f.status === 'pending').length,
    trades: o.trades.filter((t) => (t.to_user === me && t.status === 'open') || awaitingMyUpdate(t, me)).length,
  }
}

/** A trade opened in full stays open while its status stays the same (TradesPage's TradeInboxList). */
export const openKey = (t: Trade) => `${t.id}:${t.status}`

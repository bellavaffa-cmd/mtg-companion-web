// The friends' Activity feed, what it may show of the user, and comments on shared decks: calls to
// the server functions in MtgCompanionApp/supabase/migrations/20261006080000_activity_comments.sql.
// The Android app's twin is data/social/ActivityComments.kt.
//
// Until that migration is applied the functions aren't there: activityCommentsAvailable() says so,
// the Activity tab keeps reading activity_feed (more.ts), and comments and the Privacy switches stay
// hidden.
//
// Completed goals (20261008110000_goal_activity.sql) are the same: until goal_activity_version
// answers, the feed has none, the "Share completed goals" switch is hidden and noting a completion
// does nothing — every call about them fails silently.

import { useEffect, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { call, SocialError } from './api'
import * as more from './more'
import { mergeFeeds, parsePrefs, type ActivityPrefs, type DeckComment, type DeckComments, type FeedItem, type SellingCard } from './activityLogic'
import type { GoalActivity } from '../collection/collectionGoals'

let probe: Promise<boolean> | null = null

/** Whether the server has these functions. Asked once per page load (again after a failed ask). */
export function activityCommentsAvailable(): Promise<boolean> {
  if (!probe) {
    probe = call<number>('activity_comments_version')
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
export function useActivityComments(): boolean | null {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [state, setState] = useState<{ user: string | null; ok: boolean } | null>(null)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void activityCommentsAvailable().then((ok) => { if (!cancelled) setState({ user: userId, ok }) })
    return () => { cancelled = true }
  }, [userId])
  if (!userId) return false
  return state && state.user === userId ? state.ok : null
}

let goalProbe: Promise<boolean> | null = null

/** Whether the server has the completed-goals functions. Asked once per page load (again after a failed ask). Never fails. */
export function goalActivityAvailable(): Promise<boolean> {
  if (!goalProbe) {
    goalProbe = call<number>('goal_activity_version')
      .then((v) => typeof v === 'number' && v >= 1)
      .catch((e: unknown) => {
        if (!(e instanceof SocialError && e.code === 'unavailable')) goalProbe = null // offline or signed out: ask again next time
        return false
      })
  }
  return goalProbe
}

/** The same, for a screen: null while asking. False when signed out. */
export function useGoalActivity(): boolean | null {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [state, setState] = useState<{ user: string | null; ok: boolean } | null>(null)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void goalActivityAvailable().then((ok) => { if (!cancelled) setState({ user: userId, ok }) })
    return () => { cancelled = true }
  }, [userId])
  if (!userId) return false
  return state && state.user === userId ? state.ok : null
}

// ---- The feed ----

/**
 * Friends' activity, newest first: [limit] items before [before] (ms; null: now). From
 * friends_activity, or the older activity_feed when the server doesn't have it yet — with friends'
 * completed goals (friends_goal_activity) merged in once the server has them.
 */
export async function feed(before: number | null = null, limit = 30): Promise<FeedItem[]> {
  const main = (await activityCommentsAvailable())
    ? await call<FeedItem[]>('friends_activity', { p_before: before, p_limit: limit }).then((l) => l ?? [])
    : await (more.activityFeed(before, limit) as Promise<FeedItem[]>)
  return mergeFeeds(main, await goalFeed(before, limit), limit)
}

/** Friends' completed goals, for feed(); none while the server doesn't have them, or when they can't be read. */
async function goalFeed(before: number | null, limit: number): Promise<FeedItem[]> {
  if (!(await goalActivityAvailable())) return []
  try {
    const list = await call<FeedItem[]>('friends_goal_activity', { p_before: before, p_limit: limit })
    return (list ?? []).filter((i) => i.actor)
  } catch {
    return []
  }
}

/**
 * Tells friends' Activity the user completed a goal (the server notes each goal once, and only while
 * "Share completed goals" is on). Fails silently: a server without it, offline, signed out.
 */
export async function postGoalCompleted(g: GoalActivity): Promise<void> {
  try {
    if (!(await goalActivityAvailable())) return
    await call<boolean>('post_goal_completed', { p_goal_id: g.goalId, p_name: g.name, p_kind: g.kind, p_cards: g.cards, p_cover: g.cover })
  } catch {
    // Not there yet, offline or signed out: the goal just isn't announced.
  }
}

/** "Share completed goals": on unless turned off (and on until the server has it). */
export async function goalActivityPref(): Promise<boolean> {
  if (!(await goalActivityAvailable())) return true
  return call<boolean>('goal_activity_pref').then((v) => v !== false).catch(() => true)
}

export const setGoalActivityPref = (on: boolean) => call<void>('set_goal_activity_pref', { p_on: on })

// ---- What friends' Activity shows of the user ----

export const activityPrefs = () => call<unknown>('activity_prefs').then(parsePrefs)
export const setActivityPrefs = (p: ActivityPrefs) =>
  call<void>('set_activity_prefs', { p_decks: p.decks, p_for_trade: p.for_trade, p_selling: p.selling, p_leagues: p.leagues })

/** [owner]'s To sell list, their cards on the user's wishlists first; null when it can't be seen. */
export const sellingList = (owner: string) => call<SellingCard[] | null>('selling_list', { p_owner: owner })

// ---- Comments on shared decks ----

/** The comments on [owner]'s deck [deckId]; null when the user can't see the deck. */
export const deckComments = (owner: string, deckId: string) => call<DeckComments | null>('deck_comments', { p_owner: owner, p_deck: deckId })

export const postComment = (owner: string, deckId: string, body: string, parent: string | null, card: { name: string; imageUrl?: string | null } | null) =>
  call<DeckComment>('post_deck_comment', {
    p_owner: owner, p_deck: deckId, p_body: body.trim(), p_parent: parent, p_card_name: card?.name ?? null, p_card_image: card?.imageUrl ?? null,
  })

export const deleteComment = (id: string) => call<void>('delete_deck_comment', { p_comment: id })
export const hideComment = (id: string, hidden: boolean) => call<void>('hide_deck_comment', { p_comment: id, p_hidden: hidden })
/** How many comments each of the user's decks has: deck id → count. */
export const myDeckCommentCounts = () => call<Record<string, number>>('my_deck_comment_counts').then((r) => r ?? {})

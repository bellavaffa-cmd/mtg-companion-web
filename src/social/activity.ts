// The friends' Activity feed, what it may show of the user, and comments on shared decks: calls to
// the server functions in MtgCompanionApp/supabase/migrations/20261006080000_activity_comments.sql.
// The Android app's twin is data/social/ActivityComments.kt.
//
// Until that migration is applied the functions aren't there: activityCommentsAvailable() says so,
// the Activity tab keeps reading activity_feed (more.ts), and comments and the Privacy switches stay
// hidden.

import { useEffect, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { call, SocialError } from './api'
import * as more from './more'
import { parsePrefs, type ActivityPrefs, type DeckComment, type DeckComments, type FeedItem, type SellingCard } from './activityLogic'

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

// ---- The feed ----

/**
 * Friends' activity, newest first: [limit] items before [before] (ms; null: now). From
 * friends_activity, or the older activity_feed when the server doesn't have it yet.
 */
export async function feed(before: number | null = null, limit = 30): Promise<FeedItem[]> {
  if (await activityCommentsAvailable()) {
    return call<FeedItem[]>('friends_activity', { p_before: before, p_limit: limit }).then((l) => l ?? [])
  }
  return more.activityFeed(before, limit) as Promise<FeedItem[]>
}

// ---- What friends' Activity shows of the user ----

export const activityPrefs = () => call<unknown>('activity_prefs').then(parsePrefs)
export const setActivityPrefs = (p: ActivityPrefs) =>
  call<void>('set_activity_prefs', { p_decks: p.decks, p_for_trade: p.for_trade, p_selling: p.selling, p_leagues: p.leagues })

/** Tells friends' feeds the user's To sell list changed (when they show it). Failing costs only that. */
export const noteSelling = () => {
  void activityCommentsAvailable().then((ok) => (ok ? call<void>('note_selling') : undefined)).catch(() => {})
}

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

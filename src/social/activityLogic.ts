// The rules behind the friends' Activity feed (friends_activity, and friends_goal_activity for
// completed collection goals), what it may show of the user (Settings › Privacy) and comments on
// shared decks — kept apart from the screens so they can be tested. Server side:
// MtgCompanionApp/supabase/migrations/20261006080000_activity_comments.sql and 20261008110000_goal_activity.sql.
// The Android app's twin is data/social/ActivityCommentsLogic.kt, case for case
// (tests/social/activity.test.ts ↔ ActivityCommentsLogicTest.kt).

import type { Collection } from '../types/models'
import type { TradeCard } from './api'
import type { ForTradeCard } from './more'
import { namesLine } from './moreLogic'

// ---- What friends' Activity shows of the user ----

/** What friends' Activity may show of the user. */
export interface ActivityPrefs {
  decks: boolean
  for_trade: boolean
  selling: boolean
  leagues: boolean
}

/**
 * On unless turned off — decks, cards for trade, league results — since they only announce what's
 * already shared with friends or a pod. Selling is off unless turned on: a To sell list is about money
 * and isn't shared anywhere else.
 */
export const DEFAULT_ACTIVITY_PREFS: ActivityPrefs = { decks: true, for_trade: true, selling: false, leagues: true }

/** Settings › Privacy's switches, in order. */
export const ACTIVITY_PREF_ROWS: { key: keyof ActivityPrefs; title: string; detail: string }[] = [
  { key: 'decks', title: 'New and changed decks', detail: 'When you share a deck, or change one you share.' },
  { key: 'for_trade', title: 'Cards for trade', detail: 'When you mark cards for trade — friends who want them see it.' },
  { key: 'selling', title: 'Your To sell list', detail: "That you're selling cards, and how many. Off unless you turn it on." },
  { key: 'leagues', title: 'League results', detail: 'Your name in pod league news: who leads, who won.' },
]

/**
 * The switch for completed goals, after ACTIVITY_PREF_ROWS — once the server has it
 * (goal_activity_version). On unless turned off; saved apart (set_goal_activity_pref).
 */
export const GOAL_PREF_ROW = { key: 'goals' as const, title: 'Share completed goals', detail: 'When you complete a collection goal: its name and how many cards.' }

export const ACTIVITY_PRIVACY_NOTE = "Only friends see your activity, never anyone you've blocked. These change only what shows in friends' Activity: what you share stays shared."

/** The server's answer with anything missing at its default. */
export function parsePrefs(raw: unknown): ActivityPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (k: keyof ActivityPrefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_ACTIVITY_PREFS[k])
  return { decks: pick('decks'), for_trade: pick('for_trade'), selling: pick('selling'), leagues: pick('leagues') }
}

// ---- The feed ----

export interface FeedActor { user_id: string; username: string; display_name: string; avatar_path?: string | null }

/** One item of friends_activity (or the older activity_feed, whose items are a subset). */
export interface FeedItem {
  kind: string
  /** Absent for league news. */
  actor?: FeedActor | null
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
  /** shared: a deck made in the 14 days before it was shared. */
  new_deck?: boolean
  /** for_trade, selling: the cards on the user's wishlists (selling: up to 6 of them). */
  wanted?: string[]
  wanted_count?: number
  /** league */
  season_id?: string
  ended?: boolean
  champion?: string | null
  champion_ids?: string[]
  /** league: pod members whose names its news leaves out (turned off, or blocked). */
  quiet?: string[]
  starts_on?: string
  ends_on?: string | null
  max_nights?: number | null
  /** comment: the deck's owner. */
  item_owner?: string
  comment_id?: string
  body?: string
  card_name?: string | null
  reply?: boolean
  on_mine?: boolean
  /** goal_completed: the goal's kind (SET, PLAYSET, DECK, CUSTOM); [item_id] is the goal's id, [count] its cards. */
  goal_kind?: string
}

/**
 * One page of the feed from friends_activity and friends_goal_activity, read with the same
 * before/limit: both newest first, together, the newest [limit]. The next page starts before the last
 * one kept, so what's cut here comes on it.
 */
export function mergeFeeds(main: FeedItem[], goals: FeedItem[], limit: number): FeedItem[] {
  if (goals.length === 0) return main
  return [...main, ...goals].map((x, i) => ({ x, i })).sort((a, b) => b.x.at - a.x.at || a.i - b.i).slice(0, limit).map((e) => e.x)
}

/** "Set goal", "Playset goal"…: a completed goal's kind, under it in the feed. */
export function goalKindWords(kind: string | null | undefined): string {
  return kind === 'SET' ? 'Set goal' : kind === 'PLAYSET' ? 'Playset goal' : kind === 'DECK' ? 'Deck goal' : 'Card list goal'
}

/** What a tap on an item's action does. */
export type FeedActionKind = 'comments' | 'ask' | 'selling'

/** A piece of an item's sentence; [bold] for names. */
export interface FeedPart { text: string; bold?: boolean }

export interface FeedLine {
  parts: FeedPart[]
  /** The grey line under it (the time goes after it). */
  sub: string | null
  action: { label: string; kind: FeedActionKind } | null
}

/** A season's table as far as the feed needs it: ranked rows, and game nights played. */
export interface LeagueSnapshot {
  standings: { userId: string | null; name: string; points: number; rank: number }[]
  nights: number
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * What league news says: "Priya leads Season 2 by 3 points", "Season 2 champion: Priya". Nobody is
 * named who turned league results off (or is blocked): the news then says only that there's news.
 * [table]: the running season's table, worked out from the pod's games (null while loading).
 */
export function leagueText(item: FeedItem, table: LeagueSnapshot | null): { text: string; sub: string | null } {
  const season = item.name?.trim() || 'The season'
  const quiet = new Set(item.quiet ?? [])
  if (item.ended) {
    const champion = item.champion?.trim()
    if (!champion || (item.champion_ids ?? []).some((id) => quiet.has(id))) return { text: `${season} is over`, sub: null }
    return { text: `${season} ${champion.includes(' & ') ? 'champions' : 'champion'}: ${champion}`, sub: null }
  }
  const left = item.max_nights && table ? item.max_nights - table.nights : null
  const sub = left && left > 0 ? `${plural(left, 'game night')} left` : null
  if (!table) return { text: `New results in ${season}`, sub: null }
  const top = table.standings.filter((s) => s.rank === 1)
  if (top.length === 0) return { text: `${season} has started`, sub }
  if (top.some((s) => s.userId && quiet.has(s.userId))) return { text: `New results in ${season}`, sub }
  if (top.length === 2) return { text: `${top[0].name} and ${top[1].name} share the lead in ${season}`, sub }
  if (top.length > 2) return { text: `${top.length} players share the lead in ${season}`, sub }
  const next = table.standings.find((s) => s.rank > 1)
  const gap = next ? top[0].points - next.points : 0
  return { text: gap > 0 ? `${top[0].name} leads ${season} by ${plural(gap, 'point')}` : `${top[0].name} leads ${season}`, sub }
}

/** What an item says, its grey line and its action. [table]: for running league news (see leagueText). */
export function feedLine(item: FeedItem, table: LeagueSnapshot | null = null): FeedLine {
  const who: FeedPart = { text: item.actor?.display_name ?? 'Someone', bold: true }
  const name = item.name?.trim() || null
  const look = { label: 'Look and comment', kind: 'comments' as const }
  switch (item.kind) {
    case 'shared': {
      if (!item.item_id) return { parts: [who, { text: item.item_kind === 'deck' ? ' shared all their decks' : ' shared their collection' }], sub: null, action: null }
      if (item.item_kind === 'deck') {
        return {
          parts: [who, { text: item.new_deck ? ' built a new deck' : ' shared a deck' }, ...(name ? [{ text: ': ' }, { text: name, bold: true }] : [])],
          sub: 'Shared with friends',
          action: look,
        }
      }
      return { parts: [who, { text: ' shared a binder' }, ...(name ? [{ text: ': ' }, { text: name, bold: true }] : [])], sub: null, action: null }
    }
    case 'deck_updated':
      return { parts: [who, { text: ' updated a deck' }, ...(name ? [{ text: ': ' }, { text: name, bold: true }] : [])], sub: null, action: look }
    case 'pod_game':
      return {
        parts: [who, ...(item.pod_name ? [{ text: ' recorded a game in ' }, { text: item.pod_name, bold: true }] : [{ text: ' recorded a game' }])],
        sub: [item.winner ? `${item.winner} won` : 'No winner', item.players ? `${item.players} players` : null].filter(Boolean).join(' · '),
        action: null,
      }
    case 'for_trade': {
      const wanted = item.wanted ?? []
      if (wanted.length > 0) {
        return {
          parts: [who, { text: ' added ' }, { text: namesLine(wanted, wanted.length), bold: true }, { text: ' to their trade binder' }],
          sub: wanted.length === 1 ? "It's on your wishlist" : "They're on your wishlist",
          action: { label: `Ask ${who.text} for ${wanted.length === 1 ? 'it' : 'them'}`, kind: 'ask' },
        }
      }
      const n = item.count ?? item.cards?.length ?? 0
      return { parts: [who, { text: ` marked ${plural(n, 'card')} for trade` }], sub: namesLine((item.cards ?? []).map((c) => c.name), n) || null, action: null }
    }
    case 'selling': {
      const n = item.count ?? 0
      const w = item.wanted_count ?? item.wanted?.length ?? 0
      return {
        parts: [who, { text: ` is selling ${plural(n, 'card')}` }],
        sub: w > 0 ? (w === 1 ? '1 is on your wishlist' : `${w} are on your wishlist`) : null,
        action: { label: 'See them', kind: 'selling' },
      }
    }
    case 'league': {
      const { text, sub } = leagueText(item, table)
      return { parts: [{ text: item.pod_name ?? 'Your pod', bold: true }, { text: `: ${text}` }], sub, action: null }
    }
    case 'comment': {
      const deck = { text: name ?? 'a deck', bold: true }
      const parts: FeedPart[] = !item.on_mine
        ? [who, { text: ' replied to your comment on ' }, deck]
        : item.reply
          ? [who, { text: ' replied on ' }, deck]
          : item.card_name
            ? [who, { text: ' commented on ' }, { text: item.card_name, bold: true }, { text: ' in ' }, deck]
            : [who, { text: ' commented on ' }, deck]
      return { parts, sub: item.body ? `“${cut(item.body, 80)}”` : null, action: { label: 'Reply', kind: 'comments' } }
    }
    case 'goal_completed':
      return {
        parts: [who, { text: ' completed a goal' }, ...(name ? [{ text: ': ' }, { text: name, bold: true }] : [])],
        sub: [goalKindWords(item.goal_kind), ...(item.count != null ? [plural(item.count, 'card')] : [])].join(' · '),
        action: null,
      }
    default:
      return { parts: [who, { text: ' did something new' }], sub: null, action: null }
  }
}

/** [s] on one line, cut to [max] characters. */
export function cut(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** The deck an item's "Look and comment" or "Reply" opens: its owner and id; null when it has none. */
export function feedDeck(item: FeedItem): { owner: string; deckId: string } | null {
  if (item.item_kind !== 'deck' || !item.item_id) return null
  const owner = item.kind === 'comment' ? item.item_owner : item.actor?.user_id
  return owner ? { owner, deckId: item.item_id } : null
}

/** Where a shared deck's comments open. */
export const commentsPath = (owner: string, deckId: string) => `/shared/${owner}/deck/${encodeURIComponent(deckId)}?tab=comments`

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** "Ask Priya for it": one copy of each wanted card she has marked for trade, as trade lines. */
export function askCards(forTrade: ForTradeCard[], names: string[]): TradeCard[] {
  const out: TradeCard[] = []
  for (const name of names) {
    const c = forTrade.find((x) => same(x.name, name))
    if (!c || out.some((o) => same(o.name, c.name))) continue
    out.push({
      scryfallId: c.scryfall_id, name: c.name, imageUrl: c.image_url ?? null, foil: c.quantity <= 0, quantity: 1, collectionId: c.item_id,
      ...(c.condition ? { condition: c.condition } : {}),
    })
  }
  return out
}

/** One card on a friend's To sell list, as selling_list answers it. */
export interface SellingCard {
  item_id: string
  item_name?: string | null
  scryfall_id: string
  name: string
  image_url?: string | null
  for_sale: number
  quantity: number
  foil_quantity: number
  condition?: string | null
  /** On the user's wishlists. */
  wanted: boolean
}

/** "Ask Jo for them" from their To sell list: one copy of each card on the user's wishlists. */
export function sellingAsk(list: SellingCard[]): TradeCard[] {
  const out: TradeCard[] = []
  for (const c of list) {
    if (!c.wanted || out.some((o) => same(o.name, c.name))) continue
    out.push({
      scryfallId: c.scryfall_id, name: c.name, imageUrl: c.image_url ?? null, foil: c.quantity <= 0, quantity: 1, collectionId: c.item_id,
      ...(c.condition ? { condition: c.condition } : {}),
    })
  }
  return out
}

// ---- Comments on shared decks ----

export const COMMENT_MAX = 1000

export interface DeckComment {
  id: string
  /** The comment it replies to; null for a top-level one. */
  parent: string | null
  author: FeedActor
  body: string
  card_name: string | null
  card_image: string | null
  hidden: boolean
  /** ms */
  created_at: number
  mine: boolean
}

export interface CommentThread { comment: DeckComment; replies: DeckComment[] }

/** What deck_comments answers. */
export interface DeckComments {
  is_owner: boolean
  can_comment: boolean
  comments: DeckComment[]
}

/**
 * Comments as threads, oldest first: each top-level comment with its replies (oldest first). Replies
 * go one level deep; a reply whose comment isn't there (deleted, hidden) is left out.
 */
export function threadComments(list: DeckComment[]): CommentThread[] {
  const byTime = [...list].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
  const threads = byTime.filter((c) => !c.parent).map((comment) => ({ comment, replies: [] as DeckComment[] }))
  const byId = new Map(threads.map((t) => [t.comment.id, t]))
  for (const c of byTime) if (c.parent) byId.get(c.parent)?.replies.push(c)
  return threads
}

/** How many comments the threads show: the "Comments · 3" count. */
export const commentCount = (threads: CommentThread[]) => threads.reduce((n, t) => n + 1 + t.replies.length, 0)

export const commentsTabLabel = (n: number) => (n > 0 ? `Comments · ${n}` : 'Comments')

/** Whether [card] is one of the deck's cards (commanders included). */
export const inDeck = (deckCards: string[], card: string) => deckCards.some((n) => same(n, card))

/** "Priya · on Gray Merchant of Asphodel", "Sam · owner", "You · on the deck". */
export function commentHeader(c: DeckComment, me: string | null, owner: string, deckCards: string[]): string {
  const parts = [c.author.user_id === me ? 'You' : c.author.display_name]
  if (c.author.user_id === owner && c.author.user_id !== me) parts.push('owner')
  if (!c.parent) {
    if (!c.card_name) parts.push('on the deck')
    else if (inDeck(deckCards, c.card_name)) parts.push(`on ${c.card_name}`)
    else parts.push(`on the deck · suggests ${c.card_name}`)
  }
  if (c.hidden) parts.push('hidden')
  return parts.join(' · ')
}

export interface CommentActions {
  reply: boolean
  /** "Consider a swap": the owner opens the deck's Considering; anyone else replies about it. */
  swap: boolean
  /** "Offer it in a trade": a card suggested for the deck that the user has. */
  offer: boolean
  remove: boolean
  hide: boolean
  report: boolean
}

/**
 * What the user may do with [c]: reply (top-level comments, when they may comment), consider a swap
 * (a comment on one of the deck's cards), offer the card in a trade (a card suggested for the deck
 * that the user — not the owner — has), delete (their own, or anything on their deck), hide (the
 * owner, others' comments) and report (others' comments).
 */
export function commentActions(c: DeckComment, o: { me: string | null; owner: string; canComment: boolean; deckCards: string[]; haveCard: boolean }): CommentActions {
  const isOwner = o.me === o.owner
  const mine = c.author.user_id === o.me
  const onDeckCard = !!c.card_name && inDeck(o.deckCards, c.card_name)
  return {
    reply: !c.parent && o.canComment,
    swap: !c.parent && onDeckCard && o.canComment,
    offer: !!c.card_name && !onDeckCard && !isOwner && o.canComment && o.haveCard,
    remove: !!o.me && (mine || isOwner),
    hide: isOwner && !mine,
    report: !!o.me && !mine,
  }
}

/** What a reply starts with when someone other than the owner taps "Consider a swap". */
export const swapReply = (card: string) => `Instead of ${card}: `

export function composerPlaceholder(ownerName: string, isOwner: boolean, replyTo: string | null): string {
  if (replyTo) return `Reply to ${replyTo}`
  return isOwner ? 'Comment on your deck' : `Comment on ${ownerName}'s deck`
}

/** The line under the comments. */
export function commentsNote(ownerName: string, isOwner: boolean): string {
  return isOwner
    ? 'Only friends you share the deck with can comment. You can hide or delete comments.'
    : `Only friends ${ownerName} shares the deck with can comment. ${ownerName} can hide or delete comments.`
}

/**
 * "Offer it in a trade": one copy of [card] from the user's binders — a copy marked for trade first,
 * then the binder with the most. Null when they have none.
 */
export function offerCard(collections: Collection[], card: string): TradeCard | null {
  let best: { c: Collection; e: Collection['entries'][number]; score: number } | null = null
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      if (!same(e.name, card)) continue
      const copies = Math.max(0, e.quantity) + Math.max(0, e.foilQuantity)
      if (copies <= 0) continue
      const score = ((e.forTrade ?? 0) > 0 ? 10000 : 0) + copies
      if (!best || score > best.score) best = { c, e, score }
    }
  }
  if (!best) return null
  const { c, e } = best
  return {
    scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl ?? null, foil: e.quantity <= 0, quantity: 1, collectionId: c.id,
    ...(e.condition ? { condition: e.condition } : {}),
  }
}

/** The report for a comment goes through report_user as the deck, with this id. */
export const commentReportId = (commentId: string) => `comment:${commentId}`

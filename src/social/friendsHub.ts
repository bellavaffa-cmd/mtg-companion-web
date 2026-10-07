/*
 * The Friends tab, now a tab of the bottom bar: its badge, the trade inbox (Your turn, Waiting on
 * them, Done, and What friends want from you), the one line of context under each friend on People,
 * and each pod's line with its running league season.
 *
 * Pure, so it can be tested. Mirrors the Android app's data/social/FriendsHub.kt rule for rule, with
 * the same tests (tests/social/friendsHub.test.ts ↔ FriendsHubTest.kt).
 */

import type { Loan } from '../types/models'
import { isOpen, stillOut } from '../collection/storagePlaces'
import type { Trade, TradeCard } from './api'
import type { TradeMatch } from './more'
import { canRate } from './moreLogic'
import { unitPrice, type PriceBook } from './tradeFairness'
import { awaitingMyUpdate, tradeSides } from './tradeLogic'

// ---- The badge on the bar ----

/** The Friends tab's badge: unread messages, trades waiting on the user and friend requests. */
export const friendsBadge = (requests: number, unread: number, trades: number): number =>
  Math.max(0, requests) + Math.max(0, unread) + Math.max(0, trades)

/** "9+" past nine, so the badge stays small. */
export const badgeText = (n: number): string => (n > 9 ? '9+' : `${n}`)

// ---- The trade inbox ----

/** The user's trades, grouped: theirs to answer or finish, the other person's, and the rest. */
export interface TradeInbox { yourTurn: Trade[]; waitingOnThem: Trade[]; done: Trade[] }

/** Whether [trade] waits on the user: an answer, or updating their binders. */
const waitingOnMe = (t: Trade, me: string) => (t.status === 'open' && t.to_user === me) || awaitingMyUpdate(t, me)

/**
 * [trades] grouped for the inbox, leaving out anyone in [blocked]. Your turn: an answer or updating
 * the user's binders. Waiting on them: a request the user sent, or an accepted trade only the other
 * side still has to update. Done: everything else. Each newest first.
 */
export function tradeInbox(trades: Trade[], me: string, blocked: Set<string> = new Set()): TradeInbox {
  const shown = trades
    .filter((t) => !blocked.has(t.from_user === me ? t.to_user : t.from_user))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
  const yourTurn = shown.filter((t) => waitingOnMe(t, me))
  const waitingOnThem = shown.filter((t) => !yourTurn.includes(t) && (
    (t.status === 'open' && t.from_user === me)
    || (t.status === 'accepted' && (t.from_user === me ? !t.to_applied : !t.from_applied))
  ))
  return { yourTurn, waitingOnThem, done: shown.filter((t) => !yourTurn.includes(t) && !waitingOnThem.includes(t)) }
}

/** "Fact or Fiction ×3, Cyclonic Rift" — up to [max] cards, then "and N more"; "nothing" for none. */
export function cardNames(cards: Pick<TradeCard, 'name' | 'quantity'>[], max = 2): string {
  if (cards.length === 0) return 'nothing'
  const names = cards.map((c) => (c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name))
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

/** "Impulse for Lightning Greaves": what the user gives, for what they get. */
export function tradeSummary(trade: Trade, me: string): string {
  const { give, get } = tradeSides(trade, me)
  return `${cardNames(give)} for ${cardNames(get)}`
}

/** A finished trade's right-hand word: the user's rating, "Rate it", or how it ended. */
export function doneLabel(trade: Trade, me: string, rating: boolean | undefined | null): string {
  switch (trade.status) {
    case 'accepted':
      return rating === true ? 'Rated good' : rating === false ? 'Rated poor' : canRate(trade, me) ? 'Rate it' : 'Done'
    case 'declined': return 'Declined'
    case 'cancelled': return 'Cancelled'
    case 'countered': return 'Countered'
    default: return 'Open'
  }
}

// ---- What friends want from you ----

/** One friend's wants from the user, across all binders: how many cards, where they are, what they're worth. */
export interface WantFromYou { friend: string; cards: number; where: string | null; value: number | null; match: TradeMatch }

/**
 * The friends in [matches] who want the user's cards (their they_want), each card once by name.
 * [where]: the binders those cards are in ([binderName] by id), up to two then "+N"; [value]: their
 * prices from [prices] (null when none is known). The dearest first, then the most cards.
 */
export function friendsWantFromYou(matches: TradeMatch[], binderName: (id: string) => string | null | undefined, prices: PriceBook = new Map()): WantFromYou[] {
  const out: WantFromYou[] = []
  for (const m of matches) {
    const seen = new Set<string>()
    const cards = m.they_want.filter((c) => {
      const key = c.name.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (cards.length === 0) continue
    const binders = [...new Set(cards.map((c) => (c.collectionId ? binderName(c.collectionId) : null)).filter((n): n is string => !!n))]
    const where = binders.length === 0 ? null : binders.length <= 2 ? binders.join(', ') : `${binders.slice(0, 2).join(', ')} +${binders.length - 2}`
    const priced = cards.map((c) => unitPrice(c, prices)).filter((p): p is number => p != null)
    out.push({ friend: m.friend, cards: cards.length, where, value: priced.length ? priced.reduce((a, b) => a + b, 0) : null, match: m })
  }
  return out.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.cards - a.cards || (a.friend < b.friend ? -1 : a.friend > b.friend ? 1 : 0))
}

/** "Priya · 3 cards". */
export const wantFromYouLine = (name: string, cards: number): string => `${name} · ${cards} ${cards === 1 ? 'card' : 'cards'}`

// ---- One line of context under each friend ----

/** The quick action beside a friend: start a trade, see the loan, or open the shared shelf. */
export type FriendAction = 'trade' | 'loan' | 'home'
export const FRIEND_ACTION_LABELS: Record<FriendAction, string> = { trade: 'Trade', loan: 'Loan', home: 'Home' }

export interface FriendContext { line: string; action: FriendAction }

/**
 * What to say under a friend, the first that applies: they want the user's cards ([wants] cards,
 * [wantsValue] already written as money) — "Wants 3 of your cards · $21"; they have the user's cards
 * on loan ([lent], the names still out; [lentDue], loanDue's label) — "Has your Sol Ring · back by
 * 10 Oct"; or they share a household's shelf with the user — "Shares the shelf at home". Null: none.
 */
export function friendContext(wants: number, wantsValue: string | null, lent: string[], lentDue: string | null, sharesHome: boolean): FriendContext | null {
  if (wants > 0) {
    return { line: `Wants ${wants} of your cards${wantsValue ? ` · ${wantsValue}` : ''}`, action: 'trade' }
  }
  if (lent.length > 0) {
    const what = lent.length === 1 ? `Has your ${lent[0]}` : `Has ${lent.length} of your cards`
    const due = lentDue && lentDue.trim() && lentDue !== 'No date' ? lentDue.charAt(0).toLowerCase() + lentDue.slice(1) : null
    return { line: `${what}${due ? ` · ${due}` : ''}`, action: 'loan' }
  }
  if (sharesHome) return { line: 'Shares the shelf at home', action: 'home' }
  return null
}

/** The user's open loans to [friendId]: the names of the copies still out, one per copy. */
export const lentTo = (loans: Loan[], friendId: string): string[] =>
  loans.filter((l) => l.friendId === friendId && isOpen(l)).flatMap((l) => l.cards.flatMap((c) => Array<string>(stillOut(c)).fill(c.name)))

// ---- Pods ----

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

/** "5 people", "1 person". */
export const peopleLine = (members: number): string => `${members} ${members === 1 ? 'person' : 'people'}`

/** "5 people · Season 2 · you're 2nd", "5 people · Season 2", "3 people · no season". */
export function podLine(members: number, season: string | null, myRank: number | null): string {
  if (season == null) return `${peopleLine(members)} · no season`
  return `${peopleLine(members)} · ${season}${myRank && myRank > 0 ? ` · you're ${ordinal(myRank)}` : ''}`
}

/** The note on Play now that people, chats and trades live on the Friends tab. */
export const MOVED_TO_FRIENDS = 'People, chats and trades moved to the Friends tab.'

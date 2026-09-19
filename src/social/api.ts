// Friends, pods, sharing, life counter seats and trades: calls to the social functions in the
// Supabase project (MtgCompanionApp/supabase/migrations/20260919000000_social.sql). Every call goes
// through a server function that checks who is asking; nothing here reads a table directly.

import { accessToken, apiHeaders, OfflineError, restUrl } from '../sync/supabaseAuth'

export interface Profile {
  user_id: string
  username: string
  display_name: string
  avatar_path: string | null
}

export interface FriendLink {
  user_id: string
  status: 'pending' | 'accepted'
  /** They asked the caller (a request waiting for an answer). */
  incoming: boolean
  since: string
}

export interface Pod {
  id: string
  name: string
  owner: string
  members: string[]
}

export type ShareKind = 'deck' | 'collection'

export interface SharedSummary {
  owner: string
  kind: ShareKind
  item_id: string
  name: string | null
  cover: string | null
  cards: number
  edited_ms: number
  /** Shared as part of the owner's whole collection / all their decks. */
  whole?: boolean
  /** A binder's type (OWNED or WISHLIST); null for decks. */
  type?: string | null
}

/** One card a friend has, found by "who has a card?" or as a wishlist match. */
export interface SharedCardHit {
  owner: string
  kind: ShareKind
  item_id: string
  item_name: string
  scryfall_id: string
  name: string
  image_url: string | null
  quantity: number
  foil_quantity: number
}

export interface Share {
  kind: ShareKind
  item_id: string
  all_friends: boolean
  pod_ids: string[]
  /** Friends it's shared with one by one. */
  friend_ids?: string[]
  link_token: string | null
}

/** Every deck or binder of [kind] — a whole collection, or all decks — shared with [viewer] (null: all friends). */
export interface ShareAll {
  kind: ShareKind
  viewer: string | null
}

/** One line of a trade. [collectionId]: the giver's binder it comes out of. */
export interface TradeCard {
  scryfallId: string
  name: string
  imageUrl?: string | null
  setCode?: string
  collectorNumber?: string
  foil: boolean
  quantity: number
  collectionId?: string
}

export type TradeStatus = 'open' | 'accepted' | 'declined' | 'cancelled' | 'countered'

export interface Trade {
  id: string
  from_user: string
  to_user: string
  /** What from_user asks for, out of to_user's binders. */
  want: TradeCard[]
  /** What from_user offers, out of their own binders. */
  give: TradeCard[]
  message: string | null
  reply: string | null
  status: TradeStatus
  reply_to: string | null
  from_applied: boolean
  to_applied: boolean
  created_at: string
  updated_at: string
}

export interface Overview {
  me: Profile | null
  people: Record<string, Profile>
  friends: FriendLink[]
  pods: Pod[]
  shared_with_me: SharedSummary[]
  /** Friends sharing their whole collection ('collection') or all decks ('deck') with the user. */
  shared_all_with_me?: { owner: string; kind: ShareKind }[]
  my_shares: Share[]
  my_share_all?: ShareAll[]
  trades: Trade[]
}

export interface Inbox {
  friend_requests: number
  trades: number
}

/** Every binder a friend shares with the user, for looking through their collection as a whole. */
export interface SharedCollection {
  owner: Profile
  /** Their whole collection is shared, not just some binders. */
  whole: boolean
  binders: Record<string, unknown>[]
}

export interface SharedItem {
  owner: Profile
  kind: ShareKind
  data: Record<string, unknown>
  edited_ms: number
}

export interface MatchSeat {
  seat: number
  profile: Profile
}

/** What the server said no to, in words for the screen. */
export class SocialError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const MESSAGES: Record<string, string> = {
  not_signed_in: 'Sign in first.',
  no_profile: 'Make your profile first.',
  bad_username: 'Usernames are 3–20 letters, numbers or _.',
  bad_display_name: 'Your name needs 1–40 characters.',
  username_taken: 'That username is taken.',
  bad_avatar: "That picture couldn't be used.",
  no_such_user: 'Nobody has that username.',
  self: "That's you!",
  too_many_requests: "You've asked a lot of people already — wait for some answers first.",
  not_a_friend: 'Only friends can be added.',
  not_yours: 'Only the pod’s owner can change it.',
  too_many_members: 'A pod holds up to 50 people.',
  too_many_pods: 'You can have up to 30 pods.',
  bad_name: 'Give it a name (up to 40 characters).',
  no_such_item: 'That deck or binder has been deleted.',
  match_over: 'That table has ended. Ask for a new code.',
  bad_seat: "That seat isn't at this table.",
  seat_taken: 'Someone is already in that seat.',
  too_many_matches: 'Too many tables started — wait a little.',
  too_many_cards: 'A trade holds up to 100 different cards.',
  bad_card: 'One of the cards in this trade is not valid.',
  no_cards: 'Pick at least one card.',
  message_too_long: 'Keep the message under 500 characters.',
  too_many_trades: 'You have a lot of open trades — wait for some answers first.',
  trade_closed: 'This trade has already been answered.',
  not_seated: "You're no longer sitting at this table.",
  not_host: 'Only the table can do that.',
}

async function call<T>(fn: string, args: Record<string, unknown> = {}, { signedIn = true } = {}): Promise<T> {
  const token = await accessToken()
  if (signedIn && !token) throw new SocialError('not_signed_in', MESSAGES.not_signed_in)
  let res: Response
  try {
    res = await fetch(restUrl(`/rest/v1/rpc/${fn}`), {
      method: 'POST',
      headers: apiHeaders(token ?? undefined),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new OfflineError("You're offline — try again when you're connected.")
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string }
    const code = body.message ?? ''
    throw new SocialError(code, MESSAGES[code] ?? `Something went wrong (HTTP ${res.status}).`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

// ---- Profile ----

/** Where a profile picture is served from (public, but only people who can see the profile learn the name). */
export const avatarUrl = (path: string | null | undefined): string | null =>
  path ? restUrl(`/storage/v1/object/public/avatars/${path.split('/').map(encodeURIComponent).join('/')}`) : null

/** [avatarPath]: undefined keeps the picture, null removes it. */
export function saveProfile(username: string, displayName: string, avatarPath?: string | null): Promise<Profile> {
  return call('save_profile', { p_username: username, p_display_name: displayName, p_avatar_path: avatarPath === undefined ? null : avatarPath ?? '' })
}

export const usernameAvailable = (username: string) => call<boolean>('username_available', { p_username: username })

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
/** Photos are made this size (square, cropped to the middle) before uploading. */
const AVATAR_SIZE = 512

/**
 * Uploads a new profile picture and answers its path. A photo is cropped square and shrunk; a GIF is
 * kept as it is, so it still moves — it must be under 2 MB.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  let body: Blob
  let type: string
  let ext: string
  if (file.type === 'image/gif') {
    if (file.size > MAX_AVATAR_BYTES) throw new SocialError('too_big', 'That GIF is over 2 MB — pick a smaller one.')
    body = file
    type = 'image/gif'
    ext = 'gif'
  } else if (file.type.startsWith('image/')) {
    body = await squareImage(file)
    type = body.type
    ext = type === 'image/webp' ? 'webp' : 'jpg'
  } else {
    throw new SocialError('not_image', 'Pick a photo or a GIF.')
  }
  const token = await accessToken()
  if (!token) throw new SocialError('not_signed_in', MESSAGES.not_signed_in)
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  let res: Response
  try {
    res = await fetch(restUrl(`/storage/v1/object/avatars/${path}`), {
      method: 'POST',
      headers: { ...apiHeaders(token), 'Content-Type': type, 'cache-control': 'max-age=31536000' },
      body,
    })
  } catch {
    throw new OfflineError("You're offline — try again when you're connected.")
  }
  if (!res.ok) throw new SocialError('upload_failed', res.status === 413 ? 'That picture is too big (2 MB at most).' : `The picture didn't upload (HTTP ${res.status}).`)
  return path
}

/** Deletes an old profile picture; failing quietly just leaves an unused file behind. */
export async function deleteAvatar(path: string): Promise<void> {
  const token = await accessToken()
  if (!token) return
  await fetch(restUrl('/storage/v1/object/avatars'), {
    method: 'DELETE',
    headers: apiHeaders(token),
    body: JSON.stringify({ prefixes: [path] }),
  }).catch(() => {})
}

async function squareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new SocialError('not_image', "That picture couldn't be opened.")
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const size = Math.min(AVATAR_SIZE, side)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  // Safari can't make WebP: it hands back a PNG instead, and a JPEG is smaller.
  if (blob && blob.type === 'image/webp') return blob
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new SocialError('not_image', "That picture couldn't be used."))), 'image/jpeg', 0.85))
}

// ---- Overview ----

export const socialOverview = () => call<Overview>('social_overview')
export const socialInbox = () => call<Inbox>('social_inbox')

// ---- Friends ----

export const requestFriend = (username: string) => call<'requested' | 'accepted' | 'already'>('request_friend', { p_username: username })
export const respondFriend = (userId: string, accept: boolean) => call<void>('respond_friend', { p_user: userId, p_accept: accept })
export const removeFriend = (userId: string) => call<void>('remove_friend', { p_user: userId })

// ---- Pods ----

export const savePod = (podId: string | null, name: string, members: string[]) =>
  call<string>('save_pod', { p_pod: podId, p_name: name, p_members: members })
export const leavePod = (podId: string) => call<void>('leave_pod', { p_pod: podId })

// ---- Sharing ----

export const setShare = (kind: ShareKind, itemId: string, allFriends: boolean, podIds: string[], link: boolean) =>
  call<Share | null>('set_library_share', { p_kind: kind, p_item_id: itemId, p_all_friends: allFriends, p_pod_ids: podIds, p_link: link })
export const getSharedItem = (owner: string, kind: ShareKind, itemId: string) =>
  call<SharedItem | null>('get_shared_item', { p_owner: owner, p_kind: kind, p_item_id: itemId })
export const setItemFriendShare = (kind: ShareKind, itemId: string, friend: string, on: boolean) =>
  call<Share | null>('set_item_friend_share', { p_kind: kind, p_item_id: itemId, p_friend: friend, p_on: on })
export const setShareAll = (kind: ShareKind, viewer: string | null, on: boolean) =>
  call<void>('set_share_all', { p_kind: kind, p_viewer: viewer, p_on: on })
/** "Who has a card?": copies of cards named like [query] in friends' shared binders and decks. */
export const searchSharedCards = (query: string) => call<SharedCardHit[]>('search_shared_cards', { p_query: query })
/** Cards in friends' shared binders that are on one of the user's wishlists. */
export const wishlistMatches = () =>
  call<Omit<SharedCardHit, 'kind'>[]>('wishlist_matches').then((hits) => hits.map((h) => ({ ...h, kind: 'collection' as const })))
export const getSharedCollection = (owner: string) => call<SharedCollection | null>('get_shared_collection', { p_owner: owner })
export const getSharedByLink = (token: string) => call<SharedItem | null>('get_shared_by_link', { p_token: token }, { signedIn: false })

// ---- Life counter seats ----

export const startMatch = (seats: number) => call<{ id: string; code: string; seats: number }>('start_match', { p_seats: seats })
export const joinMatch = (code: string, seat: number) => call<{ match_id: string; seat: number; host: Profile }>('join_match', { p_code: code, p_seat: seat })
export const matchSeats = (matchId: string) => call<MatchSeat[]>('match_seats', { p_match: matchId })
export const clearMatchSeat = (matchId: string, seat: number) => call<void>('clear_match_seat', { p_match: matchId, p_seat: seat })
export const endMatch = (matchId: string) => call<void>('end_match', { p_match: matchId })
/** The table shares the game with its players' remotes (match:<id> "state"). */
export const publishMatchState = (matchId: string, state: unknown) => call<void>('publish_match_state', { p_match: matchId, p_state: state })
/** A seated player's remote asks the table to change their seat (match:<id> "action"). */
export const sendMatchAction = (matchId: string, action: object) => call<void>('send_match_action', { p_match: matchId, p_action: action })
/** Friends' shared binder copies of these exact card names (a deck's missing cards). */
export const whoHasCards = (names: string[]) => call<SharedCardHit[]>('who_has_cards', { p_names: names })

// ---- Trades ----

export const proposeTrade = (to: string, want: TradeCard[], give: TradeCard[], message: string, replyTo: string | null = null) =>
  call<string>('propose_trade', { p_to: to, p_want: want, p_give: give, p_message: message || null, p_reply_to: replyTo })
export const respondTrade = (tradeId: string, action: 'accept' | 'decline' | 'cancel', reply = '') =>
  call<void>('respond_trade', { p_trade: tradeId, p_action: action, p_reply: reply || null })
export const markTradeApplied = (tradeId: string) => call<void>('mark_trade_applied', { p_trade: tradeId })

// ---- Links (QR codes and share links open the web app at these) ----

/** The web app's own address, e.g. https://…/mtg-companion-web/ */
export const appUrl = (path: string) => `${window.location.origin}${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

export const PUBLIC_APP_URL = 'https://bellavaffa-cmd.github.io/mtg-companion-web/'
/** Links for other people (QR codes, share links) always point at the live site, even from a dev build. */
export const publicUrl = (path: string) => PUBLIC_APP_URL + path.replace(/^\//, '')

export const friendLink = (username: string) => publicUrl(`add/${encodeURIComponent(username)}`)
export const seatLink = (code: string, seat: number) => publicUrl(`join/${code}/${seat}`)
export const shareLink = (token: string) => publicUrl(`s/${token}`)

/*
 * Trade nights: trading at a game night. Each player who's Going can put up a list for the night —
 * the cards they bring to trade (from binders they pick, or their event bag) and the cards they want
 * (Wishlist, cards their decks are missing, collection goals). From everyone's lists:
 *  - Wanted here: the cards the user wants that someone is bringing;
 *  - They want from you: the cards the user brings that someone wants;
 *  - Suggested trades: per person, a fair bundle — the cards each side wants most, worth the same
 *    within the trade-fairness rule (tradeFairness.ts isFair: $2 or a tenth), only cards that are
 *    spare (marked for trade, or no deck of theirs uses them);
 *  - the Trade table: the trades made at the night, agreed ones first, to tick off once swapped.
 * The server keeps the lists (supabase/migrations/20261008100000_trade_nights.sql in the Android
 * repo); everything here is worked out on the device.
 *
 * Pure, so it can be tested. Mirrors the Android app's data/social/TradeNights.kt, with the same
 * cases (tests/social/tradeNightVectors.json ↔ app/src/test/resources/tradeNightVectors.json).
 */

import type { Profile, Trade, TradeCard, TradeStatus } from './api'
import { isFair, unitPrice, type PriceBook } from './tradeFairness'
import { GAME_NIGHT_DECK } from './friendsWant'
import { namesDecksUse } from '../collection/spares'
import { pullNeeds } from '../collection/pullList'
import { goalProgress, goalsOf, missingNames } from '../collection/collectionGoals'
import type { Collection, CollectionEntry, Deck } from '../types/models'

/** One line of a list: copies of a printing the player brings. [spare]: no deck of theirs needs it, or it's marked for trade. */
export interface NightCard {
  scryfallId: string
  name: string
  imageUrl?: string | null
  foil: boolean
  quantity: number
  collectionId?: string | null
  condition?: string | null
  spare: boolean
}

/** A card the player wants, and how much: [WANT_WISHLIST], [WANT_DECK] or [WANT_GOAL]. */
export interface NightWant { name: string; weight: number }

/** One player's list for the night. */
export interface NightList { userId: string; name: string; cards: NightCard[]; wants: NightWant[] }

/** What the cards come from: a binder, or the event bag ("Bring to game night"). */
export type NightSource = { kind: 'binder'; id: string; name: string } | { kind: 'bag'; name: string }

export const WANT_WISHLIST = 3
export const WANT_DECK = 2
export const WANT_GOAL = 1
/** A list holds up to this many lines (the server's limit). */
export const NIGHT_MAX_LINES = 500
/** The event bag source's name. */
export const BAG_SOURCE_NAME = 'Event bag'

const key = (s: string) => s.trim().toLowerCase()
/** Plain code-unit order, the same as Kotlin's String.compareTo. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// ---- Wants ----

/**
 * The user's wants: Wishlist names (weight 3), the cards their decks are missing (2), the cards their
 * collection goals are missing (1). Each name once, its highest weight and its first spelling; the
 * most wanted first, then A–Z; up to [NIGHT_MAX_LINES].
 */
export function mergeWants(wishlist: string[], decksMissing: string[], goalsMissing: string[]): NightWant[] {
  const seen = new Map<string, NightWant>()
  const groups: [string[], number][] = [[wishlist, WANT_WISHLIST], [decksMissing, WANT_DECK], [goalsMissing, WANT_GOAL]]
  for (const [names, weight] of groups) {
    for (const n of names) {
      const k = key(n)
      if (!k || seen.has(k)) continue
      seen.set(k, { name: n.trim(), weight })
    }
  }
  return [...seen.values()].sort((a, b) => b.weight - a.weight || cmp(key(a.name), key(b.name))).slice(0, NIGHT_MAX_LINES)
}

/** How much [wants] want [name]: 0 when not at all. */
export function wantWeight(wants: NightWant[], name: string): number {
  const k = key(name)
  let best = 0
  for (const w of wants) if (key(w.name) === k && w.weight > best) best = w.weight
  return best
}

// ---- Bring list ----

/** The binders picked when the user hasn't picked any: the ones called "…trade…" (not the Wishlist). */
export function defaultSources(collections: Collection[]): NightSource[] {
  return collections
    .filter((c) => c.type !== 'WISHLIST' && key(c.name).includes('trade'))
    .map((c) => ({ kind: 'binder' as const, id: c.id, name: c.name }))
}

const spareOf = (e: CollectionEntry, decksUse: Set<string>) => (e.forTrade ?? 0) > 0 || !decksUse.has(key(e.name))

/**
 * The cards the user brings from [sources]: each picked binder's copies (plain and foil apart, up to
 * 99 a line), and for the event bag one copy of each of [bagNames] (the "Bring to game night" cards)
 * from the first binder that has one — a card already brought from a binder isn't added again.
 * [decksUse]: the names the user's decks use, lower case (spares.ts namesDecksUse, without the
 * "Bring to game night" deck). Up to [NIGHT_MAX_LINES] lines.
 */
export function bringCards(collections: Collection[], sources: NightSource[], bagNames: string[], decksUse: Set<string>): NightCard[] {
  const out: NightCard[] = []
  const line = (e: CollectionEntry, binder: string, foil: boolean, quantity: number): NightCard => ({
    scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl ?? null, foil, quantity: Math.min(quantity, 99),
    collectionId: binder, condition: e.condition ?? null, spare: spareOf(e, decksUse),
  })
  const owned = collections.filter((c) => c.type !== 'WISHLIST')
  for (const s of sources) {
    if (s.kind !== 'binder') continue
    const binder = owned.find((c) => c.id === s.id)
    if (!binder) continue
    for (const e of binder.entries) {
      if (e.quantity > 0) out.push(line(e, binder.id, false, e.quantity))
      if (e.foilQuantity > 0) out.push(line(e, binder.id, true, e.foilQuantity))
    }
  }
  if (sources.some((s) => s.kind === 'bag')) {
    for (const n of bagNames) {
      const k = key(n)
      if (out.some((c) => key(c.name) === k)) continue
      for (const b of owned) {
        const e = b.entries.find((x) => key(x.name) === k && x.quantity + x.foilQuantity > 0)
        if (e) { out.push(line(e, b.id, e.quantity <= 0, 1)); break }
      }
    }
  }
  return out.slice(0, NIGHT_MAX_LINES)
}

// ---- Matching ----

/** A card the user wants that someone brings: who, with their line. */
export interface WantedHereRow { name: string; weight: number; from: { userId: string; name: string; card: NightCard }[] }

/** The cards the user wants ([myWants]) that the others bring — the most wanted first, then A–Z; each person once a card. */
export function wantedHere(myWants: NightWant[], others: NightList[]): WantedHereRow[] {
  const wants = [...myWants].sort((a, b) => b.weight - a.weight || cmp(key(a.name), key(b.name)))
  const out: WantedHereRow[] = []
  const done = new Set<string>()
  for (const w of wants) {
    const k = key(w.name)
    if (done.has(k)) continue
    done.add(k)
    const from = others.flatMap((o) => {
      const card = o.cards.find((c) => key(c.name) === k)
      return card ? [{ userId: o.userId, name: o.name, card }] : []
    })
    if (from.length > 0) out.push({ name: w.name, weight: w.weight, from })
  }
  return out
}

/** Someone who wants cards the user brings: those cards (each name once), and how much they want each. */
export interface TheyWantRow { userId: string; name: string; cards: { card: NightCard; weight: number }[] }

/** Per person, the cards in the user's list ([myCards]) they want — the most wanted first; the people wanting most first. */
export function theyWantFromYou(myCards: NightCard[], others: NightList[]): TheyWantRow[] {
  const out: TheyWantRow[] = []
  for (const o of others) {
    const seen = new Set<string>()
    const cards: { card: NightCard; weight: number }[] = []
    for (const c of myCards) {
      const k = key(c.name)
      if (seen.has(k)) continue
      const weight = wantWeight(o.wants, c.name)
      if (weight <= 0) continue
      seen.add(k)
      cards.push({ card: c, weight })
    }
    cards.sort((a, b) => b.weight - a.weight || cmp(key(a.card.name), key(b.card.name)))
    if (cards.length > 0) out.push({ userId: o.userId, name: o.name, cards })
  }
  return out.sort((a, b) => b.cards.length - a.cards.length || cmp(key(a.name), key(b.name)) || cmp(a.userId, b.userId))
}

// ---- Suggested trades ----

/** A fair bundle with one person: what the user gets and gives (one copy each), and what each side is worth (US dollars). */
export interface NightSuggestion { userId: string; name: string; get: TradeCard[]; give: TradeCard[]; getValue: number; giveValue: number }

/** Up to this many cards a side to start from. */
const MAX_SIDE = 10

interface Candidate { card: NightCard; weight: number; price: number }

/** A list's line as a trade line: one copy, out of the binder it's in. */
export function nightAsTrade(c: NightCard): TradeCard {
  return {
    scryfallId: c.scryfallId, name: c.name, foil: c.foil, quantity: 1,
    ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
    ...(c.collectionId ? { collectionId: c.collectionId } : {}),
    ...(c.condition ? { condition: c.condition } : {}),
  }
}

/** [cards] that are spare, priced and wanted by [wants], each name once — the most wanted, then the dearest, then A–Z. */
function candidates(cards: NightCard[], wants: NightWant[], prices: PriceBook): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const c of cards) {
    if (!c.spare) continue
    const k = key(c.name)
    if (seen.has(k)) continue
    const weight = wantWeight(wants, c.name)
    if (weight <= 0) continue
    const price = unitPrice(c, prices)
    if (price == null || price <= 0) continue
    seen.add(k)
    out.push({ card: c, weight, price })
  }
  return out.sort((a, b) => b.weight - a.weight || b.price - a.price || cmp(key(a.card.name), key(b.card.name))).slice(0, MAX_SIDE)
}

const total = (side: Candidate[]) => side.reduce((s, c) => s + c.price, 0)

/**
 * A fair trade between the user ([me]) and [them], or null when there isn't one: each side starts with
 * the spare, priced cards the other wants (up to 10, the most wanted first); then, while it isn't fair,
 * the heavier side gives up a card — the least wanted one that brings the totals closer (then the one
 * bringing them closest, then A–Z) — never its last. Null when a side has nothing, or it can't be made fair.
 */
export function suggestTrade(me: NightList, them: NightList, prices: PriceBook): NightSuggestion | null {
  const get = candidates(them.cards, me.wants, prices)
  const give = candidates(me.cards, them.wants, prices)
  if (get.length === 0 || give.length === 0) return null
  for (;;) {
    const sg = total(get)
    const sv = total(give)
    const diff = sg - sv
    if (isFair(diff, sg, sv)) {
      return { userId: them.userId, name: them.name, get: get.map((c) => nightAsTrade(c.card)), give: give.map((c) => nightAsTrade(c.card)), getValue: sg, giveValue: sv }
    }
    const heavy = diff > 0 ? get : give
    if (heavy.length <= 1) return null
    const gap = Math.abs(diff)
    let best = -1
    let bestAfter = 0
    for (let i = 0; i < heavy.length; i++) {
      const after = Math.abs(gap - heavy[i].price)
      if (after >= gap) continue
      if (best < 0) { best = i; bestAfter = after; continue }
      const b = heavy[best]
      const c = heavy[i]
      const better = c.weight !== b.weight ? c.weight < b.weight
        : after !== bestAfter ? after < bestAfter
          : cmp(key(c.card.name), key(b.card.name)) < 0
      if (better) { best = i; bestAfter = after }
    }
    if (best < 0) return null
    heavy.splice(best, 1)
  }
}

/** A fair trade with each of [others] that has one — the biggest first, then A–Z. */
export function suggestedTrades(me: NightList, others: NightList[], prices: PriceBook): NightSuggestion[] {
  return others
    .map((o) => suggestTrade(me, o, prices))
    .filter((s): s is NightSuggestion => s !== null)
    .sort((a, b) => (b.getValue + b.giveValue) - (a.getValue + a.giveValue) || cmp(key(a.name), key(b.name)))
}

/** The printings whose prices the suggestions need: spare cards either side wants. Sorted, each once. */
export function priceIdsNeeded(me: NightList, others: NightList[]): string[] {
  const ids = new Set<string>()
  for (const o of others) {
    for (const c of o.cards) if (c.spare && wantWeight(me.wants, c.name) > 0) ids.add(c.scryfallId)
    for (const c of me.cards) if (c.spare && wantWeight(o.wants, c.name) > 0) ids.add(c.scryfallId)
  }
  return [...ids].sort(cmp)
}

// ---- Trade table ----

/** agreed: accepted, the user's binders not updated yet; waiting: not answered yet; done: the user has updated their binders. */
export type TableState = 'agreed' | 'waiting' | 'done'

export interface TableRow { trade: Trade; other: string; state: TableState }

const STATE_ORDER: Record<TableState, number> = { agreed: 0, waiting: 1, done: 2 }

/** The night's trades as the Trade table lists them: agreed ones first, then waiting, then done; declined, cancelled and countered ones left out. */
export function tradeTable(trades: Trade[], me: string): TableRow[] {
  const rows: TableRow[] = []
  for (const t of trades) {
    const other = t.from_user === me ? t.to_user : t.from_user
    let state: TableState
    if (t.status === 'open') state = 'waiting'
    else if (t.status === 'accepted') state = (t.from_user === me ? t.from_applied : t.to_applied) ? 'done' : 'agreed'
    else continue
    rows.push({ trade: t, other, state })
  }
  return rows.map((r, i) => ({ r, i })).sort((a, b) => STATE_ORDER[a.r.state] - STATE_ORDER[b.r.state] || a.i - b.i).map((x) => x.r)
}

/** "3 agreed · 1 waiting" — or null when the table is empty. */
export function tableLine(rows: TableRow[]): string | null {
  if (rows.length === 0) return null
  const n = (s: TableState) => rows.filter((r) => r.state === s).length
  const parts = [n('agreed') > 0 ? `${n('agreed')} agreed` : null, n('waiting') > 0 ? `${n('waiting')} waiting` : null, n('done') > 0 ? `${n('done')} done` : null]
  return parts.filter(Boolean).join(' · ')
}

/** "3 cards you want are here" — or null when none are. */
export function wantedHereLine(rows: WantedHereRow[]): string | null {
  if (rows.length === 0) return null
  return `${rows.length} ${rows.length === 1 ? 'card you want is' : 'cards you want are'} here`
}

// ---- The user's own library ----

const isBringDeck = (d: Deck) => d.name === GAME_NIGHT_DECK

/**
 * What the user wants for the night, from their library: the Wishlist, the cards their decks need
 * that they don't own at all (the pull list's "not owned"; not archived or sample decks, not the
 * "Bring to game night" deck) and what their unfinished collection goals are missing.
 */
export function nightWantsOf(collections: Collection[], decks: Deck[]): NightWant[] {
  const wishlist = collections.filter((c) => c.type === 'WISHLIST').flatMap((c) => c.entries.map((e) => e.name))
  const owned = new Set(collections.filter((c) => c.type !== 'WISHLIST').flatMap((c) => c.entries.filter((e) => e.quantity + e.foilQuantity > 0).map((e) => key(e.name))))
  const decksMissing = decks
    .filter((d) => !d.archived && !d.sample && !isBringDeck(d))
    .flatMap((d) => pullNeeds(d).map((n) => n.name))
    .filter((n) => !owned.has(key(n)))
  const goalsMissing = goalsOf(collections).filter((g) => g.completedAt == null).flatMap((g) => missingNames(goalProgress(g, collections, decks)))
  return mergeWants(wishlist, decksMissing, goalsMissing)
}

/** The names the user's decks use, for "spare" — without the "Bring to game night" deck, whose cards are there to go. */
export const nightDecksUse = (decks: Deck[]): Set<string> => namesDecksUse(decks.filter((d) => !isBringDeck(d)))

/** The event bag's cards: the "Bring to game night" deck's (FriendsWant's Bring to game night, Trade matches tonight's Bring them). */
export function bagNamesOf(decks: Deck[]): string[] {
  const deck = decks.find((d) => isBringDeck(d) && !d.archived && !d.sample)
  return deck ? [deck.commander, deck.partnerCommander, ...deck.cards].filter((c) => !!c).map((c) => c!.name) : []
}

// ---- From the server (trade_night) ----

/** Someone's list as the server sends it. */
export interface NightListRow { user: Profile; sources: NightSource[]; cards: NightCard[]; wants: NightWant[]; updatedAt: number }

/** The trade side of a night for the user: are they Going, is it open, their list, the others' lists and the night's trades. */
export interface TradeNight { nightId: string; going: boolean; open: boolean; mine: NightListRow | null; others: NightListRow[]; trades: Trade[] }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function profileOf(v: unknown): Profile {
  const o = obj(v) ?? {}
  return { user_id: str(o.user_id) ?? '', username: str(o.username) ?? '', display_name: str(o.display_name) ?? 'Someone', avatar_path: str(o.avatar_path) }
}

export function parseNightCard(v: unknown): NightCard | null {
  const o = obj(v)
  const scryfallId = str(o?.scryfallId)
  const name = str(o?.name)
  const quantity = num(o?.quantity)
  if (!o || !scryfallId || !name || quantity == null || quantity < 1) return null
  return {
    scryfallId, name, imageUrl: str(o.imageUrl), foil: o.foil === true, quantity: Math.floor(quantity),
    collectionId: str(o.collectionId), condition: str(o.condition), spare: o.spare === true,
  }
}

function parseSource(v: unknown): NightSource | null {
  const o = obj(v)
  if (o?.kind === 'binder' && str(o.id)) return { kind: 'binder', id: str(o.id)!, name: str(o.name) ?? '' }
  if (o?.kind === 'bag') return { kind: 'bag', name: str(o.name) ?? BAG_SOURCE_NAME }
  return null
}

function parseListRow(v: unknown): NightListRow | null {
  const o = obj(v)
  if (!o) return null
  const user = profileOf(o.user)
  if (!user.user_id) return null
  return {
    user,
    sources: arr(o.sources).map(parseSource).filter((s): s is NightSource => !!s),
    cards: arr(o.cards).map(parseNightCard).filter((c): c is NightCard => !!c),
    wants: arr(o.wants).flatMap((w) => {
      const x = obj(w)
      const name = str(x?.name)
      const weight = num(x?.weight)
      return name && weight != null && weight > 0 ? [{ name, weight }] : []
    }),
    updatedAt: num(o.updatedAt) ?? 0,
  }
}

const STATUSES: TradeStatus[] = ['open', 'accepted', 'declined', 'cancelled', 'countered']

function parseTrade(v: unknown): Trade | null {
  const o = obj(v)
  const id = str(o?.id)
  if (!o || !id) return null
  const status = STATUSES.find((s) => s === o.status) ?? 'cancelled'
  return {
    id, from_user: str(o.from_user) ?? '', to_user: str(o.to_user) ?? '',
    want: arr(o.want) as TradeCard[], give: arr(o.give) as TradeCard[],
    message: str(o.message), reply: str(o.reply), status, reply_to: str(o.reply_to),
    from_applied: o.from_applied === true, to_applied: o.to_applied === true,
    created_at: str(o.created_at) ?? '', updated_at: str(o.updated_at) ?? '',
  }
}

/** trade_night's answer; null when the user isn't invited (or it isn't one). */
export function parseTradeNight(raw: unknown): TradeNight | null {
  const o = obj(raw)
  const nightId = str(o?.nightId)
  if (!o || !nightId) return null
  return {
    nightId,
    going: o.going === true,
    open: o.open === true,
    mine: parseListRow(o.mine),
    others: arr(o.others).map(parseListRow).filter((r): r is NightListRow => !!r),
    trades: arr(o.trades).map(parseTrade).filter((t): t is Trade => !!t),
  }
}

/** A list row as the matching works on it. */
export const asNightList = (r: NightListRow): NightList => ({ userId: r.user.user_id, name: r.user.display_name, cards: r.cards, wants: r.wants })

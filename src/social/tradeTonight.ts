/*
 * "Trade matches tonight" on a game night and in Pack your bag's For trades: for each player there
 * who's a friend, the cards on their shared wishlists that the user has spare (no deck of theirs
 * plays it) or marked for trade — with where each one is — and the cards the user wants that they've
 * marked for trade. All from the same two-way trade matches as the Friends page (trade_matches — no
 * new server function). A guest, or someone who isn't a friend, is listed by name so the screen can
 * say "Add Priya as a friend to see what they want".
 *
 * Pure, so it can be tested. Mirrors the Android app's data/social/TradeTonight.kt, with the same
 * tests (tests/social/tradeTonight.test.ts ↔ TradeTonightTest.kt).
 */

import { pocketLabel, sameCardName, type PlacedCard } from '../collection/storagePlaces'
import type { DeckCardEntry } from '../types/models'
import type { TradeCard } from './api'
import type { MatchCard, TradeMatch } from './more'

/** Someone at the table: their name, and their account when they're a friend (null: a guest). */
export interface TonightPlayer { name: string; userId: string | null }

/** One of the user's cards a friend wants: the line to offer, and where it is ("Trade binder · Page 4, slot 6"). */
export interface TonightCard { card: TradeCard; where: string }

/** What can change hands with one friend tonight. */
export interface TonightMatch {
  friend: string
  name: string
  /** The user's cards they want — spare or marked for trade. */
  theyWant: TonightCard[]
  /** Their cards marked for trade that the user wants. */
  theyHave: TradeCard[]
}

export interface Tonight {
  /** Friends with something to trade, the most cards first. */
  matches: TonightMatch[]
  /** Friends there with nothing to trade tonight. */
  nothing: string[]
  /** Players who aren't friends (guests): no wants to show. */
  notFriends: string[]
}

const lower = (s: string) => s.trim().toLowerCase()
const BIG = Number.MAX_SAFE_INTEGER
const inPocket = (c: PlacedCard) => (c.line.page ?? 0) > 0 && (c.line.slot ?? 0) > 0

/** Which copy goes first: marked for trade, then in a pocket, then the earliest pocket. The same order as friendsWant.ts. */
function goesFirst(a: PlacedCard, b: PlacedCard): number {
  const ta = (a.entry.forTrade ?? 0) > 0 ? 1 : 0
  const tb = (b.entry.forTrade ?? 0) > 0 ? 1 : 0
  if (ta !== tb) return tb - ta
  const pa = inPocket(a) ? 1 : 0
  const pb = inPocket(b) ? 1 : 0
  if (pa !== pb) return pb - pa
  return ((a.line.page ?? BIG) - (b.line.page ?? BIG)) || ((a.line.slot ?? BIG) - (b.line.slot ?? BIG))
}

/**
 * Where the user's copy of [name] is: "Trade binder · Page 4, slot 6", "Red box › Red", "Red box" —
 * the copy that would go first. "No place yet" when no copy is in a place. [placeNames]: place id to name.
 */
export function whereTonight(name: string, placed: PlacedCard[], placeNames: Map<string, string>): string {
  const best = placed.filter((c) => c.line.qty > 0 && sameCardName(c.entry.name, name)).sort(goesFirst)[0]
  if (!best) return 'No place yet'
  const place = placeNames.get(best.line.placeId) ?? 'A place'
  if (inPocket(best)) return `${place} · ${pocketLabel(best.line.page!, best.line.slot!)}`
  return best.line.section ? `${place} › ${best.line.section}` : place
}

function distinctByName<T extends { name: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((c) => { const k = lower(c.name); if (seen.has(k)) return false; seen.add(k); return true })
}

const strip = ({ forTrade: _mark, ...card }: MatchCard): TradeCard => { void _mark; return card }

/**
 * Tonight's trade matches for [players] (the user left out by the caller). A player counts as a
 * friend when their account is in [friends]; each friend once. [decksUse]: the card names the user's
 * decks use, lower case (spares.ts) — a card on their wishlist is offered when it's marked for trade
 * or no deck uses it.
 */
export function tradeMatchesTonight(
  players: TonightPlayer[],
  friends: Set<string>,
  matches: TradeMatch[],
  decksUse: Set<string>,
  placed: PlacedCard[],
  placeNames: Map<string, string>,
): Tonight {
  const out: TonightMatch[] = []
  const nothing: string[] = []
  const notFriends: string[] = []
  const done = new Set<string>()
  for (const p of players) {
    if (!p.userId || !friends.has(p.userId)) {
      if (p.name.trim() && !notFriends.some((n) => lower(n) === lower(p.name))) notFriends.push(p.name.trim())
      continue
    }
    if (done.has(p.userId)) continue
    done.add(p.userId)
    const m = matches.find((x) => x.friend === p.userId)
    const theyWant = distinctByName((m?.they_want ?? []).filter((c) => c.forTrade || !decksUse.has(lower(c.name))))
      .map((c) => ({ card: strip(c), where: whereTonight(c.name, placed, placeNames) }))
    const theyHave = distinctByName((m?.they_have ?? []).filter((c) => c.forTrade)).map(strip)
    if (theyWant.length + theyHave.length === 0) nothing.push(p.name)
    else out.push({ friend: p.userId, name: p.name, theyWant, theyHave })
  }
  out.sort((a, b) => (b.theyWant.length + b.theyHave.length) - (a.theyWant.length + a.theyHave.length) || (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0))
  return { matches: out, nothing, notFriends }
}

/** "Add Priya as a friend to see what they want". */
export const addFriendLine = (name: string): string => `Add ${name} as a friend to see what they want`

/** "Priya wants 3 of your cards · has 1 card for trade that you want". */
export function tonightLine(m: TonightMatch): string {
  const parts: string[] = []
  if (m.theyWant.length > 0) parts.push(`wants ${m.theyWant.length} of your cards`)
  if (m.theyHave.length > 0) parts.push(`has ${m.theyHave.length} ${m.theyHave.length === 1 ? 'card' : 'cards'} for trade that you want`)
  return `${m.name} ${parts.join(' · ')}`
}

/** The cards they want as lines of the "Bring to game night" deck (friendsWant.ts bringToGameNight). */
export const tonightAsDeckCards = (cards: TonightCard[]): DeckCardEntry[] => cards.map(({ card }) => ({
  scryfallId: card.scryfallId,
  name: card.name,
  imageUrl: card.imageUrl ?? null,
  quantity: 1,
  canBeCommander: false,
  typeLine: null,
  partnerAbility: null,
}))

/**
 * The bag's "Who's coming" names as players: a name that's a friend's (the same, or one's first name
 * of the other — eventBag.ts isComing) gets their account. [people]: friends' ids and display names.
 */
export function playersFromNames(names: string[], people: { userId: string; name: string }[], isComing: (name: string, attendees: string[]) => boolean): TonightPlayer[] {
  return names.map((n) => ({ name: n, userId: people.find((p) => isComing(p.name, [n]))?.userId ?? null }))
}

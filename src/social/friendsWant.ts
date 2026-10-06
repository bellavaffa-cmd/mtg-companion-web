/*
 * "Friends want these" on a binder: the friends whose wishlists want cards in it, from the same
 * two-way matches the Friends page shows (trade_matches — no new server function), each with the
 * cards of theirs the user wants. Per friend: how many cards and what they're worth, each card with
 * its pocket, "Priya has 2 cards you want: …", Propose a trade (the composer started with both sides)
 * and Bring to game night — the cards go on the "Bring to game night" deck's pull list
 * (collection/pullList.ts), so pulling them for the night is the pull list as for any deck.
 *
 * Pure, so it can be tested. Mirrors the Android app's data/social/FriendsWant.kt, with the same
 * tests (tests/social/friendsWant.test.ts ↔ FriendsWantTest.kt).
 */

import { holdsCards } from '../collection/pullList'
import { pocketLabel, sameCardName, type PlacedCard } from '../collection/storagePlaces'
import { normalizeDeck, type Deck, type DeckCardEntry } from '../types/models'
import type { TradeCard } from './api'
import type { TradeMatch } from './more'

/** A card in the binder a friend wants: the copy that would go, and its price (null: not known). */
export interface WantedHere { card: PlacedCard; price: number | null }

/** One friend's wants in the binder, and the cards of theirs the user wants ([theyHave]). */
export interface FriendWants { friend: string; cards: WantedHere[]; value: number; theyHave: TradeCard[] }

const lower = (s: string) => s.toLowerCase()
const inPocket = (c: PlacedCard) => (c.line.page ?? 0) > 0 && (c.line.slot ?? 0) > 0
const BIG = Number.MAX_SAFE_INTEGER

/** Which copy goes first: marked for trade, then in a pocket, then the earliest pocket. */
function goesFirst(a: PlacedCard, b: PlacedCard): number {
  const ta = (a.entry.forTrade ?? 0) > 0 ? 1 : 0
  const tb = (b.entry.forTrade ?? 0) > 0 ? 1 : 0
  if (ta !== tb) return tb - ta
  const pa = inPocket(a) ? 1 : 0
  const pb = inPocket(b) ? 1 : 0
  if (pa !== pb) return pb - pa
  return ((a.line.page ?? BIG) - (b.line.page ?? BIG)) || ((a.line.slot ?? BIG) - (b.line.slot ?? BIG))
}

function distinctBy<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return list.filter((t) => { const k = key(t); if (seen.has(k)) return false; seen.add(k); return true })
}

/**
 * The friends in [matches] who want cards in the binder ([here], its copies), most cards first (then
 * the most value). Each wanted card once, by name, the dearest first. [priceOf]: a copy's price.
 */
export function friendsWantHere(matches: TradeMatch[], here: PlacedCard[], priceOf: (c: PlacedCard) => number | null): FriendWants[] {
  const out: FriendWants[] = []
  for (const m of matches) {
    const picked = distinctBy(m.they_want, (w) => lower(w.name))
      .map((want) => here.filter((c) => sameCardName(c.entry.name, want.name) && c.line.qty > 0).sort(goesFirst)[0])
      .filter((c): c is PlacedCard => !!c)
    const cards = distinctBy(picked, (c) => lower(c.entry.name))
      .map((card) => ({ card, price: priceOf(card) }))
      .sort((a, b) => ((b.price ?? 0) - (a.price ?? 0)) || (lower(a.card.entry.name) < lower(b.card.entry.name) ? -1 : lower(a.card.entry.name) > lower(b.card.entry.name) ? 1 : 0))
    if (cards.length === 0) continue
    out.push({ friend: m.friend, cards, value: cards.reduce((n, c) => n + (c.price ?? 0), 0), theyHave: m.they_have.map(({ forTrade: _mark, ...card }) => { void _mark; return card }) })
  }
  return out.sort((a, b) => (b.cards.length - a.cards.length) || (b.value - a.value) || (a.friend < b.friend ? -1 : a.friend > b.friend ? 1 : 0))
}

/** Where the copy is: "Page 4, slot 6", or "Not in a pocket yet". */
export const wantedWhere = (w: WantedHere): string =>
  inPocket(w.card) ? pocketLabel(w.card.line.page!, w.card.line.slot!) : 'Not in a pocket yet'

/** "3 cards · $21" — [value] already written as money, or null when no prices are known. */
export const wantsLine = (count: number, value: string | null): string =>
  `${count} ${count === 1 ? 'card' : 'cards'}${value !== null ? ` · ${value}` : ''}`

/** "Priya has 2 cards you want: Sheoldred, Smothering Tithe" — or null when they have none. Up to 3 names, then "and N more". */
export function hasLine(name: string, theyHave: TradeCard[]): string | null {
  const names = distinctBy(theyHave.map((c) => c.name), lower)
  if (names.length === 0) return null
  const shown = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  return `${name} has ${names.length} ${names.length === 1 ? 'card' : 'cards'} you want: ${shown}`
}

/** The cards as the user's side of a trade: one copy each, out of the binder it's in. */
export const wantedAsTrade = (cards: WantedHere[]): TradeCard[] => cards.map(({ card }) => ({
  scryfallId: card.entry.scryfallId,
  name: card.entry.name,
  imageUrl: card.entry.imageUrl,
  foil: !!card.line.foil,
  quantity: 1,
  collectionId: card.collectionId,
  ...(card.entry.condition ? { condition: card.entry.condition } : {}),
}))

// ---- Bring to game night ----

/** The deck the cards for game night are gathered on; its pull list says where each is. */
export const GAME_NIGHT_DECK = 'Bring to game night'

/** The wanted cards as lines of the game night deck. */
export const wantedAsDeckCards = (cards: WantedHere[]): DeckCardEntry[] => cards.map(({ card }) => ({
  scryfallId: card.entry.scryfallId,
  name: card.entry.name,
  imageUrl: card.entry.imageUrl,
  quantity: 1,
  canBeCommander: false,
  typeLine: null,
  partnerAbility: null,
}))

/**
 * [decks] with [cards] on the "Bring to game night" deck — made (virtual, so every card is on its
 * pull list) with the id [newId] when there isn't one. A card already on it isn't added twice. On a
 * deck already pulled into a deck box (it holds cards now), the new cards come in as proxies, so
 * they're still on the pull list. Also the deck's id.
 */
export function bringToGameNight(decks: Deck[], cards: DeckCardEntry[], newId: string, now = Date.now()): { decks: Deck[]; deckId: string } {
  const existing = decks.find((d) => d.name === GAME_NIGHT_DECK && !d.archived && !d.sample)
  const deck = existing ?? normalizeDeck({ id: newId, name: GAME_NIGHT_DECK, ownership: 'VIRTUAL', createdAt: now })
  const added: DeckCardEntry[] = []
  for (const c of cards) {
    if ([...deck.cards, ...added].some((x) => sameCardName(x.name, c.name))) continue
    added.push(holdsCards(deck) ? { ...c, proxyQuantity: c.quantity } : c)
  }
  const next = { ...deck, cards: [...deck.cards, ...added] }
  return { decks: existing ? decks.map((d) => (d.id === deck.id ? next : d)) : [...decks, next], deckId: deck.id }
}

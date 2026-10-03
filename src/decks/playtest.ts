// Solo playtesting ("goldfishing") a deck: shuffle, draw seven, mulligan the London way, then play
// turns — draw, put cards onto the battlefield, tap and untap them, send them to the graveyard, make
// the deck's tokens. Plain state and actions, so the rules are tested here rather than on a screen;
// every shuffle takes a random source, so a test can seed it. Nothing is saved: closing the playtest
// ends it. Mirrors the Android app's data/Playtest.kt.

import type { Deck, DeckCardEntry } from '../types/models'
import { OPENING_HAND } from './handOdds'

/** One physical card in the game. [id] tells copies of the same card apart. */
export interface PlayCard {
  id: string
  name: string
  imageUrl: string | null
  backImageUrl?: string | null
  typeLine?: string | null
  /** A token made during the game: it ceases to exist when it leaves the battlefield. */
  isToken?: boolean
}

/** A card on the battlefield, and whether it's tapped. */
export interface Permanent {
  card: PlayCard
  tapped: boolean
}

export interface PlaytestState {
  library: PlayCard[]
  hand: PlayCard[]
  battlefield: Permanent[]
  graveyard: PlayCard[]
  /** Commanders, castable from here at any time. */
  commandZone: PlayCard[]
  /** 0 while choosing an opening hand; 1 and up once it's kept. */
  turn: number
  /** On the play there's no draw on turn 1. */
  onThePlay: boolean
  mulligans: number
  /** Cards still to put on the bottom of the library before the hand can be kept (London mulligan). */
  toBottom: number
  /** Commander's house rule: the first mulligan puts no card on the bottom. */
  freeMulligan: boolean
  /** Tokens made so far, for their ids. */
  tokensMade: number
}

export type Random = () => number

export const choosingHand = (s: PlaytestState): boolean => s.turn === 0
export const canKeep = (s: PlaytestState): boolean => choosingHand(s) && s.toBottom === 0

const isCommanderCard = (card: PlayCard) => card.id.endsWith('#cmd')

/** [cards] shuffled (Fisher–Yates), leaving [cards] as it was. */
function shuffled<T>(cards: T[], random: Random): T[] {
  const out = [...cards]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const playCard = (entry: DeckCardEntry, id: string): PlayCard =>
  ({ id, name: entry.name, imageUrl: entry.imageUrl, backImageUrl: entry.backImageUrl ?? null, typeLine: entry.typeLine })

/**
 * Every card of [deck]'s main deck as a game card — less one copy of each commander, which starts in
 * the command zone. The sideboard and the Considering list aren't played.
 */
export function playCards(deck: Deck): { library: PlayCard[]; commandZone: PlayCard[] } {
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)
  const copies = new Map<string, number>()
  for (const c of commanders) copies.set(c.scryfallId, (copies.get(c.scryfallId) ?? 0) + 1)
  const library = deck.cards.flatMap((entry) =>
    Array.from({ length: Math.max(0, entry.quantity - (copies.get(entry.scryfallId) ?? 0)) }, (_, i) => playCard(entry, `${entry.scryfallId}#${i}`)))
  return { library, commandZone: commanders.map((c) => playCard(c, `${c.scryfallId}#cmd`)) }
}

/** A new game: [library] shuffled and seven drawn. [freeMulligan] is the Commander rule that the first mulligan is free. */
export function newGame(
  library: PlayCard[],
  commandZone: PlayCard[] = [],
  random: Random = Math.random,
  onThePlay = true,
  freeMulligan = false,
): PlaytestState {
  const cards = shuffled(library, random)
  return {
    library: cards.slice(OPENING_HAND),
    hand: cards.slice(0, OPENING_HAND),
    battlefield: [],
    graveyard: [],
    commandZone,
    turn: 0,
    onThePlay,
    mulligans: 0,
    toBottom: 0,
    freeMulligan,
    tokensMade: 0,
  }
}

/** Every card back from hand, battlefield and graveyard (tokens gone), and a fresh game. */
export function reset(s: PlaytestState, random: Random = Math.random): PlaytestState {
  const all = [...s.library, ...s.hand, ...s.battlefield.map((p) => p.card), ...s.graveyard].filter((c) => !c.isToken)
  const commanders = [...all.filter(isCommanderCard), ...s.commandZone]
    .filter((c, i, list) => list.findIndex((o) => o.id === c.id) === i)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return newGame(all.filter((c) => !isCommanderCard(c)), commanders, random, s.onThePlay, s.freeMulligan)
}

/** How many cards a hand after [mulligans] mulligans puts on the bottom. */
export const cardsToBottom = (mulligans: number, freeMulligan: boolean): number => Math.max(0, mulligans - (freeMulligan ? 1 : 0))

/**
 * London mulligan: the hand goes back, the library is shuffled and seven are drawn again; then one
 * card per mulligan taken goes on the bottom (putOnBottom) before the hand can be kept. Only while
 * choosing an opening hand.
 */
export function mulligan(s: PlaytestState, random: Random = Math.random): PlaytestState {
  if (!choosingHand(s)) return s
  const cards = shuffled([...s.library, ...s.hand], random)
  const taken = s.mulligans + 1
  return {
    ...s,
    library: cards.slice(OPENING_HAND),
    hand: cards.slice(0, OPENING_HAND),
    mulligans: taken,
    toBottom: Math.min(cardsToBottom(taken, s.freeMulligan), OPENING_HAND),
  }
}

/** Puts a hand card on the bottom of the library, while the mulligan still asks for one. */
export function putOnBottom(s: PlaytestState, cardId: string): PlaytestState {
  if (s.toBottom <= 0) return s
  const card = s.hand.find((c) => c.id === cardId)
  if (!card) return s
  return { ...s, hand: s.hand.filter((c) => c !== card), library: [...s.library, card], toBottom: s.toBottom - 1 }
}

/** On the play or on the draw — chosen before the hand is kept. */
export const withOnThePlay = (s: PlaytestState, play: boolean): PlaytestState => (choosingHand(s) ? { ...s, onThePlay: play } : s)

/** Whether the first mulligan is free — chosen before the hand is kept. */
export const withFreeMulligan = (s: PlaytestState, free: boolean): PlaytestState =>
  choosingHand(s) ? { ...s, freeMulligan: free, toBottom: Math.min(cardsToBottom(s.mulligans, free), OPENING_HAND) } : s

/** Keeps the hand and starts turn 1, drawing for it when on the draw. */
export function keep(s: PlaytestState): PlaytestState {
  if (!canKeep(s)) return s
  const started = { ...s, turn: 1 }
  return s.onThePlay ? started : draw(started)
}

/** Draws the top card, if there is one. */
export function draw(s: PlaytestState): PlaytestState {
  const top = s.library[0]
  if (!top) return s
  return { ...s, library: s.library.slice(1), hand: [...s.hand, top] }
}

/** The next turn: untap everything, then draw. */
export function nextTurn(s: PlaytestState): PlaytestState {
  if (choosingHand(s)) return s
  return draw({ ...s, turn: s.turn + 1, battlefield: s.battlefield.map((p) => (p.tapped ? { ...p, tapped: false } : p)) })
}

/** A card from the hand or the command zone onto the battlefield — a land or a spell alike. */
export function play(s: PlaytestState, cardId: string): PlaytestState {
  const fromHand = s.hand.find((c) => c.id === cardId)
  if (fromHand) return { ...s, hand: s.hand.filter((c) => c !== fromHand), battlefield: [...s.battlefield, { card: fromHand, tapped: false }] }
  const fromZone = s.commandZone.find((c) => c.id === cardId)
  if (fromZone) return { ...s, commandZone: s.commandZone.filter((c) => c !== fromZone), battlefield: [...s.battlefield, { card: fromZone, tapped: false }] }
  return s
}

/** Taps an untapped permanent, untaps a tapped one. */
export const toggleTap = (s: PlaytestState, cardId: string): PlaytestState =>
  ({ ...s, battlefield: s.battlefield.map((p) => (p.card.id === cardId ? { ...p, tapped: !p.tapped } : p)) })

/**
 * A card from the hand or the battlefield to where it goes when it dies: a commander back to the
 * command zone, a token nowhere, anything else the graveyard.
 */
export function toGraveyard(s: PlaytestState, cardId: string): PlaytestState {
  const card = s.hand.find((c) => c.id === cardId) ?? s.battlefield.find((p) => p.card.id === cardId)?.card
  if (!card) return s
  const left = { ...s, hand: s.hand.filter((c) => c.id !== cardId), battlefield: s.battlefield.filter((p) => p.card.id !== cardId) }
  if (card.isToken) return left
  if (isCommanderCard(card)) return { ...left, commandZone: [...left.commandZone, card] }
  return { ...left, graveyard: [...left.graveyard, card] }
}

/** A permanent back to its owner's hand. A token just goes. */
export function toHand(s: PlaytestState, cardId: string): PlaytestState {
  const permanent = s.battlefield.find((p) => p.card.id === cardId)
  if (!permanent) return s
  const left = { ...s, battlefield: s.battlefield.filter((p) => p !== permanent) }
  return permanent.card.isToken ? left : { ...left, hand: [...left.hand, permanent.card] }
}

/** One of the deck's tokens onto the battlefield, untapped. */
export function createToken(s: PlaytestState, name: string, imageUrl: string | null, typeLine: string | null = null): PlaytestState {
  const made = s.tokensMade + 1
  const token: PlayCard = { id: `token#${made}`, name, imageUrl, typeLine, isToken: true }
  return { ...s, battlefield: [...s.battlefield, { card: token, tapped: false }], tokensMade: made }
}

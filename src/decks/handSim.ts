/**
 * Test hands by the thousand: shuffle the deck 10,000 times and count how the opening seven and the
 * first turns go — lands in the opener, a land drop each turn, a two-drop to cast on turn 2, how often
 * a simple keep rule sends the hand back. Played out, not worked out (decks/handOdds.ts has the exact
 * sums for the opener), so the numbers wobble by a point or so; a seed makes them repeat. Colours
 * aren't checked: a land is any land, a two-drop is any non-land with mana value 2.
 *
 * The random numbers are mulberry32 and the shuffle a partial Fisher–Yates, written the same way as
 * the Android app's data/HandSim.kt, so a seed gives both apps the very same numbers.
 */

import type { Deck, DeckCardEntry } from '../types/models'
import { isLandType } from './deckAnalysis'
import { OPENING_HAND } from './handOdds'

export const SIM_HANDS = 10_000
export const SIM_SEED = 7
/** The simple keep rule: a seven with this many lands is kept, any other goes back. */
export const SIM_KEEP_LANDS: [number, number] = [2, 5]
/** Land drops are counted for turns 1 to this. */
export const SIM_TURNS = 4

/** A seeded random number from 0 (inclusive) to 1: mulberry32. */
export function seededRandom(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One card in the library, as far as the numbers care. */
export interface SimCard {
  land: boolean
  /** Mana value; null for a land or a card it isn't known for. */
  manaValue: number | null
}

/**
 * The deck's library for the numbers: its main deck less one copy of each commander (it starts in the
 * command zone, so it's never drawn). [manaValue] is a card's mana value where it's known.
 */
export function simLibrary(deck: Deck, typeLine: (e: DeckCardEntry) => string | null | undefined, manaValue: (e: DeckCardEntry) => number | null | undefined): SimCard[] {
  const commanders = new Map<string, number>()
  for (const c of [deck.commander, deck.partnerCommander]) if (c) commanders.set(c.scryfallId, (commanders.get(c.scryfallId) ?? 0) + 1)
  const out: SimCard[] = []
  for (const e of deck.cards) {
    const copies = Math.max(0, e.quantity - (commanders.get(e.scryfallId) ?? 0))
    const land = isLandType(typeLine(e) ?? e.typeLine)
    const mv = land ? null : manaValue(e) ?? null
    for (let i = 0; i < copies; i++) out.push({ land, manaValue: mv })
  }
  return out
}

/** On the play and on the draw. */
export interface PlayDraw {
  onThePlay: number
  onTheDraw: number
}

export interface HandStats {
  hands: number
  library: number
  lands: number
  /** Non-lands with mana value 2. */
  twoDrops: number
  /** Share of openers with exactly 0, 1, … 7 lands. */
  landsInOpener: number[]
  /** 2 to 4 lands in the opener. */
  twoToFourLands: number
  averageLands: number
  /** Turn 1 to 4: a land to play every turn so far (n lands among the cards seen by turn n). */
  landDrops: ({ turn: number } & PlayDraw)[]
  /** Two lands and a two-drop among the cards seen by turn 2. */
  twoDropOnTurn2: PlayDraw
  /** Openers the keep rule sends back. */
  mulliganRate: number
}

/** Cards seen by [turn]: the seven, plus a draw each turn — but none on turn 1 on the play. */
const seenBy = (turn: number, onThePlay: boolean) => OPENING_HAND + turn - (onThePlay ? 1 : 0)

/**
 * The numbers for [library], from [hands] shuffles with [seed]. Null for a library too small for an
 * opener and four draws.
 */
export function handStats(library: SimCard[], hands = SIM_HANDS, seed = SIM_SEED): HandStats | null {
  const deepest = seenBy(SIM_TURNS, false)
  const n = library.length
  if (n < deepest || hands <= 0) return null
  const random = seededRandom(seed)
  const cards = [...library]
  const landsInOpener = new Array<number>(OPENING_HAND + 1).fill(0)
  const play = new Array<number>(SIM_TURNS).fill(0)
  const drawn = new Array<number>(SIM_TURNS).fill(0)
  let twoDropPlay = 0
  let twoDropDraw = 0
  let landTotal = 0
  let mulligans = 0

  for (let h = 0; h < hands; h++) {
    // Only the top cards matter: shuffle just those into place.
    for (let i = 0; i < deepest; i++) {
      const j = i + Math.floor(random() * (n - i))
      const t = cards[i]
      cards[i] = cards[j]
      cards[j] = t
    }
    // Lands and two-drops among the top 1, 2, … cards.
    let lands = 0
    let twos = 0
    const landsSeen: number[] = []
    const twosSeen: number[] = []
    for (let i = 0; i < deepest; i++) {
      const c = cards[i]
      if (c.land) lands++
      else if (c.manaValue === 2) twos++
      landsSeen.push(lands)
      twosSeen.push(twos)
    }
    const opener = landsSeen[OPENING_HAND - 1]
    landsInOpener[opener]++
    landTotal += opener
    if (opener < SIM_KEEP_LANDS[0] || opener > SIM_KEEP_LANDS[1]) mulligans++
    for (let turn = 1; turn <= SIM_TURNS; turn++) {
      if (landsSeen[seenBy(turn, true) - 1] >= turn) play[turn - 1]++
      if (landsSeen[seenBy(turn, false) - 1] >= turn) drawn[turn - 1]++
    }
    const p2 = seenBy(2, true) - 1
    const d2 = seenBy(2, false) - 1
    if (landsSeen[p2] >= 2 && twosSeen[p2] >= 1) twoDropPlay++
    if (landsSeen[d2] >= 2 && twosSeen[d2] >= 1) twoDropDraw++
  }

  const share = (k: number) => k / hands
  const spread = landsInOpener.map(share)
  return {
    hands,
    library: n,
    lands: library.filter((c) => c.land).length,
    twoDrops: library.filter((c) => !c.land && c.manaValue === 2).length,
    landsInOpener: spread,
    twoToFourLands: share(landsInOpener[2] + landsInOpener[3] + landsInOpener[4]),
    averageLands: landTotal / hands,
    landDrops: play.map((k, i) => ({ turn: i + 1, onThePlay: share(k), onTheDraw: share(drawn[i]) })),
    twoDropOnTurn2: { onThePlay: share(twoDropPlay), onTheDraw: share(twoDropDraw) },
    mulliganRate: share(mulligans),
  }
}

// The life counter's game modes, as in the Android app (LifeCounterViewModel's GameModeState):
// Planechase, Archenemy and Bounty, one at a time. Each is a shuffled deck of cards fetched from
// Scryfall when the mode starts, and the card the table is on. Pure, so the tests run without a page.

import { displayImageUrl, displayOracleText, type ScryfallCard } from '../types/scryfall'

export type GameModeKind = 'PLANECHASE' | 'ARCHENEMY' | 'BOUNTY'
export type PlanarFace = 'BLANK' | 'CHAOS' | 'PLANESWALK'

export interface GameModeState {
  mode: GameModeKind
  loading: boolean
  planeDeck: ScryfallCard[]
  currentPlane: ScryfallCard | null
  schemeDeck: ScryfallCard[]
  currentScheme: ScryfallCard | null
  /** Ongoing schemes stay face up until they're abandoned; the rest are used and gone. */
  ongoingSchemes: ScryfallCard[]
  archenemyPlayerId: number | null
  bountyDeck: ScryfallCard[]
  currentBounty: ScryfallCard | null
  /** How to play Bounty, from the "Wanted!" back face every bounty card shares. */
  bountyRules: string | null
}

export const MODE_LABEL: Record<GameModeKind, string> = { PLANECHASE: 'Planechase', ARCHENEMY: 'Archenemy', BOUNTY: 'Bounty' }

/**
 * Where each deck comes from on Scryfall. Bounty cards (Outlaws of Thunder Junction Commander) aren't
 * a searchable card type — Scryfall files them as double-faced token-set extras named
 * "Bounty: <outlaw> // Wanted!", so they're found by set and name instead.
 */
export const MODE_QUERY: Record<GameModeKind, string> = {
  PLANECHASE: 't:plane or t:phenomenon',
  ARCHENEMY: 't:scheme',
  BOUNTY: 'set:totc name:"Bounty:" include:extras',
}

const EMPTY: Omit<GameModeState, 'mode'> = {
  loading: false, planeDeck: [], currentPlane: null, schemeDeck: [], currentScheme: null, ongoingSchemes: [],
  archenemyPlayerId: null, bountyDeck: [], currentBounty: null, bountyRules: null,
}

export function shuffle<T>(list: T[], random: () => number = Math.random): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A mode starting: shuffling while its cards load. */
export function loadingMode(mode: GameModeKind, archenemyPlayerId: number | null = null): GameModeState {
  return { ...EMPTY, mode, loading: true, archenemyPlayerId: mode === 'ARCHENEMY' ? archenemyPlayerId : null }
}

/**
 * The mode once its cards came: only the cards that belong (a search can bring back others), shuffled.
 * Planechase turns the first plane up at once; Archenemy and Bounty wait to reveal the first card.
 * No cards (offline, say) leaves an empty deck, which the sheet explains.
 */
export function startedMode(mode: GameModeKind, cards: ScryfallCard[], archenemyPlayerId: number | null = null, random: () => number = Math.random): GameModeState {
  const base = { ...loadingMode(mode, archenemyPlayerId), loading: false }
  switch (mode) {
    case 'PLANECHASE': {
      const deck = shuffle(cards.filter((c) => /Plane|Phenomenon/.test(c.type_line ?? '')), random)
      return { ...base, currentPlane: deck[0] ?? null, planeDeck: deck.slice(1) }
    }
    case 'ARCHENEMY':
      return { ...base, schemeDeck: shuffle(cards.filter((c) => (c.type_line ?? '').includes('Scheme')), random) }
    case 'BOUNTY': {
      const bounties = cards.filter((c) => c.name.startsWith('Bounty:'))
      return {
        ...base,
        bountyDeck: shuffle(bounties, random),
        bountyRules: bounties.map((c) => c.card_faces?.[1]?.oracle_text).find((t): t is string => !!t) ?? null,
      }
    }
  }
}

/** Move to the next plane, cycling the current one back into the deck. */
export function planeswalk(s: GameModeState): GameModeState {
  if (s.mode !== 'PLANECHASE' || s.planeDeck.length === 0) return s
  return { ...s, currentPlane: s.planeDeck[0], planeDeck: [...s.planeDeck.slice(1), ...(s.currentPlane ? [s.currentPlane] : [])] }
}

/** A real planar die, from a roll of 0–5: four blank faces, one Chaos, one Planeswalk. */
export function planarFace(n: number): PlanarFace {
  return n === 0 ? 'CHAOS' : n === 1 ? 'PLANESWALK' : 'BLANK'
}

export const isOngoing = (card: ScryfallCard) => /ongoing/i.test(card.type_line ?? '')

/** Ongoing schemes stay face up (kept apart); one-shot schemes are used and discarded. */
export function revealNextScheme(s: GameModeState): GameModeState {
  if (s.mode !== 'ARCHENEMY' || s.schemeDeck.length === 0) return s
  const next = s.schemeDeck[0]
  return {
    ...s,
    currentScheme: next,
    schemeDeck: s.schemeDeck.slice(1),
    ongoingSchemes: isOngoing(next) ? [...s.ongoingSchemes, next] : s.ongoingSchemes,
  }
}

/** Claimed bounties go to the bottom of the pile, so the deck never runs dry mid-game. */
export function revealNextBounty(s: GameModeState): GameModeState {
  if (s.mode !== 'BOUNTY' || s.bountyDeck.length === 0) return s
  return { ...s, currentBounty: s.bountyDeck[0], bountyDeck: [...s.bountyDeck.slice(1), ...(s.currentBounty ? [s.currentBounty] : [])] }
}

/** The card the table is on in this mode, if one is up. */
export function currentCard(s: GameModeState): ScryfallCard | null {
  return s.mode === 'PLANECHASE' ? s.currentPlane : s.mode === 'ARCHENEMY' ? s.currentScheme : s.currentBounty
}

/** How a card shows: a bounty by its front face (the bounty), anything else whole. */
export function cardFace(s: GameModeState, card: ScryfallCard): { name: string; imageUrl: string | null; text: string | null } {
  const front = s.mode === 'BOUNTY' ? card.card_faces?.[0] : undefined
  if (front) return { name: front.name ?? card.name, imageUrl: front.image_uris?.normal ?? displayImageUrl(card), text: front.oracle_text ?? null }
  return { name: card.name, imageUrl: displayImageUrl(card), text: displayOracleText(card) }
}

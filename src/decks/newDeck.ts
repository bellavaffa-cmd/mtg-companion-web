// The rules behind starting a deck from scratch (pages/NewDeckPage.tsx): which cards Scryfall is
// asked for as commanders, how the picker filters and sorts them, which second commander is offered,
// and what the deck is called. Plain functions, so the Android app can follow the same spec.

import { canPair, secondCommanderKind, type PairCard, type SecondCommanderKind } from './pairing'
import { GAME_MODES_USING_COMMANDER, GAME_MODE_LABELS, type DeckCardEntry, type GameMode } from '../types/models'
import { backImageUrl, canBeCommander, cardTags, displayImageUrl, displayOracleText, partnerAbility, type ScryfallCard } from '../types/scryfall'

/** A deck entry for [quantity] copies of [card], with what the deck needs to know about it cached. */
export function entryFromCard(card: ScryfallCard, quantity: number): DeckCardEntry {
  return {
    scryfallId: card.id,
    name: card.name,
    imageUrl: displayImageUrl(card),
    quantity,
    canBeCommander: canBeCommander(card),
    typeLine: card.type_line ?? null,
    partnerAbility: partnerAbility(card),
    backImageUrl: backImageUrl(card),
    tags: cardTags(card),
  }
}

/** Whether a deck of [format] starts by choosing a commander. */
export const picksCommander = (format: GameMode) => GAME_MODES_USING_COMMANDER.has(format)

/**
 * The Scryfall search for every card that can lead a [format] deck, or null for a format without a
 * commander. Commander has its own operator; Brawl takes legendary creatures and planeswalkers, and
 * anything that says it can be your commander.
 */
export function commanderQuery(format: GameMode): string | null {
  if (format === 'COMMANDER') return 'is:commander legal:commander'
  if (format === 'BRAWL') return 'legal:brawl (t:legendary (t:creature or t:planeswalker) or o:"can be your commander")'
  return null
}

/** Every Background a "Choose a Background" commander can take. Only Commander has them. */
export const BACKGROUND_QUERY = 't:background legal:commander'

/**
 * The second commander to offer after [main] in a [format] deck, or null when there's none. The
 * pairing rules are decks/pairing.ts; a Background is only offered in Commander, since Brawl has none.
 */
export function secondCommanderOffer(main: ScryfallCard, format: GameMode): SecondCommanderKind | null {
  const kind = secondCommanderKind(pairCardOf(main))
  if (kind === 'BACKGROUND' && format !== 'COMMANDER') return null
  return kind
}

/**
 * Where the second commanders come from: a Background is its own search; everything else is a
 * commander already in the format's list (see secondCommanders).
 */
export const secondCommanderQuery = (kind: SecondCommanderKind): string | null => (kind === 'BACKGROUND' ? BACKGROUND_QUERY : null)

/** What pairing needs to know about a Scryfall card. */
export const pairCardOf = (card: ScryfallCard): PairCard => ({
  name: card.name,
  typeLine: card.type_line ?? null,
  partnerAbility: partnerAbility(card),
})

/** The cards in [list] that can be [main]'s second commander. */
export function secondCommanders(main: ScryfallCard, list: ScryfallCard[]): ScryfallCard[] {
  const first = pairCardOf(main)
  return list.filter((card) => canPair(first, pairCardOf(card)))
}

/** The colour chips in the picker: the five colours, then colourless. */
export const IDENTITY_CHOICES = ['W', 'U', 'B', 'R', 'G', 'C'] as const

/**
 * Whether a commander with [identity] fits within the [chosen] colours: everything in its colour
 * identity was chosen, so it could lead a deck of those colours. Nothing chosen fits everything.
 * Colourless commanders fit any colours; "C" chosen alone shows only them.
 */
export function fitsIdentity(identity: string[] | undefined, chosen: readonly string[]): boolean {
  if (chosen.length === 0) return true
  const colours = new Set(chosen.filter((c) => c !== 'C'))
  return (identity ?? []).every((c) => colours.has(c))
}

/** Whether [card] matches what's typed in the picker's search: its name, type line or rules text. */
export function matchesSearch(card: ScryfallCard, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [card.name, card.type_line ?? '', displayOracleText(card) ?? ''].some((text) => text.toLowerCase().includes(q))
}

export const COMMANDER_SORTS = ['POPULAR', 'NAME', 'NEWEST'] as const
export type CommanderSort = (typeof COMMANDER_SORTS)[number]
export const COMMANDER_SORT_LABELS: Record<CommanderSort, string> = { POPULAR: 'Popular', NAME: 'Name', NEWEST: 'Newest' }

/**
 * [cards] in the picker's order: Popular is EDHREC's rank (unranked last, as Scryfall sent them),
 * Name is A to Z, Newest is the latest release first. Ties keep the order they came in.
 */
export function sortCommanders(cards: ScryfallCard[], sort: CommanderSort): ScryfallCard[] {
  const out = [...cards]
  const rank = (c: ScryfallCard) => c.edhrec_rank ?? Number.MAX_SAFE_INTEGER
  if (sort === 'POPULAR') out.sort((a, b) => rank(a) - rank(b))
  if (sort === 'NAME') out.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'NEWEST') out.sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? ''))
  return out
}

/** A double-faced card's front name: "Esika, God of the Tree", not the whole "A // B". */
const frontName = (name: string) => name.split(' // ')[0]

/**
 * The name a new deck starts with: its commander's ("A & B" for two), or "New Standard deck" for a
 * format without one.
 */
export function defaultDeckName(format: GameMode, commander?: { name: string } | null, second?: { name: string } | null): string {
  if (commander) return [commander, second].filter((c): c is { name: string } => !!c).map((c) => frontName(c.name)).join(' & ')
  return `New ${GAME_MODE_LABELS[format]} deck`
}

/** The deck tab a new deck opens on: what to add next for a commander deck, its cards otherwise. */
export const landingTab = (format: GameMode): 'Suggestions' | 'Cards' => (picksCommander(format) ? 'Suggestions' : 'Cards')

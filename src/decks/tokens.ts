/**
 * What to bring besides the deck: the tokens and emblems its cards make.
 *
 * Scryfall prints this on the cards themselves — a card's `all_parts` lists everything published
 * alongside it, each tagged with what it is. We keep the tokens, which is what a player has to have
 * in the box, and say which cards ask for each one, since that's how you check you haven't missed
 * any. Meld halves and combo pieces are real cards, not things to bring, so they're left out.
 *
 * A token is identified by what's printed on it rather than by its Scryfall id: the same 1/1 white
 * Soldier is a different id in every set, and a player needs one of it, not six.
 */

import type { Deck, DeckCardEntry } from '../types/models'
import type { ScryfallCard, ScryfallPart } from '../types/scryfall'

export interface TokenNeeded {
  /** A Scryfall id for one printing of it — enough to fetch the art. */
  id: string
  name: string
  typeLine: string | null
  /** The cards in the deck that make it, by name, in the order they were found. */
  madeBy: string[]
  /** Emblems and the like: still worth bringing, but not a creature token. */
  isEmblem: boolean
}

/** Two tokens are the same token when they'd be the same piece of cardboard. */
const sameness = (part: ScryfallPart) =>
  `${part.name.trim().toLowerCase()}|${(part.type_line ?? '').trim().toLowerCase()}`

const isEmblem = (part: ScryfallPart) => (part.type_line ?? '').toLowerCase().includes('emblem')

/**
 * Every token [deck]'s cards make, with the cards that make each. [cardsById] is what
 * useDeckCardData holds; cards still loading are simply not counted yet.
 */
export function tokensNeeded(deck: Deck, cardsById: Map<string, ScryfallCard> | null | undefined): TokenNeeded[] {
  if (!cardsById) return []
  const entries: DeckCardEntry[] = [
    ...(deck.commander ? [deck.commander] : []),
    ...(deck.partnerCommander ? [deck.partnerCommander] : []),
    ...deck.cards,
  ]
  const found = new Map<string, TokenNeeded>()
  for (const entry of entries) {
    const card = cardsById.get(entry.scryfallId)
    for (const part of card?.all_parts ?? []) {
      // 'token' covers emblems and dungeons too; meld halves and combo pieces are cards you'd own.
      if (part.component !== 'token') continue
      const key = sameness(part)
      const already = found.get(key)
      if (already) {
        if (!already.madeBy.includes(entry.name)) already.madeBy.push(entry.name)
      } else {
        found.set(key, {
          id: part.id,
          name: part.name,
          typeLine: part.type_line ?? null,
          madeBy: [entry.name],
          isEmblem: isEmblem(part),
        })
      }
    }
  }
  // Tokens first, then emblems; within each, the ones most cards ask for.
  return [...found.values()].sort((a, b) =>
    Number(a.isEmblem) - Number(b.isEmblem)
    || b.madeBy.length - a.madeBy.length
    || a.name.localeCompare(b.name))
}

/** "3 cards make it" / "Llanowar Elves" — what to say under a token. */
export function madeByLabel(token: TokenNeeded): string {
  if (token.madeBy.length === 1) return token.madeBy[0]
  if (token.madeBy.length === 2) return token.madeBy.join(' and ')
  return `${token.madeBy[0]} and ${token.madeBy.length - 1} more`
}

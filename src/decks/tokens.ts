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

// ---- How many to bring, and the counters ----

/** "Create X …" counts as this many. */
export const X_TOKENS = 10
/** No token is worth bringing more of than this. */
export const MAX_TOKENS = 30

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: X_TOKENS,
}

/** How many tokens a card's text makes at once: "create two" is 2, "create X" is [X_TOKENS], and 1 when it doesn't say. */
export function makesHowMany(text: string): number {
  const m = /\bcreates? (an?|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+)\b/i.exec(text)
  if (!m) return 1
  const word = m[1].toLowerCase()
  return Number(word) || NUMBER_WORDS[word] || 1
}

/** A card's rules text, every face of it. */
export function rulesTextOf(card: ScryfallCard): string {
  return [card.oracle_text ?? '', ...(card.card_faces ?? []).map((f) => f.oracle_text ?? '')].join('\n')
}

const deckEntries = (deck: Deck): DeckCardEntry[] => [
  ...(deck.commander ? [deck.commander] : []),
  ...(deck.partnerCommander ? [deck.partnerCommander] : []),
  ...deck.cards,
]

/** A token to bring for a deck, and how many: what each card making it makes at once, added up (1 to [MAX_TOKENS]). */
export interface TokenToBring { name: string; count: number; madeBy: string[] }

/** The tokens (not emblems) to bring for [deck], most-made first, with how many of each. */
export function tokensToBring(deck: Deck, cardsById: Map<string, ScryfallCard> | null | undefined): TokenToBring[] {
  if (!cardsById) return []
  const textByName = new Map<string, string>()
  for (const e of deckEntries(deck)) {
    const card = cardsById.get(e.scryfallId)
    if (card && !textByName.has(e.name)) textByName.set(e.name, rulesTextOf(card))
  }
  return tokensNeeded(deck, cardsById).filter((t) => !t.isEmblem).map((t) => ({
    name: t.name,
    madeBy: t.madeBy,
    count: Math.min(MAX_TOKENS, Math.max(1, t.madeBy.reduce((n, by) => n + makesHowMany(textByName.get(by) ?? ''), 0))),
  }))
}

/** The counters worth bringing, in the order they're checked; '+1/+1' and '-1/-1' as printed. */
export const COUNTER_KINDS = [
  '+1/+1', '-1/-1', 'poison', 'energy', 'experience', 'loyalty', 'charge', 'oil', 'shield', 'stun', 'lore', 'time', 'quest', 'age', 'level',
  'rad', 'ticket', 'finality', 'bounty', 'blood', 'corpse', 'divinity', 'doom', 'fade', 'fate', 'flood', 'fungus', 'ice', 'incarnation',
  'ki', 'luck', 'omen', 'page', 'plague', 'slime', 'spore', 'study', 'tide', 'training', 'verse', 'vitality', 'void', 'wish',
]

/** Which counters a card's text asks for: "poison counter", infect and toxic for poison, {E} for energy… */
export function countersOn(card: ScryfallCard): string[] {
  const text = rulesTextOf(card).toLowerCase()
  const keywords = (card.keywords ?? []).map((k) => k.toLowerCase())
  return COUNTER_KINDS.filter((kind) => {
    // Planeswalkers come with their loyalty; only another card adding some counts.
    if (kind === 'loyalty') return text.includes('loyalty counter') && !(card.type_line ?? '').toLowerCase().includes('planeswalker')
    if (kind === 'poison' && ['infect', 'toxic', 'poisonous'].some((k) => keywords.includes(k))) return true
    if (kind === 'energy' && text.includes('{e}')) return true
    return new RegExp(`(^|[^a-z0-9+/-])${kind.replace(/[+/]/g, (c) => `\\${c}`)} counters?\\b`).test(text)
  })
}

/** The counters [deck]'s cards ask for, the ones most cards ask for first. */
export function countersNeeded(deck: Deck, cardsById: Map<string, ScryfallCard> | null | undefined): string[] {
  if (!cardsById) return []
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const e of deckEntries(deck)) {
    const card = cardsById.get(e.scryfallId)
    if (!card || seen.has(card.id)) continue
    seen.add(card.id)
    for (const kind of countersOn(card)) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || COUNTER_KINDS.indexOf(a[0]) - COUNTER_KINDS.indexOf(b[0]))
    .map(([kind]) => kind)
}

/** "Poison and +1/+1 counters", "Charge counters". */
export function countersLabel(kinds: string[]): string {
  const names = kinds.map((k, i) => (i === 0 ? k.charAt(0).toUpperCase() + k.slice(1) : k))
  const list = names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${list} counters`
}

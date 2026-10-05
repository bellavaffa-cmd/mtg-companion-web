// Companions: the ten Ikoria creatures that start the game outside it, each only if the starting
// deck meets its condition (rule 702.139). A deck names its companion in Deck.companion; the card
// itself sits in the sideboard — one of the fifteen in a 60-card format, outside the 100 in Commander
// (where the commander is part of the starting deck, and the companion must fit its colours). The
// conditions, from the cards' Oracle text:
//   Gyruda, Doom of Depths    — Your starting deck contains only cards with even mana values.
//   Jegantha, the Wellspring  — No card in your starting deck has more than one of the same mana symbol in its mana cost.
//   Kaheera, the Orphanguard  — Each creature card in your starting deck is a Cat, Elemental, Nightmare, Dinosaur, or Beast card.
//   Keruga, the Macrosage     — Your starting deck contains only cards with mana value 3 or greater and land cards.
//   Lurrus of the Dream-Den   — Each permanent card in your starting deck has mana value 2 or less.
//   Lutri, the Spellchaser    — Each nonland card in your starting deck has a different name.
//   Obosh, the Preypiercer    — Your starting deck contains only cards with odd mana values and land cards.
//   Umori, the Collector      — Each nonland card in your starting deck shares a card type.
//   Yorion, Sky Nomad         — Your starting deck contains at least twenty cards more than the minimum deck size.
//   Zirda, the Dawnwaker      — Each permanent card in your starting deck has an activated ability.
// Pure, so it can be tested; the Android app's data/Companion.kt checks the same, in the same words.

import type { Deck, DeckCardEntry } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

export interface Companion {
  name: string
  /** What it's called in a sentence: "Lurrus". */
  short: string
  /** Its condition, plainly. */
  rule: string
}

export const COMPANIONS: Companion[] = [
  { name: 'Gyruda, Doom of Depths', short: 'Gyruda', rule: 'Every card must have an even mana value.' },
  { name: 'Jegantha, the Wellspring', short: 'Jegantha', rule: 'No card may have the same mana symbol twice in its cost.' },
  { name: 'Kaheera, the Orphanguard', short: 'Kaheera', rule: 'Every creature must be a Cat, Elemental, Nightmare, Dinosaur or Beast.' },
  { name: 'Keruga, the Macrosage', short: 'Keruga', rule: 'Every card but lands must have mana value 3 or more.' },
  { name: 'Lurrus of the Dream-Den', short: 'Lurrus', rule: 'Every permanent must have mana value 2 or less.' },
  { name: 'Lutri, the Spellchaser', short: 'Lutri', rule: 'Every card but lands must have a different name.' },
  { name: 'Obosh, the Preypiercer', short: 'Obosh', rule: 'Every card but lands must have an odd mana value.' },
  { name: 'Umori, the Collector', short: 'Umori', rule: 'Every card but lands must share a card type.' },
  { name: 'Yorion, Sky Nomad', short: 'Yorion', rule: 'The deck needs at least 20 cards more than the minimum.' },
  { name: 'Zirda, the Dawnwaker', short: 'Zirda', rule: 'Every permanent must have an activated ability.' },
]

/** The companion called [name] (whatever its case), if it is one. */
export const companionNamed = (name: string | null | undefined): Companion | undefined =>
  name ? COMPANIONS.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) : undefined

/**
 * What the check needs to know of a card in the starting deck. Anything not known (null) isn't held
 * against it: a card not looked up yet only counts for its name and copies.
 */
export interface CompanionCard {
  name: string
  quantity: number
  cmc: number | null
  /** The mana cost the card has in the deck: the front face's, or both halves' for a split card. */
  manaCost: string | null
  /** The front face's type line. */
  typeLine: string | null
  /** Every face's rules text. */
  oracleText: string | null
}

export interface CompanionResult {
  met: boolean
  /** The cards that break it, each once, in deck order. */
  offenders: string[]
  /** Yorion: how many cards the deck has, against how many it needs. */
  has?: number
  needs?: number
}

const PERMANENT_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'planeswalker', 'sorcery']
const KAHEERA_TYPES = ['cat', 'elemental', 'nightmare', 'dinosaur', 'beast']

/** The card types on a type line (front face, before the dash), lower-cased; "Tribal" is Kindred. */
function cardTypes(typeLine: string): string[] {
  const front = typeLine.split('//')[0].split('—')[0].toLowerCase().replace(/\btribal\b/g, 'kindred')
  return front.split(/\s+/).filter(Boolean)
}
const subtypes = (typeLine: string): string[] => {
  const front = typeLine.split('//')[0]
  const dash = front.indexOf('—')
  return dash < 0 ? [] : front.slice(dash + 1).toLowerCase().split(/\s+/).filter(Boolean)
}
const isLand = (c: CompanionCard) => c.typeLine != null && cardTypes(c.typeLine).includes('land')
const isPermanent = (c: CompanionCard) => c.typeLine != null && cardTypes(c.typeLine).some((t) => PERMANENT_TYPES.includes(t))
const isCreature = (c: CompanionCard) => c.typeLine != null && cardTypes(c.typeLine).includes('creature')

/** Activated abilities named by a keyword alone, with no colon printed (Scryfall leaves out reminder text). */
const ACTIVATED_KEYWORDS = /^(equip|cycling|basic landcycling|\w+cycling|ninjutsu|unearth|level up|reconfigure|crew|fortify|outlast|scavenge|embalm|eternalize|transmute|channel|boast|transfigure|forecast|bloodrush|reinforce|encore|craft|exhaust|station|adapt|monstrosity)\b/im

/**
 * Whether rules text has an activated ability: "[Cost]: [Effect]" — reminder text counts, so a basic
 * land's "({T}: Add {G}.)" does — or a keyword that is one (Equip, Cycling, Crew…). Abilities a card
 * only grants to others, in quotes, don't.
 */
export function hasActivatedAbility(text: string): boolean {
  const own = text.replace(/["“][^"”]*["”]/g, '')
  return own.includes(':') || ACTIVATED_KEYWORDS.test(own)
}

/** Whether a mana cost repeats a symbol: {R}{R}, {1}{1} across a split card's halves, {G/W}{G/W}. */
export function repeatsManaSymbol(manaCost: string): boolean {
  const symbols = [...manaCost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase())
  return new Set(symbols).size < symbols.length
}

const each = (cards: CompanionCard[], breaks: (c: CompanionCard) => boolean): CompanionResult => {
  const offenders: string[] = []
  for (const c of cards) if (breaks(c) && !offenders.some((o) => o.toLowerCase() === c.name.toLowerCase())) offenders.push(c.name)
  return { met: offenders.length === 0, offenders }
}

/**
 * Whether [cards] — the starting deck, commanders included — meet companion [name]'s condition, and
 * which cards don't. [minimumSize] is the format's smallest deck (60, 40 in Limited, 100 in Commander).
 * Not a companion: met.
 */
export function checkCompanion(name: string, cards: CompanionCard[], minimumSize: number): CompanionResult {
  const mv = (c: CompanionCard) => c.cmc
  switch (companionNamed(name)?.short) {
    case 'Gyruda':
      return each(cards, (c) => mv(c) != null && mv(c)! % 2 !== 0)
    case 'Jegantha':
      return each(cards, (c) => c.manaCost != null && repeatsManaSymbol(c.manaCost))
    case 'Kaheera':
      return each(cards, (c) => isCreature(c) && !subtypes(c.typeLine!).some((t) => KAHEERA_TYPES.includes(t)) &&
        !/^changeling\b/im.test(c.oracleText ?? ''))
    case 'Keruga':
      return each(cards, (c) => c.typeLine != null && !isLand(c) && mv(c) != null && mv(c)! < 3)
    case 'Lurrus':
      return each(cards, (c) => isPermanent(c) && mv(c) != null && mv(c)! > 2)
    case 'Lutri': {
      const copies = new Map<string, number>()
      for (const c of cards) if (!isLand(c)) copies.set(c.name.toLowerCase(), (copies.get(c.name.toLowerCase()) ?? 0) + c.quantity)
      return each(cards, (c) => !isLand(c) && (copies.get(c.name.toLowerCase()) ?? 0) > 1)
    }
    case 'Obosh':
      return each(cards, (c) => c.typeLine != null && !isLand(c) && mv(c) != null && mv(c)! % 2 !== 1)
    case 'Umori': {
      // The type the most nonland cards share is the one the deck keeps; the rest break it.
      const typed = cards.filter((c) => c.typeLine != null && !isLand(c))
      let best = ''
      let most = -1
      for (const t of CARD_TYPES) {
        const n = typed.filter((c) => cardTypes(c.typeLine!).includes(t)).reduce((s, c) => s + c.quantity, 0)
        if (n > most) { best = t; most = n }
      }
      return each(typed, (c) => !cardTypes(c.typeLine!).includes(best))
    }
    case 'Yorion': {
      const has = cards.reduce((n, c) => n + c.quantity, 0)
      const needs = minimumSize + 20
      return { met: has >= needs, offenders: [], has, needs }
    }
    case 'Zirda':
      return each(cards, (c) => isPermanent(c) && c.oracleText != null && !hasActivatedAbility(c.oracleText))
    default:
      return { met: true, offenders: [] }
  }
}

/** A deck card as the check sees it, from what Scryfall says of it (or only its entry when it isn't known). */
export function companionCard(entry: Pick<DeckCardEntry, 'name' | 'quantity' | 'typeLine'>, card?: ScryfallCard): CompanionCard {
  if (!card) return { name: entry.name, quantity: entry.quantity, cmc: null, manaCost: null, typeLine: entry.typeLine ?? null, oracleText: null }
  const faces = card.card_faces ?? []
  // A split card's cost is both halves'; a double-faced or adventure card's is its front face's.
  const split = card.layout === 'split'
  const manaCost = split
    ? faces.map((f) => f.mana_cost ?? '').join('') || card.mana_cost || ''
    : faces.length > 0 ? faces[0].mana_cost ?? card.mana_cost ?? '' : card.mana_cost ?? ''
  const typeLine = (card.type_line ?? faces[0]?.type_line ?? entry.typeLine ?? '').split('//')[0].trim()
  const oracleText = [card.oracle_text, ...faces.map((f) => f.oracle_text)].filter(Boolean).join('\n')
  return { name: entry.name, quantity: entry.quantity, cmc: card.cmc ?? null, manaCost: manaCost.replace(/\s*\/\/\s*/g, ''), typeLine, oracleText }
}

/** "Sol Ring", "Sol Ring and Arcane Signet", "Sol Ring, Arcane Signet, Mind Stone and 4 more". */
export function nameList(names: string[], shown = 3): string {
  if (names.length <= 1) return names.join('')
  if (names.length <= shown) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`
}

/** The sentence under a broken condition: "Every permanent… Not met by Sol Ring and 2 more." */
export function companionReason(companion: Companion, result: CompanionResult): string {
  if (result.has != null && result.needs != null) return `${companion.rule} It has ${result.has} of the ${result.needs} needed.`
  return `${companion.rule} Not met by ${nameList(result.offenders)}.`
}

/** The deck's companion's sideboard entry, if the companion is in the sideboard. */
export function companionEntry(deck: Deck): DeckCardEntry | undefined {
  const name = deck.companion?.trim().toLowerCase()
  return name ? (deck.sideboard ?? []).find((c) => c.name.trim().toLowerCase() === name) : undefined
}

/** The deck with [name] as its companion; null or "" takes it off (kept as "" once set — see Deck.companion). */
export function withCompanion(deck: Deck, name: string | null): Deck {
  const next = name?.trim() ?? ''
  if (!next && deck.companion === undefined) return deck
  return { ...deck, companion: next }
}

/**
 * Why adding [card] to the main deck would break the deck's companion condition — "Breaks Lurrus's
 * condition" — or null. Only the card's own part is checked (Yorion's count isn't): [deckCards] are the
 * deck's cards as their entries know them, for Lutri's names and Umori's types.
 */
export function companionAddProblem(deck: Deck, card: CompanionCard): string | null {
  const companion = companionNamed(deck.companion)
  if (!companion || companion.short === 'Yorion') return null
  const deckCards = deck.cards.map((e) => companionCard(e))
  const result = checkCompanion(companion.name, [...deckCards, card], 0)
  return result.offenders.some((o) => o.toLowerCase() === card.name.toLowerCase()) ? `Breaks ${companion.short}'s companion condition` : null
}

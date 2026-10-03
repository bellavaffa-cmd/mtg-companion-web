// Which two commanders may lead a deck together. Shared by the new-deck flow, the deck page's
// "Set as partner commander", the legality check and setCommander — and the Android app is to get
// the same rules, so they live here as plain functions over what a deck entry stores.
//
// A deck entry keeps no rules text, only its name, type line and one string, `partnerAbility`
// (DeckCardEntry.partnerAbility, synced with the phone). That string says which pairing ability
// the card has:
//   null                   none
//   "Partner"              plain Partner: pairs with any other plain-Partner card
//   "Friends forever"      pairs with any other Friends forever card (old wording and the newer
//                          "Partner—Friends forever" both store this)
//   "Partner—<variant>"    another named Partner variant ("Partner—Survivors", "Partner—Father &
//                          son"): pairs only with the same variant
//   "Choose a Background"  pairs with a legendary Background enchantment
//   "Doctor's companion"   pairs with a legendary creature that is a Time Lord Doctor and nothing else
//   anything else          the <Name> of "Partner with <Name>": pairs only with that card
// Backgrounds and Time Lord Doctors have no ability of their own; they're known by their type line.

import type { ScryfallCard } from '../types/scryfall'

export const PARTNER = 'Partner'
export const FRIENDS_FOREVER = 'Friends forever'
export const CHOOSE_A_BACKGROUND = 'Choose a Background'
export const DOCTORS_COMPANION = "Doctor's companion"

/** What pairing needs to know about a card: a deck entry has exactly this. */
export interface PairCard {
  name: string
  typeLine: string | null
  partnerAbility: string | null
}

/** The phrase at the start of an oracle line, up to its reminder text. */
const lineHead = (line: string) => line.split(' (')[0].trim()

/**
 * The pairing ability [card] has, in the stored form described at the top of this file. Read from
 * the oracle text (every face); Scryfall's keyword list backs it up for the fixed phrases.
 */
export function pairingAbility(card: Pick<ScryfallCard, 'oracle_text' | 'card_faces' | 'keywords'>): string | null {
  const text = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n')
  for (const raw of text.split('\n')) {
    // Scryfall writes straight apostrophes, but a curly one costs nothing to accept.
    const line = lineHead(raw.replace(/’/g, "'"))
    const lower = line.toLowerCase()
    if (lower.startsWith('partner with ')) return line.slice('partner with '.length).trim()
    const variant = /^partner\s*[—–-]\s*(.+)$/i.exec(line)
    if (variant) {
      const name = variant[1].trim()
      return name.toLowerCase() === FRIENDS_FOREVER.toLowerCase() ? FRIENDS_FOREVER : `${PARTNER}—${name}`
    }
    if (lower === 'partner') return PARTNER
    if (lower === FRIENDS_FOREVER.toLowerCase()) return FRIENDS_FOREVER
    if (lower === CHOOSE_A_BACKGROUND.toLowerCase()) return CHOOSE_A_BACKGROUND
    if (lower === DOCTORS_COMPANION.toLowerCase()) return DOCTORS_COMPANION
  }
  const keywords = (card.keywords ?? []).map((k) => k.toLowerCase())
  for (const phrase of [FRIENDS_FOREVER, CHOOSE_A_BACKGROUND, DOCTORS_COMPANION]) {
    if (keywords.includes(phrase.toLowerCase())) return phrase
  }
  return null
}

/** The front face's type line split into its types and its subtypes. */
function typesOf(typeLine: string | null): { types: string[]; subtypes: string[] } {
  const front = (typeLine ?? '').split('//')[0]
  const [types, subtypes = ''] = front.split(/\s+[—–-]\s+/)
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
  return { types: words(types), subtypes: words(subtypes) }
}

/** A legendary Background enchantment — what "Choose a Background" pairs with. */
export function isBackground(card: Pick<PairCard, 'typeLine'>): boolean {
  const { types, subtypes } = typesOf(card.typeLine)
  return types.includes('Legendary') && types.includes('Enchantment') && subtypes.includes('Background')
}

/**
 * A legendary creature whose only creature types are Time Lord Doctor — what "Doctor's companion"
 * pairs with. A Doctor that's also, say, a Human doesn't qualify.
 */
export function isTimeLordDoctor(card: Pick<PairCard, 'typeLine'>): boolean {
  const { types, subtypes } = typesOf(card.typeLine)
  return types.includes('Legendary') && types.includes('Creature') && subtypes.join(' ') === 'Time Lord Doctor'
}

const FIXED = new Set([PARTNER, FRIENDS_FOREVER, CHOOSE_A_BACKGROUND, DOCTORS_COMPANION])
const isVariant = (ability: string) => ability.startsWith(`${PARTNER}—`)
/** The <Name> of "Partner with <Name>", or null for every other ability. */
const partnerWithTarget = (ability: string | null) => (ability && !FIXED.has(ability) && !isVariant(ability) ? ability : null)

const sameName = (a: string, b: string) => {
  const norm = (s: string) => s.trim().toLowerCase()
  return norm(a) === norm(b) || norm(a.split(' // ')[0]) === norm(b.split(' // ')[0])
}

/** One way round: whether [a]'s ability accepts [b]. canPair asks it both ways. */
function accepts(a: PairCard, b: PairCard): boolean {
  const ability = a.partnerAbility
  if (!ability) return false
  if (ability === PARTNER) return b.partnerAbility === PARTNER
  if (ability === FRIENDS_FOREVER || isVariant(ability)) return b.partnerAbility === ability
  if (ability === CHOOSE_A_BACKGROUND) return isBackground(b)
  if (ability === DOCTORS_COMPANION) return isTimeLordDoctor(b)
  const target = partnerWithTarget(ability)
  return !!target && sameName(target, b.name)
}

/**
 * Whether [a] and [b] may be a deck's two commanders, in either order: both plain Partner, one
 * "Partner with" the other, the same Partner variant (Friends forever…), a "Choose a Background"
 * commander and a Background, or a "Doctor's companion" and a Time Lord Doctor.
 */
export function canPair(a: PairCard, b: PairCard): boolean {
  if (sameName(a.name, b.name)) return false
  return accepts(a, b) || accepts(b, a)
}

/** What the second commander would be, for a card that can have one. */
export type SecondCommanderKind = 'PARTNER' | 'BACKGROUND' | 'DOCTOR' | 'COMPANION'

/**
 * Whether [main] can lead with a second commander, and of what kind: a partner (any Partner
 * flavour), a Background, a Doctor (for a Doctor's companion) or a companion (for a Time Lord
 * Doctor). Null when it can't have one.
 */
export function secondCommanderKind(main: PairCard): SecondCommanderKind | null {
  const ability = main.partnerAbility
  if (ability === CHOOSE_A_BACKGROUND) return 'BACKGROUND'
  if (ability === DOCTORS_COMPANION) return 'DOCTOR'
  if (ability) return 'PARTNER'
  if (isTimeLordDoctor(main)) return 'COMPANION'
  return null
}

/** The button that offers one: "Add a partner", "Add a Background"… */
export const SECOND_COMMANDER_ACTION: Record<SecondCommanderKind, string> = {
  PARTNER: 'Add a partner',
  BACKGROUND: 'Add a Background',
  DOCTOR: 'Add a Doctor',
  COMPANION: "Add a Doctor's companion",
}

/** What the second commander is called in the deck's card actions: "Set as partner commander"… */
export const SECOND_COMMANDER_NOUN: Record<SecondCommanderKind, string> = {
  PARTNER: 'partner commander',
  BACKGROUND: 'Background',
  DOCTOR: 'Doctor',
  COMPANION: "Doctor's companion",
}

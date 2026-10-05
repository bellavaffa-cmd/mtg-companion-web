// Trimmed to the fields this app actually uses — mirrors the shape of
// MtgCompanionApp's ScryfallCard, not Scryfall's full schema.

import { pairingAbility } from '../decks/pairing'

export interface ScryfallImageUris {
  small?: string
  normal?: string
  large?: string
  art_crop?: string
}

export interface ScryfallCardFace {
  name?: string
  type_line?: string
  oracle_text?: string
  mana_cost?: string
  image_uris?: ScryfallImageUris
  /** A double-faced card keeps these on each face (the Advanced filter reads every face). */
  colors?: string[]
  power?: string
  toughness?: string
  loyalty?: string
  artist?: string
  flavor_text?: string
}

export interface ScryfallCard {
  id: string
  oracle_id?: string
  name: string
  type_line?: string
  oracle_text?: string
  mana_cost?: string
  cmc?: number
  colors?: string[]
  color_identity?: string[]
  produced_mana?: string[]
  /** e.g. "normal", "transform", "modal_dfc", "split", "adventure", "flip", "meld". Determines
   * whether card_faces is a flippable back side (hasFlipSides) or just two rules-text blocks
   * printed on one face (split/adventure — already merged by displayOracleText). */
  layout?: string
  /** Printed keyword abilities, e.g. ["Flying", "Lifelink"] — feeds cardTags() alongside a few
   * heuristic theme tags (Lifegain, Removal, ...) inferred from oracle text. */
  keywords?: string[]
  rarity?: string
  set?: string
  set_name?: string
  collector_number?: string
  /**
   * The name printed large on a Universes Beyond card, with the real name in smaller type beneath
   * it ("Kefka's Tower" over "Bolas's Citadel"). It's what the camera reads.
   */
  flavor_name?: string
  /** The finishes this printing comes in: 'nonfoil', 'foil', 'etched'. */
  finishes?: string[]
  released_at?: string
  /** Where EDHREC ranks the card by how many decks play it (1 = most). Absent for unplayed cards. */
  edhrec_rank?: number
  legalities?: Record<string, string>
  prices?: { usd?: string | null; usd_foil?: string | null; eur?: string | null }
  /** Where to buy this printing (see api/buy.ts). */
  purchase_uris?: { tcgplayer?: string | null; cardmarket?: string | null; cardhoarder?: string | null }
  image_uris?: ScryfallImageUris
  card_faces?: ScryfallCardFace[]
  game_changer?: boolean
  /** On the Reserved List: never to be reprinted. */
  reserved?: boolean
  /** Printed with art over the whole card. */
  full_art?: boolean
  /** As printed: "3", "*", "1+*". Strings, so a non-number stays as it is. */
  power?: string
  toughness?: string
  loyalty?: string
  artist?: string
  flavor_text?: string
  /**
   * Everything printed alongside this card: the tokens it makes, an emblem, the other half of a
   * meld. Scryfall sends it on any card that has one — see decks/tokens.ts.
   */
  all_parts?: ScryfallPart[]
}

/** One of a card's [all_parts]: what it is, and enough to look it up. */
export interface ScryfallPart {
  id: string
  /** 'token', 'meld_part', 'meld_result', 'combo_piece'. */
  component?: string
  name: string
  type_line?: string
}

export function displayImageUrl(card: ScryfallCard | null | undefined): string | null {
  if (!card) return null
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null
}

/** The big art, for a hover preview or a zoom: 'large' where Scryfall has it, else what we'd show. */
export function largeImageUrl(card: ScryfallCard | null | undefined): string | null {
  if (!card) return null
  return card.image_uris?.large ?? card.card_faces?.[0]?.image_uris?.large ?? displayImageUrl(card)
}

/**
 * The whole card, big, from the address of any other size of the same picture — Scryfall's URLs are
 * …/<size>/front/a/b/id.jpg, so an art crop leads back to the full card. For the hover preview,
 * which often has only the thumbnail's address to go on. Null for anything else, rather than a guess
 * that would 404.
 */
export function biggerImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  return /^https:\/\/cards\.scryfall\.io\/(small|normal|art_crop|border_crop)\//.test(url)
    ? url.replace(/\/(small|normal|art_crop|border_crop)\//, '/large/')
    : null
}

const FLIPPABLE_LAYOUTS = new Set(['transform', 'modal_dfc', 'flip', 'reversible_card', 'double_faced_token'])

/** True for cards with a real second side to flip to: transform, modal DFC, flip, and reversible
 * cards. False for split/adventure (two spells/rules blocks printed on one face). */
export function hasFlipSides(card: ScryfallCard | null | undefined): boolean {
  return !!card && card.card_faces?.length === 2 && !!card.layout && FLIPPABLE_LAYOUTS.has(card.layout)
}

/** The second face's image, when this card actually flips (hasFlipSides) — null otherwise. */
export function backImageUrl(card: ScryfallCard | null | undefined): string | null {
  if (!hasFlipSides(card)) return null
  return card!.card_faces?.[1]?.image_uris?.normal ?? null
}

export function displayOracleText(card: ScryfallCard): string | null {
  if (card.oracle_text) return card.oracle_text
  if (card.card_faces?.length) {
    return card.card_faces
      .map((f) => [f.type_line, f.oracle_text].filter(Boolean).join('\n'))
      .join('\n\n')
  }
  return null
}

/** The printed cast cost as `{X}` symbol syntax. Double-faced cards carry an empty top-level
 * `mana_cost` with the real one on the front face, so fall back to that. Split/adventure cards
 * already have both halves in the top-level string. */
export function displayManaCost(card: ScryfallCard): string | null {
  if (card.mana_cost) return card.mana_cost
  return card.card_faces?.[0]?.mana_cost ?? null
}

/**
 * Whether [card] can lead a deck of [gameMode]. Commander takes a legendary creature or a card that
 * says it "can be your commander"; Brawl takes those and any legendary planeswalker too. Decks store
 * the Commander answer on each card (DeckCardEntry.canBeCommander) — see entryCanBeCommander.
 */
export function canBeCommander(card: ScryfallCard, gameMode: string = 'COMMANDER'): boolean {
  const type = card.type_line ?? ''
  const isLegendaryCreature = type.includes('Legendary') && type.includes('Creature')
  const explicit = (card.oracle_text ?? '').toLowerCase().includes('can be your commander')
  return isLegendaryCreature || explicit || (gameMode === 'BRAWL' && isLegendaryPlaneswalker(type))
}

const isLegendaryPlaneswalker = (typeLine: string) => typeLine.includes('Legendary') && typeLine.includes('Planeswalker')

/**
 * Whether a card already in a deck can be that deck's commander. The stored flag is the Commander
 * rule (it's the same field the Android app writes), so Brawl's planeswalkers are read off the type line.
 */
export function entryCanBeCommander(entry: { canBeCommander: boolean; typeLine: string | null }, gameMode: string): boolean {
  return entry.canBeCommander || (gameMode === 'BRAWL' && isLegendaryPlaneswalker(entry.typeLine ?? ''))
}

/**
 * The card's way of having a second commander, as a deck entry stores it — "Partner", the name a
 * "Partner with" names, "Choose a Background"… See decks/pairing.ts, which also says how they pair.
 */
export function partnerAbility(card: ScryfallCard): string | null {
  return pairingAbility(card)
}

/** Checked in order, so e.g. "Artifact Creature" resolves to "Creature". Mirrors the Android
 * app's ScryfallCard.PRIMARY_TYPES / DeckDetailViewModel's type-grouping priority. */
const PRIMARY_TYPES = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land']

/** e.g. "Creature" from "Legendary Creature — Human Wizard" — used for the "similar cards" search. */
export function primaryType(card: ScryfallCard): string {
  const line = (card.type_line ?? '').toLowerCase()
  return PRIMARY_TYPES.find((t) => line.includes(t.toLowerCase())) ?? 'Other'
}

/** Heuristic oracle-text patterns for common deckbuilding theme tags that aren't printed keywords.
 * Approximate by nature — a differently-worded effect is a likelier miss than a false positive,
 * so this stays a short, conservative list. Mirrors the Android app's THEME_TAG_RULES. */
const THEME_TAG_RULES: { label: string; pattern: RegExp }[] = [
  { label: 'Lifegain', pattern: /gain(s)?\s+\S*\s*life|whenever you gain life/i },
  { label: 'Card Draw', pattern: /draws? (a|two|three|\d+|that many) cards?/i },
  { label: 'Removal', pattern: /destroy target|exile target|deals? \d+ damage to target/i },
  { label: 'Ramp', pattern: /search your library for a( basic)? land card|add \{[wubrgc]\}/i },
  { label: 'Tokens', pattern: /creates? [^.]*token/i },
  { label: 'Counterspell', pattern: /counter target spell/i },
]

/** Printed keywords plus a handful of heuristic theme tags — shown as chips wherever the full
 * card (not just a cached deck/binder entry) is on hand. */
export function cardTags(card: ScryfallCard): string[] {
  const result = new Set<string>(card.keywords ?? [])
  const text = displayOracleText(card) ?? ''
  for (const rule of THEME_TAG_RULES) {
    if (rule.pattern.test(text)) result.add(rule.label)
  }
  return [...result]
}

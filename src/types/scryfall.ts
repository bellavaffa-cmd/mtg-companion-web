// Trimmed to the fields this app actually uses — mirrors the shape of
// MtgCompanionApp's ScryfallCard, not Scryfall's full schema.

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
  released_at?: string
  legalities?: Record<string, string>
  prices?: { usd?: string | null; usd_foil?: string | null }
  image_uris?: ScryfallImageUris
  card_faces?: ScryfallCardFace[]
  game_changer?: boolean
}

export function displayImageUrl(card: ScryfallCard | null | undefined): string | null {
  if (!card) return null
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null
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

export function artCropUrl(card: ScryfallCard | null | undefined): string | null {
  if (!card) return null
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? displayImageUrl(card)
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

export function canBeCommander(card: ScryfallCard): boolean {
  const type = card.type_line ?? ''
  const isLegendaryCreature = type.includes('Legendary') && type.includes('Creature')
  const explicit = (card.oracle_text ?? '').toLowerCase().includes('can be your commander')
  return isLegendaryCreature || explicit
}

/** null (no partner ability), "Partner" (plain), or the exact "Partner with <Name>" target. */
export function partnerAbility(card: ScryfallCard): string | null {
  const text = displayOracleText(card)
  if (!text) return null
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('Partner'))
  if (!line) return null
  const withPrefix = 'Partner with '
  if (line.toLowerCase().startsWith(withPrefix.toLowerCase())) {
    return line.slice(withPrefix.length).split(' (')[0].trim()
  }
  return 'Partner'
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

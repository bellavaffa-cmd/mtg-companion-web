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
  image_uris?: ScryfallImageUris
}

export interface ScryfallCard {
  id: string
  name: string
  type_line?: string
  oracle_text?: string
  mana_cost?: string
  cmc?: number
  colors?: string[]
  color_identity?: string[]
  produced_mana?: string[]
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

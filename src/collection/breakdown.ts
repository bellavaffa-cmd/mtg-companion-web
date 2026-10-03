// Where the collection's value sits: by set, by colour, by rarity and by card type, and the cards
// worth the most. Every copy counts at the card's non-foil US dollar price, as the dashboard's total
// does; proxies aren't counted. Mirrors the Android app's data/CollectionBreakdown.kt.

/** One owned card (a printing) and what's known about it. [usd]: one copy's price; null when there's none. */
export interface BreakdownCard {
  id: string
  name: string
  imageUrl: string | null
  copies: number
  usd: number | null
  setCode?: string
  setName?: string
  /** Colour identity as WUBRG letters; empty for a colourless card. */
  colors?: Set<string>
  rarity?: string
  typeLine?: string
}

/** One part of a breakdown: its [label], what it's worth and how many copies are in it. */
export interface Slice { label: string; usd: number; copies: number }

export interface CollectionBreakdown {
  totalUsd: number
  bySet: Slice[]
  byColor: Slice[]
  byRarity: Slice[]
  byType: Slice[]
  /** The cards worth most, all copies counted, dearest first. */
  mostValuable: BreakdownCard[]
}

/** All copies of [card] at its price. */
export const cardValue = (card: BreakdownCard) => (card.usd ?? 0) * card.copies

/** The colour buckets, in this order: one per colour, then two or more, then none. */
export const COLOR_BUCKETS = ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless']

const COLOR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }

/** A card's colour bucket: its one colour, Multicolor for two or more, Colorless for none. */
export function colorBucket(colors: Set<string>): string {
  const known = [...colors].filter((c) => c in COLOR_NAMES)
  return known.length === 0 ? 'Colorless' : known.length === 1 ? COLOR_NAMES[known[0]] : 'Multicolor'
}

/** Rarities, commonest first; anything else (special, bonus) is Other. */
export const RARITY_BUCKETS = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Other']

export function rarityBucket(rarity: string): string {
  const r = rarity.toLowerCase()
  return r === 'common' ? 'Common' : r === 'uncommon' ? 'Uncommon' : r === 'rare' ? 'Rare' : r === 'mythic' ? 'Mythic' : 'Other'
}

/** A card's main type, creatures first (an artifact creature is a creature), as the dashboard sorts them. */
export function typeBucket(typeLine: string): string {
  const line = typeLine.toLowerCase()
  return ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Battle', 'Land'].find((t) => line.includes(t.toLowerCase())) ?? 'Other'
}

function slices(cards: BreakdownCard[], label: (c: BreakdownCard) => string): Slice[] {
  const out = new Map<string, Slice>()
  for (const c of cards) {
    const l = label(c)
    const s = out.get(l) ?? { label: l, usd: 0, copies: 0 }
    s.usd += cardValue(c)
    s.copies += c.copies
    out.set(l, s)
  }
  return [...out.values()]
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The breakdown of [cards] (cards with no copies are left out): sets by value, the [topSets] worth
 * most and the rest together as "Other sets"; colours, rarities and types in their usual order with
 * empty ones left out; and the [topCards] most valuable cards.
 */
export function collectionBreakdown(cards: BreakdownCard[], topSets = 8, topCards = 10): CollectionBreakdown {
  const owned = cards.filter((c) => c.copies > 0)
  const sets = slices(owned, (c) => c.setName?.trim() || c.setCode?.toUpperCase().trim() || 'Unknown set')
    .sort((a, b) => b.usd - a.usd || b.copies - a.copies || cmp(a.label, b.label))
  const bySet = sets.length <= topSets + 1 ? sets : (() => {
    const rest = sets.slice(topSets)
    return [...sets.slice(0, topSets), { label: 'Other sets', usd: rest.reduce((n, s) => n + s.usd, 0), copies: rest.reduce((n, s) => n + s.copies, 0) }]
  })()
  const ordered = (list: Slice[], order: string[]) => {
    const at = (l: string) => (order.includes(l) ? order.indexOf(l) : order.length)
    return [...list].sort((a, b) => at(a.label) - at(b.label))
  }
  return {
    totalUsd: owned.reduce((n, c) => n + cardValue(c), 0),
    bySet,
    byColor: ordered(slices(owned, (c) => colorBucket(c.colors ?? new Set())), COLOR_BUCKETS),
    byRarity: ordered(slices(owned, (c) => rarityBucket(c.rarity ?? '')), RARITY_BUCKETS),
    byType: slices(owned, (c) => typeBucket(c.typeLine ?? '')).sort((a, b) => b.usd - a.usd || b.copies - a.copies),
    mostValuable: owned.filter((c) => c.usd != null && cardValue(c) > 0)
      .sort((a, b) => cardValue(b) - cardValue(a) || cmp(a.name.toLowerCase(), b.name.toLowerCase()))
      .slice(0, topCards),
  }
}

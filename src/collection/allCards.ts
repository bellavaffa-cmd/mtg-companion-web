// All cards: every card the user owns — in any binder (the Unsorted pile too, never a wishlist) or
// any deck — one row a printing, with the copies added up and where they are. Plus the totals
// panel over them, and what picking some of them can do. Mirrors the Android app's
// CollectionsViewModel (allCards), Dashboard.kt and CollectionRepository (gatherInto, removeEverywhere).

import type { Collection, CollectionEntry, Deck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

export interface CardSource { kind: 'binder' | 'deck'; id: string; name: string; quantity: number }

export interface AllCard {
  scryfallId: string
  name: string
  imageUrl: string | null
  backImageUrl?: string | null
  tags?: string[]
  total: number
  sources: CardSource[]
}

const owns = (c: Collection) => c.type !== 'WISHLIST'

/** Every card in [collections]' owned binders and in [decks], by printing, A to Z. */
export function allCardsOf(collections: Collection[], decks: Deck[]): AllCard[] {
  const byCard = new Map<string, AllCard>()
  const add = (e: { scryfallId: string; name: string; imageUrl: string | null; backImageUrl?: string | null; tags?: string[] }, quantity: number, source: CardSource) => {
    if (quantity <= 0) return
    let card = byCard.get(e.scryfallId)
    if (!card) {
      card = { scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, backImageUrl: e.backImageUrl ?? null, tags: e.tags, total: 0, sources: [] }
      byCard.set(e.scryfallId, card)
    }
    card.total += quantity
    card.sources.push(source)
  }
  for (const c of collections.filter(owns)) {
    for (const e of c.entries) {
      const q = e.quantity + e.foilQuantity
      add(e, q, { kind: 'binder', id: c.id, name: c.name, quantity: q })
    }
  }
  for (const d of decks) {
    for (const e of d.cards) add(e, e.quantity, { kind: 'deck', id: d.id, name: d.name, quantity: e.quantity })
  }
  return [...byCard.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

/** [collections] with every copy of the cards [ids] in the other owned binders gathered into [toId]. */
export function gatherInto(collections: Collection[], toId: string, ids: Set<string>): Collection[] {
  const sources = collections.filter((c) => c.id !== toId && owns(c))
  const moving = sources.flatMap((c) => c.entries.filter((e) => ids.has(e.scryfallId)))
  if (moving.length === 0) return collections
  return collections.map((c) => {
    if (c.id === toId) {
      let entries = c.entries
      for (const m of moving) {
        entries = entries.some((e) => e.scryfallId === m.scryfallId)
          ? entries.map((e) => (e.scryfallId === m.scryfallId ? { ...e, quantity: e.quantity + m.quantity, foilQuantity: e.foilQuantity + m.foilQuantity } : e))
          : [...entries, { ...m }]
      }
      return { ...c, entries }
    }
    return sources.includes(c) ? { ...c, entries: c.entries.filter((e) => !ids.has(e.scryfallId)) } : c
  })
}

/** [collections] with the cards [ids] gone from every owned binder; wishlists keep theirs. */
export function removeEverywhere(collections: Collection[], ids: Set<string>): Collection[] {
  return collections.map((c) => (owns(c) && c.entries.some((e) => ids.has(e.scryfallId)) ? { ...c, entries: c.entries.filter((e) => !ids.has(e.scryfallId)) } : c))
}

/** How many copies of the cards [ids] the owned binders hold — what removing them takes away. */
export function copiesInBinders(collections: Collection[], ids: Set<string>): number {
  return collections.filter(owns).flatMap((c) => c.entries).filter((e) => ids.has(e.scryfallId)).reduce((n, e) => n + e.quantity + e.foilQuantity, 0)
}

/**
 * The picked cards [ids] as entries to export: the binders' copies added up (foils kept apart),
 * or a deck's copies for a card that's only in decks.
 */
export function exportEntries(collections: Collection[], cards: AllCard[], ids: Set<string>): CollectionEntry[] {
  const byCard = new Map<string, CollectionEntry>()
  for (const e of collections.filter(owns).flatMap((c) => c.entries)) {
    if (!ids.has(e.scryfallId)) continue
    const had = byCard.get(e.scryfallId)
    byCard.set(e.scryfallId, had ? { ...had, quantity: had.quantity + e.quantity, foilQuantity: had.foilQuantity + e.foilQuantity } : { ...e })
  }
  const deckOnly = cards.filter((c) => ids.has(c.scryfallId) && !byCard.has(c.scryfallId))
    .map((c): CollectionEntry => ({ scryfallId: c.scryfallId, name: c.name, imageUrl: c.imageUrl, quantity: c.total, foilQuantity: 0, backImageUrl: c.backImageUrl }))
  return [...byCard.values(), ...deckOnly]
}

export interface CollectionDashboard {
  /** Value in US dollars, of the copies Scryfall has a price for. */
  totalUsd: number
  pricedCount: number
  /** W, U, B, R, G, Colorless — copies in each colour identity (a two-colour card counts in both). */
  colorCounts: [string, number][]
  /** Card type → copies, most first. */
  typeCounts: [string, number][]
  cards: number
  /** Each card's price (USD, non-foil), by scryfallId. */
  prices: Map<string, number>
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Battle', 'Land']

/** A card's type for the totals, creatures first: "Artifact Creature" is a Creature. */
export function primaryType(typeLine: string | null | undefined): string {
  const line = (typeLine ?? '').toLowerCase()
  return TYPE_ORDER.find((t) => line.includes(t.toLowerCase())) ?? 'Other'
}

/** The totals for [cards], from Scryfall's data for them ([cardsById]); null with nothing to count. */
export function dashboardOf(cards: { scryfallId: string; total: number }[], cardsById: Map<string, ScryfallCard>): CollectionDashboard | null {
  if (cards.length === 0 || cardsById.size === 0) return null
  let totalUsd = 0
  let pricedCount = 0
  const colors = new Map<string, number>(['W', 'U', 'B', 'R', 'G', 'Colorless'].map((c) => [c, 0]))
  const types = new Map<string, number>()
  const prices = new Map<string, number>()
  for (const { scryfallId, total } of cards) {
    const card = cardsById.get(scryfallId)
    if (!card) continue
    const usd = card.prices?.usd ? Number(card.prices.usd) : NaN
    if (Number.isFinite(usd)) {
      totalUsd += usd * total
      pricedCount += total
      prices.set(scryfallId, usd)
    }
    const identity = card.color_identity?.length ? card.color_identity : card.colors ?? []
    if (identity.length === 0) colors.set('Colorless', colors.get('Colorless')! + total)
    else for (const c of identity) if (colors.has(c)) colors.set(c, colors.get(c)! + total)
    const type = primaryType(card.type_line ?? card.card_faces?.[0]?.type_line)
    types.set(type, (types.get(type) ?? 0) + total)
  }
  return {
    totalUsd,
    pricedCount,
    colorCounts: [...colors].filter(([, n]) => n > 0),
    typeCounts: [...types].sort((a, b) => b[1] - a[1]),
    cards: cards.reduce((n, c) => n + c.total, 0),
    prices,
  }
}

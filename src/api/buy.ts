/**
 * Where to buy a card. Scryfall hands out a shop link per printing; without one (a card the app
 * only knows by name, like a binder entry) TCGplayer's own search does the job. A whole list of
 * cards goes to TCGplayer's mass entry, which fills a basket in one go.
 * Mirrors the Android app's Buy buttons (CardDetailScreen, DeckDetailViewModel.buyMissingUrl).
 */

import type { ScryfallCard } from '../types/scryfall'

/** Where to buy [card], or the card named [name] when there's no card data to hand. */
export function buyCardUrl(card: ScryfallCard | null | undefined, name?: string): string {
  const shop = card?.purchase_uris?.tcgplayer
  if (shop) return shop
  const search = (card?.name ?? name ?? '').trim()
  return `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(search)}&productLineName=magic`
}

/** A card to buy and how many copies. */
export interface BuyLine { name: string; quantity: number }

/**
 * A basket of [cards] at TCGplayer: "2 Sol Ring||1 Cultivate", the format its mass entry page reads.
 * Null with nothing to buy.
 */
export function buyListUrl(cards: BuyLine[]): string | null {
  const lines = cards
    .filter((c) => c.name.trim().length > 0)
    .map((c) => `${Math.max(1, c.quantity)} ${c.name.trim()}`)
  if (lines.length === 0) return null
  return `https://store.tcgplayer.com/massentry?c=${encodeURIComponent(lines.join('||'))}`
}

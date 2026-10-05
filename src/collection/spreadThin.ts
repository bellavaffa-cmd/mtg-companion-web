/**
 * Cards spread too thin: the cards your decks between them use more copies of than you own — Sol
 * Ring in four decks with two copies to go round. Counted the way a deck's missing cards are
 * (decks/missing.ts): by card name, since any printing fills a slot; what you own is the copies in
 * your binders (the Unsorted pile too, never the Wishlist) plus the real copies sitting in the decks
 * you hold (Physical, and the cards swapped into a Proxy deck). A Proxy deck's proxies are
 * print-outs it already has, so they ask for nothing. Basic lands are left out.
 * Mirrors the Android app's data/SpreadThin.kt.
 */

import type { Collection, Deck } from '../types/models'
import { copiesHeld, isBasicLand } from '../decks/missing'
import { proxyCopies } from '../decks/proxies'
import { buildCardListText } from './cardListText'

const key = (name: string) => name.trim().toLowerCase()

/** One deck playing the card, and how many copies. */
export interface ThinUse {
  deckId: string
  deckName: string
  copies: number
}

export interface ThinCard {
  name: string
  imageUrl: string | null
  /** The printings the decks play, for a price. */
  scryfallIds: string[]
  /** Copies you own: binders plus the real copies in decks you hold. */
  owned: number
  /** Copies your decks use between them. */
  used: number
  /** How many more you'd need for every deck to have its own. */
  short: number
  /** Most copies first. */
  decks: ThinUse[]
}

/** Copies of each card [deck] asks for: all of them, except a Proxy deck's proxies. */
function copiesUsed(deck: Deck): Map<string, number> {
  const used = new Map<string, number>()
  for (const entry of deck.cards) {
    const copies = entry.quantity - (deck.ownership === 'PROXY' ? proxyCopies(deck, entry) : 0)
    if (copies > 0) used.set(key(entry.name), (used.get(key(entry.name)) ?? 0) + copies)
  }
  return used
}

/** Every card your decks use more copies of than you own, the shortest first. */
export function spreadThin(collections: Collection[], decks: Deck[]): ThinCard[] {
  const owned = new Map<string, number>()
  const add = (name: string, copies: number) => owned.set(key(name), (owned.get(key(name)) ?? 0) + copies)
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) add(e.name, e.quantity + e.foilQuantity)
  }
  for (const d of decks) for (const [name, copies] of copiesHeld(d)) add(name, copies)

  const byName = new Map<string, ThinCard>()
  for (const d of decks) {
    const used = copiesUsed(d)
    for (const entry of d.cards) {
      const k = key(entry.name)
      const copies = used.get(k)
      if (!copies || isBasicLand(entry.name)) continue
      let card = byName.get(k)
      if (!card) {
        card = { name: entry.name, imageUrl: entry.imageUrl, scryfallIds: [], owned: owned.get(k) ?? 0, used: 0, short: 0, decks: [] }
        byName.set(k, card)
      }
      if (!card.scryfallIds.includes(entry.scryfallId)) card.scryfallIds.push(entry.scryfallId)
      // A deck holding two printings of a card is one deck using it.
      if (!card.decks.some((u) => u.deckId === d.id)) {
        card.decks.push({ deckId: d.id, deckName: d.name, copies })
        card.used += copies
      }
    }
  }
  return [...byName.values()]
    .map((c) => ({ ...c, short: c.used - c.owned, decks: [...c.decks].sort((a, b) => b.copies - a.copies || a.deckName.localeCompare(b.deckName)) }))
    .filter((c) => c.short > 0)
    .sort((a, b) => b.short - a.short || b.used - a.used || a.name.localeCompare(b.name))
}

/**
 * What the copies [card] is short of cost, in US dollars: its cheapest printing among the decks'
 * (by [prices], scryfallId → non-foil price). Null when none of them has a price.
 */
export function shortCost(card: ThinCard, prices: Map<string, number | null | undefined>): number | null {
  const known = card.scryfallIds.map((id) => prices.get(id)).filter((p): p is number => p != null && Number.isFinite(p))
  return known.length ? Math.min(...known) * card.short : null
}

/** The copies to buy as text, "2 Sol Ring" a line — the list format the app exports and TCGplayer reads. */
export function shortBuyList(cards: ThinCard[]): string {
  return buildCardListText(cards.map((c) => ({ scryfallId: c.scryfallIds[0] ?? '', name: c.name, quantity: c.short, foilQuantity: 0 })))
}

/** "You own 2 · 4 decks use 4". */
export function thinLine(card: ThinCard): string {
  return `You own ${card.owned} · ${card.decks.length} ${card.decks.length === 1 ? 'deck uses' : 'decks use'} ${card.used}`
}

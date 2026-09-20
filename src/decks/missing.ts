/**
 * The cards in a deck you don't own: what your binders and the decks you really hold don't cover.
 * Copies in another deck you own count — they're cards you have, even if they're busy — and so do
 * the real cards swapped into a proxy deck. Basic lands are left out; nobody buys those.
 * Mirrors the Android app's missingCards in data/DeckBuilding.kt.
 */

import type { Collection, Deck, DeckCardEntry } from '../types/models'
import { proxyCopies } from './proxies'

const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'])

const key = (name: string) => name.trim().toLowerCase()

const isBasicLand = (name: string) => BASICS.has(key(name).replace(/^snow-covered /, ''))

/** Copies of each card this deck really holds — proxies are print-outs, not copies you have. */
export function copiesHeld(deck: Deck): Map<string, number> {
  const held = new Map<string, number>()
  if (deck.ownership !== 'PHYSICAL' && deck.ownership !== 'PROXY') return held
  for (const entry of deck.cards) {
    const real = entry.quantity - proxyCopies(deck, entry)
    if (real > 0) held.set(key(entry.name), (held.get(key(entry.name)) ?? 0) + real)
  }
  return held
}

/**
 * The deck's cards you don't own, each with the copies still needed as its quantity. A deck you
 * hold covers itself, so it never has anything missing, and a proxy deck is built already.
 */
export function missingCards(deck: Deck, collections: Collection[], decks: Deck[]): DeckCardEntry[] {
  if (deck.ownership === 'PROXY') return []
  const owned = new Map<string, number>()
  const add = (name: string, copies: number) => owned.set(key(name), (owned.get(key(name)) ?? 0) + copies)
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) add(e.name, e.quantity + e.foilQuantity)
  }
  for (const other of decks) {
    for (const [name, copies] of copiesHeld(other)) add(name, copies)
  }

  // One line per card, not per printing: three Swamp printings would each be short of the same copies.
  const byName = new Map<string, DeckCardEntry[]>()
  for (const entry of [deck.commander, deck.partnerCommander, ...deck.cards]) {
    if (!entry || isBasicLand(entry.name)) continue
    const printings = byName.get(key(entry.name))
    if (printings) printings.push(entry)
    else byName.set(key(entry.name), [entry])
  }

  const out: DeckCardEntry[] = []
  for (const [name, printings] of byName) {
    // A commander is also in the deck's cards; count the copies once.
    const wanted = [...new Map(printings.map((e) => [e.scryfallId, e])).values()].reduce((n, e) => n + e.quantity, 0)
    const need = wanted - (owned.get(name) ?? 0)
    if (need > 0) out.push({ ...printings[0], quantity: need })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

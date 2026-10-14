// Where each printing is owned — every owned binder (never the Wishlist) and every deck that counts as
// owned (ownedCopies.ts countsAsOwned: not Virtual, Prototype, a cube or a sample) holding copies of
// it — for "Where you own it" on search results and the card page. Mirrors the Android app's buildCardSources and the zoom's
// "In 2 decks and 1 binder" line (ui/common/CardZoomDialog.kt).

import type { Collection, Deck, DeckCardEntry } from '../types/models'
import { shownName } from '../types/models'
import { countsAsOwned, ownedCopies, ownedProxies } from './ownedCopies'

export interface HeldIn {
  kind: 'binder' | 'deck'
  id: string
  name: string
  quantity: number
}

/** Copies of [e] a deck holds that count as owned: real ones and proxies, as All cards counts them. */
const deckCopies = (d: Deck, e: DeckCardEntry) => ownedCopies(d, e) + ownedProxies(d, e)

/** scryfallId -> the owned binders and owned decks holding it; a card owned nowhere isn't in the map. */
export function cardSources(collections: Collection[], decks: Deck[]): Map<string, HeldIn[]> {
  const out = new Map<string, HeldIn[]>()
  const add = (id: string, source: HeldIn) => {
    if (source.quantity <= 0) return
    const list = out.get(id)
    if (list) list.push(source)
    else out.set(id, [source])
  }
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) add(e.scryfallId, { kind: 'binder', id: c.id, name: shownName(c), quantity: e.quantity + e.foilQuantity })
  }
  for (const d of decks) {
    if (!countsAsOwned(d)) continue
    for (const e of d.cards) add(e.scryfallId, { kind: 'deck', id: d.id, name: d.name, quantity: deckCopies(d, e) })
  }
  return out
}

/** "In 2 decks and 1 binder"; '' when it's held nowhere. */
export function sourcesLabel(sources: HeldIn[]): string {
  const decks = sources.filter((s) => s.kind === 'deck').length
  const binders = sources.length - decks
  const parts = [
    decks > 0 ? `${decks} ${decks === 1 ? 'deck' : 'decks'}` : null,
    binders > 0 ? `${binders} ${binders === 1 ? 'binder' : 'binders'}` : null,
  ].filter(Boolean)
  return parts.length ? `In ${parts.join(' and ')}` : ''
}

/**
 * Every owned binder and owned deck (as [cardSources]) holding any printing of [name] — a card page is about the card, not one
 * printing — with each place's copies added up. A double-faced card answers to its front face too.
 */
export function sourcesForName(collections: Collection[], decks: Deck[], name: string): HeldIn[] {
  const keys = (n: string) => { const full = n.trim().toLowerCase(); return [full, full.split(' // ')[0].trim()] }
  const wanted = new Set(keys(name))
  const matches = (n: string) => keys(n).some((k) => wanted.has(k))
  const out = new Map<string, HeldIn>()
  const add = (source: HeldIn) => {
    if (source.quantity <= 0) return
    const key = `${source.kind}:${source.id}`
    const had = out.get(key)
    out.set(key, had ? { ...had, quantity: had.quantity + source.quantity } : source)
  }
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) if (matches(e.name)) add({ kind: 'binder', id: c.id, name: shownName(c), quantity: e.quantity + e.foilQuantity })
  }
  for (const d of decks) {
    if (!countsAsOwned(d)) continue
    for (const e of d.cards) if (matches(e.name)) add({ kind: 'deck', id: d.id, name: d.name, quantity: deckCopies(d, e) })
  }
  return [...out.values()]
}

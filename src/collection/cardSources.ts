// Where each printing is held — every binder and deck holding copies of it — for "Where you own it"
// on search results and the card page. Mirrors the Android app's buildCardSources and the zoom's
// "In 2 decks and 1 binder" line (ui/common/CardZoomDialog.kt).

import type { Collection, Deck } from '../types/models'

export interface HeldIn {
  kind: 'binder' | 'deck'
  id: string
  name: string
  quantity: number
}

/** scryfallId -> the binders and decks holding it; a card held nowhere isn't in the map. */
export function cardSources(collections: Collection[], decks: Deck[]): Map<string, HeldIn[]> {
  const out = new Map<string, HeldIn[]>()
  const add = (id: string, source: HeldIn) => {
    if (source.quantity <= 0) return
    const list = out.get(id)
    if (list) list.push(source)
    else out.set(id, [source])
  }
  for (const c of collections) {
    for (const e of c.entries) add(e.scryfallId, { kind: 'binder', id: c.id, name: c.name, quantity: e.quantity + e.foilQuantity })
  }
  for (const d of decks) {
    for (const e of d.cards) add(e.scryfallId, { kind: 'deck', id: d.id, name: d.name, quantity: e.quantity })
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
 * Every binder and deck holding any printing of [name] — a card page is about the card, not one
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
  for (const c of collections) for (const e of c.entries) if (matches(e.name)) add({ kind: 'binder', id: c.id, name: c.name, quantity: e.quantity + e.foilQuantity })
  for (const d of decks) for (const e of d.cards) if (matches(e.name)) add({ kind: 'deck', id: d.id, name: d.name, quantity: e.quantity })
  return [...out.values()]
}

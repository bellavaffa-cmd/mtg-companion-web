// What the Undo bar takes back: the copies a change added to or took from each deck, Considering list,
// sideboard and binder, worked out by comparing the library before and after. Undo applies the
// opposite counts to the library as it is by then — not the old library over it — so an edit made in
// between (another card added, a sync from the phone) survives. The Android app's undo does the same.

import type { Library } from './cloudSync'
import type { CollectionEntry, DeckCardEntry } from '../types/models'

/** One card's change in one list: copies added (negative: taken), and the entry to bring back if it went. */
interface CardChange<E> {
  scryfallId: string
  quantity: number
  foilQuantity: number
  entry: E
}

export interface LibraryChange {
  decks: { id: string; cards: CardChange<DeckCardEntry>[]; considering: CardChange<DeckCardEntry>[]; sideboard: CardChange<DeckCardEntry>[] }[]
  collections: { id: string; entries: CardChange<CollectionEntry>[] }[]
}

type Counted = { scryfallId: string; quantity: number; foilQuantity?: number }

function changesIn<E extends Counted>(before: E[] = [], after: E[] = []): CardChange<E>[] {
  if (before === after) return []
  const was = new Map(before.map((e) => [e.scryfallId, e]))
  const now = new Map(after.map((e) => [e.scryfallId, e]))
  const out: CardChange<E>[] = []
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id)
    const b = now.get(id)
    const quantity = (b?.quantity ?? 0) - (a?.quantity ?? 0)
    const foilQuantity = (b?.foilQuantity ?? 0) - (a?.foilQuantity ?? 0)
    if (quantity !== 0 || foilQuantity !== 0) out.push({ scryfallId: id, quantity, foilQuantity, entry: (a ?? b)! })
  }
  return out
}

/** The copies that moved between [before] and [after], list by list. */
export function changeBetween(before: Library, after: Library): LibraryChange {
  const decksBefore = new Map(before.decks.map((d) => [d.id, d]))
  const collectionsBefore = new Map(before.collections.map((c) => [c.id, c]))
  return {
    decks: after.decks.flatMap((d) => {
      const old = decksBefore.get(d.id)
      if (old === d) return []
      const cards = changesIn(old?.cards, d.cards)
      const considering = changesIn(old?.considering, d.considering)
      const sideboard = changesIn(old?.sideboard, d.sideboard)
      return cards.length || considering.length || sideboard.length ? [{ id: d.id, cards, considering, sideboard }] : []
    }),
    collections: after.collections.flatMap((c) => {
      const old = collectionsBefore.get(c.id)
      if (old === c) return []
      const entries = changesIn(old?.entries, c.entries)
      return entries.length ? [{ id: c.id, entries }] : []
    }),
  }
}

export const isNoChange = (change: LibraryChange): boolean => change.decks.length === 0 && change.collections.length === 0

function reverted<E extends Counted>(list: E[], changes: CardChange<E>[]): E[] {
  let out = list
  for (const ch of changes) {
    const current = out.find((e) => e.scryfallId === ch.scryfallId)
    const quantity = (current?.quantity ?? 0) - ch.quantity
    const foilQuantity = (current?.foilQuantity ?? 0) - ch.foilQuantity
    if (quantity <= 0 && foilQuantity <= 0) {
      out = out.filter((e) => e.scryfallId !== ch.scryfallId)
    } else if (current) {
      out = out.map((e) => (e === current ? withCounts(e, quantity, foilQuantity) : e))
    } else {
      // Taken out altogether by the change: it comes back as it was, with its tags and price alert.
      out = [...out, withCounts(ch.entry, quantity, foilQuantity)]
    }
  }
  return out
}

function withCounts<E extends Counted>(e: E, quantity: number, foilQuantity: number): E {
  // Deck entries don't count foils; only a binder entry gets the field.
  return 'foilQuantity' in e ? { ...e, quantity: Math.max(0, quantity), foilQuantity: Math.max(0, foilQuantity) } : { ...e, quantity: Math.max(0, quantity) }
}

/** [lib] with [change] taken back. Decks and binders deleted since are left alone. */
export function undoChange(lib: Library, change: LibraryChange): Library {
  const decks = new Map(change.decks.map((d) => [d.id, d]))
  const collections = new Map(change.collections.map((c) => [c.id, c]))
  return {
    ...lib,
    decks: lib.decks.map((d) => {
      const ch = decks.get(d.id)
      if (!ch) return d
      return {
        ...d,
        cards: reverted(d.cards, ch.cards),
        ...(d.considering || ch.considering.length ? { considering: reverted(d.considering ?? [], ch.considering) } : {}),
        ...(d.sideboard || ch.sideboard.length ? { sideboard: reverted(d.sideboard ?? [], ch.sideboard) } : {}),
      }
    }),
    collections: lib.collections.map((c) => {
      const ch = collections.get(c.id)
      return ch ? { ...c, entries: reverted(c.entries, ch.entries) } : c
    }),
  }
}

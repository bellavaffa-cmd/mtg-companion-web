// How a deck's primer, folder, archive flag, companion and categories sync (Deck.description, folder,
// archived, companion, categoryTargets and each card's categories). They ride in the deck's JSON like
// everything else, and merge like it: the primer, folder, flag and companion go to whichever device
// changed them (the later edit when both did); each category's target the same, one by one; a card's
// categories keep both devices' additions, and one either took off stays off (sync/mergeItems.ts).
//
// An app from before these existed drops them when it saves the deck. So each is left out until it's
// first set and kept afterwards — as "", false or {} once cleared — and a deck saved without the key
// gets this device's back rather than losing it on every device. The cards' categories ride on
// categoryTargets: a deck with none was saved by an older app, which dropped the cards' too.
// The Android app's data/DeckExtras.kt, line for line.

import type { Deck, DeckCardEntry } from '../types/models'

type Extra = 'description' | 'folder' | 'archived' | 'companion'
const EXTRAS: Extra[] = ['description', 'folder', 'archived', 'companion']

/** [list] with each card's categories from [from] where the card has none. */
function withCategoriesFrom(list: DeckCardEntry[] | undefined, from: DeckCardEntry[] | undefined): DeckCardEntry[] | undefined {
  if (!list || !from) return list
  const known = new Map(from.filter((e) => e.categories?.length).map((e) => [e.scryfallId, e.categories!]))
  if (known.size === 0) return list
  return list.map((e) => (e.categories?.length || !known.has(e.scryfallId) ? e : { ...e, categories: known.get(e.scryfallId)! }))
}

/**
 * [theirs] with [source]'s primer, folder, archive flag, companion and categories put back where
 * [theirs] was written by an app that doesn't know them (no key) — the same object when nothing was missing.
 */
export function keepDeckExtrasFromOlderApp(source: Deck, theirs: Deck): Deck {
  let out = theirs
  for (const field of EXTRAS) {
    if (out[field] === undefined && source[field] !== undefined) out = { ...out, [field]: source[field] }
  }
  if (out.categoryTargets === undefined && source.categoryTargets !== undefined) {
    out = {
      ...out,
      categoryTargets: source.categoryTargets,
      cards: withCategoriesFrom(out.cards, source.cards)!,
      ...(out.sideboard ? { sideboard: withCategoriesFrom(out.sideboard, source.sideboard) } : {}),
      ...(out.considering ? { considering: withCategoriesFrom(out.considering, source.considering) } : {}),
    }
  }
  return out
}

const same = (a: unknown, b: unknown) => a === b

/** A field's value after a merge: whoever changed it, or the more recent edit when both did. */
function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/** Each category's target merged on its own; undefined when no side has any. */
export function mergeCategoryTargets(
  base: Record<string, number> | undefined,
  mine: Record<string, number> | undefined,
  theirs: Record<string, number> | undefined,
  minePreferred: boolean,
): Record<string, number> | undefined {
  if (mine === undefined && theirs === undefined) return undefined
  const out: Record<string, number> = {}
  const keys = [...new Set([...Object.keys(base ?? {}), ...Object.keys(mine ?? {}), ...Object.keys(theirs ?? {})])].sort()
  for (const k of keys) {
    const value = pick(base?.[k], mine?.[k], theirs?.[k], minePreferred)
    if (value !== undefined) out[k] = value
  }
  return out
}

/** The deck-level extras merged: each to whoever changed it, the targets one by one. */
export function mergeDeckExtras(base: Deck, mine: Deck, theirs: Deck, minePreferred: boolean): Partial<Deck> {
  const out: Partial<Deck> = {}
  for (const field of EXTRAS) {
    const value = pick(base[field], mine[field], theirs[field], minePreferred)
    if (value !== undefined) (out as Record<string, unknown>)[field] = value
  }
  const targets = mergeCategoryTargets(base.categoryTargets, mine.categoryTargets, theirs.categoryTargets, minePreferred)
  if (targets !== undefined) out.categoryTargets = targets
  return out
}

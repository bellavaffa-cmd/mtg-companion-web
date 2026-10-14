// Which binders a deck card's real copies are sorted into (DeckCardEntry.binders). Shown and changed by
// binders as views (collection/binderViews.ts), and kept through every edit, through the sync's merge
// (as one value, whoever changed it — sync/mergeItems.ts), and through backups.

import type { Deck, DeckCardEntry } from '../types/models'

export type BinderRef = NonNullable<DeckCardEntry['binders']>[number]

/**
 * [theirs] with each card's binders taken from [source] where [theirs] came without them — a deck
 * saved by an app that doesn't know about them leaves them as they were. The same object when
 * there's nothing to keep.
 */
export function keepBindersFromOlderApp(source: Deck, theirs: Deck): Deck {
  const known = new Map(source.cards.filter((e) => e.binders != null).map((e) => [e.scryfallId, e.binders!]))
  if (known.size === 0 || !theirs.cards.some((e) => e.binders == null && known.has(e.scryfallId))) return theirs
  return {
    ...theirs,
    cards: theirs.cards.map((e) => (e.binders != null || !known.has(e.scryfallId) ? e : { ...e, binders: known.get(e.scryfallId)! })),
  }
}

/**
 * Two entries' binders as one, for two entries joined into one (a printing changed to one the deck
 * already has): the counts per binder added up. Undefined when neither had any set.
 */
export function joinedBinders(a: DeckCardEntry['binders'], b: DeckCardEntry['binders']): BinderRef[] | undefined {
  if (a == null && b == null) return undefined
  const out: BinderRef[] = []
  for (const ref of [...(a ?? []), ...(b ?? [])]) {
    const at = out.findIndex((r) => r.id === ref.id)
    if (at >= 0) out[at] = { ...out[at], qty: out[at].qty + ref.qty }
    else out.push(ref)
  }
  return out
}

/** [deck] with each card's binder ids switched by [ids] (a binder given a new id); the same object when none is. */
export function withBinderIds(deck: Deck, ids: Map<string, string>): Deck {
  const moves = (e: DeckCardEntry) => !!e.binders?.some((r) => ids.has(r.id))
  if (!deck.cards.some(moves)) return deck
  return {
    ...deck,
    cards: deck.cards.map((e) => (!moves(e) ? e : { ...e, binders: e.binders!.map((r) => (ids.has(r.id) ? { ...r, id: ids.get(r.id)! } : r)) })),
  }
}

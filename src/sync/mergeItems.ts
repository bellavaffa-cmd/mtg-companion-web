// Three-way merge for decks and binders, so two devices editing the same one keep both sets of
// edits instead of the newer save replacing the older one wholesale.
//
// Every merge compares three versions: the one both devices last agreed on (the base), this
// device's version, and the other device's. Both devices run the same rules on the same three
// versions, so they reach the same result and settle down.
//
// The rules, in short:
//  - A card added on one side is kept.
//  - A card removed on one side stays removed, even if the other side changed its count.
//  - Counts that both sides changed add up: +1 here and +2 there lands on +3.
//  - A field both sides changed differently (a deck's name, say) goes to the more recent edit.
// The Android app merges the same way — see data/supabase/ItemMerge.kt.

import type { Collection, CollectionEntry, Deck, DeckCardEntry, GameResult } from '../types/models'

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** A field's value after a merge: whoever changed it, or the more recent edit when both did. */
function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/** Merges a set of strings (a deck's tags): additions from both sides, minus what either removed. */
function mergeStringSet(base: string[], mine: string[], theirs: string[]): string[] {
  const baseSet = new Set(base)
  const mineSet = new Set(mine)
  const theirsSet = new Set(theirs)
  const out: string[] = []
  for (const tag of [...theirs, ...mine]) {
    if (out.includes(tag)) continue
    const removedByMe = baseSet.has(tag) && !mineSet.has(tag)
    const removedByThem = baseSet.has(tag) && !theirsSet.has(tag)
    if (!removedByMe && !removedByThem) out.push(tag)
  }
  return out
}

interface EntryRules<T> {
  /** Fields whose changes add up (quantities). */
  counts: (keyof T)[]
}

/**
 * Merges a list of card entries keyed by printing. Remote order is kept, with cards this device
 * added appended, so both devices end up with the same list in the same order.
 */
function mergeEntries<T extends { scryfallId: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
  rules: EntryRules<T>,
  minePreferred: boolean
): T[] {
  const byId = (list: T[]) => new Map(list.map((e) => [e.scryfallId, e]))
  const baseMap = byId(base)
  const mineMap = byId(mine)
  const theirsMap = byId(theirs)

  const ids: string[] = []
  for (const e of [...theirs, ...mine]) if (!ids.includes(e.scryfallId)) ids.push(e.scryfallId)

  const out: T[] = []
  for (const id of ids) {
    const b = baseMap.get(id)
    const m = mineMap.get(id)
    const t = theirsMap.get(id)
    // Removing a card is deliberate, so it stays removed even if the other side touched it.
    if (b && (!m || !t)) continue
    if (!b) {
      // Added on one side, or on both at once: one copy, the larger count.
      const added = t ?? m!
      if (m && t) {
        const merged = { ...added }
        for (const field of rules.counts) {
          merged[field] = Math.max(Number(m[field] ?? 0), Number(t[field] ?? 0)) as T[keyof T]
        }
        out.push(merged)
      } else {
        out.push(added)
      }
      continue
    }
    // In all three: counts add up, everything else follows whoever changed it.
    const merged = { ...t! } as T
    for (const key of new Set([...Object.keys(b), ...Object.keys(m!), ...Object.keys(t!)]) as Set<keyof T>) {
      if (rules.counts.includes(key)) {
        const mineDelta = Number(m![key] ?? 0) - Number(b[key] ?? 0)
        merged[key] = Math.max(0, Number(t![key] ?? 0) + mineDelta) as T[keyof T]
      } else {
        merged[key] = pick(b[key], m![key], t![key], minePreferred)
      }
    }
    // Every count down to zero means both sides emptied it out — that's a removal.
    if (rules.counts.length > 0 && rules.counts.every((field) => Number(merged[field] ?? 0) <= 0)) continue
    out.push(merged)
  }
  return out
}

/** Games logged on either device, minus any deleted on either; newest first, like the deck page. */
function mergeGameResults(base: GameResult[], mine: GameResult[], theirs: GameResult[]): GameResult[] {
  const ids = (list: GameResult[]) => new Set(list.map((g) => g.id))
  const baseIds = ids(base)
  const mineIds = ids(mine)
  const theirsIds = ids(theirs)
  const out: GameResult[] = []
  for (const game of [...theirs, ...mine]) {
    if (out.some((g) => g.id === game.id)) continue
    const removedByMe = baseIds.has(game.id) && !mineIds.has(game.id)
    const removedByThem = baseIds.has(game.id) && !theirsIds.has(game.id)
    if (!removedByMe && !removedByThem) out.push(game)
  }
  return out.sort((a, b) => b.playedAt - a.playedAt)
}

const DECK_COUNTS: EntryRules<DeckCardEntry> = { counts: ['quantity'] }
const COLLECTION_COUNTS: EntryRules<CollectionEntry> = { counts: ['quantity', 'foilQuantity'] }

/** [minePreferred]: this device's edit is the more recent one, so it wins any field both changed. */
export function mergeDeck(base: Deck, mine: Deck, theirs: Deck, minePreferred: boolean): Deck {
  return {
    ...theirs,
    name: pick(base.name, mine.name, theirs.name, minePreferred),
    gameMode: pick(base.gameMode, mine.gameMode, theirs.gameMode, minePreferred),
    ownership: pick(base.ownership, mine.ownership, theirs.ownership, minePreferred),
    createdAt: Math.min(base.createdAt || mine.createdAt, mine.createdAt, theirs.createdAt),
    commander: pick(base.commander, mine.commander, theirs.commander, minePreferred),
    partnerCommander: pick(base.partnerCommander, mine.partnerCommander, theirs.partnerCommander, minePreferred),
    cards: mergeEntries(base.cards, mine.cards, theirs.cards, DECK_COUNTS, minePreferred),
    tags: mergeStringSet(base.tags ?? [], mine.tags ?? [], theirs.tags ?? []),
    gameResults: mergeGameResults(base.gameResults ?? [], mine.gameResults ?? [], theirs.gameResults ?? []),
  }
}

export function mergeCollection(base: Collection, mine: Collection, theirs: Collection, minePreferred: boolean): Collection {
  return {
    ...theirs,
    name: pick(base.name, mine.name, theirs.name, minePreferred),
    type: pick(base.type, mine.type, theirs.type, minePreferred),
    createdAt: Math.min(base.createdAt || mine.createdAt, mine.createdAt, theirs.createdAt),
    entries: mergeEntries(base.entries, mine.entries, theirs.entries, COLLECTION_COUNTS, minePreferred),
  }
}

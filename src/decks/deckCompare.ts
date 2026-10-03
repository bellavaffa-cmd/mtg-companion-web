// Two deck lists side by side — this deck against another deck, or against one of its own saved
// versions: what only this one has, what only the other has, and what both have (with how many copies
// each). Cards are matched by name, so a different printing of the same card is the same card, the way
// versions already count them. The main deck only: commanders included, sideboard and Considering left
// out. Mirrors the Android app's data/DeckCompare.kt.

import type { Deck, DeckVersion } from '../types/models'

/** One card in a comparison: [here] copies in this deck, [there] in the other. */
export interface CompareRow {
  name: string
  here: number
  there: number
}

export const sameCount = (row: CompareRow): boolean => row.here === row.there

export interface DeckDiff {
  onlyHere: CompareRow[]
  onlyThere: CompareRow[]
  /** Cards in both, the ones whose counts differ first. */
  both: CompareRow[]
}

export const identical = (diff: DeckDiff): boolean =>
  diff.onlyHere.length === 0 && diff.onlyThere.length === 0 && diff.both.every(sameCount)

/** [deck]'s main deck as card name → copies, the way a DeckVersion keeps it. */
export function deckCounts(deck: Deck): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of deck.cards) counts.set(c.name, (counts.get(c.name) ?? 0) + c.quantity)
  // A commander missing from the card list still belongs to the deck.
  for (const c of [deck.commander, deck.partnerCommander]) if (c && !counts.has(c.name)) counts.set(c.name, 1)
  return counts
}

/** A saved version's list, commanders included. */
export function versionCounts(version: DeckVersion): Map<string, number> {
  const counts = new Map(Object.entries(version.cards))
  for (const name of version.commanders) if (!counts.has(name)) counts.set(name, 1)
  return counts
}

const lower = (a: CompareRow, b: CompareRow) => {
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

/** The difference between [here] and [there] (card name → copies), names matched ignoring case. */
export function diffDecks(here: Map<string, number>, there: Map<string, number>): DeckDiff {
  const byKey = (m: Map<string, number>) => {
    const out = new Map<string, [string, number]>()
    for (const [name, n] of m) {
      if (n <= 0) continue
      const key = name.trim().toLowerCase()
      const had = out.get(key)
      out.set(key, had ? [had[0], had[1] + n] : [name, n])
    }
    return out
  }
  const a = byKey(here)
  const b = byKey(there)
  const onlyHere = [...a].filter(([k]) => !b.has(k)).map(([, [name, n]]) => ({ name, here: n, there: 0 })).sort(lower)
  const onlyThere = [...b].filter(([k]) => !a.has(k)).map(([, [name, n]]) => ({ name, here: 0, there: n })).sort(lower)
  const both = [...a].filter(([k]) => b.has(k)).map(([k, [name, n]]) => ({ name, here: n, there: b.get(k)![1] }))
    .sort((x, y) => Number(sameCount(x)) - Number(sameCount(y)) || lower(x, y))
  return { onlyHere, onlyThere, both }
}

/** How a row's copies read: "4", or "4 → 2" where the two lists differ. */
export const compareCount = (row: CompareRow): string =>
  row.here > 0 && row.there > 0 && row.here !== row.there ? `${row.here} → ${row.there}` : `${row.here > 0 ? row.here : row.there}`

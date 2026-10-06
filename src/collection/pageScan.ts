/*
 * Scanning a whole binder page: one photo of the page, cut into the binder's pockets (3 × 3 for 9 a
 * page, 3 × 4 for 12…), each pocket looked at by the same card recogniser a single scan uses
 * (scan/cardRecognizer.ts, scan/cardIndex.ts). Each pocket comes out as
 *  - READ: a card, its printing known;
 *  - CHOOSE ("Which one?"): a card whose printing (or name) the picture can't settle — tap it to choose;
 *  - EMPTY: no card in the pocket.
 * Then "Record this page" writes what was read into those pockets — copies listed in a pocket the
 * photo shows something else in leave the pocket (they stay in the binder, waiting for a pocket), and
 * each card read goes in its pocket: a copy waiting in the binder first, then one with no place or in
 * another place (as putting a card away does), and a card not owned at all is added. "Check against
 * record" lists, pocket by pocket, where the photo and the binder's record disagree.
 *
 * Pure, so it can be tested. Mirrors the Android app's data/PageScan.kt rule for rule, with the same
 * tests (tests/collection/pageScan.test.ts ↔ PageScanTest.kt).
 */

import type { IndexEntry, IndexMatch } from '../scan/cardIndex'
import { cardBySight, printingBySight, sameCard } from '../scan/sight'
import { pageGrid } from './binderPages'
import { addedHere, cardsIn, moveCopies, pocketsOf, putAway, sameCardName, type PlacedCard, type Spot } from './storagePlaces'
import type { Collection, CollectionEntry, CopyPlace, StoragePlace } from '../types/models'

export type CellState = 'read' | 'choose' | 'empty'

/** A card a pocket may hold: one printing. */
export interface CellCard { scryfallId: string; name: string; set: string; number: string }

/** One pocket of the page as the photo showed it; [slot] counts from 1. [options]: CHOOSE's candidates, best first. */
export interface PageCell { slot: number; state: CellState; card?: CellCard; options: CellCard[] }

/** A box in the photo's pixels. */
export interface CellBox { x: number; y: number; width: number; height: number }

/** Below this likeness to anything in the index a pocket is taken to be empty (a bare pocket, a sleeve's glare). */
export const EMPTY_BELOW = 0.5

/** How many candidates a CHOOSE pocket offers. */
export const CELL_OPTIONS = 4

const cellCard = (e: IndexEntry): CellCard => ({ scryfallId: e.id, name: e.name, set: e.set, number: e.number })

/**
 * The pockets of a page photographed inside [area]: the page's grid (pageGrid) laid evenly over it,
 * row by row — slot 1 top left. Each box is where one pocket's card is expected.
 */
export function pageCellBoxes(area: CellBox, pockets: number): CellBox[] {
  const { cols, rows } = pageGrid(pockets)
  const w = area.width / cols
  const h = area.height / rows
  return Array.from({ length: pockets }, (_, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const left = Math.trunc(area.x + col * w)
    const top = Math.trunc(area.y + row * h)
    return { x: left, y: top, width: Math.trunc(area.x + (col + 1) * w) - left, height: Math.trunc(area.y + (row + 1) * h) - top }
  })
}

/** A page's shape, wide over tall, for the framing guide: its pockets side by side, card-shaped. */
export function pageAspect(pockets: number): number {
  const { cols, rows } = pageGrid(pockets)
  return (cols * 63) / (rows * 88)
}

/** A pocket whose card is known: its printing by sight, or CHOOSE among the printings too close to call. */
function byPrinting(slot: number, matches: IndexMatch[]): PageCell {
  const pick = printingBySight(matches)
  if (pick) return { slot, state: 'read', card: cellCard(pick.entry), options: [] }
  const seen = new Set<string>()
  const printings = matches.filter((m) => !seen.has(m.id) && !!seen.add(m.id)).slice(0, CELL_OPTIONS).map(cellCard)
  return { slot, state: 'choose', options: printings }
}

/**
 * What one pocket holds, from what the recogniser made of it: [found] whether a card's outline was
 * found there at all; [anywhere] the nearest pictures over the whole index; [named] the nearest
 * among the printings of a title read off the card, if one was.
 *  - Nothing found, or nothing alike: EMPTY.
 *  - A title read: its printings decide — the one by sight, or CHOOSE among them when two pictures are
 *    too close to call.
 *  - Else known by sight (cardBySight): READ, unless its own printings are too close to call (CHOOSE).
 *  - Else something's there but not clearly one card: CHOOSE among the likeliest names.
 */
export function readCell(slot: number, found: boolean, anywhere: IndexMatch[], named: IndexMatch[] = []): PageCell {
  const best = anywhere[0]
  if (!found || ((!best || best.score < EMPTY_BELOW) && named.length === 0)) return { slot, state: 'empty', options: [] }
  if (named.length > 0) return byPrinting(slot, named)
  const sight = cardBySight(anywhere)
  if (sight) return byPrinting(slot, anywhere.filter((m) => sameCard(m.name, sight.name)))
  const seen = new Set<string>()
  const names = anywhere.filter((m) => !seen.has(m.name.toLowerCase()) && !!seen.add(m.name.toLowerCase())).slice(0, CELL_OPTIONS)
  return { slot, state: 'choose', options: names.map(cellCard) }
}

/** A pocket settled by hand: [card] chosen (or typed), or null for empty. */
export const chooseCell = (cell: PageCell, card: CellCard | null): PageCell =>
  card ? { slot: cell.slot, state: 'read', card, options: [] } : { slot: cell.slot, state: 'empty', options: [] }

/** "6 read · 1 to check · 2 empty" — the parts with none left out, except what was read. */
export function pageScanSummary(cells: PageCell[]): string {
  const read = cells.filter((c) => c.state === 'read').length
  const check = cells.filter((c) => c.state === 'choose').length
  const empty = cells.filter((c) => c.state === 'empty').length
  return [`${read} read`, check > 0 ? `${check} to check` : null, empty > 0 ? `${empty} empty` : null].filter(Boolean).join(' · ')
}

/** What a CHOOSE pocket could be: "Counterspell (2 printings)", "Opt or Ponder". */
export function couldBe(cell: PageCell): string {
  const seen = new Set<string>()
  const names = cell.options.map((o) => o.name).filter((n) => !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
  if (names.length === 0) return 'anything'
  if (names.length === 1) return `${names[0]} (${cell.options.length} ${cell.options.length === 1 ? 'printing' : 'printings'})`
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** The line under the summary: "Slot 5 could be Counterspell (2 printings). Tap it to choose." — or null when nothing needs a look. */
export function pageScanHint(cells: PageCell[]): string | null {
  const unsure = cells.filter((c) => c.state === 'choose')
  if (unsure.length === 0) return null
  if (unsure.length === 1) return `Slot ${unsure[0].slot} could be ${couldBe(unsure[0])}. Tap it to choose.`
  return `Slots ${unsure.slice(0, -1).map((c) => c.slot).join(', ')} and ${unsure[unsure.length - 1].slot} need a look. Tap each to choose.`
}

// ---- Check against record ----

/** same: as recorded. missing: recorded, the pocket's empty. extra: a card the record doesn't have there. different: another card. unsure: not settled yet. */
export type PageDiffKind = 'same' | 'missing' | 'extra' | 'different' | 'unsure'

/** One pocket compared: what the record says is in it ([recorded], names) and what the photo showed ([found]). */
export interface PageDiffLine { slot: number; kind: PageDiffKind; recorded: string[]; found: string | null }

/** The names recorded in each pocket of [page] of the binder [place], slot by slot. */
export function recordedOnPage(place: StoragePlace, collections: Collection[], page: number): Map<number, string[]> {
  const out = new Map<number, string[]>()
  const pockets = pocketsOf(place)
  for (const c of cardsIn(collections, place.id)) {
    const slot = c.line.slot ?? 0
    if (c.line.page !== page || slot < 1 || slot > pockets) continue
    out.set(slot, [...(out.get(slot) ?? []), c.entry.name])
  }
  return out
}

/** The page as photographed against the binder's record, pocket by pocket. */
export function pageDiff(recorded: Map<number, string[]>, cells: PageCell[]): PageDiffLine[] {
  return cells.map((cell) => {
    const listed = recorded.get(cell.slot) ?? []
    if (cell.state === 'choose') return { slot: cell.slot, kind: 'unsure', recorded: listed, found: couldBe(cell) }
    if (cell.state === 'empty') return { slot: cell.slot, kind: listed.length === 0 ? 'same' : 'missing', recorded: listed, found: null }
    const name = cell.card?.name ?? ''
    const kind: PageDiffKind = listed.length === 0 ? 'extra' : listed.some((n) => sameCardName(n, name)) ? 'same' : 'different'
    return { slot: cell.slot, kind, recorded: listed, found: name }
  })
}

/** "All 9 pockets as recorded", or "6 as recorded · 1 missing · 1 not in the record · 1 different". */
export function pageDiffSummary(lines: PageDiffLine[]): string {
  const n = (kind: PageDiffKind) => lines.filter((l) => l.kind === kind).length
  const same = n('same')
  if (same === lines.length) return `All ${lines.length} pockets as recorded`
  return [
    `${same} as recorded`,
    n('missing') > 0 ? `${n('missing')} missing` : null,
    n('extra') > 0 ? `${n('extra')} not in the record` : null,
    n('different') > 0 ? `${n('different')} different` : null,
    n('unsure') > 0 ? `${n('unsure')} to check` : null,
  ].filter(Boolean).join(' · ')
}

/** One pocket that disagrees, in words: "Slot 2: Opt — the record says Ponder". Null for same. */
export function pageDiffText(line: PageDiffLine): string | null {
  const said = line.recorded.length === 0 ? 'nothing recorded' : `the record says ${line.recorded.join(', ')}`
  switch (line.kind) {
    case 'same': return null
    case 'missing': return `Slot ${line.slot}: empty — ${said}`
    case 'extra': return `Slot ${line.slot}: ${line.found} — not in the record`
    case 'different': return `Slot ${line.slot}: ${line.found} — ${said}`
    case 'unsure': return `Slot ${line.slot}: could be ${line.found} — ${said}`
  }
}

// ---- Record this page ----

/** What recording a page did: [placed] copies given their pocket, [added] new to the collection, [cleared] taken out of a pocket. */
export interface RecordedPage { collections: Collection[]; placed: number; added: number; cleared: number }

/** "Recorded page 4: 5 cards in their pockets, 1 new to your collection, 2 taken out of their pockets". */
export function recordedLine(page: number, r: RecordedPage): string {
  const parts = [
    r.placed > 0 ? `${r.placed} ${r.placed === 1 ? 'card' : 'cards'} in ${r.placed === 1 ? 'its pocket' : 'their pockets'}` : null,
    r.added > 0 ? `${r.added} new to your collection` : null,
    r.cleared > 0 ? `${r.cleared} taken out of ${r.cleared === 1 ? 'its pocket' : 'their pockets'}` : null,
  ].filter(Boolean)
  return parts.length === 0 ? `Page ${page} was already as recorded` : `Recorded page ${page}: ${parts.join(', ')}`
}

function moveLine(collections: Collection[], c: PlacedCard, to: Spot, qty: number): Collection[] {
  return collections.map((col) => col.id !== c.collectionId ? col : {
    ...col,
    entries: col.entries.map((e) => (e.scryfallId === c.entry.scryfallId ? moveCopies(e, c.line, to, qty).entry : e)),
  })
}

const inAPocket = (line: CopyPlace, pockets: number) => (line.page ?? 0) > 0 && (line.slot ?? 0) >= 1 && (line.slot ?? 0) <= pockets

/**
 * [collections] with [page] of the binder [place] recorded as [cells] show it. CHOOSE pockets are left
 * as they are. [newEntry]: the entry for a card not in the collection, with no copies yet.
 */
export function recordPage(collections: Collection[], place: StoragePlace, page: number, cells: PageCell[], newEntry: (c: CellCard) => CollectionEntry): RecordedPage {
  let out = collections
  let placed = 0
  let added = 0
  let cleared = 0
  const pockets = pocketsOf(place)
  const waiting: Spot = { placeId: place.id }
  // Copies the photo doesn't bear out leave their pocket; they stay in the binder, waiting for one.
  for (const cell of cells) {
    if (cell.state === 'choose') continue
    const listed = cardsIn(out, place.id).filter((c) => c.line.page === page && c.line.slot === cell.slot)
    for (const c of listed) {
      if (cell.state === 'read' && cell.card && sameCardName(c.entry.name, cell.card.name)) continue
      out = moveLine(out, c, waiting, c.line.qty)
      cleared += c.line.qty
    }
  }
  for (const cell of cells) {
    const card = cell.card
    if (cell.state !== 'read' || !card) continue
    const here = cardsIn(out, place.id)
    if (here.some((c) => c.line.page === page && c.line.slot === cell.slot && sameCardName(c.entry.name, card.name))) continue
    const to: Spot = { placeId: place.id, page, slot: cell.slot }
    const firstOf = (list: PlacedCard[]) => list.find((c) => c.entry.scryfallId === card.scryfallId) ?? list.find((c) => sameCardName(c.entry.name, card.name))
    // A copy waiting in this binder for a pocket.
    const loose = firstOf(here.filter((c) => !inAPocket(c.line, pockets)))
    if (loose) {
      out = moveLine(out, loose, to, 1)
      placed++
      continue
    }
    const outcome = putAway(out, { id: card.scryfallId, name: card.name }, to, newEntry(card))
    if (outcome.result === 'placed' || outcome.result === 'moved') {
      out = outcome.collections
      placed++
    } else if (outcome.result === 'new') {
      out = outcome.collections
      added++
    } else {
      // Listed in a pocket on another page: the photo says it's here now.
      const elsewhere = firstOf(here.filter((c) => inAPocket(c.line, pockets) && c.line.page !== page))
      if (elsewhere) {
        out = moveLine(out, elsewhere, to, 1)
        placed++
      } else {
        out = addedHere(out, { id: card.scryfallId }, to, newEntry(card)).collections
        added++
      }
    }
  }
  return { collections: out, placed, added, cleared }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { IndexMatch } from '../../src/scan/cardIndex.ts'
import {
  chooseCell, couldBe, pageAspect, pageCellBoxes, pageDiff, pageDiffSummary, pageDiffText, pageScanHint, pageScanSummary,
  readCell, recordedLine, recordedOnPage, recordPage, type CellCard, type PageCell,
} from '../../src/collection/pageScan.ts'
import { cardsIn } from '../../src/collection/storagePlaces.ts'
import type { Collection, CollectionEntry, CopyPlace, StoragePlace } from '../../src/types/models.ts'

// Scanning a whole binder page: the pocket grid, what each pocket holds, the summary, the check against
// the record and recording the page. The Android app has the same checks — see PageScanTest.kt.

let row = 0
const m = (name: string, score: number): IndexMatch => {
  const r = row++
  return { row: r, id: `id${r}`, face: 0, name, set: 'set', number: '1', group: r, score }
}

const binder: StoragePlace = { id: 'b', name: 'Trade binder', kind: 'BINDER', createdAt: 1 }
const at = (qty: number, page?: number, slot?: number): CopyPlace => ({ placeId: 'b', qty, ...(page ? { page } : {}), ...(slot ? { slot } : {}) })
const entry = (id: string, name: string, quantity: number, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity: 0, ...(places ? { places } : {}) })
const pile = (...entries: CollectionEntry[]): Collection[] =>
  [{ id: 'unsorted', name: 'Unsorted', entries, createdAt: 0, type: 'OWNED', storagePlaces: [binder] }]
const newEntry = (c: CellCard): CollectionEntry => ({ scryfallId: c.scryfallId, name: c.name, imageUrl: null, quantity: 0, foilQuantity: 0 })
const card = (id: string, name: string): CellCard => ({ scryfallId: id, name, set: '', number: '' })
const read = (slot: number, id: string, name: string): PageCell => ({ slot, state: 'read', card: card(id, name), options: [] })
const empty = (slot: number): PageCell => ({ slot, state: 'empty', options: [] })
const choose = (slot: number, options: CellCard[] = []): PageCell => ({ slot, state: 'choose', options })

test('a page is cut into its pockets row by row', () => {
  const boxes = pageCellBoxes({ x: 0, y: 0, width: 300, height: 420 }, 9)
  assert.equal(boxes.length, 9)
  assert.deepEqual(boxes[0], { x: 0, y: 0, width: 100, height: 140 })
  assert.deepEqual(boxes[1], { x: 100, y: 0, width: 100, height: 140 })
  assert.deepEqual(boxes[3], { x: 0, y: 140, width: 100, height: 140 })
  assert.deepEqual(boxes[8], { x: 200, y: 280, width: 100, height: 140 })
  const twelve = pageCellBoxes({ x: 10, y: 20, width: 300, height: 560 }, 12)
  assert.deepEqual(twelve[4], { x: 110, y: 160, width: 100, height: 140 })
  assert.deepEqual(twelve[11], { x: 210, y: 440, width: 100, height: 140 })
  assert.ok(Math.abs(pageAspect(9) * 88 / 63 - 1) < 0.001)
  assert.equal(pageCellBoxes({ x: 0, y: 0, width: 200, height: 280 }, 4).length, 4)
})

test('a pocket is read, asked about or empty', () => {
  // Nothing found, or nothing alike: empty.
  assert.equal(readCell(1, false, [m('Opt', 0.9)]).state, 'empty')
  assert.equal(readCell(1, true, [m('Opt', 0.3)]).state, 'empty')
  // Clearly one card, one picture: read.
  const opt = readCell(2, true, [m('Opt', 0.86), m('Ponder', 0.4)])
  assert.equal(opt.state, 'read')
  assert.equal(opt.card?.name, 'Opt')
  // Clearly Counterspell, but two of its pictures too close to call: which one?
  const counter = readCell(5, true, [m('Counterspell', 0.85), m('Counterspell', 0.84), m('Ponder', 0.5)])
  assert.equal(counter.state, 'choose')
  assert.equal(counter.options.length, 2)
  assert.equal(couldBe(counter), 'Counterspell (2 printings)')
  // Something's there, but not clearly one card: the likeliest names.
  const unsure = readCell(7, true, [m('Opt', 0.6), m('Ponder', 0.58), m('Opt', 0.55)])
  assert.equal(unsure.state, 'choose')
  assert.deepEqual(unsure.options.map((o) => o.name), ['Opt', 'Ponder'])
  assert.equal(couldBe(unsure), 'Opt or Ponder')
  // A title read decides among its own printings.
  const named = readCell(3, true, [m('Island', 0.5)], [m('Brainstorm', 0.7), m('Brainstorm', 0.6)])
  assert.equal(named.state, 'read')
  assert.equal(named.card?.name, 'Brainstorm')
  // Settled by hand.
  assert.equal(chooseCell(counter, counter.options[1]).state, 'read')
  assert.equal(chooseCell(counter, null).state, 'empty')
})

test('the summary says what was read and what needs a look', () => {
  const cells = [
    ...[1, 2, 3, 4, 5, 6].map((i) => read(i, `x${i}`, `Card ${i}`)),
    choose(7, [card('c1', 'Counterspell'), card('c2', 'Counterspell')]), empty(8), empty(9),
  ]
  assert.equal(pageScanSummary(cells), '6 read · 1 to check · 2 empty')
  assert.equal(pageScanHint(cells), 'Slot 7 could be Counterspell (2 printings). Tap it to choose.')
  assert.equal(pageScanSummary(cells.slice(0, 2)), '2 read')
  assert.equal(pageScanHint(cells.slice(0, 2)), null)
  assert.equal(pageScanHint([choose(2), choose(5), choose(8)]), 'Slots 2, 5 and 8 need a look. Tap each to choose.')
})

test('checking a page against the record', () => {
  const recorded = new Map([[1, ['Brainstorm']], [2, ['Ponder']], [3, ['Opt']], [5, ['Counterspell']]])
  const cells = [read(1, 'a', 'Brainstorm'), read(2, 'b', 'Preordain'), empty(3), read(4, 'd', 'Impulse'), choose(5, [card('c', 'Counterspell')]), empty(6)]
  const diff = pageDiff(recorded, cells)
  assert.deepEqual(diff.map((d) => d.kind), ['same', 'different', 'missing', 'extra', 'unsure', 'same'])
  assert.equal(pageDiffSummary(diff), '2 as recorded · 1 missing · 1 not in the record · 1 different · 1 to check')
  assert.equal(pageDiffText(diff[1]), 'Slot 2: Preordain — the record says Ponder')
  assert.equal(pageDiffText(diff[2]), 'Slot 3: empty — the record says Opt')
  assert.equal(pageDiffText(diff[3]), 'Slot 4: Impulse — not in the record')
  assert.equal(pageDiffText(diff[0]), null)
  assert.equal(pageDiffSummary(pageDiff(recorded, [read(1, 'a', 'brainstorm'), empty(9)])), 'All 2 pockets as recorded')
})

test("the record comes from the page's pockets", () => {
  const cols = pile(
    entry('a', 'Brainstorm', 1, [at(1, 4, 1)]),
    entry('p', 'Ponder', 1, [at(1, 4, 2)]),
    entry('o', 'Opt', 1, [at(1, 5, 1)]),
  )
  assert.deepEqual(recordedOnPage(binder, cols, 4), new Map([[1, ['Brainstorm']], [2, ['Ponder']]]))
})

test('recording a page writes its pockets', () => {
  const cols = pile(
    // As recorded.
    entry('a', 'Brainstorm', 1, [at(1, 4, 1)]),
    // Recorded in slot 2, but the photo shows another card there: out of its pocket.
    entry('p', 'Ponder', 1, [at(1, 4, 2)]),
    // Waiting in the binder for a pocket.
    entry('o', 'Opt', 1, [at(1)]),
    // Owned, with no place.
    entry('i', 'Impulse', 1),
    // In a pocket on another page.
    entry('f', 'Fact or Fiction', 1, [at(1, 7, 3)]),
  )
  const cells = [
    read(1, 'a', 'Brainstorm'), read(2, 'o', 'Opt'), read(3, 'i', 'Impulse'), read(4, 'f', 'Fact or Fiction'),
    read(5, 'n', 'Preordain'), choose(6), empty(7),
  ]
  const r = recordPage(cols, binder, 4, cells, newEntry)
  const here = cardsIn(r.collections, 'b')
  const slotOf = (name: string) => here.filter((c) => c.entry.name === name).map((c) => [c.line.page ?? null, c.line.slot ?? null])
  assert.deepEqual(slotOf('Brainstorm'), [[4, 1]])
  assert.deepEqual(slotOf('Ponder'), [[null, null]])
  assert.deepEqual(slotOf('Opt'), [[4, 2]])
  assert.deepEqual(slotOf('Impulse'), [[4, 3]])
  assert.deepEqual(slotOf('Fact or Fiction'), [[4, 4]])
  assert.deepEqual(slotOf('Preordain'), [[4, 5]])
  assert.equal(r.placed, 3)
  assert.equal(r.added, 1)
  assert.equal(r.cleared, 1)
  assert.equal(recordedLine(4, r), 'Recorded page 4: 3 cards in their pockets, 1 new to your collection, 1 taken out of its pocket')
  // Recording it again changes nothing.
  const again = recordPage(r.collections, binder, 4, cells, newEntry)
  assert.equal(again.placed + again.added + again.cleared, 0)
  assert.equal(recordedLine(4, again), 'Page 4 was already as recorded')
})

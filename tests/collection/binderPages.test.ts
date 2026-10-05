import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFit, binderPockets, closeGapsMoves, compareCards, fitLooseCards, fitSteps, looseCopies, pageCount, pageGrid, pageSummary,
  planFit, pocketAt, pocketIndex, relocate, reorderMoves, sheetOf, sideLabel, sideOf, swapMoves, undoMoves,
} from '../../src/collection/binderPages.ts'
import { cardsIn, type CardFacts } from '../../src/collection/storagePlaces.ts'
import type { Collection, CollectionEntry, CopyPlace, StoragePlace } from '../../src/types/models.ts'

// Binder pages: sheets, the order, fitting new cards in and moving pockets, the same on both apps. The
// Android app has the same checks — see BinderPagesTest.kt.

const f = (name: string, set?: string, collectorNumber?: string, colors?: string[]): CardFacts => ({ name, set, collectorNumber, colors })
const names = (list: string[]) => list.map((name, i) => ({ index: i, facts: f(name) }))
const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const entry = (id: string, quantity: number, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity: 0, ...(places ? { places } : {}) })
const pile = (entries: CollectionEntry[], places: StoragePlace[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries, createdAt: 0, type: 'OWNED', storagePlaces: places })

test('pages are the fronts and backs of sheets', () => {
  assert.deepEqual([1, 2, 3, 4].map(sheetOf), [1, 1, 2, 2])
  assert.deepEqual([1, 2, 3].map(sideOf), ['Front', 'Back', 'Front'])
  assert.equal(sideLabel(3), 'Front of sheet 2')
  assert.equal(sideLabel(4), 'Back of sheet 2')
})

test('a page lays its pockets out in a grid', () => {
  assert.deepEqual(pageGrid(9), { cols: 3, rows: 3 })
  assert.deepEqual(pageGrid(12), { cols: 3, rows: 4 })
  assert.deepEqual(pageGrid(4), { cols: 2, rows: 2 })
  assert.deepEqual(pageGrid(8), { cols: 2, rows: 4 })
  assert.deepEqual(pageGrid(7), { cols: 3, rows: 3 })
  assert.deepEqual(pageGrid(1), { cols: 1, rows: 1 })
  assert.equal(pocketIndex(3, 5, 9), 22)
  assert.deepEqual(pocketAt(22, 9), { page: 3, slot: 5 })
  assert.deepEqual(pocketAt(0, 12), { page: 1, slot: 1 })
})

test('the order: by set then number, A–Z, colour, type', () => {
  const sorted = (rule: Parameters<typeof compareCards>[0], list: CardFacts[]) => [...list].sort((a, b) => compareCards(rule, a, b)).map((x) => x.name)
  const list = [f('Zap', 'one', '1'), f('Bolt', 'dmu', '98a'), f('Shock', 'dmu', '98'), f('Abrade', 'dmu', '12')]
  assert.deepEqual(sorted('SET', list), ['Abrade', 'Shock', 'Bolt', 'Zap'])
  assert.deepEqual(sorted('NAME', list), ['Abrade', 'Bolt', 'Shock', 'Zap'])
  assert.deepEqual(sorted(null, list), ['Abrade', 'Bolt', 'Shock', 'Zap'])
  const colours = [f('Opt', undefined, undefined, ['U']), f('Bolt', undefined, undefined, ['R']), f('Abrade', undefined, undefined, ['R']), f('Sol Ring', undefined, undefined, [])]
  assert.deepEqual(sorted('COLOUR', colours), ['Opt', 'Abrade', 'Bolt', 'Sol Ring'])
  const types = [{ name: 'Opt', typeLine: 'Instant' }, { name: 'Goblin', typeLine: 'Creature — Goblin' }]
  assert.deepEqual(sorted('TYPE', types), ['Goblin', 'Opt'])
})

test("a page's summary says what's on it", () => {
  assert.equal(pageSummary('SET', [f('Bolt', 'dmu', '98'), f('Abrade', 'dmu', '12')]), 'DMU 12–98')
  assert.equal(pageSummary('SET', [f('Zap', 'one', '12'), f('Bolt', 'dmu', '240')]), 'DMU 240 – ONE 12')
  assert.equal(pageSummary('SET', [f('Bolt', 'dmu', '98')]), 'DMU 98')
  assert.equal(pageSummary('NAME', [f('Counterspell'), f('Abrade'), f('Bolt')]), 'A–C')
  assert.equal(pageSummary(null, [f('Bolt'), f('Brainstorm')]), 'B')
  assert.equal(pageSummary('COLOUR', [f('Fury', undefined, undefined, ['R']), f('Abrade', undefined, undefined, ['R'])]), 'Red · A–F')
  assert.equal(pageSummary('COLOUR', [f('Fury', undefined, undefined, ['R']), f('Opt', undefined, undefined, ['U'])]), 'Blue to Red')
  assert.equal(pageSummary('SET', []), 'Empty')
})

test('keeping the order: cards shift along only as far as the next empty pocket', () => {
  // A B D E F G H in pockets 0–6, then an empty pocket: C goes where D was, D–H one along.
  const plan = planFit('NAME', names(['A', 'B', 'D', 'E', 'F', 'G', 'H']), [f('C')], 'KEEP')
  assert.deepEqual(plan.puts, [{ item: 0, to: 2 }])
  assert.deepEqual(plan.moves, [{ from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 6 }, { from: 6, to: 7 }])
  // An empty pocket after E: only D and E move.
  const gap = planFit('NAME', [...names(['A', 'B', 'D', 'E']), { index: 5, facts: f('F') }], [f('C')], 'KEEP')
  assert.deepEqual(gap.moves, [{ from: 2, to: 3 }, { from: 3, to: 4 }])
  // Room right after B already: nothing moves.
  const room = planFit('NAME', [...names(['A', 'B']), { index: 4, facts: f('D') }], [f('C')], 'KEEP')
  assert.deepEqual(room, { moves: [], puts: [{ item: 0, to: 2 }] })
})

test('keeping the order: cards shift back instead when that moves fewer', () => {
  // Pocket 0 empty, 1–20 full: C between B (2) and D (3) moves A and B back rather than D…U along.
  const letters = 'ABDEFGHIJKLMNOPQRSTU'.split('')
  const plan = planFit('NAME', letters.map((name, i) => ({ index: i + 1, facts: f(name) })), [f('C')], 'KEEP')
  assert.deepEqual(plan.moves, [{ from: 1, to: 0 }, { from: 2, to: 1 }])
  assert.deepEqual(plan.puts, [{ item: 0, to: 2 }])
})

test('keeping the order is stable: a new copy goes after the ones there, and cards added together keep their order', () => {
  const plan = planFit('NAME', names(['Bolt', 'Bolt', 'Shock']), [f('Bolt')], 'KEEP')
  assert.deepEqual(plan, { moves: [{ from: 2, to: 3 }], puts: [{ item: 0, to: 2 }] })
  // Several at once, two copies of one card among them: in order, each into the binder as the last left it.
  const many = planFit('NAME', names(['A', 'Z']), [f('Shock'), f('Bolt'), f('Bolt')], 'KEEP')
  assert.deepEqual(many.moves, [{ from: 1, to: 4 }])
  assert.deepEqual(many.puts, [{ item: 0, to: 3 }, { item: 1, to: 1 }, { item: 2, to: 2 }])
  // The last card of all goes after the last pocket in use.
  assert.deepEqual(planFit('NAME', names(['A', 'B']), [f('Z')], 'KEEP'), { moves: [], puts: [{ item: 0, to: 2 }] })
  assert.deepEqual(planFit('NAME', [], [f('B'), f('A')], 'KEEP'), { moves: [], puts: [{ item: 0, to: 1 }, { item: 1, to: 0 }] })
})

test('full pages spill onto the next page, and the steps say so from the last card back', () => {
  // 4 pockets a page, pages 1 and 2 full.
  const plan = planFit('NAME', names(['Ant', 'Bat', 'Cat', 'Dog', 'Eel', 'Fox', 'Gnu', 'Hen']), [f('Cow')], 'KEEP')
  assert.deepEqual(plan.puts, [{ item: 0, to: 3 }])
  assert.deepEqual(plan.moves.map((m) => `${m.from}>${m.to}`), ['3>4', '4>5', '5>6', '6>7', '7>8'])
  const steps = fitSteps(plan, 4, (i) => ['Ant', 'Bat', 'Cat', 'Dog', 'Eel', 'Fox', 'Gnu', 'Hen'][i], () => ({ name: 'Cow', detail: 'M21 7' }))
  assert.deepEqual(steps, [
    { title: 'Pages 1–2: move 5 cards one along', detail: 'Starting from the last card, so nothing is in the way' },
    { title: 'Put Cow in page 1, slot 4', detail: 'M21 7' },
  ])
})

test('filling gaps moves nothing and takes the nearest empty pocket', () => {
  // Pockets 1–9 full, 0 and 10 empty: C (between B and D) goes in pocket 0, nearer than 10.
  const letters = 'ABDEFGHIJ'.split('')
  const plan = planFit('NAME', letters.map((name, i) => ({ index: i + 1, facts: f(name) })), [f('C')], 'GAPS')
  assert.deepEqual(plan, { moves: [], puts: [{ item: 0, to: 0 }] })
  // As near both ways: the one after.
  const even = planFit('NAME', [{ index: 1, facts: f('A') }, { index: 2, facts: f('D') }, { index: 4, facts: f('E') }], [f('C')], 'GAPS')
  assert.deepEqual(even, { moves: [], puts: [{ item: 0, to: 3 }] })
})

test('steps: moves of different lengths are steps of their own, and new cards on one page are one step', () => {
  const plan = planFit('NAME', names(['A', 'B', 'D', 'F']), [f('C'), f('E')], 'KEEP')
  assert.deepEqual(plan.moves, [{ from: 2, to: 3 }, { from: 3, to: 5 }])
  assert.deepEqual(plan.puts, [{ item: 0, to: 2 }, { item: 1, to: 4 }])
  const name = (i: number) => ['A', 'B', 'D', 'F'][i]
  assert.deepEqual(fitSteps(plan, 9, name, (i) => ({ name: ['C', 'E'][i], detail: '' })).map((s) => s.title), [
    'Put E in page 1, slot 5',
    'Move F from page 1, slot 4 to page 1, slot 6',
    'Move D from page 1, slot 3 to page 1, slot 4',
    'Put C in page 1, slot 3',
  ])
  // New cards in empty pockets of one page: one step, slot by slot.
  const two = planFit('NAME', [{ index: 0, facts: f('A') }, { index: 5, facts: f('M') }], [f('Z'), f('B')], 'KEEP')
  assert.deepEqual(fitSteps(two, 9, () => '', (i) => ({ name: ['Z', 'B'][i], detail: '' })), [
    { title: 'Put 2 cards in page 1', detail: 'Slot 2: B · Slot 7: Z' },
  ])
  // A run on one page.
  const run = fitSteps({ moves: [{ from: 4, to: 5 }, { from: 5, to: 6 }, { from: 6, to: 7 }], puts: [] }, 9, () => '', () => ({ name: '', detail: '' }))
  assert.deepEqual(run.map((s) => s.title), ['Page 1: move slots 5–7 one along'])
})

test('closing the gaps moves every card up, from the first', () => {
  assert.deepEqual(closeGapsMoves([5, 0, 2]), [{ from: 2, to: 1 }, { from: 5, to: 2 }])
  assert.deepEqual(closeGapsMoves([0, 1]), [])
  const steps = fitSteps({ moves: closeGapsMoves([0, 2, 3, 4]), puts: [] }, 9, () => '', () => ({ name: '', detail: '' }))
  assert.deepEqual(steps, [{ title: 'Page 1: move slots 3–5 one back', detail: 'Starting from the first card, so nothing is in the way' }])
})

test('dragging a pocket shifts the ones between; tapping two swaps them', () => {
  const all = new Set([0, 1, 2, 3])
  assert.deepEqual(reorderMoves(0, 3, all), [{ from: 0, to: 3 }, { from: 1, to: 0 }, { from: 2, to: 1 }, { from: 3, to: 2 }])
  assert.deepEqual(reorderMoves(3, 1, all), [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 1 }])
  assert.deepEqual(reorderMoves(0, 5, all), [{ from: 0, to: 5 }])
  assert.deepEqual(reorderMoves(4, 0, all), [])
  assert.deepEqual(swapMoves(1, 3, all), [{ from: 1, to: 3 }, { from: 3, to: 1 }])
  assert.deepEqual(swapMoves(1, 6, all), [{ from: 1, to: 6 }])
  assert.deepEqual(undoMoves([{ from: 1, to: 6 }]), [{ from: 6, to: 1 }])
})

test('moving pockets moves every copy in them at once, and fitting puts the loose copies in', () => {
  const rb: StoragePlace = { id: 'rb', name: 'Rares binder', kind: 'BINDER', pocketsPerPage: 4, sortRule: 'NAME', createdAt: 1 }
  const cols = [pile([
    // Two copies of one card in pockets 1 and 2 shift together without running into each other.
    entry('Bolt', 2, [at('rb', 1, { page: 1, slot: 1 }), at('rb', 1, { page: 1, slot: 2 })]),
    entry('Opt', 1, [at('rb', 1, { page: 1, slot: 3 })]),
    entry('Abrade', 1, [at('rb', 1)]),
    entry('Wrath', 1, [at('rb', 1, { page: 1, slot: 9 })]),
  ], [rb])]
  const moved = relocate(cols, rb, [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 4 }])
  assert.deepEqual(moved[0].entries.map((e) => e.places), [
    [at('rb', 1, { page: 1, slot: 2 }), at('rb', 1, { page: 1, slot: 3 })],
    [at('rb', 1, { page: 2, slot: 1 })],
    [at('rb', 1)],
    // A slot past the page's pockets isn't one of its pockets: it's left as it is.
    [at('rb', 1, { page: 1, slot: 9 })],
  ])
  assert.deepEqual(relocate(moved, rb, undoMoves([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 4 }])), cols)

  const cards = cardsIn(cols, 'rb')
  assert.deepEqual(binderPockets(rb, cards).map((p) => [p.index, p.cards.map((c) => c.entry.name)]), [[0, ['Bolt']], [1, ['Bolt']], [2, ['Opt']]])
  assert.deepEqual(looseCopies(rb, cards).map((c) => c.entry.name), ['Abrade', 'Wrath'])
  assert.equal(pageCount(rb, binderPockets(rb, cards)), 1)
  const fit = fitLooseCards(cols, rb, (c) => f(c.entry.name), 'KEEP')
  // Abrade before Bolt: everything one along; Wrath after Opt.
  assert.deepEqual(fit.plan.puts, [{ item: 0, to: 0 }, { item: 1, to: 4 }])
  const done = applyFit(cols, rb, fit.plan, fit.items)
  assert.deepEqual(done[0].entries.map((e) => e.places), [
    [at('rb', 1, { page: 1, slot: 2 }), at('rb', 1, { page: 1, slot: 3 })],
    [at('rb', 1, { page: 1, slot: 4 })],
    [at('rb', 1, { page: 1, slot: 1 })],
    [at('rb', 1, { page: 2, slot: 1 })],
  ])
})

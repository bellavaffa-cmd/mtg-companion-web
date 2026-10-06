import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lastPileAdded, nextBoxName, overflowLine, overflows, pileAdds, placeSize, planSplit, roomLine, sizeSetting, sizeUnit, spaceLabel, spaceOf,
  spacePercent, splitBox, splitSideLabel, withSize,
} from '../../src/collection/boxSpace.ts'
import { cardsIn, keepPlaceSizes, mergePlaceLists, placesOf, storagePlace } from '../../src/collection/storagePlaces.ts'
import type { CopyMove } from '../../src/collection/copyHistory.ts'
import type { SortSession } from '../../src/collection/sortPiles.ts'
import type { Collection, CollectionEntry, CopyPlace, StoragePlace } from '../../src/types/models.ts'

// How full a place is, the overflow warnings and splitting a box on whole sections — the same on both
// apps. The Android app has the same checks — see BoxSpaceTest.kt.

const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', sections: ['White', 'Blue', 'Black', 'Red', 'Green'], sortRule: 'COLOUR', createdAt: 1, capacity: 10 }
const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', pocketsPerPage: 4, createdAt: 2, pages: 2 }
const entry = (id: string, name: string, qty: number, ...places: CopyPlace[]): CollectionEntry => ({ scryfallId: id, name, imageUrl: null, quantity: qty, foilQuantity: 0, places })
const COLS: Collection[] = [{
  id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', storagePlaces: [red, rares],
  entries: [
    entry('w', 'Swords to Plowshares', 2, at('red', 2, { section: 'White' })),
    entry('u', 'Counterspell', 1, at('red', 1, { section: 'Blue' })),
    entry('b', 'Dark Ritual', 2, at('red', 2, { section: 'Black' })),
    entry('r', 'Shock', 3, at('red', 3, { section: 'Red' })),
    entry('g', 'Giant Growth', 1, at('red', 1, { section: 'Green' })),
    entry('x', 'Mystery', 1, at('red', 1)),
    entry('ring', 'The One Ring', 1, at('rares', 1, { page: 1, slot: 1 })),
    entry('bolt', 'Lightning Bolt', 2, at('rares', 2, { page: 1, slot: 2 })),
    entry('opt', 'Opt', 1, at('rares', 1)),
  ],
}]

test('a box holds its capacity and a binder its pages of pockets', () => {
  assert.equal(placeSize(red), 10)
  assert.equal(placeSize(rares), 8)
  assert.equal(placeSize({ ...rares, pages: undefined }), null)
  assert.equal(placeSize({ ...red, capacity: 0 }), null)
  assert.equal(sizeUnit(rares), 'pockets')
  assert.equal(sizeUnit(red), 'cards')
  assert.equal(withSize(rares, 40).pages, 40)
  assert.equal(withSize(red, 640).capacity, 640)
  assert.equal(withSize(red, -3).capacity, 0)
  assert.equal(sizeSetting(rares), 2)
  assert.equal(sizeSetting({ ...red, capacity: 0 }), null)
})

test('how full a place is', () => {
  const box = spaceOf(red, COLS)!
  assert.deepEqual(box, { placeId: 'red', used: 10, size: 10 })
  assert.equal(spaceLabel(red, box), '100% full · 10 of 10')
  assert.equal(roomLine(box), 'Full.')
  // A binder: two pockets in use and one copy waiting for a pocket.
  const binder = spaceOf(rares, COLS)!
  assert.deepEqual(binder, { placeId: 'rares', used: 3, size: 8 })
  assert.equal(spaceLabel(rares, binder), '3 of 8 pockets')
  assert.equal(roomLine(binder, 4), 'Room for about 5 more. Your last pile added 4.')
  const big = { placeId: 'red', used: 612, size: 640 }
  assert.equal(spacePercent(big), 96)
  assert.equal(spaceLabel(red, big), '96% full · 612 of 640')
  assert.equal(roomLine(big, 38), 'Room for about 28 more. Your last pile added 38.')
  assert.equal(roomLine({ placeId: 'red', used: 12, size: 10 }), 'Over by 2.')
  assert.equal(spaceLabel(red, { placeId: 'red', used: 575, size: 640 }), '575 of 640')
  assert.equal(spaceOf({ ...red, capacity: undefined }, COLS), null)
})

test('the last pile is what went in within half an hour of each other', () => {
  const hour = 60 * 60 * 1000
  const log: CopyMove[] = [
    { at: 0, kind: 'ADDED', name: 'A', qty: 1, title: '', places: ['red'] },
    { at: hour, kind: 'PUT_AWAY', name: 'B', qty: 1, title: '', places: ['red', 'rares'] },
    { at: hour + 10 * 60_000, kind: 'PUT_AWAY', name: 'C', qty: 2, title: '', places: ['red'] },
    { at: hour + 15 * 60_000, kind: 'PUT_AWAY', name: 'D', qty: 5, title: '', places: ['rares', 'red'] },
    { at: hour + 20 * 60_000, kind: 'MOVED', name: 'E', qty: 1, title: '', places: ['rares', 'red'] },
  ]
  assert.equal(lastPileAdded(log, 'red'), 3)
  assert.equal(lastPileAdded(log, 'rares'), 5)
  assert.equal(lastPileAdded(log, 'blue'), null)
})

test('overflowing a place', () => {
  assert.deepEqual(overflows(COLS, new Map([['red', 2], ['rares', 5]])), [{ placeId: 'red', name: 'Red box', adding: 2, room: 0 }])
  assert.deepEqual(overflows(COLS, new Map([['rares', 6], ['nowhere', 3]])), [{ placeId: 'rares', name: 'Rares binder', adding: 6, room: 5 }])
  assert.equal(overflowLine({ placeId: 'red', name: 'Red box', adding: 2, room: 0 }), 'Red box is full already.')
  assert.equal(overflowLine({ placeId: 'red', name: 'Red box', adding: 2, room: -3 }), 'Red box is full already (over by 3).')
  assert.equal(overflowLine({ placeId: 'red', name: 'Red box', adding: 38, room: 28 }), 'Red box will overflow: room for about 28, this adds 38.')
})

test('a sort session adds its cards to the places their piles go to', () => {
  const scan = (id: number, scryfallId: string, name: string, colors: string[] | undefined, pile: number) => ({
    id, scryfallId, name, facts: { name, colors, typeLine: colors ? 'Instant' : undefined }, entry: { scryfallId, name, imageUrl: null, quantity: 0, foilQuantity: 0 }, pile, why: '',
  })
  const session: SortSession = {
    source: '', newCards: true,
    rules: [{ kind: 'PRICE', over: 2, to: 'rares' }, { kind: 'BULK', to: 'RULE' }],
    scans: [scan(1, 's1', 'Shock', ['R'], 1), scan(2, 's2', 'Opt', ['U'], 1), scan(3, 's3', 'Ring', undefined, 0)],
  } as unknown as SortSession
  assert.deepEqual([...pileAdds(COLS, session)], [['red', 2], ['rares', 1]])
})

test('a box splits on whole sections as near half and half as they allow', () => {
  const plan = planSplit(red, cardsIn(COLS, 'red'))!
  assert.deepEqual(plan.stay.map((s) => s.name), ['White', 'Blue', 'Black'])
  assert.deepEqual(plan.go.map((s) => s.name), ['Red', 'Green'])
  // The copy in no section stays.
  assert.equal(plan.stayCopies, 6)
  assert.equal(plan.goCopies, 4)
  assert.equal(splitSideLabel(plan.stay, plan.stayCopies), 'White, Blue, Black · 6')
  assert.equal(splitSideLabel(plan.go, plan.goCopies), 'Red, Green · 4')
  assert.equal(planSplit(rares, cardsIn(COLS, 'rares')), null)
})

test('the new box is numbered', () => {
  assert.equal(nextBoxName([red], 'Red box'), 'Red box 2')
  assert.equal(nextBoxName([red, { ...red, id: 'r2', name: 'red box 2' }], 'Red box'), 'Red box 3')
  assert.equal(nextBoxName([red, { ...red, id: 'r2', name: 'Red box 2' }], 'Red box 2'), 'Red box 3')
})

test('splitting makes the new box and moves the copies in the sections that go', () => {
  const plan = planSplit(red, cardsIn(COLS, 'red'))!
  const after = splitBox(COLS, 'red', plan, 'red2', 99)
  const places = placesOf(after)
  assert.deepEqual(places.map((p) => p.id), ['red', 'red2', 'rares'])
  assert.deepEqual(places[1], { id: 'red2', name: 'Red box 2', kind: 'BOX', sections: ['Red', 'Green'], sortRule: 'COLOUR', createdAt: 99, capacity: 10 })
  assert.deepEqual(places[0].sections, ['White', 'Blue', 'Black'])
  const pile = new Map(after[0].entries.map((e) => [e.scryfallId, e]))
  assert.deepEqual(pile.get('r')!.places, [at('red2', 3, { section: 'Red' })])
  assert.deepEqual(pile.get('g')!.places, [at('red2', 1, { section: 'Green' })])
  assert.deepEqual(pile.get('x')!.places, [at('red', 1)])
  assert.deepEqual(spaceOf(places[0], after), { placeId: 'red', used: 6, size: 10 })
  assert.equal(splitBox(COLS, 'gone', plan, 'x', 1), COLS)
})

test('a place saved by an older app keeps its size', () => {
  const pile = COLS[0]
  const { capacity: _c, ...redOld } = red
  const { pages: _p, ...raresOld } = rares
  const older = { ...pile, storagePlaces: [redOld, raresOld] }
  assert.deepEqual(keepPlaceSizes(pile, older).storagePlaces, [red, rares])
  // A size taken off (0) stays off.
  const cleared = { ...pile, storagePlaces: [{ ...red, capacity: 0 }, rares] }
  assert.equal(keepPlaceSizes(pile, cleared), cleared)
  // Both devices: whoever changed it.
  const merged = mergePlaceLists([red], [{ ...red, capacity: 20 }], [{ ...red, name: 'Red' }], false)!
  assert.equal(merged[0].capacity, 20)
  assert.equal(merged[0].name, 'Red')
  assert.equal(storagePlace({ ...red, capacity: -1 }).capacity, 0)
})

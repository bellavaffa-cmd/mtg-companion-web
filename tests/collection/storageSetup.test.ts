import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applySetup, deckBoxCount, nextBoxRule, nextPockets, placedPercent, setupDrafts, setupPlaces, type SetupCounts,
} from '../../src/collection/storageSetup.ts'
import { COLOUR_SECTIONS, placesOf, placeSubtitle, placeTree } from '../../src/collection/storagePlaces.ts'
import type { Deck } from '../../src/types/models.ts'

// Getting started with storage: the three steps' numbers become named places. The Android app has the
// same checks — see StorageSetupTest.kt.

const ids = () => { let n = 0; return () => `p${++n}` }
const counts = (over: Partial<SetupCounts> = {}): SetupCounts => ({ binders: 2, pockets: 9, boxes: 3, boxRule: 'COLOUR', shelves: 1, ...over })

test('the numbers become named places', () => {
  const drafts = setupDrafts(counts())
  assert.deepEqual(drafts.map((d) => d.name), ['Shelf', 'Binder 1', 'Binder 2', 'Box 1', 'Box 2', 'Box 3'])
  assert.deepEqual(drafts.map((d) => d.key), ['shelf-1', 'binder-1', 'binder-2', 'box-1', 'box-2', 'box-3'])
  // One of a kind has no number; a name already used gets one.
  const one = setupDrafts(counts({ binders: 1, boxes: 1, shelves: 0 }), [{ id: 'x', name: 'Box', kind: 'BOX', createdAt: 0 }])
  assert.deepEqual(one.map((d) => d.name), ['Binder', 'Box 2'])
  assert.equal(setupDrafts(counts({ binders: 0, boxes: 0, boxRule: null, shelves: 0 })).length, 0)
})

test('boxes are sorted and everything sits on the shelf', () => {
  const c = counts({ binders: 1, pockets: 12, boxes: 1, shelves: 1 })
  const made = setupPlaces(c, setupDrafts(c), { 'box-1': '  Red box ', 'binder-1': '' }, 1000, ids())
  assert.deepEqual(made.map((p) => p.name), ['Shelf', 'Binder', 'Red box'])
  const [shelf, binder, box] = made
  assert.equal(shelf.parentId, undefined)
  assert.equal(binder.parentId, shelf.id)
  assert.equal(box.parentId, shelf.id)
  assert.equal(binder.pocketsPerPage, 12)
  assert.equal(box.sortRule, 'COLOUR')
  assert.deepEqual(box.sections, COLOUR_SECTIONS)
  assert.deepEqual(made.map((p) => p.createdAt), [1000, 1001, 1002])
  assert.equal(placeSubtitle({ ...box, note: 'Bulk' }), 'Bulk · by colour, then A–Z')
  // Nine pockets is the default, so it isn't written; nor sections for a box not sorted.
  const plain = counts({ binders: 1, boxes: 1, boxRule: null, shelves: 0 })
  const [b, x] = setupPlaces(plain, setupDrafts(plain), {}, 0, ids())
  assert.equal(b.pocketsPerPage, undefined)
  assert.equal(x.sortRule, undefined)
  assert.equal(x.sections, undefined)
  assert.equal(x.parentId, undefined)
  // Saved, they're the user's places, in that order.
  const cols = applySetup([], made)
  assert.deepEqual(placeTree(placesOf(cols)).map((n) => n.place.name), ['Shelf', 'Binder', 'Red box'])
})

test('step one cycles its choices', () => {
  assert.equal(nextPockets(9), 12)
  assert.equal(nextPockets(4), 9)
  assert.equal(nextPockets(7), 9)
  assert.equal(nextBoxRule('COLOUR'), 'SET')
  assert.equal(nextBoxRule('NAME'), null)
  assert.equal(nextBoxRule(null), 'COLOUR')
})

test('the share with a place rounds down', () => {
  assert.equal(placedPercent({ total: 1000, placed: 925 }), 92)
  assert.equal(placedPercent({ total: 1000, placed: 999 }), 99)
  assert.equal(placedPercent({ total: 4, placed: 4 }), 100)
  assert.equal(placedPercent({ total: 0, placed: 0 }), 0)
  const deck = (id: string, ownership: Deck['ownership']) => ({ id, name: id, cards: [], ownership } as unknown as Deck)
  assert.equal(deckBoxCount([deck('a', 'PHYSICAL'), deck('b', 'VIRTUAL')]), 1)
})

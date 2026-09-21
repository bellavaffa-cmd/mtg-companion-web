import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withUnsortedPile } from '../../src/collection/unsorted.ts'
import { UNSORTED_COLLECTION_ID, isUnsorted, type Collection } from '../../src/types/models.ts'

// The Unsorted pile is always there, like the Wishlist. The Android app has the same checks — see
// UnsortedPileTest.kt.

const binder = (id: string, type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries: [], createdAt: 5, type })

test('a library without the pile gets one, empty and owned', () => {
  const out = withUnsortedPile([binder('wishlist', 'WISHLIST'), binder('Blue')])
  const pile = out.find(isUnsorted)
  assert.ok(pile)
  assert.equal(pile.id, UNSORTED_COLLECTION_ID)
  assert.equal(pile.name, 'Unsorted')
  assert.equal(pile.type, 'OWNED')
  assert.deepEqual(pile.entries, [])
  // The same on every device, so two made independently don't disagree about when.
  assert.equal(pile.createdAt, 0)
  assert.equal(out.length, 3)
})

test('a pile that is already there is left exactly as it is', () => {
  const cards = [{ scryfallId: 'id-Sol Ring', name: 'Sol Ring', imageUrl: null, quantity: 2, foilQuantity: 0 }]
  const library = [binder('Blue'), { ...binder(UNSORTED_COLLECTION_ID), entries: cards }]
  // The same array back, so nothing is written and nothing syncs.
  assert.equal(withUnsortedPile(library), library)
})

test('an empty library still gets its pile', () => {
  assert.equal(withUnsortedPile([]).filter(isUnsorted).length, 1)
})

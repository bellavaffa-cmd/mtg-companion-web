import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takenFromUnsorted, withUnsortedPile } from '../../src/collection/unsorted.ts'
import { UNSORTED_COLLECTION_ID, isUnsorted, type Collection, type CollectionEntry } from '../../src/types/models.ts'

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

const loose = (scryfallId: string, name: string, quantity: number, foilQuantity = 0): CollectionEntry =>
  ({ scryfallId, name, imageUrl: null, quantity, foilQuantity })

test('a card put in a deck leaves the pile: that printing first, plain before foil', () => {
  const pile = [loose('msc', 'Sol Ring', 1, 1), loose('bolt', 'Lightning Bolt', 2)]
  const out = takenFromUnsorted(pile, 'msc', 'Sol Ring', 1)
  assert.equal(out.taken, 1)
  assert.deepEqual(out.entries.map((e) => [e.scryfallId, e.quantity, e.foilQuantity]), [['msc', 0, 1], ['bolt', 2, 0]])
  // The last copy gone, the entry goes too.
  assert.deepEqual(takenFromUnsorted(out.entries, 'msc', 'Sol Ring', 1).entries.map((e) => e.scryfallId), ['bolt'])
})

test('another printing of the same card is taken when that printing is not in the pile', () => {
  const pile = [loose('cmr', 'Sol Ring', 1), loose('msc', 'Sol Ring', 1), loose('dfc', 'Delver of Secrets // Insectile Aberration', 1)]
  const out = takenFromUnsorted(pile, 'msc', 'Sol Ring', 2)
  assert.equal(out.taken, 2)
  assert.deepEqual(out.entries.map((e) => e.scryfallId), ['dfc'])
  // Either face's name is the card.
  assert.equal(takenFromUnsorted(pile, 'other', 'Delver of Secrets', 1).taken, 1)
})

test('only what the pile has is taken, and a card not in it leaves the pile as it was', () => {
  const pile = [loose('msc', 'Sol Ring', 1)]
  assert.equal(takenFromUnsorted(pile, 'msc', 'Sol Ring', 3).taken, 1)
  const none = takenFromUnsorted(pile, 'bolt', 'Lightning Bolt', 1)
  assert.equal(none.taken, 0)
  assert.equal(none.entries, pile)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFindIndex, chipLabel, copiesLine, findIn, finder, matchScore, normalize } from '../../src/collection/findAnything.ts'
import { normalizeDeck } from '../../src/types/models.ts'
import type { Collection, CollectionEntry, CopyPlace, DeckCardEntry } from '../../src/types/models.ts'

// Find anything: the index, the matching and how a card's copies are grouped. The Android app has the
// same cases — see FindAnythingTest.kt.

const entry = (id: string, name: string, quantity: number, more: Partial<CollectionEntry> = {}, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity: 0, ...more, ...(places ? { places } : {}) })
const card = (id: string, name: string, quantity = 1, more: Partial<DeckCardEntry> = {}): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...more })

const pile: Collection = {
  id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED',
  entries: [
    entry('ring1', 'Sol Ring', 2, { forTrade: 1 }, [{ placeId: 'red', qty: 1, section: 'Colourless' }]),
    entry('bolt', 'Lightning Bolt', 3, { forSale: 2 }),
    entry('vial', 'Æther Vial', 1),
  ],
  storagePlaces: [
    { id: 'shelf', name: 'Shelf, study', kind: 'SHELF', createdAt: 1 },
    { id: 'red', name: 'Red box', kind: 'BOX', parentId: 'shelf', createdAt: 1 },
    { id: 'blue', name: 'Blue box', kind: 'BOX', parentId: 'shelf', createdAt: 1 },
    { id: 'rares', name: 'Rares binder', kind: 'BINDER', parentId: 'red', createdAt: 1 },
  ],
  graded: [{ id: 'g1', scryfallId: 'ring2', name: 'Sol Ring', company: 'PSA', grade: '9', createdAt: 1 }],
  loans: [{ id: 'l1', to: 'Sam', cards: [{ name: 'Sol Ring', scryfallId: 'ring1', qty: 1, collectionId: 'unsorted' }], lentAt: 1 }],
}
const wishlist: Collection = { id: 'wishlist', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries: [entry('mox', 'Mox Opal', 1)] }
const atraxa = normalizeDeck({ id: 'atraxa', name: 'Atraxa', cards: [card('ring3', 'Sol Ring')], ownership: 'PHYSICAL', createdAt: 1 })
const krenko = normalizeDeck({ id: 'krenko', name: 'Krenko goblins', cards: [card('ring4', 'Sol Ring'), card('gob', 'Goblin Guide', 4)], ownership: 'PROXY', createdAt: 1 })
const solDeck = normalizeDeck({ id: 'sol', name: 'Solar flare', cards: [], ownership: 'PHYSICAL', createdAt: 1, gameMode: 'MODERN' })
const index = buildFindIndex([pile, wishlist], [atraxa, krenko, solDeck])

test('normalize and match', () => {
  assert.equal(normalize('Æther Vial'), 'aether vial')
  assert.equal(normalize("Urza's  Saga!"), 'urzas saga')
  const ring = { text: 'sol ring', words: ['sol', 'ring'] }
  assert.equal(matchScore(ring, 'sol ring'), 4)
  assert.equal(matchScore(ring, 'sol r'), 3)
  assert.equal(matchScore(ring, 'ri so'), 2)
  assert.equal(matchScore(ring, 'l ri'), 1)
  assert.equal(matchScore(ring, 'ring sol x'), 0)
  assert.equal(matchScore(ring, ''), 0)
})

test('a card with every place its copies are', () => {
  const found = findIn(index, 'sol ri')
  assert.deepEqual(found.cards.map((c) => c.name), ['Sol Ring'])
  const ring = found.cards[0]
  // 2 in the pile (1 in the Red box, 1 lent to Sam), 1 in Atraxa, 1 graded; Krenko's is a proxy.
  assert.equal(ring.copies, 4)
  assert.equal(copiesLine(ring), '4 copies')
  assert.deepEqual(ring.chips.map(chipLabel), ['Red box › Colourless ×1', 'Atraxa deck ×1', 'Lent to Sam ×1', 'Graded PSA 9 ×1', 'For trade ×1'])
  assert.equal(ring.chips[2].kind, 'lent')
  assert.deepEqual(found.decksUsing, [
    { id: 'atraxa', name: 'Atraxa', line: 'Commander' },
    { id: 'krenko', name: 'Krenko goblins', line: 'Commander · proxy' },
  ])
  // "sol" also names a deck: it's found by its name.
  assert.deepEqual(findIn(index, 'sol').decks, [{ id: 'sol', name: 'Solar flare', line: 'Modern' }])
})

test('copies with no place, to sell, and cards only in decks as proxies', () => {
  const bolt = findIn(index, 'bolt').cards[0]
  assert.deepEqual(bolt.chips.map(chipLabel), ['No place ×3', 'To sell ×2'])
  const gob = findIn(index, 'goblin guide').cards[0]
  assert.equal(gob.copies, 0)
  assert.equal(copiesLine(gob), 'Proxy only')
  assert.equal(findIn(index, 'aether').cards[0].name, 'Æther Vial')
  // The wishlist isn't the user's.
  assert.equal(findIn(index, 'mox').cards.length, 0)
})

test('places, with what is inside', () => {
  const found = findIn(index, 'shelf')
  assert.deepEqual(found.places, [{ id: 'shelf', name: 'Shelf, study', line: '3 places inside' }])
  assert.deepEqual(findIn(index, 'red').places, [{ id: 'red', name: 'Red box', line: '1 place inside · in Shelf, study' }])
  assert.deepEqual(findIn(index, 'blue').places, [{ id: 'blue', name: 'Blue box', line: 'Box · 0 copies · in Shelf, study' }])
})

test('typing on narrows the last results, and starting over searches everything', () => {
  const find = finder(index)
  assert.equal(find('s').cards.length, 1)
  assert.equal(find('so').cards[0].name, 'Sol Ring')
  assert.equal(find('sol x').cards.length, 0)
  // Back to a shorter query: everything again.
  assert.equal(find('l').cards.map((c) => c.name).join(','), 'Lightning Bolt,Æther Vial,Goblin Guide,Sol Ring')
  assert.equal(find('').cards.length, 0)
  assert.equal(find('bolt').cards[0].name, 'Lightning Bolt')
})

test('better matches first', () => {
  const idx = buildFindIndex([{ id: 'b', name: 'B', createdAt: 0, type: 'OWNED', entries: [entry('a', 'Ring of Thune', 1), entry('b', 'Sol Ring', 1), entry('c', 'Ring', 1)] }], [])
  assert.deepEqual(findIn(idx, 'ring').cards.map((c) => c.name), ['Ring', 'Ring of Thune', 'Sol Ring'])
})

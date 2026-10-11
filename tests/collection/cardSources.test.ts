import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardSources, sourcesForName, sourcesLabel } from '../../src/collection/cardSources.ts'
import type { Collection, Deck } from '../../src/types/models.ts'

// "Where you own it": every binder and deck holding a printing, as the phone's buildCardSources.

test('binders and decks holding a printing, said as the phone says it', () => {
  const collections = [
    { id: 'b1', name: 'Binder', type: 'OWNED', createdAt: 0, entries: [{ scryfallId: 's', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 1 }] },
  ] as unknown as Collection[]
  const decks = [
    { id: 'd1', name: 'Atraxa', cards: [{ scryfallId: 's', name: 'Sol Ring', quantity: 1 }] },
    { id: 'd2', name: 'Edgar', cards: [{ scryfallId: 's', name: 'Sol Ring', quantity: 1 }, { scryfallId: 'x', name: 'X', quantity: 0 }] },
  ] as unknown as Deck[]
  const map = cardSources(collections, decks)
  assert.deepEqual(map.get('s')!.map((s) => [s.kind, s.name, s.quantity]), [['binder', 'Binder', 2], ['deck', 'Atraxa', 1], ['deck', 'Edgar', 1]])
  assert.equal(map.has('x'), false)
  assert.equal(sourcesLabel(map.get('s')!), 'In 2 decks and 1 binder')
  assert.equal(sourcesLabel([]), '')
})

test('a card page counts every printing, place by place', () => {
  const collections = [
    { id: 'b', name: 'Binder', entries: [
      { scryfallId: 'p1', name: 'Delver of Secrets // Insectile Aberration', quantity: 1, foilQuantity: 0 },
      { scryfallId: 'p2', name: 'Delver of Secrets // Insectile Aberration', quantity: 2, foilQuantity: 1 },
      { scryfallId: 'z', name: 'Opt', quantity: 4, foilQuantity: 0 },
    ] },
  ] as unknown as Collection[]
  const decks = [{ id: 'd', name: 'Tempo', cards: [{ scryfallId: 'p1', name: 'Delver of Secrets // Insectile Aberration', quantity: 1 }] }] as unknown as Deck[]
  assert.deepEqual(sourcesForName(collections, decks, 'Delver of Secrets').map((s) => [s.name, s.quantity]), [['Binder', 4], ['Tempo', 1]])
})

test("where you own it: no Virtual, Prototype, cube or sample deck, and not the Wishlist", () => {
  const collections = [
    { id: 'b', name: 'Binder', type: 'OWNED', createdAt: 0, entries: [{ scryfallId: 's', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0 }] },
    { id: 'w', name: 'Wishlist', type: 'WISHLIST', createdAt: 0, entries: [{ scryfallId: 's', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0 }] },
  ] as unknown as Collection[]
  const deck = (id: string, ownership: string, more: object = {}) =>
    ({ id, name: id, ownership, gameMode: 'COMMANDER', cards: [{ scryfallId: 's', name: 'Sol Ring', quantity: 1 }], ...more })
  const decks = [
    deck('Physical', 'PHYSICAL'), deck('Proxy', 'PROXY'), deck('Virtual', 'VIRTUAL'), deck('Prototype', 'PROTOTYPE'),
    deck('Cube', 'VIRTUAL', { gameMode: 'CUBE', archived: true }), deck('Sample', 'PHYSICAL', { sample: true }), deck('Unset', ''),
  ] as unknown as Deck[]
  const held = cardSources(collections, decks).get('s')!
  assert.deepEqual(held.map((s) => s.name), ['Binder', 'Physical', 'Proxy', 'Unset'])
  assert.equal(sourcesLabel(held), 'In 3 decks and 1 binder')
  assert.deepEqual(sourcesForName(collections, decks, 'Sol Ring').map((s) => s.name), ['Binder', 'Physical', 'Proxy', 'Unset'])
  // A card only in a Virtual deck and on the Wishlist is owned nowhere.
  assert.equal(cardSources([collections[1]], [decks[2]]).has('s'), false)
  assert.deepEqual(sourcesForName([collections[1]], [decks[2]], 'Sol Ring'), [])
})

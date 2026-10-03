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

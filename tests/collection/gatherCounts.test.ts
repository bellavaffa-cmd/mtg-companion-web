import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gatherCounts, gatherInto } from '../../src/collection/allCards.ts'
import type { Collection, CollectionEntry } from '../../src/types/models.ts'

// Add to… a binder from All cards: only copies in other binders move; deck-only cards stay put, and
// the confirmation says so rather than counting the whole selection (tester report, build 19).

const entry = (id: string): CollectionEntry => ({ scryfallId: id, name: id, imageUrl: null, quantity: 1, foilQuantity: 0 })
const binder = (id: string, ids: string[], type: Collection['type'] = 'OWNED'): Collection =>
  ({ id, name: id, entries: ids.map(entry), createdAt: 0, type })

test('counts what moves, what is only in decks, and what is there already', () => {
  const collections = [binder('unsorted', ['a', 'b', 'c']), binder('test', ['d']), binder('wish', ['e'], 'WISHLIST')]
  const ids = ['a', 'b', 'c', 'd', 'e', 'x', 'y']
  assert.deepEqual(gatherCounts(collections, 'test', ids), { moving: 3, deckOnly: 3, there: 1 })
  const after = gatherInto(collections, 'test', new Set(ids))
  assert.deepEqual(after.find((c) => c.id === 'test')!.entries.map((e) => e.scryfallId).sort(), ['a', 'b', 'c', 'd'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCollectionChanges, cardsTheyWant } from '../../src/social/tradeLogic.ts'
import type { Collection } from '../../src/types/models.ts'

// A trade line carries the giver's condition (JSON key "condition"), and the cards arrive in it. The
// Android app's TradeConditionTest checks the same.

const binder = (id: string, entries: Collection['entries'] = [], type: Collection['type'] = 'OWNED'): Collection =>
  ({ id, name: id, entries, createdAt: 1, type })

test('cards a trade brings in arrive in their condition', () => {
  const got = applyCollectionChanges([binder('b')], [{ collectionId: 'b', card: { scryfallId: 'a', name: 'Sol Ring', foil: false, quantity: 1, condition: 'MP' }, quantity: 1, foilQuantity: 0 }])
  assert.equal(got.collections[0].entries[0].condition, 'MP')
  const plain = applyCollectionChanges([binder('b')], [{ collectionId: 'b', card: { scryfallId: 'a', name: 'Sol Ring', foil: false, quantity: 1 }, quantity: 1, foilQuantity: 0 }])
  assert.ok(!('condition' in plain.collections[0].entries[0]))
})

test("a card they want is offered in the condition it's in; left out when not said", () => {
  const mine = [binder('m', [
    { scryfallId: 'a', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0, condition: 'LP' },
    { scryfallId: 'b', name: 'Arcane Signet', imageUrl: null, quantity: 1, foilQuantity: 0 },
  ])]
  const theirs = [binder('w', [
    { scryfallId: 'x', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0 },
    { scryfallId: 'y', name: 'Arcane Signet', imageUrl: null, quantity: 1, foilQuantity: 0 },
  ], 'WISHLIST')]
  const wanted = cardsTheyWant(mine, theirs)
  assert.deepEqual(wanted.map((w) => w.card.condition), [undefined, 'LP'])
  assert.ok(!JSON.stringify(wanted[0].card).includes('condition'))
})

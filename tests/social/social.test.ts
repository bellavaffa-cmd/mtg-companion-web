import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCollectionChanges, awaitingMyUpdate, tradeChanges, tradeSides } from '../../src/social/tradeLogic.ts'
import type { Trade } from '../../src/social/api.ts'
import type { Collection } from '../../src/types/models.ts'
import { DEFAULT_SETTINGS, gameReducer, newGame } from '../../src/lifecounter/game.ts'

const A = 'user-a'
const B = 'user-b'

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: 't1', from_user: A, to_user: B,
    // A asks for B's foil Sol Ring from B's binder b-trade; A offers two Bolts from a-main.
    want: [{ scryfallId: 'sol', name: 'Sol Ring', foil: true, quantity: 1, collectionId: 'b-trade' }],
    give: [{ scryfallId: 'bolt', name: 'Lightning Bolt', foil: false, quantity: 2, collectionId: 'a-main' }],
    message: null, reply: null, status: 'accepted', reply_to: null, from_applied: false, to_applied: false,
    created_at: '', updated_at: '', ...over,
  }
}

const binder = (id: string, entries: Collection['entries']): Collection => ({ id, name: id, entries, createdAt: 0, type: 'OWNED' })

test("each side of a trade sees what they give and what they get", () => {
  assert.deepEqual(tradeSides(trade(), A).give.map((c) => c.name), ['Lightning Bolt'])
  assert.deepEqual(tradeSides(trade(), A).get.map((c) => c.name), ['Sol Ring'])
  assert.equal(tradeSides(trade(), A).other, B)
  assert.deepEqual(tradeSides(trade(), B).give.map((c) => c.name), ['Sol Ring'])
  assert.deepEqual(tradeSides(trade(), B).get.map((c) => c.name), ['Lightning Bolt'])
  assert.equal(tradeSides(trade(), B).other, A)
})

test('only an accepted trade waits for each side to update their binders', () => {
  assert.ok(awaitingMyUpdate(trade(), A))
  assert.ok(!awaitingMyUpdate(trade({ from_applied: true }), A))
  assert.ok(awaitingMyUpdate(trade({ from_applied: true }), B))
  assert.ok(!awaitingMyUpdate(trade({ status: 'open' }), B))
})

test("the giver's copies come out of their binder and the received ones go in", () => {
  const mine = [
    binder('a-main', [{ scryfallId: 'bolt', name: 'Lightning Bolt', imageUrl: null, quantity: 3, foilQuantity: 1 }]),
    binder('a-trades', []),
  ]
  const { collections, short } = applyCollectionChanges(mine, tradeChanges(trade(), A, 'a-trades', null))
  assert.deepEqual(short, [])
  assert.deepEqual(collections[0].entries, [{ scryfallId: 'bolt', name: 'Lightning Bolt', imageUrl: null, quantity: 1, foilQuantity: 1 }])
  assert.deepEqual(collections[1].entries, [{ scryfallId: 'sol', name: 'Sol Ring', imageUrl: null, quantity: 0, foilQuantity: 1 }])
})

test('a card with no copies left leaves the binder; copies that are gone are reported, not made negative', () => {
  const theirs = [binder('b-trade', [{ scryfallId: 'sol', name: 'Sol Ring', imageUrl: null, quantity: 0, foilQuantity: 1 }])]
  const done = applyCollectionChanges(theirs, tradeChanges(trade(), B, 'b-trade', null))
  assert.deepEqual(done.collections[0].entries.map((e) => [e.name, e.quantity, e.foilQuantity]), [['Lightning Bolt', 2, 0]])
  assert.deepEqual(done.short, [])

  const traded = applyCollectionChanges([binder('b-trade', [])], tradeChanges(trade(), B, 'b-trade', null))
  assert.deepEqual(traded.short.map((c) => c.card.name), ['Sol Ring'])
  assert.ok(traded.collections[0].entries.every((e) => e.quantity >= 0 && e.foilQuantity >= 0))

  const deleted = applyCollectionChanges([binder('elsewhere', [])], tradeChanges(trade(), B, 'elsewhere', null))
  assert.deepEqual(deleted.short.map((c) => c.card.name), ['Sol Ring'])
})

test('a restart at the same table keeps who is sitting where; new seating drops them', () => {
  const alice = { userId: 'a', username: 'alice', displayName: 'Alice', avatarPath: null }
  let game = newGame(DEFAULT_SETTINGS)
  game = gameReducer(game, { type: 'match', match: { id: 'm1', code: 'c' } })
  game = gameReducer(game, { type: 'link', id: 2, player: alice })
  game = gameReducer(game, { type: 'life', id: 2, delta: -5 })
  const restarted = gameReducer(game, { type: 'new', settings: DEFAULT_SETTINGS })
  assert.deepEqual(restarted.match, { id: 'm1', code: 'c' })
  assert.deepEqual(restarted.players.find((p) => p.id === 2)?.linked, alice)
  assert.equal(restarted.players.find((p) => p.id === 2)?.life, 40)

  const reseated = gameReducer(game, { type: 'new', settings: { ...DEFAULT_SETTINGS, layoutId: '2-facing' } })
  assert.equal(reseated.players.length, 2)
  assert.equal(reseated.match ?? null, null)
  assert.ok(reseated.players.every((p) => !p.linked))

  const closed = gameReducer(game, { type: 'match', match: null })
  assert.ok(closed.players.every((p) => !p.linked))
})

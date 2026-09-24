import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTurnFrom } from '../../src/lifecounter/game.ts'
import type { Player } from '../../src/lifecounter/game.ts'

// Passing the turn: someone who has lost is passed over, and a "turn" is a round of the table.

const player = (id: number, extra: Partial<Player> = {}): Player => ({
  id, life: 40, commanderDamage: {}, poison: 0, colorIndex: id, name: null, killed: false, ...extra,
})

const four = [player(1), player(2), player(3), player(4)]

test('the turn goes round the table, one seat at a time', () => {
  assert.deepEqual(nextTurnFrom(four, 1, 1, true), { turnPlayerId: 2, roundComplete: false })
  assert.deepEqual(nextTurnFrom(four, 2, 1, true), { turnPlayerId: 3, roundComplete: false })
})

test('a round is only complete when play comes back to whoever started', () => {
  // Starting player is 1, so 4 -> 1 finishes the round; nothing before it does.
  assert.equal(nextTurnFrom(four, 3, 1, true)?.roundComplete, false)
  assert.equal(nextTurnFrom(four, 4, 1, true)?.roundComplete, true)
})

test('a round is measured from the player who actually started', () => {
  // Player 3 won the roll: the round completes coming back to 3, not to 1.
  assert.equal(nextTurnFrom(four, 4, 3, true)?.roundComplete, false)
  assert.equal(nextTurnFrom(four, 1, 3, true)?.roundComplete, false)
  assert.equal(nextTurnFrom(four, 2, 3, true)?.roundComplete, true)
})

test('a player who is out is passed over', () => {
  const players = [player(1), player(2, { killed: true }), player(3), player(4)]
  assert.equal(nextTurnFrom(players, 1, 1, true)?.turnPlayerId, 3)
})

test('out by life, poison or commander damage counts as out when the table is set that way', () => {
  const byLife = [player(1), player(2, { life: 0 }), player(3)]
  assert.equal(nextTurnFrom(byLife, 1, 1, true)?.turnPlayerId, 3)
  // ...and doesn't when the table keeps score by hand.
  assert.equal(nextTurnFrom(byLife, 1, 1, false)?.turnPlayerId, 2)

  const byPoison = [player(1), player(2, { poison: 10 }), player(3)]
  assert.equal(nextTurnFrom(byPoison, 1, 1, true)?.turnPlayerId, 3)

  const byCommander = [player(1), player(2, { commanderDamage: { 1: 21 } }), player(3)]
  assert.equal(nextTurnFrom(byCommander, 1, 1, true)?.turnPlayerId, 3)
})

test('passing over the starting player still completes the round', () => {
  // 1 started and is out: coming round past their seat is still a new round.
  const players = [player(1, { killed: true }), player(2), player(3), player(4)]
  assert.deepEqual(nextTurnFrom(players, 4, 1, true), { turnPlayerId: 2, roundComplete: true })
  assert.equal(nextTurnFrom(players, 2, 1, true)?.roundComplete, false)
})

test('the last player left keeps taking turns, and each one is a round', () => {
  const players = [player(1, { killed: true }), player(2), player(3, { killed: true })]
  assert.deepEqual(nextTurnFrom(players, 2, 1, true), { turnPlayerId: 2, roundComplete: true })
})

test('nothing moves when there is nobody to move to', () => {
  assert.equal(nextTurnFrom([], 1, 1, true), null)
  assert.equal(nextTurnFrom([player(1, { killed: true })], 1, 1, true), null)
})

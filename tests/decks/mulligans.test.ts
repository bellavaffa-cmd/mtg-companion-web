import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanMulligans, handSize, mulliganStats, mulliganSummary, mulliganText } from '../../src/decks/mulligans.ts'
import type { GameResult } from '../../src/types/models.ts'

// Mulligans in real games. The Android app has the same checks — see MulligansTest.kt.

const g = (id: string, result: GameResult['result'], mulligans?: number | null): GameResult =>
  ({ id, result, opponent: null, playedAt: 0, ...(mulligans === undefined ? {} : { mulligans }) })

test('the hand left after mulligans, the first one free in multiplayer', () => {
  assert.deepEqual([0, 1, 2, 8].map((m) => handSize(m, false)), [7, 6, 5, 0])
  assert.deepEqual([0, 1, 2].map((m) => handSize(m, true)), [7, 7, 6])
  assert.equal(mulliganText(0, false), 'Kept 7')
  assert.equal(mulliganText(1, false), '1 mulligan, to 6')
  assert.equal(mulliganText(2, true), '2 mulligans, to 6')
})

test('a mulligan count from the other app is a whole number from 0 to 7', () => {
  assert.deepEqual([3, 0, 7].map(cleanMulligans), [3, 0, 7])
  assert.deepEqual([8, -1, 1.5, '2', null, undefined].map(cleanMulligans), [null, null, null, null, null, null])
})

test('mulligan rate and win rate after a mulligan, over the games that recorded them', () => {
  const s = mulliganStats([g('a', 'WIN', 0), g('b', 'LOSS', 1), g('c', 'WIN', 1), g('d', 'WIN', 2), g('e', 'LOSS', null), g('f', 'LOSS', 0), g('h', 'WIN')])
  assert.deepEqual(s, { recorded: 5, mulliganed: 3, rate: 60, winsAfter: 2, winRateAfter: 66, winRateKept: 50 })
  assert.equal(mulliganSummary(s), 'Mulligan in 60% of 5 games · won 66% after one')
  assert.equal(mulliganSummary(mulliganStats([g('a', 'WIN')])), null)
  assert.deepEqual(mulliganStats([g('a', 'WIN', 0)]), { recorded: 1, mulliganed: 0, rate: 0, winsAfter: 0, winRateAfter: null, winRateKept: 100 })
  assert.equal(mulliganSummary(mulliganStats([g('a', 'WIN', 0)])), 'Mulligan in 0% of 1 game')
})

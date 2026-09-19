import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handOdds, oddsPercent } from '../../src/decks/handOdds.ts'

// Opening-hand odds, against figures worked out separately (Python's math.comb). The Android app
// has the same checks — see HandOddsTest.kt.

const near = (expected: number, actual: number) => assert.ok(Math.abs(expected - actual) < 0.0001, `${actual} ≠ ${expected}`)

test('a Commander deck', () => {
  // 100 cards less the commander: 37 lands, 10 ramp. Multiplayer draws on turn 1.
  const odds = handOdds(99, 37, 10, true)!
  ;[0.0330, 0.1528, 0.2895, 0.2912, 0.1678, 0.0554, 0.0097, 0.0007].forEach((e, i) => near(e, odds.landSpread[i]))
  near(1, odds.landSpread.reduce((a, b) => a + b, 0))
  near(0.7484, odds.keepable)
  near(0.9367, odds.keepableWithMulligan)
  near(0.5372, odds.rampInHand)
  assert.deepEqual(odds.landDrops.map((d) => d.turn), [3, 4])
  near(0.8004, odds.landDrops[0].chance)
  near(0.6488, odds.landDrops[1].chance)
  near(0.5670, odds.landsAndRampByTurn2)
})

test('a sixty-card deck on the play', () => {
  const odds = handOdds(60, 24, 4, false)!
  near(0.7887, odds.landDrops[0].chance)
  near(0.3904, odds.landsAndRampByTurn2)
})

test('too few cards, and how chances read', () => {
  assert.equal(handOdds(10, 4, 0, true), null)
  assert.equal(oddsPercent(0.0007), '<1%')
  assert.equal(oddsPercent(0.998), '>99%')
  assert.equal(oddsPercent(0.7484), '75%')
})

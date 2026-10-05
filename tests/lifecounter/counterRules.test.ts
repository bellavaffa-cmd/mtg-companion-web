import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampCounter, cleanRingBearer, isMaxSpeed, ringAbilities } from '../../src/lifecounter/counterRules.ts'

// Rad, speed and the Ring. The Android app has the same checks — see CounterRulesTest.kt.

test('speed and the Ring stop at 4; rad has no limit; nothing goes below 0', () => {
  assert.equal(clampCounter('speed', 3 + 5), 4)
  assert.equal(clampCounter('speed', -1), 0)
  assert.equal(clampCounter('ring', 7), 4)
  assert.equal(clampCounter('ring', 2), 2)
  assert.equal(clampCounter('rad', 123), 123)
  assert.equal(clampCounter('rad', -4), 0)
  assert.equal(clampCounter('energy', 40), 40)
})

test('max speed is 4', () => {
  assert.equal(isMaxSpeed(3), false)
  assert.equal(isMaxSpeed(4), true)
})

test('each time the Ring tempts you its bearer gains the next ability', () => {
  assert.equal(ringAbilities(0).length, 0)
  assert.deepEqual(ringAbilities(1), ["Legendary, and can't be blocked by creatures with greater power."])
  assert.equal(ringAbilities(3).length, 3)
  assert.equal(ringAbilities(4)[3], 'Whenever it deals combat damage to a player, each opponent loses 3 life.')
  assert.equal(ringAbilities(9).length, 4)
})

test("a Ring-bearer's name is trimmed, cut to 60 characters, and blank is nobody", () => {
  assert.equal(cleanRingBearer('  Frodo Baggins '), 'Frodo Baggins')
  assert.equal(cleanRingBearer('   '), null)
  assert.equal(cleanRingBearer(42), null)
  assert.equal(cleanRingBearer('x'.repeat(80))!.length, 60)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindDetail, kindsToChoose } from '../../src/collection/addTargets.ts'

// Whether the "add to…" sheet asks binder or deck first, before listing either. The Android app's
// MoveTargetKindsTest checks the same.

test('binders and decks together are asked about first', () => {
  assert.deepEqual(kindsToChoose(2, 1), ['binder', 'deck'])
})

test('only one kind goes straight to its list', () => {
  assert.equal(kindsToChoose(0, 3), null)
  assert.equal(kindsToChoose(2, 0), null)
  assert.equal(kindsToChoose(0, 0), null)
})

test('the first step counts what each kind holds', () => {
  assert.equal(kindDetail('deck', 1), '1 deck')
  assert.equal(kindDetail('binder', 4), '4 binders')
})

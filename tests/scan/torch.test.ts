import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasTorch, torchConstraints } from '../../src/scan/torch.ts'

test('the light button only for a camera that says it has a torch', () => {
  assert.equal(hasTorch({ torch: true }), true)
  assert.equal(hasTorch({ torch: false }), false)
  assert.equal(hasTorch({ zoom: { min: 1, max: 5 } }), false)
  assert.equal(hasTorch(undefined), false)
})

test('switching it asks for the torch as an advanced constraint', () => {
  assert.deepEqual(torchConstraints(true), { advanced: [{ torch: true }] })
})

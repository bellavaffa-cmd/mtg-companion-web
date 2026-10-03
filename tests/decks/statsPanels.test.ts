import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodePanels, isPanelOpen } from '../../src/decks/statsPanels.ts'

// Stats panels fold away, as the Android app's StatsPanels: summary, curve and roles start open.

test('untouched panels take their default', () => {
  assert.equal(isPanelOpen('summary', {}), true)
  assert.equal(isPanelOpen('curve', {}), true)
  assert.equal(isPanelOpen('roles', {}), true)
  assert.equal(isPanelOpen('types', {}), false)
  assert.equal(isPanelOpen('match', {}), false)
})

test('a stored choice wins over the default', () => {
  assert.equal(isPanelOpen('curve', { curve: false }), false)
  assert.equal(isPanelOpen('types', { types: true }), true)
})

test('unreadable storage reads as nothing chosen', () => {
  assert.deepEqual(decodePanels(null), {})
  assert.deepEqual(decodePanels('not json'), {})
  assert.deepEqual(decodePanels('[1,2]'), {})
  assert.deepEqual(decodePanels('{"curve":false,"x":"yes"}'), { curve: false })
})

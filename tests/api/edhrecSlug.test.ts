// EDHREC's page names for a card (src/api/edhrec.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { edhrecSlug } from '../../src/api/edhrec.ts'

test('punctuation goes and spaces become hyphens', () => {
  assert.equal(edhrecSlug("Yuriko, the Tiger's Shadow"), 'yuriko-the-tigers-shadow')
})

test('a two-faced commander is found by its front face', () => {
  assert.equal(edhrecSlug("Katilda, Dawnhart Martyr // Katilda's Rising Dawn"), 'katilda-dawnhart-martyr')
})

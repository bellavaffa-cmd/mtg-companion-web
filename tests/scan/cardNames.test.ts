// Matching what the scanner reads against real card names (src/scan/cardNames.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildNameIndex, MIN_MATCH } from '../../src/scan/cardNames.ts'

const names = [
  'Lightning Bolt', 'Lightning Helix', 'Sol Ring', 'Rhystic Study', 'Serra Angel', 'Serra',
  'Delver of Secrets // Insectile Aberration', "Atraxa, Praetors' Voice", 'Jötun Grunt', 'Counterspell',
]
const index = buildNameIndex(names)
const matched = (text: string) => {
  const m = index.match(text)
  return m && m.score >= MIN_MATCH ? m.name : null
}

test('an exact read matches its card', () => {
  assert.equal(matched('Lightning Bolt'), 'Lightning Bolt')
  assert.equal(matched('Sol Ring'), 'Sol Ring')
})

test('a misread letter or two still lands on the right card', () => {
  assert.equal(matched('Rhstic Study'), 'Rhystic Study')
  assert.equal(matched('Lightnlng Bolt'), 'Lightning Bolt')
  assert.equal(matched('Counterspel'), 'Counterspell')
})

test('accents and punctuation are ignored', () => {
  assert.equal(matched('Jotun Grunt'), 'Jötun Grunt')
  assert.equal(matched('Atraxa Praetors Voice'), "Atraxa, Praetors' Voice")
})

test('a double-faced card matches by its front face and comes back with its full name', () => {
  assert.equal(matched('Delver of Secrets'), 'Delver of Secrets // Insectile Aberration')
})

test('noise from a card frame matches nothing', () => {
  assert.equal(matched('EEE'), null)
  assert.equal(matched('——— |'), null)
  assert.equal(matched('pr TT y i'), null)
})

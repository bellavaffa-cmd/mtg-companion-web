import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLE_TAGS, matchedTags, matchesNameOrTag, tagLabel } from '../../src/tags/roleTags.ts'

test('one search finds a card by its name or by one of its tags', () => {
  assert.ok(matchesNameOrTag('Sol Ring', ['ramp', 'mana-rock'], 'sol'))
  assert.ok(matchesNameOrTag('Sol Ring', ['ramp', 'mana-rock'], 'ramp'))
  assert.ok(matchesNameOrTag('Sol Ring', ['ramp', 'mana-rock'], 'Mana Rock'))
  assert.ok(!matchesNameOrTag('Sol Ring', ['ramp', 'mana-rock'], 'removal'))
  assert.ok(matchesNameOrTag('Sol Ring', [], '  '))
})

test('a search says which tags it matched', () => {
  assert.deepEqual(matchedTags(['ramp', 'land-ramp', 'tutor'], 'ramp'), ['ramp', 'land-ramp'])
  assert.deepEqual(matchedTags(['ramp'], ''), [])
  assert.equal(tagLabel('board-wipe'), 'Board wipe')
})

test('every tag has a label and a Scryfall search, and ids are unique', () => {
  assert.equal(new Set(ROLE_TAGS.map((t) => t.id)).size, ROLE_TAGS.length)
  for (const t of ROLE_TAGS) assert.ok(t.label && t.query, t.id)
})

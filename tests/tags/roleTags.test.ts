import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLE_TAGS, matchedTags, matchesNameOrTag, parseTagFile, tagLabel, tagsFor } from '../../src/tags/roleTags.ts'

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

test('every tag has a label and a Tagger tag or rules-text match, and ids are unique', () => {
  assert.equal(new Set(ROLE_TAGS.map((t) => t.id)).size, ROLE_TAGS.length)
  for (const t of ROLE_TAGS) assert.ok(t.label && (t.slugs?.length || t.text), t.id)
})

test("Tagger's file gives each tag its cards and everything under it", () => {
  // Tagger's "removal" has no cards of its own, only the tags under it.
  const lines = [
    '{"id":"t1","slug":"removal","aliases":[],"child_ids":["t2"],"taggings":[]}',
    '{"id":"t2","slug":"creature-removal","child_ids":["t3"],"taggings":[{"oracle_id":"aaaaaaaa-1111-2222-3333-444444444444"}]}',
    '{"id":"t3","slug":"removal-exile","child_ids":[],"taggings":[{"oracle_id":"bbbbbbbb-1111-2222-3333-444444444444"}]}',
    '{"id":"t4","slug":"ramp","child_ids":[],"taggings":[{"oracle_id":"cccccccc-1111-2222-3333-444444444444"}]}',
    '{"id":"t5","slug":"sweeper","aliases":["mass removal"],"child_ids":[],"taggings":[{"oracle_id":"dddddddd-1111-2222-3333-444444444444"}]}',
    '{"id":"t6","slug":"unrelated","child_ids":[],"taggings":[{"oracle_id":"eeeeeeee-1111-2222-3333-444444444444"}]}',
    '',
  ]
  const sets = parseTagFile(lines)
  assert.deepEqual([...sets.get('removal')!].sort(), ['aaaaaaaa-1111', 'bbbbbbbb-1111'])
  assert.deepEqual([...sets.get('ramp')!], ['cccccccc-1111'])
  assert.deepEqual([...sets.get('board-wipe')!], ['dddddddd-1111'])
  assert.deepEqual(tagsFor('bbbbbbbb-1111-2222-3333-444444444444', 'Exile target creature.', sets), ['removal'])
  assert.deepEqual(tagsFor('eeeeeeee-1111-2222-3333-444444444444', '', sets), [])
})

test('token and Treasure tags read the rules text', () => {
  const none = new Map<string, Set<string>>()
  assert.deepEqual(tagsFor(undefined, 'Create two 1/1 white Soldier creature tokens.', none), ['tokens'])
  assert.deepEqual(tagsFor(undefined, 'Whenever an opponent casts a spell, create a Treasure token.', none), ['treasure'])
  // Doubling Season makes no tokens of its own.
  assert.deepEqual(tagsFor(undefined, 'If an effect would create one or more tokens under your control, it creates twice that many creature tokens instead.', none), [])
})

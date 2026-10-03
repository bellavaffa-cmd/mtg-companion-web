import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardValue, collectionBreakdown, colorBucket, rarityBucket, typeBucket, type BreakdownCard } from '../../src/collection/breakdown.ts'

// Where the collection's value sits. The Android app has the same checks — CollectionBreakdownTest.kt.

const card = (id: string, usd: number | null, { copies = 1, set = `Set ${id}`, colors = '', rarity = 'rare', type = 'Creature' } = {}): BreakdownCard =>
  ({ id, name: id, imageUrl: null, copies, usd, setCode: id, setName: set, colors: new Set(colors), rarity, typeLine: type })

test('sets beyond the top eight go together', () => {
  const cards = Array.from({ length: 10 }, (_, i) => card(`s${i + 1}`, i + 1))
  const b = collectionBreakdown(cards)
  assert.equal(b.bySet.length, 9)
  assert.equal(b.bySet[0].label, 'Set s10')
  assert.deepEqual(b.bySet[8], { label: 'Other sets', usd: 3, copies: 2 })
  assert.equal(b.totalUsd, 55)
  // Nine sets fit without an "Other" of one.
  assert.equal(collectionBreakdown(cards.slice(0, 9)).bySet.length, 9)
})

test('colours, rarities and types add up by value', () => {
  const b = collectionBreakdown([
    card('a', 2, { copies: 2, colors: 'R', rarity: 'common', type: 'Instant' }),
    card('b', 10, { colors: 'WU', rarity: 'mythic', type: 'Legendary Artifact Creature — Golem' }),
    card('c', null, { copies: 3, colors: '', rarity: 'special', type: 'Basic Land — Island' }),
    card('d', 1, { copies: 0, colors: 'G' }),
  ])
  assert.deepEqual(b.byColor, [{ label: 'Red', usd: 4, copies: 2 }, { label: 'Multicolor', usd: 10, copies: 1 }, { label: 'Colorless', usd: 0, copies: 3 }])
  assert.deepEqual(b.byRarity.map((s) => s.label), ['Common', 'Mythic', 'Other'])
  assert.deepEqual(b.byType.map((s) => s.label), ['Creature', 'Instant', 'Land'])
  assert.deepEqual(b.mostValuable.map((c) => c.id), ['b', 'a'])
})

test('the ten dearest cards count every copy', () => {
  const top = collectionBreakdown(Array.from({ length: 12 }, (_, i) => card(`c${i + 1}`, 1, { copies: i + 1 }))).mostValuable
  assert.equal(top.length, 10)
  assert.equal(top[0].id, 'c12')
  assert.equal(cardValue(top[0]), 12)
})

test('buckets by the usual rules', () => {
  assert.equal(colorBucket(new Set()), 'Colorless')
  assert.equal(colorBucket(new Set(['G'])), 'Green')
  assert.equal(colorBucket(new Set(['B', 'G'])), 'Multicolor')
  assert.equal(rarityBucket('MYTHIC'), 'Mythic')
  assert.equal(typeBucket('Artifact Creature — Construct'), 'Creature')
  assert.equal(typeBucket('Kindred Tribal'), 'Other')
})

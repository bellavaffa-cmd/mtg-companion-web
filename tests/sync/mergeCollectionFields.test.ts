import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import type { Collection, CollectionEntry } from '../../src/types/models.ts'

// A binder card's own fields — the copies' condition and language, the rise alert — merge field by
// field, as the Android app's ItemMerge.mergeCollections does (ItemMergeTest).

const entry = (extra: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: 'a', name: 'a', imageUrl: null, quantity: 1, foilQuantity: 0, ...extra })
const binder = (e: CollectionEntry): Collection => ({ id: 'c1', name: 'Binder', entries: [e], createdAt: 1, type: 'OWNED' })

test("one device's condition, the other's language and alert: all three kept", () => {
  const merged = mergeCollection(binder(entry()), binder(entry({ condition: 'LP' })), binder(entry({ language: 'ja', priceAlertAbove: 40 })), false).entries[0]
  assert.deepEqual([merged.condition, merged.language, merged.priceAlertAbove], ['LP', 'ja', 40])
})

test('both changed the condition: the more recent edit wins', () => {
  const base = binder(entry({ condition: 'NM' }))
  assert.equal(mergeCollection(base, binder(entry({ condition: 'HP' })), binder(entry({ condition: 'MP' })), true).entries[0].condition, 'HP')
  assert.equal(mergeCollection(base, binder(entry({ condition: 'HP' })), binder(entry({ condition: 'MP' })), false).entries[0].condition, 'MP')
})

test('clearing a field is a change, and the key stays left out', () => {
  const base = binder(entry({ condition: 'NM', language: 'de' }))
  const cleared = mergeCollection(base, base, binder(entry({ language: 'de' })), true).entries[0]
  assert.equal(cleared.condition, undefined)
  assert.equal(cleared.language, 'de')
  assert.ok(!('condition' in cleared))
  // Cleared here, untouched there: still cleared.
  const mine = mergeCollection(base, binder(entry({ condition: 'NM' })), base, false).entries[0]
  assert.ok(!('language' in mine))
  assert.equal(mine.condition, 'NM')
})

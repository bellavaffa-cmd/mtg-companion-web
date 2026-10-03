import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingFromSet, ownedPrintings, setComplete, setFraction, setPercent, setProgress, sortedSets, type SetInfo } from '../../src/collection/setCompletion.ts'
import { normalizeDeck, type Collection } from '../../src/types/models.ts'

// How much of each set the user has. The Android app has the same checks — SetCompletionTest.kt.

const sets = new Map<string, SetInfo>([
  ['mh3', { code: 'mh3', name: 'Modern Horizons 3', cardCount: 4, releasedAt: '2024-06-14' }],
  ['lea', { code: 'lea', name: 'Limited Edition Alpha', cardCount: 2, releasedAt: '1993-08-05' }],
  ['cmr', { code: 'cmr', name: 'Commander Legends', cardCount: 10, releasedAt: '2020-11-20' }],
])

test('printings are counted once per set', () => {
  const owned = new Map([['a', 'mh3'], ['b', 'MH3'], ['c', 'lea'], ['d', 'lea'], ['e', 'xyz']])
  const progress = new Map(setProgress(owned, sets).map((p) => [p.set.code, p]))
  assert.equal(progress.get('mh3')!.owned, 2)
  assert.equal(setPercent(progress.get('mh3')!), 50)
  assert.ok(setComplete(progress.get('lea')!))
  // A set Scryfall's list lacks is still there, its size unknown.
  const unknown = progress.get('xyz')!
  assert.equal(unknown.set.name, 'XYZ')
  assert.equal(setFraction(unknown), 0)
  assert.ok(!setComplete(unknown))
  assert.ok(!progress.has('cmr'), "sets with nothing owned aren't listed")
})

test('sorts by completion, name or release', () => {
  const list = setProgress(new Map([['a', 'mh3'], ['c', 'lea'], ['d', 'lea'], ['f', 'cmr']]), sets)
  assert.deepEqual(sortedSets(list, 'PERCENT').map((p) => p.set.code), ['lea', 'mh3', 'cmr'])
  assert.deepEqual(sortedSets(list, 'NAME').map((p) => p.set.code), ['cmr', 'lea', 'mh3'])
  assert.deepEqual(sortedSets(list, 'RELEASE').map((p) => p.set.code), ['mh3', 'cmr', 'lea'])
})

test('the percent only reads 100 when complete', () => {
  const x = (cardCount: number, owned: number) => ({ set: { code: 'x', name: 'X', cardCount }, owned })
  assert.equal(setPercent(x(200, 199)), 99)
  assert.equal(setPercent(x(200, 200)), 100)
  assert.equal(setFraction(x(2, 3)), 1)
})

test('owned is what All cards counts', () => {
  const binder: Collection = { id: 'b', name: 'Binder', createdAt: 0, type: 'OWNED', entries: [{ scryfallId: 'a', name: 'A', imageUrl: null, quantity: 1, foilQuantity: 1 }] }
  const wishlist: Collection = { id: 'wishlist', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries: [{ scryfallId: 'w', name: 'W', imageUrl: null, quantity: 1, foilQuantity: 0 }] }
  const card = (id: string, quantity: number, proxyQuantity?: number) =>
    ({ scryfallId: id, name: id.toUpperCase(), imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, proxyQuantity })
  const deck = normalizeDeck({ id: 'd', name: 'Deck', cards: [card('a', 1), card('p', 2, 2)] })
  assert.deepEqual([...ownedPrintings([binder, wishlist], [deck])], [['a', 3]])
  assert.deepEqual(missingFromSet(['a', 'b'], new Set(['a']), (x) => x), ['b'])
})

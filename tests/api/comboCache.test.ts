import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEEP, TTL_MS, cacheGet, cachePut, prune, trim, type ComboStore } from '../../src/api/comboCache.ts'
import type { ComboVariant } from '../../src/api/relay.ts'

// What's kept of a card's combos: a week, then it's asked for again. The Android app has the same
// checks — see ComboCacheTest.kt.

const variant = (id: string): ComboVariant => ({
  id,
  uses: [{ card: { name: 'Sol Ring', imageUriFrontNormal: 'https://example.test/art.jpg' }, quantity: 1 }],
  produces: [{ feature: { name: 'Infinite mana' } }],
  description: 'A long set of steps the app never shows.',
  popularity: 1234,
})
const now = 1_700_000_000_000

test('a card is kept for a week, "no combos" included, and matched however it is typed', () => {
  let store: ComboStore = cachePut({}, 'Sol Ring', [variant('a'), variant('b')], now)
  store = cachePut(store, 'Rhystic Study', [], now)

  assert.deepEqual(cacheGet(store, '  sol ring  ', now)?.map((v) => v.id), ['a', 'b'])
  // An empty answer is an answer: it must not read as "not kept" and send us asking again.
  assert.deepEqual(cacheGet(store, 'Rhystic Study', now), [])
  assert.equal(cacheGet(store, 'Cultivate', now), undefined)

  assert.equal(cacheGet(store, 'Sol Ring', now + TTL_MS)?.length, 2)
  assert.equal(cacheGet(store, 'Sol Ring', now + TTL_MS + 1), undefined)
})

test('only what the card view shows is kept — no art, no step-by-step', () => {
  const kept = trim(variant('a'))
  assert.deepEqual(kept, { id: 'a', uses: [{ card: { name: 'Sol Ring' } }], produces: [{ feature: { name: 'Infinite mana' } }] })
  const stored = JSON.stringify(cachePut({}, 'Sol Ring', [variant('a')], now))
  assert.ok(!stored.includes('example.test'), 'card art must not be kept')
  assert.ok(!stored.includes('never shows'), 'the description must not be kept')
})

test('stale cards go, and only the newest KEEP are held', () => {
  const old: ComboStore = { 'ancient card': { at: now - TTL_MS - 1, variants: [] } }
  assert.deepEqual(prune(old, now), {})

  let store: ComboStore = {}
  for (let i = 0; i < KEEP + 30; i++) store = cachePut(store, `card ${i}`, [variant(`v${i}`)], now + i)
  assert.equal(Object.keys(store).length, KEEP)
  // The ones asked for longest ago went; the newest stayed.
  assert.equal(cacheGet(store, 'card 0', now + KEEP), undefined)
  assert.deepEqual(cacheGet(store, `card ${KEEP + 29}`, now + KEEP)?.map((v) => v.id), [`v${KEEP + 29}`])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertHits, alertNotification, alertPrice, alertStep, alertWatches, byDirection, memoryKey, type AlertWatch } from '../../src/collection/priceAlertRules.ts'
import type { Collection, CollectionEntry } from '../../src/types/models.ts'

// When price alerts go off, both kinds. The Android app has the same checks — PriceAlertRulesTest.kt.

const entry = (id: string, { below, above, quantity = 1, foil = 0 }: { below?: number; above?: number; quantity?: number; foil?: number } = {}): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity: foil, ...(below ? { priceAlert: below } : {}), ...(above ? { priceAlertAbove: above } : {}) })

const wishlist: Collection = { id: 'wishlist', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries: [entry('w', { below: 5 }), entry('w0')] }
const binder: Collection = { id: 'b1', name: 'Binder', createdAt: 0, type: 'OWNED', entries: [entry('o', { above: 40 }), entry('o2', { below: 1 })] }

test('wishlists watch for drops and binders for rises', () => {
  const watches = alertWatches([wishlist, binder])
  assert.deepEqual(watches.map((w) => [w.entry.scryfallId, w.direction]), [['w', 'BELOW'], ['o', 'ABOVE']])
  assert.deepEqual(watches.map(memoryKey), ['w', 'above:o'])
})

test('a rise alert goes off at or above its price', () => {
  const [w] = alertWatches([binder])
  assert.deepEqual(alertStep(w, 39.99, null), { kind: 'forget' })
  assert.deepEqual(alertStep(w, 40, null), { kind: 'tell', price: 40 })
  // Told at 41: quiet at 41 or less, told again when it climbs further.
  assert.deepEqual(alertStep(w, 41, 41), { kind: 'quiet' })
  assert.deepEqual(alertStep(w, 40.5, 41), { kind: 'quiet' })
  assert.deepEqual(alertStep(w, 45, 41), { kind: 'tell', price: 45 })
  // Back under: forgotten, so the next rise tells again.
  assert.deepEqual(alertStep(w, 30, 45), { kind: 'forget' })
})

test('a drop alert works as before', () => {
  const [w] = alertWatches([wishlist])
  assert.deepEqual(alertStep(w, 5.01, 4), { kind: 'forget' })
  assert.deepEqual(alertStep(w, 5, null), { kind: 'tell', price: 5 })
  assert.deepEqual(alertStep(w, 4.5, 4), { kind: 'quiet' })
  assert.deepEqual(alertStep(w, 3, 4), { kind: 'tell', price: 3 })
})

test('a rise alert on foil-only copies watches the foil price', () => {
  const foils: AlertWatch = { collectionId: 'b1', entry: entry('f', { above: 10, quantity: 0, foil: 2 }), direction: 'ABOVE', target: 10 }
  assert.equal(alertPrice(foils, 3, 12), 12)
  assert.equal(alertPrice(foils, 3, null), 3)
  assert.equal(alertPrice({ ...foils, entry: { ...foils.entry, quantity: 1 } }, 3, 12), 3)
})

test('Home lists every alert past its line, drops first', () => {
  const watches = alertWatches([wishlist, binder])
  assert.deepEqual(alertHits(watches, new Map([['w', [4, null]], ['o', [39, 80]]])).map((h) => h.watch.entry.scryfallId), ['w'])
  const both = alertHits(watches, new Map([['o', [42, null]], ['w', [4, null]]]))
  assert.deepEqual(both.map((h) => h.price), [4, 42])
  assert.deepEqual(byDirection([...both].reverse()).map((h) => h.watch.direction), ['BELOW', 'ABOVE'])
})

test("the notification says it in the phone's words", () => {
  const usd = (v: number) => `$${v.toFixed(2)}`
  const [w, o] = alertWatches([wishlist, binder])
  assert.deepEqual(alertNotification([{ watch: o, price: 42 }], usd), { title: 'Price rise: o', body: 'o is $42.00 — over your $40.00 alert' })
  assert.deepEqual(alertNotification([{ watch: w, price: 4 }], usd), { title: 'Price drop: w', body: 'w is $4.00 — under your $5.00 alert' })
  assert.deepEqual(alertNotification([{ watch: w, price: 4 }, { watch: o, price: 42 }], usd), { title: 'Price alerts', body: '2 cards passed your alert prices: w $4.00, o $42.00' })
  assert.equal(alertNotification([], usd), null)
})

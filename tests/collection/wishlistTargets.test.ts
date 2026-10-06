import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cheapestPrinting, gotItKept, keepAlertOptionsFromOlderApp, sameCard, shortPrice, targetCount, targetFromPercent, targetLine,
  targetsForAll, underYourPrice, weekDrop, wishlistTotal, withGotIt, withTarget, yearLow,
} from '../../src/collection/wishlistTargets.ts'
import { alertHits, alertPrice, alertStep, alertWatches, priceKey } from '../../src/collection/priceAlertRules.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import type { PriceTrack } from '../../src/collection/cardPriceHistory.ts'
import type { Collection, CollectionEntry } from '../../src/types/models.ts'

// Price targets on the Wishlist: the target from a percentage, when one goes off and comes back,
// "Any printing counts", "Foil only", the row's words and the "Under your price" box. The Android
// app has the same checks — WishlistTargetsTest.kt.

const entry = (id: string, over: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity: 1, foilQuantity: 0, ...over })
const wishlist = (...entries: CollectionEntry[]): Collection => ({ id: 'wishlist', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries })
const usd = (v: number, whole = false) => (whole ? `$${Math.round(v)}` : `$${v.toFixed(2)}`)

test('a target so much off today\'s price, to the cent', () => {
  assert.equal(targetFromPercent(18.4, 20), 14.72)
  assert.equal(targetFromPercent(18.4, 10), 16.56)
  assert.equal(targetFromPercent(0.99, 10), 0.89)
  assert.equal(targetFromPercent(null, 10), null)
  assert.equal(targetFromPercent(0, 10), null)
})

test('"Set targets for all…" sets one only where there is none and a price', () => {
  const entries = [entry('a', { priceAlert: 5 }), entry('b'), entry('c')]
  const targets = targetsForAll(entries, new Map([['a', 10], ['b', 20], ['c', null]]), 10)
  assert.deepEqual([...targets], [['b', 18]])
})

test('a target is told about once, then again only on the next drop', () => {
  const [w] = alertWatches([wishlist(entry('t', { priceAlert: 15 }))])
  assert.deepEqual(alertStep(w, 18.4, null), { kind: 'forget' })
  assert.deepEqual(alertStep(w, 14.5, null), { kind: 'tell', price: 14.5 })
  // Still under, no cheaper: quiet.
  assert.deepEqual(alertStep(w, 14.5, 14.5), { kind: 'quiet' })
  assert.deepEqual(alertStep(w, 14.9, 14.5), { kind: 'quiet' })
  // The next drop: told again.
  assert.deepEqual(alertStep(w, 13, 14.5), { kind: 'tell', price: 13 })
  // Back over: rearmed, so going under again tells again.
  assert.deepEqual(alertStep(w, 16, 13), { kind: 'forget' })
  assert.deepEqual(alertStep(w, 14.9, null), { kind: 'tell', price: 14.9 })
})

test('any printing counts: the cheapest printing of the same card', () => {
  assert.ok(sameCard('Sol Ring', 'sol ring'))
  assert.ok(sameCard('Delver of Secrets', 'Delver of Secrets // Insectile Aberration'))
  assert.ok(!sameCard('Sol Ring', 'Sol Talisman'))
  const printings = [
    { name: 'Sol Ring', usd: 3, usdFoil: 12 },
    { name: 'Sol Ring', usd: 1.5, usdFoil: null },
    { name: 'Sol Ring', usd: null, usdFoil: 8 },
    { name: 'Sol Talisman', usd: 0.2, usdFoil: 0.3 },
  ]
  assert.deepEqual(cheapestPrinting('Sol Ring', printings), [1.5, 8])
  assert.deepEqual(cheapestPrinting('Mana Crypt', printings), [null, null])

  // The check finds an any-printing target's prices under its own key, apart from its printing's.
  const [any, own] = alertWatches([wishlist(entry('sol', { name: 'Sol Ring', priceAlert: 2, alertAnyPrinting: true }), entry('crypt', { priceAlert: 100 }))])
  assert.equal(priceKey(any), 'any:sol')
  assert.equal(priceKey(own), 'crypt')
  const hits = alertHits([any, own], new Map([['sol', [3, 12]], ['any:sol', [1.5, 8]], ['crypt', [150, null]]]))
  assert.deepEqual(hits.map((h) => [h.watch.entry.scryfallId, h.price]), [['sol', 1.5]])
})

test('foil only checks the foil price', () => {
  const [w] = alertWatches([wishlist(entry('f', { priceAlert: 10, alertFoilOnly: true }))])
  assert.equal(alertPrice(w, 3, 12), 12)
  assert.equal(alertPrice(w, 3, null), null)
  const [plain] = alertWatches([wishlist(entry('p', { priceAlert: 10 }))])
  assert.equal(alertPrice(plain, 3, 12), 3)
})

test('a target is set with both options, and taken off without them', () => {
  const set = withTarget(entry('a'), 15, { anyPrinting: true, foilOnly: false })
  assert.deepEqual([set.priceAlert, set.alertAnyPrinting, set.alertFoilOnly], [15, true, false])
  const off = withTarget(set, null)
  assert.equal(off.priceAlert, undefined)
  assert.equal('priceAlert' in off, false)
})

test("the row says how far off its target a card is", () => {
  assert.equal(targetLine(null, 38.9, null, usd), 'No target · tap to set one')
  assert.equal(targetLine(15, 18.4, null, usd), 'Target $15 · $3.40 to go')
  assert.equal(targetLine(60, 81, null, usd), 'Target $60 · $21 to go')
  assert.equal(targetLine(70, 64.2, 12, usd), 'Target $70 · dropped 12% this week')
  assert.equal(targetLine(70, 64.2, null, usd), 'Target $70 · under your price')
  assert.equal(targetLine(70, null, null, usd), 'Target $70')
  assert.equal(shortPrice(15, usd), '$15')
  assert.equal(shortPrice(14.72, usd), '$14.72')
  assert.equal(targetCount([entry('a', { priceAlert: 1 }), entry('b')]), '2 cards · 1 with a target')
  assert.equal(wishlistTotal([entry('a', { quantity: 2 }), entry('b')], new Map([['a', 10], ['b', null]])), 20)
  assert.equal(wishlistTotal([entry('b')], new Map()), null)
})

test("the week's drop and the year's low come from the card's own history, or not at all", () => {
  const p = (day: number, v: number | null, foil: number | null = null) => ({ day, usd: v, usdFoil: foil, eur: null })
  const track: PriceTrack = { points: [p(100, 20, 40), p(150, 14.1, 30), p(190, 73), p(196, 64.2, 25)], lastDay: 200 }
  assert.equal(weekDrop(track, false, 200), 12)
  // The foil held at 30 a week ago (its last price before then), and is 25 now.
  assert.equal(weekDrop(track, true, 200), 17)
  assert.equal(yearLow(track, false), 14.1)
  assert.equal(yearLow(track, true), 25)
  // A week's history isn't enough for a year's low, and a day's isn't enough for a week's drop.
  const short: PriceTrack = { points: [p(195, 20), p(199, 15)], lastDay: 200 }
  assert.equal(yearLow(short, false), null)
  assert.equal(weekDrop(short, false, 200), null)
  assert.equal(weekDrop(null, false, 200), null)
})

test('the Under your price box: until "Got it", then again on the next drop or the next time under', () => {
  const list = wishlist(entry('s', { priceAlert: 70 }))
  const watches = alertWatches([list])
  const hitsAt = (price: number) => alertHits(watches, new Map([['s', [price, null]]]))
  assert.equal(underYourPrice(hitsAt(64.2), {}).length, 1)
  const gotIt = withGotIt({}, underYourPrice(hitsAt(64.2), {}))
  assert.deepEqual(gotIt, { s: 64.2 })
  assert.equal(underYourPrice(hitsAt(64.2), gotIt).length, 0)
  assert.equal(underYourPrice(hitsAt(60), gotIt).length, 1)
  // Back over its target: the "Got it" is forgotten, so the next time under shows again.
  assert.deepEqual(gotItKept(gotIt, hitsAt(80)), {})
  assert.equal(gotItKept(gotIt, hitsAt(64.2)), gotIt)
})

test("an older app's save keeps a target's options", () => {
  const mine = wishlist(entry('a', { priceAlert: 15, alertAnyPrinting: true, alertFoilOnly: false }), entry('b'))
  const older = wishlist(entry('a', { priceAlert: 12 }), entry('b'))
  const kept = keepAlertOptionsFromOlderApp(mine, older)
  assert.deepEqual(kept.entries[0], entry('a', { priceAlert: 12, alertAnyPrinting: true, alertFoilOnly: false }))
  assert.equal(keepAlertOptionsFromOlderApp(mine, mine), mine)

  // Through the merge: the older app changed the target, this one the options; both stay.
  const base = wishlist(entry('a', { priceAlert: 15, alertAnyPrinting: false, alertFoilOnly: false }))
  const here = wishlist(entry('a', { priceAlert: 15, alertAnyPrinting: true, alertFoilOnly: true }))
  const merged = mergeCollection(base, here, wishlist(entry('a', { priceAlert: 12 })), true)
  assert.deepEqual(merged.entries[0], entry('a', { priceAlert: 12, alertAnyPrinting: true, alertFoilOnly: true }))
})

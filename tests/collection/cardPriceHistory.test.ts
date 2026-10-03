import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  epochDay, kindsIn, priceHistoryFromJson, priceHistoryToJson, priceMove, priceSeries, trackDays, withDay, withPricesNoted,
  type PricePoint, type PriceTrack,
} from '../../src/collection/cardPriceHistory.ts'

// A card's own price history in this browser. The Android app has the same checks — CardPriceHistoryTest.kt.

const p = (day: number, usd: number | null, usdFoil: number | null = null, eur: number | null = null): PricePoint => ({ day, usd, usdFoil, eur })

test('only days the price changed are kept', () => {
  let t: PriceTrack | undefined
  t = withDay(t, p(100, 1))
  t = withDay(t, p(101, 1))
  t = withDay(t, p(102, 1.5))
  t = withDay(t, p(103, 1.5))
  assert.deepEqual(t.points.map((q) => q.day), [100, 102])
  assert.equal(t.lastDay, 103)
  // The line runs on to the last day seen.
  assert.deepEqual(priceSeries(t, 'usd'), [[100, 1], [102, 1.5], [103, 1.5]])
})

test('a later note the same day replaces its price', () => {
  let t = withDay(withDay(undefined, p(100, 1)), p(101, 2))
  t = withDay(t, p(101, 2.5))
  assert.deepEqual(t.points.map((q) => q.usd), [1, 2.5])
  // Back to yesterday's price: today's point goes again.
  t = withDay(t, p(101, 1))
  assert.deepEqual(t.points.map((q) => q.day), [100])
  assert.equal(t.lastDay, 101)
  // An older note is ignored.
  assert.equal(withDay(t, p(99, 9)), t)
})

test('a year is kept, with the price that held at its start', () => {
  let t = withDay(undefined, p(0, 1))
  t = withDay(t, p(10, 2))
  t = withDay(t, p(400, 3), 365)
  // The window starts on day 36: the 2.0 noted on day 10 still held then.
  assert.deepEqual(t.points.map((q) => [q.day, q.usd]), [[36, 2], [400, 3]])
  assert.equal(trackDays(t), 365)
})

test('the move is from the first price to the last', () => {
  const t = withDay(withDay(undefined, p(100, 2, null, 1.8)), p(130, 3, null, 1.8))
  const move = priceMove(priceSeries(t, 'usd'))!
  assert.ok(Math.abs(move.change - 1) < 1e-9)
  assert.ok(Math.abs(move.percent! - 50) < 1e-9)
  assert.deepEqual(kindsIn(t), ['usd', 'eur'])
  assert.deepEqual(priceSeries(t, 'usdFoil'), [])
  assert.equal(priceMove([]), null)
})

test('prices are kept in whole cents', () => {
  const t = withDay(undefined, p(1, 1.234, 5.678))
  assert.equal(t.points[0].usd, 1.23)
  assert.equal(t.points[0].usdFoil, 5.68)
})

test("noting Scryfall's prices leaves the map alone when nothing changed", () => {
  const first = withPricesNoted(new Map(), 100, new Map([['a', { usd: '1.00', usd_foil: '2.00' }], ['b', {}]]))
  assert.deepEqual([...first.keys()], ['a'])
  assert.equal(withPricesNoted(first, 100, new Map([['a', { usd: '1.00', usd_foil: '2.00' }]])), first)
  const next = withPricesNoted(first, 101, new Map([['a', { usd: '1.00', usd_foil: '2.00' }]]))
  assert.equal(next.get('a')!.lastDay, 101)
})

test('the stored shape reads back, the same as the phone writes it', () => {
  const tracks = new Map([['id-1', { points: [p(20000, 1.23, null, 0.99), p(20010, 1.5, 4, null)], lastDay: 20012 }]])
  const json = priceHistoryToJson(tracks)
  assert.equal(json.v, 1)
  assert.equal(json.cards['id-1'].l, 20012)
  assert.equal(JSON.stringify(json.cards['id-1'].p[0]), '[20000,123,null,99]')
  assert.deepEqual(priceHistoryFromJson(JSON.parse(JSON.stringify(json))), tracks)
  assert.equal(priceHistoryFromJson({}).size, 0)
  assert.equal(priceHistoryFromJson(null).size, 0)
})

test('days count from 1970-01-01 in local time', () => {
  assert.equal(epochDay(new Date(1970, 0, 1, 23, 59)), 0)
  assert.equal(epochDay(new Date(2026, 9, 3, 0, 1)), 20729)
})

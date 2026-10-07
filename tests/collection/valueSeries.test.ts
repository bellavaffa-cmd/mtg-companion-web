import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PriceTrack } from '../../src/collection/cardPriceHistory.ts'
import {
  binderValues, bucketDays, bucketKey, likeForLike, pricesOn, trendSummary, valueMovers, valueSeries, type Holding,
} from '../../src/collection/valueSeries.ts'

// The collection's value over time from each card's own price history. The Android app has the same
// checks — ValueSeriesTest.kt.

const track = (lastDay: number, ...points: [number, number | null][]): PriceTrack => ({
  points: points.map(([day, usd]) => ({ day, usd, usdFoil: null, eur: null })),
  lastDay,
})
const hold = (id: string, copies: number, binderId = 'b1', binderName = 'Binder'): Holding => ({ id, name: id.toUpperCase(), imageUrl: null, binderId, binderName, copies })

// Day 20000 is 2024-10-04, a Friday.
const D = 20000

test('a price holds until the next one, and after the last day seen', () => {
  const t = track(D + 10, [D, 1], [D + 5, 2])
  assert.deepEqual(pricesOn(t, [D - 1, D, D + 4, D + 5, D + 20]), [null, 1, 1, 2, 2])
  assert.deepEqual(pricesOn(undefined, [D]), [null])
})

test('weeks start on Monday and months on the 1st', () => {
  // D+3 is Monday 7 Oct 2024.
  assert.equal(bucketKey(D + 2, 'week'), bucketKey(D - 4, 'week'))
  assert.notEqual(bucketKey(D + 2, 'week'), bucketKey(D + 3, 'week'))
  // 31 Oct (D+27) and 1 Nov (D+28).
  assert.notEqual(bucketKey(D + 27, 'month'), bucketKey(D + 28, 'month'))
  // The first day, then each week's last (Sunday), then the end.
  assert.deepEqual(bucketDays(D, D + 12, 'week'), [D, D + 2, D + 9, D + 12])
  assert.deepEqual(bucketDays(D, D + 2, 'day'), [D, D + 1, D + 2])
})

test('the line starts where the history starts, from sparse points, without back-filling', () => {
  const tracks = new Map([
    ['a', track(D + 20, [D, 1], [D + 10, 3])],
    // Saved only from day 15: it doesn't count before that.
    ['b', track(D + 20, [D + 15, 5])],
  ])
  const s = valueSeries(tracks, [hold('a', 2), hold('b', 1), hold('c', 4)], '1M', D + 20)!
  assert.equal(s.historyStart, D)
  assert.equal(s.bucket, 'day')
  assert.equal(s.points[0].day, D)
  assert.equal(s.points.length, 21)
  assert.equal(s.points[0].usd, 2)
  assert.equal(s.points[0].priced, 2)
  assert.equal(s.points[10].usd, 6)
  assert.equal(s.points[15].usd, 11)
  assert.equal(s.points[20].copies, 7)
  // c has no saved price; b came in late.
  assert.equal(s.unpriced, 4)
  assert.equal(s.lateCards, 1)
})

test('a range shorter than the history starts at the range, weekly for six months', () => {
  const tracks = new Map([['a', track(D + 300, [D, 1], [D + 250, 2])]])
  const month = valueSeries(tracks, [hold('a', 1)], '1M', D + 300)!
  assert.equal(month.points[0].day, D + 271)
  const half = valueSeries(tracks, [hold('a', 1)], '6M', D + 300)!
  assert.equal(half.bucket, 'week')
  assert.equal(half.points[0].day, D + 300 - 181)
  assert.equal(half.points[half.points.length - 1].day, D + 300)
  const all = valueSeries(tracks, [hold('a', 1)], 'All', D + 300)!
  assert.equal(all.points[0].day, D)
  assert.equal(all.bucket, 'week')
})

test('the line ends on the last day prices were saved, and no history is no line', () => {
  const tracks = new Map([['a', track(D + 5, [D, 1])]])
  const s = valueSeries(tracks, [hold('a', 1)], '1M', D + 40)!
  assert.equal(s.points[s.points.length - 1].day, D + 5)
  assert.equal(valueSeries(new Map(), [hold('a', 1)], '1M', D), null)
})

test('risers and fallers by what they did to the value', () => {
  const tracks = new Map([
    ['up', track(D + 30, [D, 1], [D + 20, 4])],
    ['bigup', track(D + 30, [D, 10], [D + 20, 12])],
    ['down', track(D + 30, [D, 5], [D + 20, 2])],
    ['flat', track(D + 30, [D, 3])],
    ['late', track(D + 30, [D + 25, 2], [D + 28, 3])],
  ])
  const holdings = [hold('up', 1), hold('bigup', 1), hold('bigup', 2, 'b2', 'Other'), hold('down', 1), hold('flat', 1), hold('late', 1)]
  const m = valueMovers(tracks, holdings, D, D + 30)
  // bigup: +2 × 3 copies = +6; up: +3; late: +1 since its first saved price.
  assert.deepEqual(m.risers.map((r) => [r.id, r.change]), [['bigup', 6], ['up', 3], ['late', 1]])
  assert.equal(m.risers[0].copies, 3)
  assert.equal(m.risers[2].sinceDay, D + 25)
  assert.equal(m.risers[1].percent, 300)
  assert.deepEqual(m.fallers.map((r) => [r.id, r.change]), [['down', -3]])
})

test('each binder, and the change like for like', () => {
  const tracks = new Map([
    ['a', track(D + 30, [D, 1], [D + 20, 2])],
    ['b', track(D + 30, [D + 25, 10])],
  ])
  const holdings = [hold('a', 2, 'b1', 'Red'), hold('b', 1, 'b1', 'Red'), hold('a', 1, 'b2', 'Blue')]
  assert.deepEqual(binderValues(tracks, holdings, D, D + 30), [
    { id: 'b1', name: 'Red', usd: 14, change: 2 },
    { id: 'b2', name: 'Blue', usd: 2, change: 1 },
  ])
  // b had no price on day D, so it isn't in the change.
  assert.deepEqual(likeForLike(tracks, holdings, D, D + 30), { from: 3, change: 3, percent: 100 })
})

test('the trend in words for screen readers', () => {
  const money = (v: number) => `$${v.toFixed(2)}`
  const day = (d: number) => `day ${d - D}`
  const points = [
    { day: D, usd: 100, priced: 1, copies: 1 },
    { day: D + 1, usd: 90, priced: 1, copies: 1 },
    { day: D + 2, usd: 110, priced: 1, copies: 1 },
  ]
  assert.equal(
    trendSummary(points, money, day),
    'Collection value from day 0 to day 2: up $10.00 (10.0%), from $100.00 to $110.00. Lowest $90.00 on day 1; highest $110.00 on day 2.',
  )
  assert.equal(trendSummary([], money, day), 'No collection value saved yet.')
})

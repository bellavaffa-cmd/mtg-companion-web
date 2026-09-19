import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Money, USD, currencyOf } from '../../src/money/currency.ts'
import { changeOf, pointsIn, withPoint, type ValuePoint } from '../../src/collection/valueHistory.ts'

// Prices in the chosen currency, and the collection's value over time. The Android app has the
// same checks — see MoneyTest.kt.

test('prices read in the chosen currency', () => {
  assert.equal(USD.format(1234.5), '$1,234.50')
  assert.equal(USD.format(1234.5, true), '$1,235')
  const peso = new Money(currencyOf('PHP'), 62.803)
  assert.equal(peso.format(10), '₱628.03')
  assert.equal(peso.formatPrice('10.00'), '₱628.03')
  assert.equal(peso.formatPrice(null), null)
  // No cents for yen; the symbol after the amount for kronor.
  assert.equal(new Money(currencyOf('JPY'), 157.89).format(10), '¥1,579')
  assert.equal(new Money(currencyOf('SEK'), 9.853).format(10), '98.53 kr')
  // A price typed in pesos goes back to dollars.
  assert.ok(Math.abs(peso.toUsd(628.03) - 10) < 0.0001)
  // An unknown code falls back to dollars.
  assert.equal(currencyOf('XYZ').code, 'USD')
})

test('the value over time', () => {
  let points: ValuePoint[] = []
  points = withPoint(points, { date: '2026-06-01', usd: 100, cards: 10 })
  points = withPoint(points, { date: '2026-09-19', usd: 150, cards: 12 })
  points = withPoint(points, { date: '2026-08-25', usd: 120, cards: 11 })
  // A later value the same day takes that day's place.
  points = withPoint(points, { date: '2026-09-19', usd: 160, cards: 12 })
  assert.deepEqual(points.map((p) => p.date), ['2026-06-01', '2026-08-25', '2026-09-19'])
  assert.equal(points[points.length - 1].usd, 160)

  assert.deepEqual(pointsIn(points, '1M').map((p) => p.date), ['2026-08-25', '2026-09-19'])
  assert.equal(pointsIn(points, 'All').length, 3)
  const month = changeOf(pointsIn(points, '1M'))!
  assert.ok(Math.abs(month.usd - 40) < 0.0001)
  assert.ok(Math.abs(month.percent! - 33.333) < 0.001)
  assert.equal(changeOf(points.slice(0, 1)), null)

  // Only the newest are kept.
  assert.deepEqual(withPoint(points.slice(0, 2), points[2], 2).map((p) => p.date), ['2026-08-25', '2026-09-19'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moversOf, withPrices, type PriceStore, type PricedCard } from '../../src/collection/priceMovers.ts'

// Which of the user's cards moved in price. The Android app has the same checks — see
// PriceMoversTest.kt.

const sol: PricedCard = { id: 'sol', name: 'Sol Ring', imageUrl: null, copies: 2 }
const rhystic: PricedCard = { id: 'rhy', name: 'Rhystic Study', imageUrl: null, copies: 1 }
const bolt: PricedCard = { id: 'bolt', name: 'Lightning Bolt', imageUrl: null, copies: 4 }
const near = (e: number, a: number) => assert.ok(Math.abs(e - a) < 0.001, `${a} ≠ ${e}`)

test('the cards that moved the value most', () => {
  let store: PriceStore = { cards: [], days: [] }
  store = withPrices(store, '2026-09-01', [sol, rhystic], new Map([['sol', 1], ['rhy', 40]]))
  store = withPrices(store, '2026-09-13', [sol, rhystic, bolt], new Map([['sol', 1.5], ['rhy', 38], ['bolt', 0.5]]))
  store = withPrices(store, '2026-09-19', [sol, rhystic, bolt], new Map([['sol', 2], ['rhy', 35], ['bolt', 0.5]]))
  // A later note the same day replaces the earlier.
  store = withPrices(store, '2026-09-20', [sol, rhystic, bolt], new Map([['sol', 2.5], ['rhy', 30], ['bolt', 0.6]]))
  store = withPrices(store, '2026-09-20', [sol, rhystic, bolt], new Map([['sol', 3], ['rhy', 30], ['bolt', 0.6]]))
  assert.deepEqual(store.days.map((d) => d.date), ['2026-09-01', '2026-09-13', '2026-09-19', '2026-09-20'])

  const day = moversOf(store, '1D')!
  assert.equal(day.since, '2026-09-19')
  // Sol Ring: +$1 a copy, two copies. Bolt: +$0.10 × 4.
  assert.deepEqual(day.up.map((m) => m.card.name), ['Sol Ring', 'Lightning Bolt'])
  near(2, day.up[0].change)
  near(50, day.up[0].percent)
  assert.deepEqual(day.down.map((m) => m.card.name), ['Rhystic Study'])
  near(-5, day.down[0].change)

  // A week: from the oldest note within it (the 13th).
  const week = moversOf(store, '7D')!
  assert.equal(week.since, '2026-09-13')
  near(-8, week.down[0].change)
  // A month: from the 1st, before Bolt was owned — so it isn't among them.
  assert.deepEqual(moversOf(store, '30D')!.up.map((m) => m.card.name), ['Sol Ring'])
})

test('old days and gone cards are dropped', () => {
  let store = withPrices({ cards: [], days: [] }, '2026-08-01', [sol, bolt], new Map([['sol', 1], ['bolt', 0.5]]))
  store = withPrices(store, '2026-09-20', [sol], new Map([['sol', 2]]))
  assert.deepEqual(store.days.map((d) => d.date), ['2026-09-20'])
  assert.deepEqual(store.cards.map((c) => c.id), ['sol'])
  assert.equal(moversOf(store, '7D'), null)
  assert.equal(moversOf({ cards: [], days: [] }, '1D'), null)
})

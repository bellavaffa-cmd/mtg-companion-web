import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decksDue, deckValueOf, monthChange, prunedDeckHistory, withDeckPoint } from '../../src/decks/deckValueHistory.ts'
import { normalizeDeck, type DeckCardEntry } from '../../src/types/models.ts'

// A deck's value over time: worked out, sampled once a day, and how it moved. The Android app runs
// the same cases — see DeckValueHistoryTest.kt.

const card = (id: string, quantity: number): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })

test("a deck's value: every copy at its price, and nothing when too few were looked up", () => {
  const deck = normalizeDeck({ id: 'd', name: 'D', cards: [card('a', 2), card('b', 1), card('c', 97)] })
  assert.deepEqual(deckValueOf(deck, new Map([['a', 1.5], ['b', null], ['c', 0.105]])), { usd: 13.19, cards: 100 })
  assert.deepEqual(deckValueOf(deck, new Map([['a', 1.5], ['c', 0.1]])), { usd: 12.7, cards: 100 })
  assert.equal(deckValueOf(deck, new Map([['c', 0.1]])), null)
  assert.equal(deckValueOf(normalizeDeck({ id: 'e', name: 'E' }), new Map()), null)
})

test('one point a day per deck', () => {
  let h = withDeckPoint({}, 'd', { date: '2026-10-01', usd: 100, cards: 60 })
  h = withDeckPoint(h, 'd', { date: '2026-10-01', usd: 110, cards: 60 })
  h = withDeckPoint(h, 'd', { date: '2026-10-02', usd: 120, cards: 60 }, 1)
  assert.deepEqual(h, { d: [{ date: '2026-10-02', usd: 120, cards: 60 }] })
})

test('which decks still need a point today', () => {
  const decks = [
    normalizeDeck({ id: 'a', name: 'A', cards: [card('x', 1)] }),
    normalizeDeck({ id: 'b', name: 'B', cards: [card('x', 1)] }),
    normalizeDeck({ id: 'c', name: 'C', cards: [card('x', 1)], archived: true }),
    normalizeDeck({ id: 'e', name: 'E' }),
  ]
  const h = { a: [{ date: '2026-10-05', usd: 1, cards: 1 }], b: [{ date: '2026-10-04', usd: 1, cards: 1 }] }
  assert.deepEqual(decksDue(h, decks, '2026-10-05').map((d) => d.id), ['b'])
  assert.deepEqual(Object.keys(prunedDeckHistory({ ...h, gone: [] }, ['a', 'b'])), ['a', 'b'])
})

test('how it moved this month', () => {
  const points = [
    { date: '2026-08-01', usd: 50, cards: 60 },
    { date: '2026-09-10', usd: 100, cards: 60 },
    { date: '2026-09-20', usd: 105, cards: 60 },
    { date: '2026-10-05', usd: 112, cards: 60 },
  ]
  const change = monthChange(points)!
  assert.equal(change.from.date, '2026-09-10')
  assert.equal(change.usd, 12)
  assert.equal(change.percent, 12)
  assert.equal(monthChange(points.slice(0, 1)), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  candidatesFor, evenOut, evenOutTitle, fairness, isFair, shortSide, sideTotal, unitPrice, unpricedLine, verdictLine, type PriceBook,
} from '../../src/social/tradeFairness.ts'
import type { TradeCard } from '../../src/social/api.ts'
import type { MatchCard, TradeMatch } from '../../src/social/more.ts'

// The trade fairness check: totals, the gap, and which cards would even it out. The Android app has
// the same checks — see TradeFairnessTest.kt.

const card = (name: string, quantity = 1, foil = false): TradeCard => ({ scryfallId: name.toLowerCase(), name, foil, quantity })
const prices: PriceBook = new Map([
  ['sol ring', { usd: 2, foil: 10 }],
  ['mana crypt', { usd: 150, foil: null }],
  ['brainstorm', { usd: 1.5, foil: 4 }],
  ['etched thing', { usd: null, foil: 7 }],
  ['rhystic study', { usd: 40, foil: null }],
  ['smothering tithe', { usd: 22, foil: null }],
  ['cyclonic rift', { usd: 14, foil: null }],
  ['fact or fiction', { usd: 9, foil: null }],
])
const money = (usd: number) => `$${usd.toFixed(2)}`

test('a copy is priced by its finish, falling back to the other one', () => {
  assert.equal(unitPrice(card('Sol Ring'), prices), 2)
  assert.equal(unitPrice(card('Sol Ring', 1, true), prices), 10)
  assert.equal(unitPrice(card('Mana Crypt', 1, true), prices), 150)
  assert.equal(unitPrice(card('Etched Thing'), prices), 7)
  assert.equal(unitPrice(card('Unknown'), prices), null)
})

test('a side adds up its copies and counts the ones with no price', () => {
  assert.deepEqual(sideTotal([card('Sol Ring', 3), card('Unknown', 2), card('Brainstorm')], prices), { sum: 7.5, unpriced: 2 })
  assert.deepEqual(sideTotal([], prices), { sum: 0, unpriced: 0 })
})

test('the gap, the verdict and the balance', () => {
  const f = fairness([card('Rhystic Study')], [card('Smothering Tithe'), card('Cyclonic Rift'), card('Unknown')], prices)!
  assert.equal(f.diff, 4)
  assert.equal(f.fair, true) // within a tenth of $40
  assert.equal(verdictLine(f, money), 'Within $4.00 — a fair trade')
  assert.equal(f.unpriced, 1)
  assert.equal(unpricedLine(f.unpriced), '1 card has no price and is left out.')
  assert.equal(unpricedLine(2), '2 cards have no price and are left out.')
  assert.equal(unpricedLine(0), null)
  assert.equal(shortSide(f), null)

  const uneven = fairness([card('Fact or Fiction')], [card('Rhystic Study')], prices)!
  assert.equal(uneven.diff, -31)
  assert.equal(verdictLine(uneven, money), 'You give $31.00 more')
  assert.equal(shortSide(uneven), 'want')
  assert.ok(Math.abs(uneven.getShare - 9 / 49) < 1e-9)

  const more = fairness([card('Mana Crypt')], [card('Sol Ring')], prices)!
  assert.equal(verdictLine(more, money), 'You get $148.00 more')
  assert.equal(shortSide(more), 'give')

  const even = fairness([card('Sol Ring')], [card('Sol Ring')], prices)!
  assert.equal(verdictLine(even, money), 'Even — a fair trade')
  assert.equal(even.getShare, 0.5)
})

test('nothing priced gives no verdict', () => {
  assert.equal(fairness([card('Unknown')], [card('Other')], prices), null)
})

test('fair is within $2 or a tenth of the bigger side', () => {
  assert.equal(isFair(2, 3, 1), true)
  assert.equal(isFair(2.5, 3, 0.5), false)
  assert.equal(isFair(9, 100, 91), true)
  assert.equal(isFair(-11, 89, 100), false)
})

test('the cards closest to the gap come first, leaving out what is in the trade or has no price', () => {
  const candidates = [card('Rhystic Study'), card('Smothering Tithe'), card('Cyclonic Rift'), card('Unknown'), card('Sol Ring'), card('Fact or Fiction'), card('Cyclonic Rift')]
  const picked = evenOut(-12, candidates, [card('Sol Ring')], prices)
  assert.deepEqual(picked.map((s) => s.card.name), ['Cyclonic Rift', 'Fact or Fiction', 'Smothering Tithe'])
  assert.deepEqual(picked.map((s) => s.price), [14, 9, 22])
  assert.equal(evenOut(40, candidates, [], prices, 1)[0].card.name, 'Rhystic Study')
  // A tie goes to the cheaper card.
  assert.equal(evenOut(11.5, [card('Smothering Tithe'), card('Fact or Fiction'), card('Cyclonic Rift')], [], prices)[0].card.name, 'Fact or Fiction')
  // One copy is suggested, whatever the line said.
  assert.equal(evenOut(5, [card('Brainstorm', 4)], [], prices)[0].card.quantity, 1)
})

test('candidates: their cards the user wants, or the user’s wanted cards that are for trade or spare', () => {
  const mc = (name: string, forTrade?: boolean): MatchCard => ({ ...card(name), ...(forTrade ? { forTrade } : {}) })
  const match: TradeMatch = { friend: 'priya', they_have: [mc('Rhystic Study', true), mc('Smothering Tithe')], they_want: [mc('Sol Ring'), mc('Cyclonic Rift', true), mc('Brainstorm')] }
  const decksUse = new Set(['sol ring', 'cyclonic rift'])
  assert.deepEqual(candidatesFor('want', match, decksUse).map((c) => c.name), ['Rhystic Study', 'Smothering Tithe'])
  // Sol Ring is in a deck and not for trade; Cyclonic Rift is in a deck but marked for trade.
  assert.deepEqual(candidatesFor('give', match, decksUse).map((c) => c.name), ['Cyclonic Rift', 'Brainstorm'])
  assert.equal('forTrade' in candidatesFor('give', match, decksUse)[0], false)
  assert.deepEqual(candidatesFor('want', null, decksUse), [])
  assert.equal(evenOutTitle('want', 'Priya'), 'To even it out, ask Priya for one of these')
  assert.equal(evenOutTitle('give', 'Priya'), 'To even it out, offer one of these')
})

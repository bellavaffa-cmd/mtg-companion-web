import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  badgeText, cardNames, doneLabel, friendContext, friendsBadge, friendsWantFromYou, lentTo, ordinal, peopleLine, podLine, tradeInbox,
  tradeSummary, wantFromYouLine,
} from '../../src/social/friendsHub.ts'
import { friendsTabFor, friendsTabLabel } from '../../src/social/friendsTabs.ts'
import type { Trade, TradeCard, TradeStatus } from '../../src/social/api.ts'
import type { TradeMatch } from '../../src/social/more.ts'
import type { Loan } from '../../src/types/models.ts'

// The Friends tab's logic. The Android app has the same checks — see FriendsHubTest.kt.

const trade = (
  id: string, from: string, to: string, status: TradeStatus, updated: string,
  extra: Partial<Trade> = {},
): Trade => ({
  id, from_user: from, to_user: to, want: [], give: [], message: null, reply: null, status, reply_to: null,
  from_applied: false, to_applied: false, created_at: updated, updated_at: updated, ...extra,
} as Trade)

const card = (name: string, quantity = 1, id = name, binder?: string): TradeCard => ({ scryfallId: id, name, quantity, foil: false, collectionId: binder })

// ---- Badge ----

test('the badge adds requests, unread messages and trades', () => {
  assert.equal(friendsBadge(1, 3, 2), 6)
  assert.equal(friendsBadge(0, 0, 0), 0)
  assert.equal(friendsBadge(-1, 2, 0), 2)
  assert.equal(badgeText(5), '5')
  assert.equal(badgeText(12), '9+')
})

test('tab labels carry their counts', () => {
  assert.equal(friendsTabLabel('messages', 3), 'Chats · 3')
  assert.equal(friendsTabLabel('activity', 0), 'Activity')
  assert.equal(friendsTabFor('chats', true), 'messages')
})

// ---- Trade inbox ----

test('trades are grouped by whose turn it is', () => {
  const me = 'me'
  const inbox = tradeInbox([
    trade('a', 'priya', me, 'open', '2026-10-05'),
    trade('b', me, 'sam', 'open', '2026-10-06'),
    trade('c', 'alex', me, 'accepted', '2026-10-01', { from_applied: true }),
    trade('d', me, 'jo', 'accepted', '2026-10-02', { from_applied: true }),
    trade('e', me, 'alex', 'accepted', '2026-09-28', { from_applied: true, to_applied: true }),
    trade('f', 'sam', me, 'declined', '2026-09-30'),
  ], me)
  assert.deepEqual(inbox.yourTurn.map((t) => t.id), ['a', 'c'])
  assert.deepEqual(inbox.waitingOnThem.map((t) => t.id), ['b', 'd'])
  assert.deepEqual(inbox.done.map((t) => t.id), ['f', 'e'])
})

test("blocked people's trades are left out", () => {
  const inbox = tradeInbox([trade('a', 'priya', 'me', 'open', '2026-10-05')], 'me', new Set(['priya']))
  assert.equal(inbox.yourTurn.length + inbox.waitingOnThem.length + inbox.done.length, 0)
})

test('a trade reads as what you give for what you get', () => {
  const t = trade('a', 'me', 'sam', 'open', '2026-10-05', { want: [card('Lightning Greaves')], give: [card('Impulse')] })
  assert.equal(tradeSummary(t, 'me'), 'Impulse for Lightning Greaves')
  assert.equal(tradeSummary(t, 'sam'), 'Lightning Greaves for Impulse')
  assert.equal(cardNames([card('Fact or Fiction', 3), card('Cyclonic Rift')]), 'Fact or Fiction ×3, Cyclonic Rift')
  assert.equal(cardNames([card('A'), card('B'), card('C'), card('D')]), 'A, B and 2 more')
  assert.equal(cardNames([]), 'nothing')
})

test('a finished trade shows the rating or how it ended', () => {
  const done = trade('e', 'me', 'alex', 'accepted', '2026-09-28', { from_applied: true, to_applied: true })
  assert.equal(doneLabel(done, 'me', true), 'Rated good')
  assert.equal(doneLabel(done, 'me', false), 'Rated poor')
  assert.equal(doneLabel(done, 'me', undefined), 'Rate it')
  assert.equal(doneLabel(trade('f', 'sam', 'me', 'declined', '2026-09-30'), 'me', undefined), 'Declined')
})

// ---- What friends want from you ----

test('what friends want is counted, priced and placed per friend', () => {
  const priya: TradeMatch = { friend: 'priya', they_have: [], they_want: [card('Sol Ring', 1, 's', 'b1'), card('Rhystic Study', 1, 'r', 'b2'), card('sol ring', 1, 's2', 'b1')] }
  const jo: TradeMatch = { friend: 'jo', they_have: [], they_want: [card('Impulse', 1, 'i', 'b3')] }
  const nobody: TradeMatch = { friend: 'sam', they_have: [card('Mox')], they_want: [] }
  const prices = new Map([['s', { usd: 2, foil: null }], ['r', { usd: 19, foil: null }], ['i', { usd: null, foil: null }]])
  const names: Record<string, string> = { b1: 'Trade binder', b2: 'Red box', b3: 'Blue box' }
  const wants = friendsWantFromYou([jo, priya, nobody], (id) => names[id], prices)
  assert.deepEqual(wants.map((w) => w.friend), ['priya', 'jo'])
  assert.equal(wants[0].cards, 2)
  assert.equal(wants[0].where, 'Trade binder, Red box')
  assert.equal(wants[0].value, 21)
  assert.equal(wants[1].value, null)
  assert.equal(wantFromYouLine('Priya', 3), 'Priya · 3 cards')
  assert.equal(wantFromYouLine('Jo', 1), 'Jo · 1 card')
})

// ---- A friend's line ----

test("a friend's line says the first thing that applies", () => {
  assert.deepEqual(friendContext(3, '$21', ['Sol Ring'], 'Back by 10 Oct', true), { line: 'Wants 3 of your cards · $21', action: 'trade' })
  assert.deepEqual(friendContext(0, null, ['Sol Ring'], 'Back by 10 Oct', true), { line: 'Has your Sol Ring · back by 10 Oct', action: 'loan' })
  assert.deepEqual(friendContext(0, null, ['Sol Ring', 'Sol Ring'], 'No date', false), { line: 'Has 2 of your cards', action: 'loan' })
  assert.deepEqual(friendContext(0, null, [], null, true), { line: 'Shares the shelf at home', action: 'home' })
  assert.equal(friendContext(0, null, [], null, false), null)
})

test('lentTo counts the copies still out', () => {
  const loans: Loan[] = [
    { id: '1', to: 'Sam', friendId: 'sam', cards: [{ name: 'Sol Ring', scryfallId: 'x', qty: 2, back: 1 }], lentAt: 0 },
    { id: '2', to: 'Sam', friendId: 'sam', cards: [{ name: 'Mox', scryfallId: 'y', qty: 1, back: 1 }], lentAt: 0 },
    { id: '3', to: 'Jo', friendId: 'jo', cards: [{ name: 'Impulse', scryfallId: 'z', qty: 1 }], lentAt: 0 },
  ]
  assert.deepEqual(lentTo(loans, 'sam'), ['Sol Ring'])
  assert.deepEqual(lentTo(loans, 'alex'), [])
})

// ---- Pods ----

test("a pod's line has its season and your place", () => {
  assert.equal(podLine(5, 'Season 2', 2), "5 people · Season 2 · you're 2nd")
  assert.equal(podLine(5, 'Season 2', null), '5 people · Season 2')
  assert.equal(podLine(3, null, null), '3 people · no season')
  assert.equal(peopleLine(1), '1 person')
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 102].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '102nd'])
})

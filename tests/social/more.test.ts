// Blocking, messages, reputation, activity and cards for trade (src/social/moreLogic.ts). The Android
// app runs the same cases in SocialMoreLogicTest.kt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activityText, canRate, dmTopic, forTradeLines, forTradeOf, forTradePicks, isMissingFunction, matchSentence, mergeMessages,
  messageParts, monthYear, namesLine, positiveLine, previewLine, setForTrade, timeAgo, tradesLine, withYouLine,
  type ActivityItem, type DirectMessage,
} from '../../src/social/moreLogic.ts'
import type { Collection } from '../../src/types/models.ts'

const entry = (scryfallId: string, name: string, quantity: number, foilQuantity: number, forTrade?: number) =>
  ({ scryfallId, name, imageUrl: null, quantity, foilQuantity, ...(forTrade !== undefined ? { forTrade } : {}) })
const binder = (id: string, entries: Collection['entries'], type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries, createdAt: 0, type })
const msg = (id: number, sender = 'a', body = 'hi'): DirectMessage => ({ id, conversation_id: 'c', sender, recipient: 'b', body, created_at: id * 1000 })

test('card names in double brackets become links', () => {
  assert.deepEqual(messageParts('Got a [[Sol Ring]] for you'), [{ text: 'Got a ' }, { card: 'Sol Ring' }, { text: ' for you' }])
  assert.deepEqual(messageParts('[[Sol Ring]][[Mana Crypt]]'), [{ card: 'Sol Ring' }, { card: 'Mana Crypt' }])
  assert.deepEqual(messageParts('[[ Fire // Ice ]]?'), [{ card: 'Fire // Ice' }, { text: '?' }])
  assert.deepEqual(messageParts('[[ ]] and [[a]]'), [{ text: '[[ ]] and ' }, { card: 'a' }])
  assert.deepEqual(messageParts('[[unclosed'), [{ text: '[[unclosed' }])
  assert.deepEqual(messageParts(''), [])
})

test('messages merge once each, oldest first', () => {
  const merged = mergeMessages([msg(3), msg(1)], [msg(2), msg(3, 'b', 'edited')])
  assert.deepEqual(merged.map((m) => m.id), [1, 2, 3])
  assert.equal(merged[2].body, 'edited')
})

test("a conversation's preview line", () => {
  assert.equal(previewLine(null, 'a'), 'No messages yet')
  assert.equal(previewLine({ sender: 'a', body: 'hi' }, 'a'), 'You: hi')
  assert.equal(previewLine({ sender: 'b', body: '  see\n you  Friday ' }, 'a'), 'see you Friday')
  assert.equal(previewLine({ sender: 'b', body: 'x'.repeat(100) }, 'a'), `${'x'.repeat(79)}…`)
  assert.equal(dmTopic('u1'), 'dm:u1')
})

test('trade record lines', () => {
  assert.equal(monthYear(Date.UTC(2026, 2, 15)), 'March 2026')
  assert.equal(tradesLine(0, null), 'No trades yet')
  assert.equal(tradesLine(12, Date.UTC(2026, 2, 15)), 'Trades completed: 12 · since March 2026')
  assert.equal(tradesLine(3, null), 'Trades completed: 3')
  assert.equal(withYouLine(0), 'None with you yet')
  assert.equal(withYouLine(1), '1 with you')
  assert.equal(positiveLine(5), '5 positive')
  assert.equal(positiveLine(-1), '0 positive')
})

test('a trade can be rated once accepted and your side updated', () => {
  const t = { status: 'accepted' as const, from_user: 'a', to_user: 'b', from_applied: true, to_applied: false }
  assert.equal(canRate(t, 'a'), true)
  assert.equal(canRate(t, 'b'), false)
  assert.equal(canRate(t, 'c'), false)
  assert.equal(canRate({ ...t, status: 'open' }, 'a'), false)
})

test('two-way match sentence', () => {
  assert.equal(matchSentence('Priya', 2, 3), 'Priya has 2 cards you want, and wants 3 of yours')
  assert.equal(matchSentence('Priya', 1, 0), 'Priya has 1 card you want')
  assert.equal(matchSentence('Priya', 0, 1), 'Priya wants 1 of yours')
  assert.equal(matchSentence('Priya', 0, 0), null)
})

test('copies for trade never exceed the copies there are', () => {
  assert.equal(forTradeOf(entry('s', 'Sol Ring', 2, 1, 5)), 3)
  assert.equal(forTradeOf(entry('s', 'Sol Ring', 2, 1)), 0)
  assert.equal(forTradeOf(entry('s', 'Sol Ring', 2, 1, -1)), 0)
  assert.equal(forTradeOf(entry('s', 'Sol Ring', 4, 0, 2)), 2)
  // Web only: a fraction (from a hand-edited binder) rounds down.
  assert.equal(forTradeOf(entry('s', 'Sol Ring', 4, 0, 2.7)), 2)
})

test('marking copies for trade', () => {
  const cols = [binder('b1', [entry('s', 'Sol Ring', 2, 0), entry('m', 'Mana Crypt', 1, 0, 1)]), binder('w', [entry('s', 'Sol Ring', 1, 0)], 'WISHLIST')]
  const marked = setForTrade(cols, 'b1', 's', 5)
  assert.equal(marked[0].entries[0].forTrade, 2)
  const cleared = setForTrade(marked, 'b1', 'm', 0)
  assert.equal('forTrade' in cleared[0].entries[1], false)
  assert.equal(setForTrade(cols, 'w', 's', 1)[1], cols[1])
  assert.deepEqual(forTradeLines(marked).map((l) => [l.entry.name, l.count]), [['Mana Crypt', 1], ['Sol Ring', 2]])
  assert.deepEqual(forTradeLines(cleared).map((l) => l.entry.name), ['Sol Ring'])
})

test('for-trade copies as picks: plain first, then foil', () => {
  const picks = forTradePicks(binder('b1', [entry('s', 'Sol Ring', 1, 2, 2), entry('x', 'Unmarked', 3, 0)]))
  assert.deepEqual(picks.map((p) => [p.name, p.foil, p.quantity, p.collectionId]), [['Sol Ring', false, 1, 'b1'], ['Sol Ring', true, 1, 'b1']])
})

test('names lines', () => {
  assert.equal(namesLine(['A', 'B', 'C'], 3), 'A, B and 1 more')
  assert.equal(namesLine(['A', 'B'], 5), 'A, B and 3 more')
  assert.equal(namesLine(['A'], 1), 'A')
  assert.equal(namesLine(['A', 'B'], 2), 'A and B')
  assert.equal(namesLine([], 0), '')
})

test('what activity items say', () => {
  const actor = { user_id: 'p', username: 'priya', display_name: 'Priya' }
  const item = (over: Partial<ActivityItem>): ActivityItem => ({ kind: 'shared', actor, at: 0, ...over })
  assert.deepEqual(activityText(item({ item_kind: 'deck', item_id: 'd', name: 'Atraxa' })), { action: 'shared a deck', detail: 'Atraxa' })
  assert.deepEqual(activityText(item({ item_kind: 'collection', item_id: 'b', name: 'Trade binder' })), { action: 'shared a binder', detail: 'Trade binder' })
  assert.deepEqual(activityText(item({ item_kind: 'deck' })), { action: 'shared all their decks', detail: null })
  assert.deepEqual(activityText(item({ item_kind: 'collection' })), { action: 'shared their collection', detail: null })
  assert.deepEqual(activityText(item({ kind: 'deck_updated', item_kind: 'deck', item_id: 'd', name: 'Atraxa' })), { action: 'updated a deck', detail: 'Atraxa' })
  assert.deepEqual(activityText(item({ kind: 'pod_game', pod_name: 'Friday', winner: 'Sam', players: 4 })), { action: 'recorded a game in Friday', detail: 'Sam won · 4 players' })
  assert.deepEqual(activityText(item({ kind: 'pod_game' })), { action: 'recorded a game', detail: 'No winner' })
  assert.deepEqual(activityText(item({ kind: 'for_trade', count: 3, cards: [{ name: 'Sol Ring' }, { name: 'Arcane Signet' }, { name: 'Mana Crypt' }] })), { action: 'marked 3 cards for trade', detail: 'Sol Ring, Arcane Signet and 1 more' })
  assert.deepEqual(activityText(item({ kind: 'for_trade', count: 1, cards: [{ name: 'Sol Ring' }] })), { action: 'marked 1 card for trade', detail: 'Sol Ring' })
  assert.deepEqual(activityText(item({ kind: 'something_new' })), { action: 'did something new', detail: null })
})

test('how long ago', () => {
  const now = Date.UTC(2026, 9, 5, 12)
  assert.equal(timeAgo(now - 30_000, now), 'just now')
  assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago')
  assert.equal(timeAgo(now - 3 * 3_600_000, now), '3 h ago')
  assert.equal(timeAgo(now - 24 * 3_600_000, now), 'yesterday')
  assert.equal(timeAgo(now - 4 * 86_400_000, now), '4 days ago')
  assert.equal(timeAgo(now - 10 * 86_400_000, now), '25 Sep')
  assert.equal(timeAgo(now + 60_000, now), 'just now')
})

test('a missing server function is told apart from other failures', () => {
  assert.equal(isMissingFunction(404, 'PGRST202'), true)
  assert.equal(isMissingFunction(404, undefined), true)
  assert.equal(isMissingFunction(400, 'P0001'), false)
  assert.equal(isMissingFunction(500, undefined), false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  daysBetween, dueBatches, emptyUsage, isUsageEvent, markSent, markTried, MAX_COUNT, newInstallId, optedOut, parseUsage,
  record, screenOfPath, USAGE_ACTIONS, type UsageState,
} from '../../src/usage/usageCounts.ts'

// Anonymous usage counts — the same cases as the Android app's UsageCountsTest.

const ID_A = 'a'.repeat(32)
const ID_B = 'b'.repeat(32)
const ids = (...list: string[]) => { let i = 0; return () => list[i++] ?? 'f'.repeat(32) }

test('counts per day per event, and only events on the list', () => {
  let s = emptyUsage()
  const next = ids(ID_A)
  s = record(s, 'deck_created', '2026-10-01', true, next)
  s = record(s, 'deck_created', '2026-10-01', true, next)
  s = record(s, 'screen_decks', '2026-10-01', true, next)
  s = record(s, 'Lightning Bolt', '2026-10-01', true, next)
  s = record(s, 'deck_created', '2026-10-02', true, next)
  assert.deepEqual(s.buckets, [
    { day: '2026-10-01', install: ID_A, counts: { deck_created: 2, screen_decks: 1 } },
    { day: '2026-10-02', install: ID_A, counts: { deck_created: 1 } },
  ])
})

test('off counts nothing', () => {
  const s = record(emptyUsage(), 'deck_created', '2026-10-01', false, ids(ID_A))
  assert.deepEqual(s, emptyUsage())
})

test('a count stops at the most the server takes', () => {
  let s: UsageState = { install: ID_A, installDay: '2026-10-01', lastTry: '', buckets: [{ day: '2026-10-01', install: ID_A, counts: { card_scanned: MAX_COUNT } }] }
  s = record(s, 'card_scanned', '2026-10-01', true, ids())
  assert.equal(s.buckets[0].counts.card_scanned, MAX_COUNT)
})

test('the install id is made once, kept 89 days and replaced on the 90th; old days keep their id', () => {
  let s = record(emptyUsage(), 'game_started', '2026-01-01', true, ids(ID_A, ID_B))
  assert.equal(s.install, ID_A)
  s = record(s, 'game_started', '2026-03-31', true, ids(ID_B)) // day 89
  assert.equal(s.install, ID_A)
  s = record(s, 'game_started', '2026-04-01', true, ids(ID_B)) // day 90
  assert.equal(s.install, ID_B)
  assert.deepEqual(s.buckets.map((b) => [b.day, b.install]), [['2026-03-31', ID_A], ['2026-04-01', ID_B]])
})

test('days more than a week old are dropped unsent', () => {
  const s: UsageState = {
    install: ID_A, installDay: '2026-10-01', lastTry: '',
    buckets: [
      { day: '2026-10-01', install: ID_A, counts: { deck_created: 1 } }, // 8 days before
      { day: '2026-10-02', install: ID_A, counts: { deck_created: 2 } }, // 7 days before
    ],
  }
  assert.deepEqual(dueBatches(s, '2026-10-09', true), [{ day: '2026-10-02', install: ID_A, counts: { deck_created: 2 } }])
  const after = record(s, 'deck_created', '2026-10-09', true, ids())
  assert.deepEqual(after.buckets.map((b) => b.day), ['2026-10-02', '2026-10-09'])
})

test('only finished days are sent, one try a day, none when off', () => {
  let s = record(emptyUsage(), 'card_scanned', '2026-10-01', true, ids(ID_A))
  s = record(s, 'card_scanned', '2026-10-02', true, ids())
  assert.deepEqual(dueBatches(s, '2026-10-01', true), [])
  assert.deepEqual(dueBatches(s, '2026-10-02', true), [{ day: '2026-10-01', install: ID_A, counts: { card_scanned: 1 } }])
  assert.deepEqual(dueBatches(s, '2026-10-02', false), [])
  const tried = markTried(s, '2026-10-02')
  assert.deepEqual(dueBatches(tried, '2026-10-02', true), [])
  // It failed (offline, or no record_usage yet): tomorrow tries again with both days.
  assert.equal(dueBatches(tried, '2026-10-03', true).length, 2)
})

test('at most 100 events a send', () => {
  const counts = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`e${String.fromCharCode(97 + (i % 26))}${i}`, 1]))
  const s: UsageState = { install: ID_A, installDay: '2026-10-01', lastTry: '', buckets: [{ day: '2026-10-01', install: ID_A, counts }] }
  assert.deepEqual(dueBatches(s, '2026-10-02', true).map((b) => Object.keys(b.counts).length), [100, 50])
})

test('a day sent is forgotten', () => {
  let s = record(emptyUsage(), 'loan_created', '2026-10-01', true, ids(ID_A))
  s = record(s, 'loan_created', '2026-10-02', true, ids())
  const [batch] = dueBatches(s, '2026-10-02', true)
  s = markSent(markTried(s, '2026-10-02'), batch)
  assert.deepEqual(s.buckets, [{ day: '2026-10-02', install: ID_A, counts: { loan_created: 1 } }])
  assert.deepEqual(dueBatches(s, '2026-10-03', true).map((b) => b.day), ['2026-10-02'])
})

test('turning it off forgets everything, install id included', () => {
  assert.deepEqual(optedOut(), { install: '', installDay: '', lastTry: '', buckets: [] })
})

test('a stored state is read back, and what doesn\'t fit is dropped', () => {
  const s = record(emptyUsage(), 'event_started', '2026-10-01', true, ids(ID_A))
  assert.deepEqual(parseUsage(JSON.stringify(s)), s)
  const bad = JSON.stringify({ ...s, buckets: [...s.buckets, { day: 'yesterday', install: ID_A, counts: { deck_created: 1 } }, { day: '2026-10-01', install: ID_B, counts: { 'Black Lotus': 3, deck_created: -1 } }] })
  assert.deepEqual(parseUsage(bad).buckets, s.buckets)
  assert.deepEqual(parseUsage('not json'), emptyUsage())
  assert.deepEqual(parseUsage(null), emptyUsage())
})

test('event names fit the server\'s rule', () => {
  assert.equal(USAGE_ACTIONS.length, 12)
  for (const a of USAGE_ACTIONS) assert.match(a, /^[a-z_]{1,40}$/)
  assert.equal(isUsageEvent('screen_settings_section'), true)
  assert.equal(isUsageEvent('screen_nowhere'), false)
  assert.match(newInstallId(() => '0123ABCD-0123-4567-89ab-0123456789ab'), /^[0-9a-f]{32}$/)
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1)
})

test('paths are counted as their screen, without ids', () => {
  assert.equal(screenOfPath('/'), 'home')
  assert.equal(screenOfPath('/decks/123e4567'), 'deck')
  assert.equal(screenOfPath('/decks/new'), 'new_deck')
  assert.equal(screenOfPath('/decks/abc/pull'), 'pull_list')
  assert.equal(screenOfPath('/collections/labels'), 'place_label')
  assert.equal(screenOfPath('/collections/xyz'), 'collection_detail')
  assert.equal(screenOfPath('/card/Lightning%20Bolt'), 'card')
  assert.equal(screenOfPath('/settings/privacy'), 'settings_section')
  assert.equal(screenOfPath('/play/events/new'), 'event_new')
  assert.equal(screenOfPath('/life'), 'life_counter')
  assert.equal(screenOfPath('/no/such/page/here'), null)
})

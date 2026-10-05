import { test } from 'node:test'
import assert from 'node:assert/strict'
import { friendsTabCounts, friendsTabFor, friendsTabPath, friendsTabs } from '../../src/social/friendsTabs.ts'

// The Friends page's tabs. The Android app has the same checks — see FriendsTabsTest.kt.

test('Messages and Activity only show when the server has them', () => {
  assert.deepEqual(friendsTabs(true), ['people', 'messages', 'trades', 'activity'])
  assert.deepEqual(friendsTabs(false), ['people', 'trades'])
  assert.deepEqual(friendsTabs(null), ['people', 'trades'])
})

test('a link or notification opens its tab', () => {
  assert.equal(friendsTabFor('trades', true), 'trades')
  assert.equal(friendsTabFor('trades', false), 'trades')
  assert.equal(friendsTabFor('messages', true), 'messages')
  assert.equal(friendsTabFor('activity', true), 'activity')
  assert.equal(friendsTabFor('friends', true), 'people')
  assert.equal(friendsTabFor('people', true), 'people')
  assert.equal(friendsTabFor(null, true), 'people')
  assert.equal(friendsTabFor(undefined, false), 'people')
  assert.equal(friendsTabFor('nonsense', true), 'people')
})

test('without social_more, Messages and Activity fall back to People', () => {
  assert.equal(friendsTabFor('messages', false), 'people')
  assert.equal(friendsTabFor('activity', null), 'people')
})

test('each tab carries what waits on it', () => {
  const waiting = { requests: 2, unread: 3, trades: 1 }
  assert.deepEqual(friendsTabCounts(friendsTabs(true), waiting), { 0: 2, 1: 3, 2: 1 })
  assert.deepEqual(friendsTabCounts(friendsTabs(false), waiting), { 0: 2, 1: 1 })
  assert.deepEqual(friendsTabCounts(friendsTabs(true), { requests: 0, unread: 0, trades: 4 }), { 2: 4 })
  assert.deepEqual(friendsTabCounts(friendsTabs(true), { requests: 0, unread: 0, trades: 0 }), {})
})

test('People is plain /friends; the others carry their tab', () => {
  assert.equal(friendsTabPath('people'), '/friends')
  assert.equal(friendsTabPath('trades'), '/friends?tab=trades')
  assert.equal(friendsTabPath('messages'), '/friends?tab=messages')
})

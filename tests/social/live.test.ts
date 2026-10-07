import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inboxOf, inOverview, openKey, SOCIAL_AREAS, socialAreaFor, socialDebounce, withFriendAccepted, withoutFriend, withTradeApplied,
  withTradeStatus, type Scheduler, type SocialArea,
} from '../../src/social/live.ts'
import { tradeInbox } from '../../src/social/friendsHub.ts'
import { awaitingMyUpdate } from '../../src/social/tradeLogic.ts'
import type { FriendLink, Overview, Trade, TradeStatus } from '../../src/social/api.ts'

// Live social updates (live.ts). The Android app has the same checks — see SocialLiveTest.kt.

const trade = (id: string, from: string, to: string, status: TradeStatus, updated: string): Trade => ({
  id, from_user: from, to_user: to, want: [], give: [], message: null, reply: null, status, reply_to: null,
  from_applied: false, to_applied: false, created_at: updated, updated_at: updated,
})

const overview = (trades: Trade[] = [], friends: FriendLink[] = []): Overview => ({
  me: { user_id: 'me', username: 'me', display_name: 'Me', avatar_path: null },
  people: {}, friends, pods: [], shared_with_me: [], my_shares: [], trades,
})

const link = (user_id: string, status: 'pending' | 'accepted', incoming: boolean): FriendLink => ({ user_id, status, incoming, since: '2026-10-01' })

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0
  let waiting: { at: number; run: () => void }[] = []
  const schedule: Scheduler = (ms, run) => {
    const entry = { at: now + ms, run }
    waiting.push(entry)
    return () => { waiting = waiting.filter((w) => w !== entry) }
  }
  const advance = (ms: number) => {
    now += ms
    const due = waiting.filter((w) => w.at <= now)
    waiting = waiting.filter((w) => w.at > now)
    due.forEach((w) => w.run())
  }
  return { schedule, advance }
}

// ---- Event → area ----

test('each ping reloads its area', () => {
  const ping = (what: string) => socialAreaFor('social', { what, id: 'x' })
  assert.equal(ping('trade'), 'trades')
  assert.equal(ping('friends'), 'friends')
  assert.equal(ping('loan'), 'loans')
  assert.equal(ping('night'), 'nights')
  assert.equal(ping('household'), 'household')
  assert.equal(ping('something new'), null)
  assert.equal(socialAreaFor('social', null), null)
  assert.equal(socialAreaFor('social', { what: 3 }), null)
})

test('other channel events are left alone', () => {
  assert.equal(socialAreaFor('game_night', { nightId: 'n' }), 'nights')
  assert.equal(socialAreaFor('message', {}), null)
  assert.equal(socialAreaFor('pod_message', {}), null)
})

test('only trades and friends are in the overview', () => {
  assert.deepEqual(SOCIAL_AREAS.filter(inOverview), ['trades', 'friends'])
})

// ---- Debounce ----

test('a burst of pings is one reload', () => {
  const clock = fakeClock()
  const fired: Set<SocialArea>[] = []
  const d = socialDebounce(300, (a) => fired.push(a), clock.schedule)
  d.add('trades')
  clock.advance(100)
  d.add('trades')
  d.add('friends')
  clock.advance(150)
  assert.equal(fired.length, 0)
  clock.advance(50)
  assert.deepEqual(fired.map((s) => [...s]), [['trades', 'friends']])
  // A later ping starts a new window.
  d.add('loans')
  clock.advance(299)
  assert.equal(fired.length, 1)
  clock.advance(1)
  assert.deepEqual([...fired[1]], ['loans'])
})

test('cancelling drops what was waiting', () => {
  const clock = fakeClock()
  const fired: Set<SocialArea>[] = []
  const d = socialDebounce(300, (a) => fired.push(a), clock.schedule)
  d.add('trades')
  d.cancel()
  clock.advance(1000)
  assert.equal(fired.length, 0)
  d.add('nights')
  clock.advance(300)
  assert.deepEqual(fired.map((s) => [...s]), [['nights']])
})

// ---- The user's own changes, at once ----

test('a cancelled trade leaves Waiting on them at once', () => {
  const o = overview([trade('t1', 'me', 'sam', 'open', '2026-10-01T10:00:00Z'), trade('t2', 'sam', 'me', 'declined', '2026-10-02T10:00:00Z')])
  assert.deepEqual(tradeInbox(o.trades, 'me').waitingOnThem.map((t) => t.id), ['t1'])
  const after = withTradeStatus(o, 't1', 'cancelled', '2026-10-07T10:00:00Z')
  const inbox = tradeInbox(after.trades, 'me')
  assert.equal(inbox.waitingOnThem.length, 0)
  assert.deepEqual(inbox.done.map((t) => t.id), ['t1', 't2'])
  assert.equal(inbox.done[0].status, 'cancelled')
  // The original is left as it was.
  assert.equal(o.trades[0].status, 'open')
})

test('an accepted trade asks for the binders, then is done', () => {
  const o = overview([trade('t1', 'sam', 'me', 'open', '2026-10-01T10:00:00Z')])
  assert.deepEqual(inboxOf(o, 'me'), { friend_requests: 0, trades: 1 })
  const accepted = withTradeStatus(o, 't1', 'accepted')
  assert.ok(awaitingMyUpdate(accepted.trades[0], 'me'))
  const applied = withTradeApplied(accepted, 't1', 'me')
  assert.equal(applied.trades[0].to_applied, true)
  assert.deepEqual(inboxOf(applied, 'me'), { friend_requests: 0, trades: 0 })
})

test('answering a friend request shows at once', () => {
  const o = overview([], [link('sam', 'pending', true), link('jo', 'pending', false)])
  assert.deepEqual(inboxOf(o, 'me'), { friend_requests: 1, trades: 0 })
  const accepted = withFriendAccepted(o, 'sam')
  assert.equal(accepted.friends.find((f) => f.user_id === 'sam')?.status, 'accepted')
  assert.deepEqual(inboxOf(accepted, 'me'), { friend_requests: 0, trades: 0 })
  assert.deepEqual(withoutFriend(o, 'jo').friends.map((f) => f.user_id), ['sam'])
})

test('an opened trade closes when its status changes', () => {
  const t = trade('t1', 'me', 'sam', 'open', '2026-10-01T10:00:00Z')
  assert.notEqual(openKey(t), openKey({ ...t, status: 'cancelled' }))
  assert.equal(openKey(t), openKey({ ...t, updated_at: '2026-10-02T10:00:00Z' }))
})

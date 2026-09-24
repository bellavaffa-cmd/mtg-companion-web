import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// The module reads localStorage at call time, so a plain stub is enough.
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

const { rememberSeat, forgetSeat, rememberedSeat, remotePath } = await import('../../src/lifecounter/seat.ts')

beforeEach(() => store.clear())

test('nothing is offered when you are not at a table', () => {
  assert.equal(rememberedSeat(), null)
})

test('a seat is remembered so the way back can be offered', () => {
  rememberSeat('match-1', 3)
  const seat = rememberedSeat()
  assert.equal(seat?.matchId, 'match-1')
  assert.equal(seat?.seat, 3)
  assert.equal(remotePath(seat!), '/remote/match-1/3')
})

test('leaving the seat forgets it', () => {
  rememberSeat('match-1', 3)
  forgetSeat()
  assert.equal(rememberedSeat(), null)
})

test("yesterday's table is not still offered, and is cleared", () => {
  rememberSeat('match-1', 3)
  const tomorrow = Date.now() + 13 * 60 * 60 * 1000
  assert.equal(rememberedSeat(tomorrow), null)
  // Cleared on the way past, so it isn't checked again.
  assert.equal(rememberedSeat(), null)
})

test('nonsense in storage is ignored rather than thrown', () => {
  store.set('mtgweb_remote_seat', 'not json')
  assert.equal(rememberedSeat(), null)
  store.set('mtgweb_remote_seat', JSON.stringify({ seat: 2 }))
  assert.equal(rememberedSeat(), null)
})

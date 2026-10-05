// Delete my account (src/account/accountDeletion.ts). The Android app runs the same cases in
// AccountDeletionTest.kt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountDeletionOutcome, avatarPaths } from '../../src/account/accountDeletion.ts'

test('a successful call is a deletion', () => {
  assert.equal(accountDeletionOutcome(204, null), 'deleted')
  assert.equal(accountDeletionOutcome(200, undefined), 'deleted')
})

test('a server without the function deletes nothing', () => {
  assert.equal(accountDeletionOutcome(404, 'PGRST202'), 'unavailable')
  assert.equal(accountDeletionOutcome(404, null), 'unavailable')
})

test('other errors are failures', () => {
  assert.equal(accountDeletionOutcome(400, 'P0001'), 'failed')
  assert.equal(accountDeletionOutcome(401, 'PGRST301'), 'failed')
  assert.equal(accountDeletionOutcome(500, null), 'failed')
  assert.equal(accountDeletionOutcome(404, '42P01'), 'failed')
})

test("avatar paths are the files in the user's folder", () => {
  const list = [
    { name: 'a1.jpg', id: '11111111-1111-1111-1111-111111111111' },
    { name: 'b2.png', id: '22222222-2222-2222-2222-222222222222' },
    { name: 'sub', id: null },
    { name: '', id: '33333333-3333-3333-3333-333333333333' },
  ]
  assert.deepEqual(avatarPaths('u1', list), ['u1/a1.jpg', 'u1/b2.png'])
})

test('an unreadable list removes nothing', () => {
  assert.deepEqual(avatarPaths('u1', null), [])
  assert.deepEqual(avatarPaths('u1', { error: 'x' }), [])
  assert.deepEqual(avatarPaths('u1', []), [])
})

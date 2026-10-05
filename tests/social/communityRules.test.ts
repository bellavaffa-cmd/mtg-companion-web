import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMUNITY_RULES_VERSION as V, createCommunityRulesStore, needsAgreement, versionFromUser } from '../../src/social/communityRules.ts'

// The one-time community rules before a first post. The Android app has the same checks — see CommunityRulesTest.kt.

test('agreement from this browser or the account counts', () => {
  assert.equal(needsAgreement(0, null), true)
  assert.equal(needsAgreement(0, 0), true)
  assert.equal(needsAgreement(V, null), false)
  assert.equal(needsAgreement(0, V), false)
  // Rules that changed since (a lower version) are asked again.
  assert.equal(needsAgreement(V - 1, V - 1), true)
})

test("the account's version comes from user metadata", () => {
  assert.equal(versionFromUser(null), 0)
  assert.equal(versionFromUser({}), 0)
  assert.equal(versionFromUser({ user_metadata: {} }), 0)
  assert.equal(versionFromUser({ user_metadata: { community_rules_version: 1 } }), 1)
  assert.equal(versionFromUser({ user_metadata: { community_rules_version: '2' } }), 2)
  assert.equal(versionFromUser({ user_metadata: { community_rules_version: 'yes' } }), 0)
  assert.equal(versionFromUser({ user_metadata: { community_rules_version: -3 } }), 0)
})

test('a first post waits for Agree, then goes ahead', () => {
  const saved: number[] = []
  const store = createCommunityRulesStore(0, (v) => saved.push(v))
  let posted = 0
  store.require(() => { posted++ })
  assert.equal(posted, 0)
  assert.ok(store.getState().pending)

  store.agree()?.()
  assert.equal(posted, 1)
  assert.equal(store.getState().pending, null)
  assert.deepEqual(saved, [V])

  // From then on, posting goes straight through without the dialog.
  store.require(() => { posted++ })
  assert.equal(posted, 2)
  assert.equal(store.getState().pending, null)
})

test('Not now posts nothing', () => {
  const store = createCommunityRulesStore(0, () => {})
  let posted = false
  store.require(() => { posted = true })
  store.dismiss()
  assert.equal(posted, false)
  assert.equal(store.getState().pending, null)
  assert.equal(store.agreed(), false)
})

test("agreed on another device isn't asked again", () => {
  const saved: number[] = []
  const store = createCommunityRulesStore(0, (v) => saved.push(v))
  store.setAccountVersion(V)
  assert.equal(store.agreed(), true)
  // Remembered in this browser too, so signing out later doesn't ask again.
  assert.deepEqual(saved, [V])
  store.setAccountVersion(null)
  assert.equal(store.agreed(), true)
})

test('already agreed in this browser', () => {
  const store = createCommunityRulesStore(V, () => { throw new Error('nothing new to save') })
  let posted = false
  store.require(() => { posted = true })
  assert.equal(posted, true)
  // Settings can still open the rules to read.
  store.show()
  assert.ok(store.getState().pending)
  store.dismiss()
})

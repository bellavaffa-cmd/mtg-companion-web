import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// A browser storage that fills up on demand.
const store = new Map<string, string>()
let roomLeft = true
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (!roomLeft) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    store.set(k, v)
  },
  removeItem: (k: string) => { store.delete(k) },
}

const { isQuotaError, onStorageFull, resetStorageFull, saveToStorage, storageFull } = await import('../../src/sync/storage.ts')
const { loadCloudState, saveCloudState, emptyCloudState } = await import('../../src/sync/cloudSync.ts')

beforeEach(() => { store.clear(); roomLeft = true; resetStorageFull() })

test('a write that fits is saved', () => {
  assert.equal(saveToStorage('k', 'v'), true)
  assert.equal(store.get('k'), 'v')
  assert.equal(storageFull(), false)
})

test('a full storage answers false instead of throwing, and is reported once', () => {
  let told = 0
  const stop = onStorageFull(() => told++)
  roomLeft = false
  assert.equal(saveToStorage('k', 'v'), false)
  assert.equal(saveToStorage('k', 'w'), false)
  assert.equal(told, 1)
  assert.equal(storageFull(), true)
  stop()
})

test("the sync's bookkeeping failing to save doesn't stop the sync", () => {
  saveCloudState({ ...emptyCloudState('me'), cursor: 'a' })
  roomLeft = false
  assert.doesNotThrow(() => saveCloudState({ ...emptyCloudState('me'), cursor: 'b' }))
  assert.equal(loadCloudState().cursor, 'a')
})

test('only the browser saying it is full counts as full', () => {
  assert.ok(isQuotaError(new DOMException('full', 'QuotaExceededError')))
  assert.ok(isQuotaError(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED')))
  assert.ok(!isQuotaError(new DOMException('no', 'SecurityError')))
  assert.ok(!isQuotaError(new Error('QuotaExceededError')))
})

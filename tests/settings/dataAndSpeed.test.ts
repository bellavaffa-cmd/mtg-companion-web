import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastSyncedLabel, offlineLabel, openLabel } from '../../src/settings/dataAndSpeed.ts'
import { secondsLabel } from '../../src/settings/perfStats.ts'

// Settings › Data and speed says each figure the same way as the Android app (DataAndSpeedTest.kt).

test('times read in seconds, short ones to the hundredth', () => {
  assert.equal(secondsLabel(400), '0.4 s')
  assert.equal(secondsLabel(42), '0.04 s')
  assert.equal(secondsLabel(3), '0.01 s')
  assert.equal(secondsLabel(1250), '1.3 s')
  assert.equal(openLabel(null), 'Not opened yet')
  assert.equal(openLabel({ ms: 380, cards: 18_000, at: 1 }), '0.4 s')
})

test('card data is counted against the printings owned, and the last sync says how long ago', () => {
  assert.equal(offlineLabel(18_402, 18_402), '18,402 of 18,402')
  const now = 1_790_000_000_000
  assert.equal(lastSyncedLabel(true, now - 2 * 60_000, now), '2 min ago')
  assert.equal(lastSyncedLabel(true, now - 5_000, now), 'Just now')
  assert.equal(lastSyncedLabel(true, 0, now), 'Not yet')
  assert.equal(lastSyncedLabel(false, now, now), 'Not signed in')
})

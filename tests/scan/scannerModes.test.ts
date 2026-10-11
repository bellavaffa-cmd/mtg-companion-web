import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canLetAppChoose, carryOver, entryOf, SCANNER_MODES, scannerModeOf, scannerStart, sortStart } from '../../src/scan/scannerModes.ts'
import type { StoragePlace } from '../../src/types/models.ts'

// The scanner's modes, the same on both apps. The Android app has the same checks — see ScannerModesTest.kt.

test('the nav bar opens in the mode last picked, and Add cards the first time', () => {
  assert.deepEqual(scannerStart('plain', null), { mode: 'add', showSwitch: true })
  assert.deepEqual(scannerStart('plain', 'sort'), { mode: 'sort', showSwitch: true })
  assert.deepEqual(scannerStart('plain', 'check'), { mode: 'check', showSwitch: true })
})

test("a job's own entry opens in that job, whatever was last picked", () => {
  assert.deepEqual(scannerStart('putAway', 'sort'), { mode: 'putAway', showSwitch: true })
  assert.deepEqual(scannerStart('check', 'add'), { mode: 'check', showSwitch: true })
  assert.deepEqual(scannerStart('sort', null), { mode: 'sort', showSwitch: true })
})

test("ticking a deck's list is its own fixed job, with no switch", () => {
  assert.deepEqual(scannerStart('tick', 'sort'), { mode: null, showSwitch: false })
})

test('modes are kept by key', () => {
  for (const { mode } of SCANNER_MODES) assert.equal(scannerModeOf(mode), mode)
  assert.equal(scannerModeOf(null), null)
  assert.equal(scannerModeOf('tick'), null)
  assert.deepEqual(SCANNER_MODES.map((m) => m.label), ['Add cards', 'Sort a pile', 'Put away', 'Check'])
})

test("the scanner's address says where it was opened from", () => {
  assert.equal(entryOf(new URLSearchParams('')), 'plain')
  assert.equal(entryOf(new URLSearchParams('pull=d1')), 'tick')
  assert.equal(entryOf(new URLSearchParams('putBack=d1')), 'tick')
  assert.equal(entryOf(new URLSearchParams('putAway=red')), 'putAway')
  assert.equal(entryOf(new URLSearchParams('check=red')), 'check')
  assert.equal(entryOf(new URLSearchParams('sort')), 'sort')
  assert.equal(entryOf(new URLSearchParams('recipe')), 'sort')
  assert.equal(entryOf(new URLSearchParams('mode=sort')), 'sort')
})

test('an empty list has nothing to carry', () => {
  assert.equal(carryOver('add', 'sort', 0, false), 'none')
})

test('leaving Add cards for Sort a pile asks, once per visit', () => {
  assert.equal(carryOver('add', 'sort', 3, false), 'ask')
  assert.equal(carryOver('add', 'sort', 3, true), 'keep')
})

test('Put away, Check and coming back keep the list without asking', () => {
  assert.equal(carryOver('add', 'putAway', 3, false), 'keep')
  assert.equal(carryOver('add', 'check', 3, false), 'keep')
  assert.equal(carryOver('sort', 'add', 3, false), 'keep')
  // Not from Add cards: the list wasn't what was being scanned into.
  assert.equal(carryOver('putAway', 'sort', 3, false), 'keep')
})

test('Sort a pile carries on a sort under way, the recipe one first', () => {
  assert.equal(sortStart(4, 2, true), 'resumeRecipe')
  assert.equal(sortStart(0, 2, true), 'resumeClassic')
  assert.equal(sortStart(null, 1, false), 'resumeClassic')
})

test('Sort a pile offers the last recipe, or asks for one', () => {
  assert.equal(sortStart(0, 0, true), 'startLast')
  assert.equal(sortStart(null, null, true), 'startLast')
  assert.equal(sortStart(null, 0, false), 'pick')
})

test('Let the app choose needs a box with a rule', () => {
  const binder: StoragePlace = { id: 'b', name: 'Binder', kind: 'BINDER', sortRule: 'SET', createdAt: 1 }
  const plain: StoragePlace = { id: 'p', name: 'Plain box', kind: 'BOX', createdAt: 2 }
  const red: StoragePlace = { id: 'r', name: 'Red box', kind: 'BOX', sortRule: 'COLOUR', createdAt: 3 }
  assert.equal(canLetAppChoose([]), false)
  assert.equal(canLetAppChoose([binder, plain]), false)
  assert.equal(canLetAppChoose([binder, plain, red]), true)
})

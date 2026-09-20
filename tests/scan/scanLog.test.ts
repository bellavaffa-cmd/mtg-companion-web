import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOUBLE_MS, copyNumber, grouped, onlyRepeats, repeatedCards, scannedTwiceOver, type ScanRow } from '../../src/scan/scanLog.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The scanning list: one row per scan, newest first. The Android app has the same checks — see
// ScanLogTest.kt.

const card = (id: string) => ({ id, name: id }) as unknown as ScryfallCard
const t0 = 1_700_000_000_000
/** Rows as the list holds them: newest first. */
const rows = (...scans: [string, number][]): ScanRow[] =>
  scans.map(([id, at], i) => ({ id: scans.length - i, card: card(id), foil: false, at: t0 + at })).slice()

test('a card scanned twice takes two rows, and each says which copy it is', () => {
  // Scanned: Sol Ring, Cultivate, Sol Ring again — newest first.
  const list = rows(['sol', 9000], ['cult', 4000], ['sol', 0])
  assert.deepEqual(list.map((r) => copyNumber(list, r)), [2, 1, 1])
  assert.deepEqual([...repeatedCards(list)], ['sol'])
  assert.deepEqual(onlyRepeats(list).map((r) => r.card.id), ['sol', 'sol'])
})

test('a repeat seconds apart reads as the camera catching one card twice', () => {
  const quick = rows(['sol', 1500], ['sol', 0])
  assert.equal(scannedTwiceOver(quick, quick[0]), true)
  assert.equal(scannedTwiceOver(quick, quick[1]), false, 'the first scan of a card is never a repeat')

  const later = rows(['sol', DOUBLE_MS + 1], ['sol', 0])
  assert.equal(scannedTwiceOver(later, later[0]), false, 'a copy scanned a minute later is just another copy')
})

test('the pile is added together only when it goes into a binder', () => {
  const list = rows(['sol', 9000], ['cult', 4000], ['sol', 0])
  assert.deepEqual(grouped(list).map((g) => [g.card.id, g.quantity]), [['sol', 2], ['cult', 1]])

  // A foil is its own stack, even of a card already scanned.
  const withFoil: ScanRow[] = [{ id: 4, card: card('sol'), foil: true, at: t0 + 12000 }, ...list]
  assert.deepEqual(grouped(withFoil).map((g) => [g.card.id, g.foil, g.quantity]), [['sol', false, 2], ['cult', false, 1], ['sol', true, 1]])
})

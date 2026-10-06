import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  changeLabel, keepSealedFromOlderApp, mergeSealed, newSealed, openableBoxes, openablePrecons, openSealed, preconDeckName, saveSealed, sealedChange,
  sealedLine, sealedOf, sealedOptions, sealedTotalUsd, sortForOpened,
} from '../../src/collection/sealed.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import type { Collection, SealedProduct, StoragePlace } from '../../src/types/models.ts'

// Sealed product: the value and change, opening one (a pile to sort, or a deck), the search, and
// merging two devices' lists — the same on both apps. The Android app has the same checks — see SealedTest.kt.

const cupboard: StoragePlace = { id: 'cup', name: 'Cupboard, hall', kind: 'SHELF', createdAt: 1 }
const box = (over: Partial<SealedProduct> = {}): SealedProduct =>
  ({ id: 'dsk', name: 'Duskmourn Play Booster Box', kind: 'PLAY_BOX', setCode: 'dsk', count: 2, placeId: 'cup', paidUsd: 210, valueUsd: 238, createdAt: 1, ...over })
const precon = (over: Partial<SealedProduct> = {}): SealedProduct =>
  ({ id: 'blame', name: 'Precon: Blame Game', kind: 'PRECON', preconFile: 'BlameGame_DSC', count: 1, paidUsd: 45, valueUsd: 41, createdAt: 2, ...over })
const pile = (sealed?: SealedProduct[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries: [], createdAt: 0, type: 'OWNED', storagePlaces: [cupboard], ...(sealed ? { sealed } : {}) })
const usd = (n: number) => `$${n}`

test('the change from paid to now, in whole percent, with a minus sign for a fall', () => {
  assert.equal(sealedChange(box()), 13)
  assert.equal(sealedChange(precon()), -9)
  assert.equal(sealedChange(box({ paidUsd: undefined })), null)
  assert.equal(sealedChange(box({ valueUsd: undefined })), null)
  assert.equal(sealedChange(box({ paidUsd: 0 })), null)
  assert.equal(changeLabel(13), '+13%')
  assert.equal(changeLabel(-9), '−9%')
  assert.equal(changeLabel(0), '0%')
})

test('the total is each value times the count; a product with no value adds nothing', () => {
  assert.equal(sealedTotalUsd([box(), precon(), box({ id: 'x', valueUsd: undefined })]), 238 * 2 + 41)
})

test("a product's line: count, place and price paid — each when there are more than one", () => {
  const cols = [pile([box(), precon()])]
  assert.equal(sealedLine(box(), cols, usd), '×2 · Cupboard, hall · paid $210 each')
  assert.equal(sealedLine(precon(), cols, usd), '×1 · No place yet · paid $45')
})

test('opening one takes one off; the last one takes the product off the list', () => {
  const cols = [pile([box(), precon()])]
  const once = openSealed(cols, 'dsk')
  assert.equal(once.opened?.name, 'Duskmourn Play Booster Box')
  assert.equal(sealedOf(once.collections).find((p) => p.id === 'dsk')?.count, 1)
  const twice = openSealed(once.collections, 'dsk')
  assert.equal(sealedOf(twice.collections).some((p) => p.id === 'dsk'), false)
  assert.deepEqual(sealedOf(twice.collections).map((p) => p.id), ['blame'])
  assert.equal(openSealed(twice.collections, 'dsk').opened, null)
})

test('an opened box starts a sort of new cards named after it; a sort of new cards under way is kept', () => {
  const rules = [{ kind: 'REST' as const }]
  const fresh = sortForOpened(null, box(), rules as never)
  assert.deepEqual(fresh, { source: 'Duskmourn Play Booster Box', rules, newCards: true, scans: [] })
  const underWay = { source: 'Bloomburrow', rules, newCards: true, scans: [{ id: 1 }] } as never
  assert.equal(sortForOpened(underWay, box(), rules as never), underWay)
  const tidy = { source: 'Old pile', rules, newCards: false, scans: [{ id: 1 }] } as never
  assert.equal(sortForOpened(tidy, box(), rules as never).source, 'Duskmourn Play Booster Box')
})

test('a precon with its decklist opens as a deck; boxes and precons without one open as a pile', () => {
  const list = [box(), precon(), precon({ id: 'own', name: 'Precon: Homebrew', preconFile: undefined })]
  assert.deepEqual(openablePrecons(list).map((p) => p.id), ['blame'])
  assert.deepEqual(openableBoxes(list).map((p) => p.id), ['dsk', 'own'])
  assert.equal(preconDeckName(precon()), 'Blame Game')
})

test('the search offers each set as its products, then precons, then the words as your own', () => {
  const sets = [{ code: 'dsk', name: 'Duskmourn: House of Horror', releasedAt: '2024-09-27', cardCount: 400 }, { code: 'lea', name: 'Limited Edition Alpha', releasedAt: '1993-08-05', cardCount: 295 }]
  const precons = [{ fileName: 'BlameGame_DSC', name: 'Blame Game', setCode: 'DSC', releaseDate: '2024-09-27' }]
  const dusk = sealedOptions('dusk', sets, precons)
  assert.deepEqual(dusk.map((o) => o.name), [
    'Duskmourn: House of Horror Play Booster Box', 'Duskmourn: House of Horror Collector Box', 'Duskmourn: House of Horror Bundle',
    'Duskmourn: House of Horror Set Booster Box', 'Duskmourn: House of Horror Draft Booster Box', 'dusk',
  ])
  const blame = sealedOptions('blame', sets, precons)
  assert.deepEqual(blame.map((o) => `${o.kind} ${o.name}`), ['PRECON Precon: Blame Game', 'OTHER blame'])
  assert.equal(blame[0].preconFile, 'BlameGame_DSC')
  assert.deepEqual(sealedOptions('  ', sets, precons), [])
  const made = newSealed(blame[0], 'n1', 5)
  assert.deepEqual(made, { id: 'n1', name: 'Precon: Blame Game', kind: 'PRECON', setCode: 'dsc', preconFile: 'BlameGame_DSC', count: 1, createdAt: 5 })
})

test('saving writes the product as both apps do: money to the cent, empty fields left out', () => {
  const cols = saveSealed([pile()], box({ id: 'n', paidUsd: 210.456, valueUsd: undefined, placeId: undefined, valueAt: 9 }))
  assert.deepEqual(sealedOf(cols)[0], { id: 'n', name: 'Duskmourn Play Booster Box', kind: 'PLAY_BOX', setCode: 'dsk', count: 2, paidUsd: 210.46, createdAt: 1 })
})

test('merging: counts add up, both opening one is two opened, and a product left with none goes', () => {
  const base = [box({ count: 3 }), precon()]
  const merged = mergeSealed(base, [box({ count: 2 }), precon()], [box({ count: 2 }), precon({ valueUsd: 50, valueAt: 7 })], false)!
  assert.equal(merged.find((p) => p.id === 'dsk')?.count, 1)
  assert.equal(merged.find((p) => p.id === 'blame')?.valueUsd, 50)
  const gone = mergeSealed([box({ count: 2 })], [box({ count: 1 })], [box({ count: 1 })], true)!
  assert.deepEqual(gone, [])
})

test('merging: one added on either side is kept, one deleted on either side stays deleted', () => {
  const merged = mergeSealed([box()], [box(), precon()], [], true)!
  assert.deepEqual(merged.map((p) => p.id), ['blame'])
  assert.equal(mergeSealed(undefined, undefined, undefined, true), undefined)
  const both = mergeSealed([], [precon({ count: 2 })], [precon({ count: 1 })], false)!
  assert.equal(both[0].count, 2)
})

test('a pile saved by an app from before sealed product keeps the list', () => {
  const mine = pile([box()])
  const older = pile()
  assert.deepEqual(keepSealedFromOlderApp(mine, older).sealed, [box()])
  assert.deepEqual(keepSealedFromOlderApp(mine, pile([])).sealed, [])
  // Through the whole binder merge: the older app's save leaves the list as it was.
  const merged = mergeCollection(mine, mine, older, false)
  assert.deepEqual(merged.sealed, [box()])
})

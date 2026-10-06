import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askForPhotos, boughtLabel, copiesOfCard, photoDayLabel, photoKey, photosForReport, type CopyPhoto } from '../../src/collection/copyPhotos.ts'
import type { Collection, StoragePlace } from '../../src/types/models.ts'

// Telling one copy from another for its photos, and the words beside them — the same on both apps.
// The Android app has the same checks — see CopyPhotosTest.kt.

const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 1 }
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', createdAt: 2 }
const COLS: Collection[] = [
  { id: 'stuff', name: 'Trade stuff', createdAt: 1, type: 'OWNED', entries: [{ scryfallId: 'opt', name: 'Opt', imageUrl: null, quantity: 1, foilQuantity: 0 }] },
  {
    id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', storagePlaces: [rares, red],
    entries: [
      {
        scryfallId: 'opt', name: 'Opt', imageUrl: null, quantity: 2, foilQuantity: 1, condition: 'LP',
        places: [{ placeId: 'red', qty: 1, section: 'Blue' }, { placeId: 'rares', qty: 1, foil: true, page: 2, slot: 1 }],
      },
      { scryfallId: 'bolt', name: 'Lightning Bolt', imageUrl: null, quantity: 1, foilQuantity: 0 },
    ],
  },
  { id: 'wish', name: 'Wishlist', createdAt: 2, type: 'WISHLIST', entries: [{ scryfallId: 'opt', name: 'Opt', imageUrl: null, quantity: 4, foilQuantity: 0 }] },
]

test('every copy one by one', () => {
  const copies = copiesOfCard(COLS, 'opt')
  assert.deepEqual(copies.map((c) => c.key), ['opt||1', 'opt||2', 'opt|foil|1', 'opt||3'])
  assert.deepEqual(copies.map((c) => c.where), ['Red box › Blue', 'No place yet', 'Rares binder p2 s1', 'No place yet'])
  assert.deepEqual(copies.map((c) => c.placeId), ['red', null, 'rares', null])
  assert.deepEqual(copies.map((c) => c.collectionId), ['unsorted', 'unsorted', 'unsorted', 'stuff'])
  assert.equal(copies[0].condition, 'LP')
  assert.equal(photoKey('x', false, 2), 'x||2')
})

test('the words', () => {
  assert.equal(photoDayLabel('2026-10-05'), '5 Oct 2026')
  assert.equal(photoDayLabel('nonsense'), 'nonsense')
  const money = (usd: number) => `$${Math.trunc(usd)}`
  assert.equal(boughtLabel({ key: 'k', scryfallId: 'ring', name: 'The One Ring', boughtUsd: 58, boughtWhere: ' Card shop ' }, money), '$58 · Card shop')
  assert.equal(boughtLabel({ key: 'k', scryfallId: 'ring', name: 'The One Ring', boughtUsd: 58 }, money), '$58')
  assert.equal(boughtLabel(null, money), '')
})

test('asking for photos', () => {
  assert.equal(askForPhotos(62, 20), true)
  assert.equal(askForPhotos(10, 20), false)
  assert.equal(askForPhotos(20, 20), false)
  assert.equal(askForPhotos(62, null), false)
  assert.equal(askForPhotos(null, 20), false)
})

test('the report has the photos of copies still owned', () => {
  const photos: CopyPhoto[] = [
    { key: 'ring||1', scryfallId: 'ring', name: 'The One Ring', front: 'a' },
    { key: 'opt||1', scryfallId: 'opt', name: 'Opt', back: 'b' },
    { key: 'bolt||1', scryfallId: 'bolt', name: 'Lightning Bolt', boughtUsd: 1 },
    { key: 'gone||1', scryfallId: 'gone', name: 'Gone', front: 'c' },
  ]
  assert.deepEqual(photosForReport(photos, new Set(['ring', 'opt', 'bolt'])).map((p) => p.key), ['opt||1', 'ring||1'])
})

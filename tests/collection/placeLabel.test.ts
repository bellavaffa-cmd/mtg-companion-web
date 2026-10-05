import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LABEL_SHOW, labelOrder, labelSizeInfo, labelText, placeIdFromLabel, placeLabelLink } from '../../src/collection/placeLabel.ts'
import type { StoragePlace } from '../../src/types/models.ts'

// Box labels: what the QR code holds and what the label says, the same on both apps. The Android app
// has the same checks — see PlaceLabelTest.kt.

const place = (id: string, over: Partial<StoragePlace> = {}): StoragePlace => ({ id, name: id, kind: 'BOX', createdAt: 1, ...over })
const shelf = place('shelf', { name: 'Shelf, study', kind: 'SHELF', createdAt: 1 })
const red = place('red', { name: 'Red box', parentId: 'shelf', sortRule: 'COLOUR', sections: ['White', 'Blue', 'Black', 'Red', 'Green', 'Other'], createdAt: 2 })
const loose = place('loose', { name: 'Loose', createdAt: 0 })
const PLACES = [shelf, red, loose]
const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b'

test('a label holds a link to its place, and the scanners read it back', () => {
  assert.equal(placeLabelLink(ID), `https://manabind.com/place/${ID}`)
  assert.deepEqual(placeIdFromLabel(placeLabelLink(ID)), { id: ID, bare: false })
  assert.deepEqual(placeIdFromLabel(`  http://www.manabind.com/place/${ID}/?x=1 `), { id: ID, bare: false })
  assert.deepEqual(placeIdFromLabel('http://localhost:5173/place/red'), { id: 'red', bare: false })
  assert.deepEqual(placeIdFromLabel('https://example.github.io/mtg-companion-web/place/red'), { id: 'red', bare: false })
  // The first labels held the id alone.
  assert.deepEqual(placeIdFromLabel(ID.toUpperCase()), { id: ID, bare: true })
  // Not a label.
  assert.equal(placeIdFromLabel('https://manabind.com/add/bob'), null)
  assert.equal(placeIdFromLabel('https://manabind.com/place/'), null)
  assert.equal(placeIdFromLabel('https://manabind.com/place/a/b'), null)
  assert.equal(placeIdFromLabel('https://evil.example/place/red'), null)
  assert.equal(placeIdFromLabel('https://manabind.com/place/%E0%A4%A'), null)
  assert.equal(placeIdFromLabel('red'), null)
})

test('what a label says', () => {
  assert.deepEqual(labelText(red, PLACES, DEFAULT_LABEL_SHOW, 612), {
    where: 'Shelf, study', name: 'Red box', sections: 'White · Blue · Black · Red · Green · Other', rule: 'By colour, then A–Z', count: null,
  })
  assert.deepEqual(labelText(red, PLACES, { where: false, sections: false, rule: false, count: true }, 1), {
    where: null, name: 'Red box', sections: null, rule: null, count: '1 copy',
  })
  assert.deepEqual(labelText(shelf, PLACES, { ...DEFAULT_LABEL_SHOW, count: true }, 0), {
    where: null, name: 'Shelf, study', sections: null, rule: null, count: '0 copies',
  })
  assert.deepEqual(labelOrder(PLACES).map((p) => p.id), ['loose', 'shelf', 'red'])
  assert.equal(labelSizeInfo('DIVIDER').heightMm, 100)
})

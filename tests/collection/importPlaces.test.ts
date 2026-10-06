import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyImportedPlaces, importedPlaceKind, locationColumnIn, locationCounts, newPlaceCount, suggestTargets, type ImportedPlacement, type PlaceTarget,
} from '../../src/collection/importPlaces.ts'
import { buildCardListCsv, CARD_LIST_CSV_HEADER, parseCardList } from '../../src/collection/cardListText.ts'
import { placedCopies, placesOf } from '../../src/collection/storagePlaces.ts'
import type { Collection, CollectionEntry, StoragePlace } from '../../src/types/models.ts'

// Import with locations: a CSV's binder, box or location column, matched to places. The Android app
// has the same checks — see ImportPlacesTest.kt.

const sol = '0afa0e33-4804-4b00-b625-c2d6b61090fc'
const bolt = '11111111-2222-3333-4444-555555555555'
const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CollectionEntry['places']): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}) })

test('the location column is found in each app’s export', () => {
  assert.equal(locationColumnIn(CARD_LIST_CSV_HEADER.toLowerCase().split(',')), 8)
  // ManaBox: "Binder Name" beside "Binder Type".
  assert.equal(locationColumnIn(['binder type', 'binder name', 'name', 'quantity']), 1)
  assert.equal(locationColumnIn(['count', 'name', 'location']), 2)
  assert.equal(locationColumnIn(['count', 'name', 'folder']), 2)
  assert.equal(locationColumnIn(['count', 'name', 'box']), 2)
  assert.equal(locationColumnIn(['count', 'name', 'my binder']), 2)
  assert.equal(locationColumnIn(['count', 'name', 'binder id', 'edition']), -1)
  assert.equal(locationColumnIn(['count', 'name', 'edition']), -1)
})

test('each value is counted, blanks last', () => {
  const csv = [
    'Binder Name,Name,Quantity,Foil',
    'Binder 1,Sol Ring,2,',
    ',Lightning Bolt,3,',
    'box r,Lightning Bolt,1,foil',
    'Box R,Sol Ring,4,',
    'binder 1,Lightning Bolt,1,',
  ].join('\n')
  const parsed = parseCardList(csv)
  assert.equal(parsed.locationColumn, 'Binder Name')
  assert.deepEqual(parsed.lines.map((l) => l.location ?? null), ['Binder 1', null, 'box r', 'Box R', 'binder 1'])
  assert.deepEqual(locationCounts(parsed.lines).map((c) => [c.value, c.copies]), [['Binder 1', 3], ['box r', 5], ['', 3]])
  // A list without such a column has none.
  assert.equal(parseCardList('Count,Name\n1,Sol Ring').locationColumn, undefined)
  assert.deepEqual(locationCounts(parseCardList('4 Lightning Bolt').lines), [])
})

test('values start matched to the place of that name', () => {
  const places: StoragePlace[] = [
    { id: 'shelf', name: 'Shelf', kind: 'SHELF', createdAt: 0 },
    { id: 'red', name: 'Red box', kind: 'BOX', parentId: 'shelf', createdAt: 0 },
  ]
  const counts = [{ value: 'red box', copies: 2 }, { value: 'Shelf › Red box', copies: 1 }, { value: 'Box B', copies: 4 }, { value: '', copies: 3 }]
  const t = suggestTargets(counts, places)
  assert.deepEqual(t.get('red box'), { kind: 'place', placeId: 'red' })
  assert.deepEqual(t.get('shelf › red box'), { kind: 'place', placeId: 'red' })
  assert.deepEqual(t.get('box b'), { kind: 'new' })
  assert.deepEqual(t.get(''), { kind: 'none' })
  assert.equal(newPlaceCount(counts, t), 1)
  assert.equal(importedPlaceKind('Trade binder', null), 'BINDER')
  assert.equal(importedPlaceKind('Box B', null), 'BOX')
  assert.equal(importedPlaceKind('Cupboard', null), 'SHELF')
  assert.equal(importedPlaceKind('Krenko deck box', null), 'DECK_BOX')
  assert.equal(importedPlaceKind('Rares', 'Binder Name'), 'BINDER')
  assert.equal(importedPlaceKind('Rares', 'Location'), 'BOX')
})

test('imported copies get their places', () => {
  const pile: Collection = {
    id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED',
    entries: [entry(sol, 'Sol Ring', 6), entry(bolt, 'Lightning Bolt', 4, 1)],
    storagePlaces: [{ id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 0 }],
  }
  const placements: ImportedPlacement[] = [
    { scryfallId: sol, locations: [{ value: 'Binder 1', qty: 2, foil: false }, { value: 'Box R', qty: 4, foil: false }] },
    { scryfallId: bolt, locations: [{ value: 'box r', qty: 1, foil: true }, { value: 'Binder 1', qty: 1, foil: false }, { value: 'Trades', qty: 9, foil: false }] },
  ]
  const targets = new Map<string, PlaceTarget>([['binder 1', { kind: 'place', placeId: 'rares' }], ['box r', { kind: 'new' }], ['trades', { kind: 'none' }]])
  let n = 0
  const out = applyImportedPlaces([pile], 'unsorted', placements, targets, 'Binder Name', 50, () => `new${++n}`)
  const places = placesOf(out)
  assert.deepEqual(places.map((p) => p.name), ['Rares binder', 'Box R'])
  assert.equal(places[1].kind, 'BOX')
  assert.equal(places[1].createdAt, 50)
  const [s, b] = out[0].entries
  assert.deepEqual(s.places!.map((p) => [p.placeId, p.qty]), [['rares', 2], ['new1', 4]])
  assert.deepEqual(b.places!.map((p) => [p.placeId, p.qty, !!p.foil]), [['new1', 1, true], ['rares', 1, false]])
  // Nothing matched: nothing changes.
  assert.equal(applyImportedPlaces([pile], 'unsorted', placements, new Map(), null, 0, () => 'x')[0], pile)
})

test('the CSV export carries places and reads back where it was', () => {
  const places: StoragePlace[] = [{ id: 'red', name: 'Red box', kind: 'BOX', createdAt: 0 }, { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 0 }]
  const entries = [
    entry(sol, 'Sol Ring', 3, 1, [{ placeId: 'red', qty: 2 }, { placeId: 'rares', qty: 1, foil: true }]),
    entry(bolt, 'Lightning Bolt', 2),
  ]
  const csv = buildCardListCsv(entries, undefined, places)
  assert.ok(csv.startsWith(CARD_LIST_CSV_HEADER))
  const parsed = parseCardList(csv)
  assert.equal(parsed.locationColumn, 'Place')
  assert.deepEqual(
    parsed.lines.map((l) => [l.name, l.quantity, l.location ?? null]),
    [['Lightning Bolt', 2, null], ['Sol Ring', 2, 'Red box'], ['Sol Ring', 1, null], ['Sol Ring', 1, 'Rares binder']],
  )
  const counts = locationCounts(parsed.lines)
  const targets = suggestTargets(counts, places)
  assert.equal(newPlaceCount(counts, targets), 0)
  // Imported into an empty pile on another device that has the same places: back where they were.
  const fresh: Collection[] = [{ id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', entries: [entry(sol, 'Sol Ring', 3, 1), entry(bolt, 'Lightning Bolt', 2)], storagePlaces: places }]
  const placements = [sol, bolt].map((id) => ({
    scryfallId: id,
    locations: parsed.lines.filter((l) => l.scryfallId === id && l.location).map((l) => ({ value: l.location!, qty: l.quantity, foil: l.foil })),
  }))
  const back = applyImportedPlaces(fresh, 'unsorted', placements, targets, parsed.locationColumn, 0, () => 'x')
  assert.deepEqual(back[0].entries.map(placedCopies), entries.map(placedCopies))
})

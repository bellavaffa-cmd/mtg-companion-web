import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lastCheckedLabel, listedIn, listedWhere, markChecked, markNoPlace, reconcile, recordHere, removeMissing, type CheckScan,
} from '../../src/collection/placeCheck.ts'
import { keepLastChecked, mergePlaceLists, placesOf } from '../../src/collection/storagePlaces.ts'
import type { Collection, CollectionEntry, CopyPlace, Deck, StoragePlace } from '../../src/types/models.ts'

// Checking a place by scanning everything in it, the same on both apps. The Android app has the same
// checks — see PlaceCheckTest.kt.

const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}) })
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', sections: ['Blue', 'Red'], createdAt: 1 }
const trade: StoragePlace = { id: 'trade', name: 'Trade binder', kind: 'BINDER', createdAt: 2 }
const pile = (entries: CollectionEntry[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries, createdAt: 0, type: 'OWNED', storagePlaces: [red, trade] })
const krenko: Deck = {
  id: 'krenko', name: 'Krenko', commander: null, partnerCommander: null, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL',
  cards: [{ scryfallId: 'matron', name: 'Goblin Matron', imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null }],
} as unknown as Deck

const COLS = [pile([
  entry('bolt', 'Lightning Bolt', 2, 0, [at('red', 2, { section: 'Red' })]),
  entry('shock', 'Shock', 1, 1, [at('red', 1, { section: 'Red' }), at('red', 1, { section: 'Red', foil: true })]),
  entry('counter', 'Counterspell', 1, 0, [at('red', 1, { section: 'Blue' })]),
  entry('opt', 'Opt', 1),
  entry('abrade', 'Abrade', 1, 0, [at('trade', 1, { page: 1, slot: 1 })]),
])]
const scan = (scryfallId: string, name: string, over: Partial<CheckScan> = {}): CheckScan =>
  ({ scryfallId, name, imageUrl: null, foil: null, exact: true, ...over })
const SCOPE = { placeId: 'red', section: 'Red' }
const SCANS = [
  scan('bolt', 'Lightning Bolt'),
  // Not sure of the printing: any printing of the card listed here counts.
  scan('bolt-m10', 'Lightning Bolt', { exact: false }),
  scan('shock', 'Shock'),
  scan('counter', 'Counterspell'),
  scan('matron', 'Goblin Matron'),
  scan('opt', 'Opt'),
  scan('abrade', 'Abrade'),
  scan('x', 'Mystery Card'),
  scan('bolt', 'Lightning Bolt'),
  scan('bolt-m10', 'Lightning Bolt'),
]

test("what's listed in a section, or in the whole place", () => {
  assert.deepEqual(listedIn(COLS, SCOPE).map((l) => `${l.name}${l.line.foil ? ' foil' : ''} ×${l.qty}`), ['Lightning Bolt ×2', 'Shock ×1', 'Shock foil ×1'])
  assert.equal(listedIn(COLS, { placeId: 'red', section: null }).length, 4)
  assert.equal(listedWhere(listedIn(COLS, { placeId: 'trade', section: null })[0]), 'Page 1, slot 1')
})

test('each scan is where it should be, or says where it is listed', () => {
  const r = reconcile(COLS, [krenko], SCOPE, SCANS)
  assert.deepEqual(r.lines.map((l) => l.label), [
    // The scans sure of their printing count first: the third Bolt scanned is the one that's over.
    'belongs here', 'one more than listed here', 'belongs here', 'should be in Blue', 'listed in Krenko deck', 'no place yet',
    'listed in Trade binder', 'not in your collection', 'belongs here', 'another printing is listed here',
  ])
  assert.equal(r.expected, 4)
  assert.equal(r.here, 3)
  // The scanner couldn't tell foil, so the Shock scanned counted as the plain one; the foil wasn't scanned.
  assert.deepEqual(r.missing.map((m) => [m.name, !!m.line.foil, m.qty]), [['Shock', true, 1]])
  assert.equal(r.missingCount, 1)
  assert.equal(r.extra.length, 7)
  assert.equal(r.foilIgnored, true)
  assert.equal(r.extra.find((l) => l.kind === 'DECK')?.deckId, 'krenko')
})

test('a scan that says foil counts against the foil copies', () => {
  const r = reconcile(COLS, [], SCOPE, [scan('shock', 'Shock', { foil: true })])
  assert.deepEqual(r.missing.map((m) => [m.name, !!m.line.foil]), [['Lightning Bolt', false], ['Shock', false]])
  assert.equal(r.foilIgnored, false)
})

test('missing copies: no place yet, or out of the collection', () => {
  const { missing } = reconcile(COLS, [], SCOPE, SCANS)
  const unplaced = markNoPlace(COLS, missing)
  assert.deepEqual(unplaced[0].entries[1].places, [at('red', 1, { section: 'Red' })])
  assert.equal(unplaced[0].entries[1].foilQuantity, 1)
  const removed = removeMissing(COLS, missing)
  assert.deepEqual([removed[0].entries[1].quantity, removed[0].entries[1].foilQuantity], [1, 0])
  assert.deepEqual(removed[0].entries[1].places, [at('red', 1, { section: 'Red' })])
  // A card with no copies left goes.
  const one = [pile([entry('bolt', 'Lightning Bolt', 1, 0, [at('red', 1, { section: 'Red' })])])]
  assert.equal(removeMissing(one, reconcile(one, [], SCOPE, []).missing)[0].entries.length, 0)
})

test('recording the extra cards here: never out of a deck without asking', () => {
  const r = reconcile(COLS, [krenko], SCOPE, SCANS)
  const kept = recordHere(COLS, [krenko], SCOPE, r.extra, false)
  assert.equal(kept.recorded, 6)
  assert.equal(kept.leftInDecks, 1)
  assert.equal(kept.decks[0].cards.length, 1)
  const again = reconcile(kept.collections, kept.decks, SCOPE, SCANS)
  assert.deepEqual(again.extra.map((l) => l.label), ['listed in Krenko deck'])
  // Counterspell moved section, Abrade moved from the binder, Opt was given its place, and the card
  // not in the collection and the Bolts over were added here.
  const byId = new Map(kept.collections[0].entries.map((e) => [e.scryfallId, e]))
  assert.deepEqual(byId.get('counter')!.places, [at('red', 1, { section: 'Red' })])
  assert.deepEqual(byId.get('abrade')!.places, [at('red', 1, { section: 'Red' })])
  assert.deepEqual(byId.get('opt')!.places, [at('red', 1, { section: 'Red' })])
  assert.deepEqual([byId.get('x')!.quantity, byId.get('x')!.name], [1, 'Mystery Card'])
  assert.deepEqual([byId.get('bolt')!.quantity, byId.get('bolt')!.places], [2, [at('red', 2, { section: 'Red' })]])
  assert.deepEqual([byId.get('bolt-m10')!.quantity, byId.get('bolt-m10')!.places], [2, [at('red', 2, { section: 'Red' })]])

  const taken = recordHere(COLS, [krenko], SCOPE, r.extra, true)
  assert.equal(taken.recorded, 7)
  assert.equal(taken.leftInDecks, 0)
  assert.equal(taken.decks[0].cards.length, 0)
  const all = reconcile(taken.collections, taken.decks, SCOPE, SCANS)
  assert.equal(all.extra.length, 0)
  assert.equal(all.here, 10)
  assert.deepEqual(all.missing.map((m) => m.name), ['Shock'])
})

test('saving the results notes when the place was checked, and that only moves on', () => {
  const checked = markChecked(COLS, 'red', 1_000)
  assert.equal(placesOf(checked).find((p) => p.id === 'red')?.lastChecked, 1_000)
  assert.equal(placesOf(markChecked(checked, 'red', 500)).find((p) => p.id === 'red')?.lastChecked, 1_000)
  // Merging: the later check; a side that dropped the key (an older app) doesn't clear it.
  const b = { ...red, lastChecked: 100 }
  assert.equal(mergePlaceLists([b], [{ ...red, lastChecked: 300 }], [{ ...red, lastChecked: 200 }], false)?.[0].lastChecked, 300)
  assert.equal(mergePlaceLists([b], [b], [{ ...red, name: 'Red box, top' }], false)?.[0].lastChecked, 100)
  assert.equal(mergePlaceLists([red], [red], [red], false)?.[0].lastChecked, undefined)
  // A pile saved by an app that doesn't know about checks gets them back; one that does is left alone.
  const older = pile([])
  const healed = keepLastChecked(checked[0], older)
  assert.equal(healed.storagePlaces?.find((p) => p.id === 'red')?.lastChecked, 1_000)
  assert.equal(keepLastChecked(older, checked[0]), checked[0])
})

test('"Last checked" in words', () => {
  const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime()
  assert.equal(lastCheckedLabel(day(5, 9), day(5, 20)), 'today')
  assert.equal(lastCheckedLabel(day(4, 23), day(5, 1)), 'yesterday')
  assert.equal(lastCheckedLabel(day(2), day(5)), '3 days ago')
  assert.equal(lastCheckedLabel(day(5), day(15)), '5 Oct 2026')
})

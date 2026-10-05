import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canMoveInto, colourSection, copyKey, deletePlace, keepPlacesFromOlderApp, mergeCopyPlaces, mergePlaceLists, moveCopies,
  nextPocket, parentOf, placeAndInside, placeCopies, placeFactsOf, placePath, placeSubtitle, placeTree, placedCopies, placesOf,
  putAway, sectionsOf, cardsIn, splitPlaces, storageSummary, suggestSpot, tidyPlaces, typeSection, undoPutAway, unplacedCopies,
  whereItIs, withPlaceList, writtenWithoutPlaces, keptInLabel, placeUnplaced, keptLabel,
} from '../../src/collection/storagePlaces.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import { normalizeDeck, type Collection, type CollectionEntry, type CopyPlace, type StoragePlace } from '../../src/types/models.ts'

// Storage places: which copies are where, kept the same way on both apps. The Android app has the
// same checks — see StoragePlacesTest.kt.

const place = (id: string, over: Partial<StoragePlace> = {}): StoragePlace => ({ id, name: id, kind: 'BOX', createdAt: 1, ...over })
const entry = (id: string, quantity: number, foilQuantity = 0, places?: CopyPlace[], over: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}), ...over })
const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const pile = (entries: CollectionEntry[], places?: StoragePlace[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries, createdAt: 0, type: 'OWNED', ...(places ? { storagePlaces: places } : {}) })
const binder = (id: string, entries: CollectionEntry[]): Collection => ({ id, name: id, entries, createdAt: 5, type: 'OWNED' })

const shelf = place('shelf', { name: 'Shelf, study', kind: 'SHELF', createdAt: 1 })
const red = place('red', { name: 'Red box', parentId: 'shelf', note: 'Bulk', sortRule: 'COLOUR', createdAt: 2 })
const trade = place('trade', { name: 'Trade binder', kind: 'BINDER', parentId: 'shelf', createdAt: 3 })
const PLACES = [shelf, red, trade]

test('places nest: the tree, paths, and nothing moved inside itself', () => {
  assert.deepEqual(placeTree(PLACES).map((n) => `${n.depth}:${n.place.id}`), ['0:shelf', '1:red', '1:trade'])
  assert.equal(placePath(PLACES, 'red'), 'Shelf, study › Red box')
  assert.deepEqual([...placeAndInside(PLACES, 'shelf')].sort(), ['red', 'shelf', 'trade'])
  assert.equal(canMoveInto(PLACES, 'shelf', 'red'), false)
  assert.equal(canMoveInto(PLACES, 'red', 'trade'), true)
  assert.equal(canMoveInto(PLACES, 'red', null), true)
  // Two devices each moved one into the other: both sit at the top rather than vanishing.
  const loop = [place('a', { parentId: 'b' }), place('b', { parentId: 'a' })]
  assert.equal(parentOf(loop, 'a'), null)
  assert.equal(placeTree(loop).length, 2)
})

test('a place says what it is', () => {
  assert.equal(placeSubtitle(red), 'Bulk · by colour, then A–Z')
  assert.equal(placeSubtitle(trade), 'Binder · 9 per page')
  assert.equal(placeSubtitle(place('x', { kind: 'DECK_BOX' })), 'Deck box')
})

test('places are kept on the Unsorted pile', () => {
  const out = withPlaceList([binder('b1', [])], PLACES)
  assert.deepEqual(placesOf(out).map((p) => p.id), ['shelf', 'red', 'trade'])
  assert.equal(out.find((c) => c.id === 'unsorted')?.storagePlaces?.length, 3)
})

test('never more placed than the copies, plain and foil apart; the first lines keep theirs', () => {
  const e = entry('bolt', 2, 1)
  assert.deepEqual(tidyPlaces(e, [at('red', 1), at('trade', 2), at('red', 1, { foil: true }), at('red', 1), at('x', 0)]),
    [at('red', 2), at('red', 1, { foil: true })])
  assert.deepEqual(unplacedCopies(entry('bolt', 3, 1, [at('red', 2)])), { plain: 1, foil: 1 })
})

test('giving copies a place, moving them and taking it away', () => {
  let e = entry('bolt', 3, 0)
  e = placeCopies(e, { placeId: 'red', section: 'Red' }, 2, false).entry
  assert.deepEqual(e.places, [at('red', 2, { section: 'Red' })])
  // Only one copy is left with no place.
  assert.equal(placeCopies(e, { placeId: 'trade' }, 5, false).moved, 1)
  e = moveCopies(e, at('red', 1, { section: 'Red' }), { placeId: 'trade', page: 3, slot: 5 }, 1).entry
  assert.deepEqual(e.places, [at('red', 1, { section: 'Red' }), at('trade', 1, { page: 3, slot: 5 })])
  e = moveCopies(e, at('trade', 1, { page: 3, slot: 5 }), null, 1).entry
  // No place left for those: the key stays, so an older app's save can be told apart.
  e = moveCopies(e, at('red', 1, { section: 'Red' }), null, 1).entry
  assert.deepEqual(e.places, [])
})

test('copies moving to another binder take their places, the unplaced ones first', () => {
  const e = entry('bolt', 4, 0, [at('red', 2), at('trade', 1)])
  assert.deepEqual(splitPlaces(e, 1, 0), { staying: [at('red', 2), at('trade', 1)], going: [] })
  assert.deepEqual(splitPlaces(e, 3, 0), { staying: [at('red', 1)], going: [at('red', 1), at('trade', 1)] })
})

test('how much has a place: places, deck boxes and loans', () => {
  const collections = [
    pile([entry('bolt', 3, 0, [at('red', 2)]), entry('lent', 2, 0, undefined, { userTags: ['lent to Sam'] })], PLACES),
    binder('b1', [entry('ring', 1, 0, [at('trade', 1), at('gone', 1)]), entry('elf', 2)]),
    { ...binder('wish', [entry('want', 4)]), type: 'WISHLIST' as const },
  ]
  const decks = [
    normalizeDeck({ id: 'd1', name: 'Goblins', cards: [{ scryfallId: 'g', name: 'Goblin', imageUrl: null, quantity: 4, canBeCommander: false, typeLine: null, partnerAbility: null }] }),
    normalizeDeck({ id: 'd2', name: 'Online', ownership: 'VIRTUAL', cards: [{ scryfallId: 'g', name: 'Goblin', imageUrl: null, quantity: 4, canBeCommander: false, typeLine: null, partnerAbility: null }] }),
  ]
  const s = storageSummary(collections, decks)
  assert.deepEqual(s, { total: 12, placed: 9, unplaced: 3, inDecks: 4, lent: 2, own: { red: 2, trade: 1 } })
})

test('where a card is: places with their spot, decks, loans and no place yet', () => {
  const collections = [
    pile([entry('bolt-a', 2, 1, [at('red', 2, { section: 'Red' }), at('trade', 1, { foil: true, page: 3, slot: 5 })], { name: 'Lightning Bolt' })], PLACES),
    binder('Rares', [entry('bolt-b', 1, 0, undefined, { name: 'Lightning Bolt' })]),
  ]
  const decks = [normalizeDeck({ id: 'd1', name: 'Krenko goblins', cards: [{ scryfallId: 'bolt-a', name: 'Lightning Bolt', imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null }] })]
  const { lines, total } = whereItIs(collections, decks, 'Lightning Bolt')
  assert.equal(total, 5)
  assert.deepEqual(lines.map((l) => [l.kind, l.title, l.detail, l.qty]), [
    ['place', 'Red box › Red', 'Shelf, study · around “L”', 2],
    ['place', 'Trade binder', 'Shelf, study · Page 3, slot 5 · foil', 1],
    ['deck', 'Deck: Krenko goblins', 'In its deck box', 1],
    ['none', 'No place yet', 'In Rares', 1],
  ])
})

test('sorting rules suggest a section and a spot', () => {
  const bolt = { name: 'Lightning Bolt', colors: ['R'], typeLine: 'Instant', set: '2x2', collectorNumber: '117' }
  assert.equal(colourSection(bolt), 'Red')
  assert.equal(colourSection({ name: 'Golos', colors: [], typeLine: 'Legendary Artifact Creature' }), 'Colourless')
  assert.equal(colourSection({ name: 'Niv', colors: ['W', 'U'], typeLine: 'Creature' }), 'Multicolour')
  assert.equal(colourSection({ name: 'Dryad Arbor', colors: ['G'], typeLine: 'Land Creature — Forest Dryad' }), 'Lands')
  assert.equal(typeSection({ name: 'x', typeLine: 'Artifact Creature — Golem' }), 'Creatures')
  assert.equal(typeSection({ name: 'x', typeLine: 'Kindred Instant — Elf' }), 'Instants')
  assert.deepEqual(suggestSpot(red, bolt, []), { spot: { placeId: 'red', section: 'Red' }, hint: 'Red › around “L”' })
  assert.deepEqual(suggestSpot(place('s', { sortRule: 'SET' }), bolt, []).hint, '2X2 › around #117')
  // A–Z with letter sections: the one holding the name's letter.
  assert.deepEqual(suggestSpot(place('n', { sortRule: 'NAME', sections: ['A–F', 'G–M', 'N–Z'] }), bolt, []).hint, 'G–M › around “L”')
  // The box's own spelling of a section wins.
  assert.equal(suggestSpot(place('c', { sortRule: 'COLOUR', sections: ['RED'] }), bolt, []).spot.section, 'RED')
})

test('a binder fills pocket after pocket, page after page', () => {
  const nine = place('nine', { kind: 'BINDER' })
  assert.deepEqual(nextPocket(nine, []), { page: 1, slot: 1 })
  assert.deepEqual(nextPocket(nine, [pile([entry('a', 1, 0, [at('nine', 1, { page: 1, slot: 9 })])])]), { page: 2, slot: 1 })
  assert.deepEqual(nextPocket(nine, [pile([entry('a', 2, 0, [at('nine', 1, { page: 2, slot: 3 }), at('nine', 1, { page: 1, slot: 8 })])])]), { page: 2, slot: 4 })
})

test("a box's sections: its own in order, then others used, then copies in none", () => {
  const box = place('box', { sections: ['White', 'Blue'] })
  const collections = [pile([entry('a', 3, 0, [at('box', 1, { section: 'Blue' }), at('box', 1, { section: 'Lands' }), at('box', 1)])])]
  assert.deepEqual(sectionsOf(box, cardsIn(collections, 'box')).map((s) => [s.name, s.copies]), [['White', 0], ['Blue', 1], ['Lands', 1], [null, 1]])
})

const newEntry = (id: string, name = id): CollectionEntry => ({ scryfallId: id, name, imageUrl: null, quantity: 0, foilQuantity: 0 })

test('putting away: a copy with no place first, the Unsorted pile before binders', () => {
  const collections = [binder('b1', [entry('bolt', 1)]), pile([entry('bolt', 1)], PLACES)]
  const out = putAway(collections, { id: 'bolt', name: 'bolt' }, { placeId: 'red', section: 'Red' }, newEntry('bolt'))
  assert.equal(out.result, 'placed')
  assert.equal(out.label, 'moved from Unsorted')
  assert.deepEqual(out.collections[1].entries[0].places, [at('red', 1, { section: 'Red' })])
  assert.equal(out.collections[0].entries[0].places, undefined)
  // Undo takes the place away again.
  assert.deepEqual(undoPutAway(out.collections, out.step!)[1].entries[0].places, [])
})

test('putting away: another printing of the card counts, after the same printing', () => {
  const collections = [pile([entry('bolt-old', 1, 0, undefined, { name: 'Lightning Bolt' })], PLACES)]
  const out = putAway(collections, { id: 'bolt-new', name: 'Lightning Bolt' }, { placeId: 'red' }, newEntry('bolt-new', 'Lightning Bolt'))
  assert.equal(out.result, 'placed')
  assert.equal(out.step?.scryfallId, 'bolt-old')
})

test('putting away: a copy kept elsewhere moves here, and Undo moves it back', () => {
  const collections = [pile([entry('bolt', 1, 0, [at('trade', 1, { page: 1, slot: 1 })])], PLACES)]
  const out = putAway(collections, { id: 'bolt', name: 'bolt' }, { placeId: 'red', section: 'Red' }, newEntry('bolt'))
  assert.equal(out.result, 'moved')
  assert.equal(out.label, 'moved from Trade binder')
  assert.deepEqual(out.collections[0].entries[0].places, [at('red', 1, { section: 'Red' })])
  assert.deepEqual(undoPutAway(out.collections, out.step!)[0].entries[0].places, [at('trade', 1, { page: 1, slot: 1 })])
})

test('putting away: already here, or new to the collection (and Undo takes the new one out)', () => {
  const here = [pile([entry('bolt', 1, 0, [at('red', 1)])], PLACES)]
  assert.equal(putAway(here, { id: 'bolt', name: 'bolt' }, { placeId: 'red' }, newEntry('bolt')).result, 'here')
  const out = putAway([pile([], PLACES)], { id: 'elf', name: 'Llanowar Elves' }, { placeId: 'red', section: 'Green' }, newEntry('elf', 'Llanowar Elves'))
  assert.equal(out.result, 'new')
  assert.equal(out.label, 'new to collection')
  assert.deepEqual(out.collections[0].entries, [{ ...newEntry('elf', 'Llanowar Elves'), quantity: 1, places: [at('red', 1, { section: 'Green' })] }])
  assert.deepEqual(undoPutAway(out.collections, out.step!)[0].entries, [])
})

test('putting away never takes a copy from a deck: a card only in a deck is a new copy', () => {
  const out = putAway([pile([], PLACES)], { id: 'g', name: 'Goblin' }, { placeId: 'red' }, newEntry('g', 'Goblin'))
  assert.equal(out.result, 'new')
})

test('deleting a place: its copies have no place, the places inside move up', () => {
  const collections = [pile([entry('bolt', 2, 0, [at('red', 1), at('shelf', 1)])], PLACES)]
  const out = deletePlace(collections, 'shelf')
  assert.deepEqual(placesOf(out).map((p) => [p.id, p.parentId ?? null]), [['red', null], ['trade', null]])
  assert.deepEqual(out[0].entries[0].places, [at('red', 1)])
})

test('merging places line by line: additions kept, removals stay, counts add up', () => {
  const base = [at('red', 1), at('trade', 1)]
  const mine = [at('red', 2), at('trade', 1), at('shelf', 1)]
  const theirs = [at('red', 2), at('box', 1)]
  assert.deepEqual(mergeCopyPlaces(base, mine, theirs), [at('red', 3), at('box', 1), at('shelf', 1)])
  assert.equal(mergeCopyPlaces(undefined, undefined, undefined), undefined)
  assert.equal(copyKey(at('red', 1, { foil: true, page: 2, slot: 3 })), 'red|foil||2|3')
})

test('merging the places themselves: fields go to whoever changed them, deletions stay', () => {
  const base = [red, trade]
  const mine = [{ ...red, name: 'Big red box' }, trade, shelf]
  const theirs = [{ ...red, sortRule: 'NAME' as const }]
  assert.deepEqual(mergePlaceLists(base, mine, theirs, true), [{ ...red, name: 'Big red box', sortRule: 'NAME' }, shelf])
})

test('a binder merge keeps each side\'s places and no more than the copies', () => {
  const base = pile([entry('bolt', 2, 0, [at('red', 1)])], [red])
  const mine = pile([entry('bolt', 2, 0, [at('red', 2)])], [red, trade])
  const theirs = pile([entry('bolt', 1, 0, [at('red', 1)])], [red])
  const merged = mergeCollection(base, mine, theirs, true)
  assert.deepEqual(merged.entries[0], entry('bolt', 1, 0, [at('red', 1)]))
  assert.deepEqual(merged.storagePlaces?.map((p) => p.id), ['red', 'trade'])
})

test('an older app\'s save, without the places, leaves them as they were', () => {
  const withPlaces = pile([entry('bolt', 2, 0, [at('red', 2)]), entry('elf', 1)], [red])
  // The older app dropped the keys and added a card.
  const older = pile([entry('bolt', 2), entry('elf', 1), entry('ring', 1)])
  assert.equal(writtenWithoutPlaces(older), true)
  assert.equal(writtenWithoutPlaces(withPlaces), false)
  const kept = keepPlacesFromOlderApp(withPlaces, older)
  assert.deepEqual(kept.storagePlaces, [red])
  assert.deepEqual(kept.entries.map((e) => e.places), [[at('red', 2)], undefined, undefined])
  // A merge treats the older side as not having changed them.
  const merged = mergeCollection(withPlaces, withPlaces, older, false)
  assert.deepEqual(merged.entries.map((e) => e.places), [[at('red', 2)], undefined, undefined])
  assert.deepEqual(merged.storagePlaces, [red])
  // A save that knows about places and cleared them is believed.
  const cleared = pile([entry('bolt', 2, 0, [])], [])
  assert.equal(keepPlacesFromOlderApp(withPlaces, cleared), cleared)
})

test('the Place filter: places holding copies, with the places they sit in, and copies with none', () => {
  assert.deepEqual(placeFactsOf(entry('bolt', 3, 0, [at('red', 1), at('gone', 1)]), PLACES), { places: ['shelf', 'red'], unplaced: 2 })
  assert.deepEqual(placeFactsOf(entry('lent', 2, 0, undefined, { userTags: ['Lent to Sam'] }), PLACES), { places: [], unplaced: 0 })
  assert.deepEqual(placedCopies(entry('x', 1, 0, [at('red', 5)])), [at('red', 1)])
})

test('where a printing is kept, short, for beside "In 2 decks and 1 binder"', () => {
  const collections = [
    pile([entry('bolt', 3, 0, [at('red', 2), at('trade', 1, { page: 1, slot: 1 })])], PLACES),
    binder('b1', [entry('bolt', 1, 0, [at('red', 1)]), entry('ring', 1)]),
  ]
  assert.equal(keptInLabel(collections, 'bolt'), 'Red box ×3 · Trade binder ×1')
  assert.equal(keptInLabel(collections, 'ring'), '')
  assert.equal(keptLabel(entry('bolt', 3, 0, [at('red', 2), at('gone', 1)]), PLACES), 'Red box ×2')
})

test('giving a card a place: that printing first, the Unsorted pile first, plain before foil, never a lent copy', () => {
  const collections = [
    binder('b1', [entry('bolt-a', 1, 0, undefined, { name: 'Lightning Bolt' })]),
    pile([
      entry('bolt-b', 1, 1, undefined, { name: 'Lightning Bolt' }),
      entry('bolt-a', 1, 0, undefined, { name: 'Lightning Bolt', userTags: ['lent to Sam'] }),
    ], PLACES),
  ]
  const out = placeUnplaced(collections, 'Lightning Bolt', 'bolt-a', { placeId: 'red' }, 3)
  assert.equal(out.moved, 3)
  assert.deepEqual(out.collections[0].entries[0].places, [at('red', 1)])
  assert.deepEqual(out.collections[1].entries[0].places, [at('red', 1), at('red', 1, { foil: true })])
  assert.equal(out.collections[1].entries[1].places, undefined)
  assert.equal(placeUnplaced(out.collections, 'Lightning Bolt', null, { placeId: 'red' }, 1).moved, 0)
})

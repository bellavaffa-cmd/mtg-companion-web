import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  binderKeys, bindersByPlace, bindersIn, chipDescription, chipText, collectionRoute, COLLECTION_TABS, entryChips, findChipDescription,
  groupByOf, groupLayout, inBindersLine, keptInPlacesLine, locationIndex, moreChipsDescription, needsAttentionLabel, NO_PLACE_TITLE,
  passesQuick, placeKeys, placesUsed, QUICK_FILTERS, QUICK_LABELS, quickCount, quickOf, quickSets, setGroupDetail, setKeys, shownChips,
  startTab, TAB_LABELS, type QuickFilter,
} from '../../src/collection/collectionLayout.ts'
import { lentByEntry, lentCopies } from '../../src/collection/storagePlaces.ts'
import { normalizeDeck } from '../../src/types/models.ts'
import type { Collection, CollectionEntry, CopyPlace, DeckCardEntry, StoragePlace } from '../../src/types/models.ts'

// The Collection's layout: the tabs and old routes, the location chips on a card row, Group by, the
// quick filters and the Binders / Storage counts. The Android app has the same cases — see
// CollectionLayoutTest.kt.

const entry = (id: string, name: string, quantity: number, more: Partial<CollectionEntry> = {}, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity: 0, ...more, ...(places ? { places } : {}) })
const card = (id: string, name: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })

const placesList: StoragePlace[] = [
  { id: 'shelf', name: 'Shelf', kind: 'SHELF', createdAt: 1 },
  { id: 'blue', name: 'Blue box', kind: 'BOX', parentId: 'shelf', createdAt: 1 },
  { id: 'trade', name: 'Trade binder', kind: 'BINDER', createdAt: 1 },
]
const pile: Collection = {
  id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED',
  entries: [
    // 2 in the Blue box's Instants, 1 lent to Sam, 1 with no place.
    entry('opt', 'Opt', 4, {}, [{ placeId: 'blue', qty: 2, section: 'Instants' }]),
    entry('bolt', 'Lightning Bolt', 3, { forSale: 1 }),
    entry('elf', 'Llanowar Elves', 1, { userTags: ['lent to Priya'] }),
  ],
  storagePlaces: placesList,
  graded: [{ id: 'g1', scryfallId: 'ring2', name: 'Sol Ring', company: 'PSA', grade: '9', createdAt: 1 }],
  loans: [{ id: 'l1', to: 'Sam', cards: [{ name: 'Opt', scryfallId: 'opt', qty: 1, collectionId: 'unsorted' }], lentAt: 1 }],
}
const trades: Collection = {
  id: 'trades', name: 'Trades', createdAt: 0, type: 'OWNED',
  entries: [
    entry('opt', 'Opt', 1, {}, [{ placeId: 'trade', qty: 1, page: 3, slot: 2 }]),
    entry('ring', 'Sol Ring', 1, {}, [{ placeId: 'blue', qty: 1, section: 'Artifacts' }]),
  ],
}
const wishlist: Collection = { id: 'wishlist', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries: [entry('mox', 'Mox Opal', 1)] }
const talrand = normalizeDeck({ id: 'talrand', name: 'Talrand', cards: [card('opt', 'Opt'), card('ring', 'Sol Ring')], ownership: 'PHYSICAL', createdAt: 1 })
const library = [pile, trades, wishlist]
const index = locationIndex(library, [talrand])
const chipsOf = (id: string) => index.get(id) ?? []

test('old routes map onto the four tabs', () => {
  assert.deepEqual(collectionRoute('all'), { tab: 'cards' })
  assert.deepEqual(collectionRoute('cards'), { tab: 'cards' })
  assert.deepEqual(collectionRoute('sets'), { tab: 'cards', group: 'set' })
  assert.deepEqual(collectionRoute('binders'), { tab: 'binders' })
  assert.deepEqual(collectionRoute('storage'), { tab: 'storage' })
  assert.deepEqual(collectionRoute('sealed'), { tab: 'storage' })
  assert.deepEqual(collectionRoute('wishlist'), { tab: 'wishlist' })
  assert.deepEqual(collectionRoute('loans'), { tab: 'cards', quick: 'lent' })
  assert.deepEqual(collectionRoute('sell'), { tab: 'cards', quick: 'sale' })
  assert.deepEqual(collectionRoute('graded'), { tab: 'cards', quick: 'graded' })
  assert.deepEqual(collectionRoute('shared'), { tab: 'cards', shared: true })
  assert.equal(collectionRoute(null), null)
  assert.equal(collectionRoute('nonsense'), null)
  // No tab said: the one used last, else Cards.
  assert.equal(startTab(null, 'storage'), 'storage')
  assert.equal(startTab(null, null), 'cards')
  assert.equal(startTab(null, 'sets'), 'cards')
  assert.equal(startTab(collectionRoute('wishlist'), 'storage'), 'wishlist')
  assert.deepEqual(COLLECTION_TABS.map((t) => TAB_LABELS[t]), ['Cards', 'Binders', 'Storage', 'Wishlist'])
})

test("a printing's chips: places, decks, loans, no place", () => {
  const opt = chipsOf('opt')
  assert.deepEqual(opt.map(chipText), ['Blue box › Instants ×2', 'Trade binder ×1', 'Talrand deck ×1', 'Lent to Sam ×1', 'No place yet · Put away'])
  assert.deepEqual(opt.map(chipDescription), [
    'Stored in Blue box, Instants section, 2 copies',
    'Stored in Trade binder, page 3, 1 copy',
    'In Talrand deck, 1 copy',
    'Lent to Sam, 1 copy',
    'No place yet, 1 copy. Put away',
  ])
  assert.equal(opt[0].placeId, 'blue')
  assert.equal(opt[0].section, 'Instants')
  assert.equal(opt[1].page, 3)
  assert.equal(opt[2].deckId, 'talrand')
  // A copy tagged "lent …" with no loan is lent out, not unplaced.
  assert.deepEqual(chipsOf('elf').map(chipText), ['Lent out ×1'])
  assert.deepEqual(chipsOf('bolt').map(chipText), ['No place yet · Put away'])
  assert.deepEqual(chipsOf('ring').map(chipText), ['Blue box › Artifacts ×1', 'Talrand deck ×1'])
  // The wishlist's cards aren't owned; a slab has no chip.
  assert.equal(index.has('mox'), false)
  assert.equal(index.has('ring2'), false)
})

test('a row shows two chips then +N, the amber one always', () => {
  const { shown, more } = shownChips(chipsOf('opt'))
  assert.deepEqual(shown.map(chipText), ['Blue box › Instants ×2', 'No place yet · Put away'])
  assert.equal(more, 3)
  const ring = shownChips(chipsOf('ring'))
  assert.equal(ring.shown.length, 2)
  assert.equal(ring.more, 0)
  assert.equal(moreChipsDescription(3), '3 more places')
  assert.equal(moreChipsDescription(1), '1 more place')
  assert.deepEqual(shownChips([]), { shown: [], more: 0 })
})

test("a binder entry's own chips", () => {
  const byId = new Map(placesList.map((p) => [p.id, p]))
  const lent = lentByEntry(lentCopies(library, [talrand]))
  assert.deepEqual(entryChips('unsorted', pile.entries[0], byId, lent).map(chipText), ['Blue box › Instants ×2', 'No place yet · Put away'])
  assert.deepEqual(entryChips('trades', trades.entries[0], byId, lent).map(chipText), ['Trade binder ×1'])
  assert.deepEqual(entryChips('x', entry('z', 'Z', 0), byId, lent), [])
})

test('group by set, binder and place', () => {
  const cards = ['opt', 'bolt', 'ring', 'elf']
  const sets: Record<string, { code: string; name: string }> = { opt: { code: 'm19', name: 'Core Set 2019' }, bolt: { code: 'm10', name: 'Magic 2010' }, ring: { code: 'c21', name: '' } }
  const bySet = groupLayout(cards, (c) => setKeys(sets[c]), 'Set not known yet', (code) => (code === 'm19' ? setGroupDetail(41, 92) : setGroupDetail(1, 0)))
  assert.deepEqual(bySet.map((g) => g.title), ['C21', 'Core Set 2019', 'Magic 2010', 'Set not known yet'])
  assert.equal(bySet[1].detail, '41/92')
  assert.equal(bySet[0].detail, '1')
  assert.equal(bySet[3].detail, null)
  assert.deepEqual(bySet[3].items, ['elf'])

  const byPlace = groupLayout(cards, (c) => placeKeys(chipsOf(c)), NO_PLACE_TITLE)
  assert.deepEqual(byPlace.map((g) => g.title), ['Blue box', 'Lent out', 'Talrand deck', 'Trade binder', 'No place yet'])
  assert.deepEqual(byPlace[0].items, ['opt', 'ring'])
  assert.deepEqual(byPlace[1].items, ['opt', 'elf'])
  assert.deepEqual(byPlace[4].items, ['opt', 'bolt'])

  const sources: Record<string, { kind: 'binder' | 'deck'; id: string; name: string }[]> = {
    opt: [{ kind: 'binder', id: 'unsorted', name: 'Unsorted' }, { kind: 'binder', id: 'trades', name: 'Trades' }, { kind: 'deck', id: 'talrand', name: 'Talrand' }],
    ring: [{ kind: 'binder', id: 'trades', name: 'Trades' }],
  }
  const byBinder = groupLayout(['opt', 'ring'], (c) => binderKeys(sources[c] ?? []), 'No binder')
  assert.deepEqual(byBinder.map((g) => g.title), ['Talrand deck', 'Trades', 'Unsorted'])
  assert.deepEqual(byBinder[1].items, ['opt', 'ring'])
})

test('quick filters', () => {
  const sets = quickSets(library, index)
  const cards = [{ scryfallId: 'opt', name: 'Opt' }, { scryfallId: 'bolt', name: 'Lightning Bolt' }, { scryfallId: 'ring', name: 'Sol Ring' }, { scryfallId: 'elf', name: 'Llanowar Elves' }]
  const kept = (q: QuickFilter | null) => cards.filter((c) => passesQuick(q, c.scryfallId, c.name, sets)).map((c) => c.scryfallId)
  assert.deepEqual(kept('lent'), ['opt', 'elf'])
  assert.deepEqual(kept('sale'), ['bolt'])
  assert.deepEqual(kept('noplace'), ['opt', 'bolt'])
  // The slab is another printing of Sol Ring: the raw one shows.
  assert.deepEqual(kept('graded'), ['ring'])
  assert.deepEqual(kept(null), cards.map((c) => c.scryfallId))
  assert.equal(quickCount('noplace', cards, sets), 2)
  assert.equal(quickOf('sale'), 'sale')
  assert.deepEqual(QUICK_FILTERS.map((q) => QUICK_LABELS[q]), ['Lent out', 'For sale', 'No place yet', 'Graded'])
})

test('binders kept in places, places in binders, needs attention', () => {
  const known = new Set(placesList.map((p) => p.id))
  assert.equal(placesUsed(pile, known), 1)
  assert.equal(placesUsed(trades, known), 2)
  assert.equal(keptInPlacesLine(2, 2), 'kept in 2 places')
  assert.equal(keptInPlacesLine(1, 9), 'kept in 1 place')
  assert.equal(keptInPlacesLine(0, 3), 'no place yet')
  assert.equal(keptInPlacesLine(0, 0), '')
  const byPlace = bindersByPlace(library)
  // The Unsorted pile isn't a binder: only Trades counts.
  assert.equal(bindersIn(byPlace, placesList, 'shelf'), 1)
  assert.equal(bindersIn(byPlace, placesList, 'trade'), 1)
  assert.equal(inBindersLine(1), 'in 1 binder')
  assert.equal(inBindersLine(3), 'in 3 binders')
  assert.equal(inBindersLine(0), '')
  assert.equal(needsAttentionLabel(3), 'Needs attention · 3')
  assert.equal(needsAttentionLabel(0), null)
  assert.equal(groupByOf('nope'), 'none')
})

test('find anything chips say themselves the same way', () => {
  assert.equal(findChipDescription({ kind: 'place', label: 'Red box › Colourless', qty: 1, placeId: 'red' }), 'Stored in Red box, Colourless section, 1 copy')
  assert.equal(findChipDescription({ kind: 'place', label: 'Shelf', qty: 3 }), 'Stored in Shelf, 3 copies')
  assert.equal(findChipDescription({ kind: 'deck', label: 'Atraxa deck', qty: 1 }), 'In Atraxa deck, 1 copy')
  assert.equal(findChipDescription({ kind: 'lent', label: 'Lent to Sam', qty: 2 }), 'Lent to Sam, 2 copies')
  assert.equal(findChipDescription({ kind: 'none', label: 'No place', qty: 1 }), 'No place yet, 1 copy')
})

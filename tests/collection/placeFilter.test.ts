import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cardsFilterActive, cardsFilterChips, cardsFilterCount, copyChip, copyMatches, filterCopies, filterIn, filterTotals, matchingPages, matchingPockets,
  NO_CARDS_FILTER, placedCopyUsd, removeCardsFilterChip, STORAGE_FILTER_KEY, storageMatchingTitle, totalsLine, withFilter,
  type CardsFilter, type FilterFacts, type FilterMemory,
} from '../../src/collection/placeFilter.ts'
import { advancedFactsOf, chipText as filterChipText, copyFactsOf, NO_ADVANCED_FILTER, type AdvancedFilter } from '../../src/collection/advancedFilter.ts'
import { NO_COLLECTION_FILTER, type CardFacts, type CollectionFilter } from '../../src/collection/cardFilter.ts'
import { copiesByPlace, walkingOrder, walkPullList } from '../../src/collection/pullList.ts'
import { cardsIn, placeChains, placesOf, type PlacedCard } from '../../src/collection/storagePlaces.ts'
import { chipText } from '../../src/collection/collectionLayout.ts'
import { namesDecksUse } from '../../src/collection/spares.ts'
import { normalizeDeck, type Collection, type CollectionEntry, type CopyPlace, type StoragePlace } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Filtering what's in storage — a place's page and the Storage tab — with the Cards tab's filters,
// copy by copy. The Android app has the same checks: PlaceFilterTest.kt.

const place = (id: string, over: Partial<StoragePlace> = {}): StoragePlace => ({ id, name: id, kind: 'BOX', createdAt: 1, ...over })
const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const entry = (id: string, name: string, quantity: number, foilQuantity: number, places: CopyPlace[], over: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, places, ...over })

const shelf = place('shelf', { name: 'Shelf, study', kind: 'SHELF', createdAt: 1 })
const red = place('red', { name: 'Red box', parentId: 'shelf', sortRule: 'COLOUR', sections: ['White', 'Blue', 'Red'], createdAt: 2 })
const rares = place('rares', { name: 'Rares binder', kind: 'BINDER', parentId: 'shelf', pocketsPerPage: 9, createdAt: 3 })

const COLLECTIONS: Collection[] = [
  {
    id: 'unsorted', name: 'Unsorted', type: 'OWNED', createdAt: 0, storagePlaces: [shelf, red, rares],
    entries: [entry('sr', 'Sol Ring', 1, 0, [])],
  },
  {
    id: 'b1', name: 'Trade binder', type: 'OWNED', createdAt: 5,
    entries: [
      entry('bolt', 'Lightning Bolt', 2, 1, [at('red', 2, { section: 'Red' }), at('rares', 1, { foil: true, page: 1, slot: 2 })]),
      entry('gg', 'Goblin Guide', 1, 0, [at('red', 1, { section: 'Red' })], { condition: 'LP' }),
      entry('cs', 'Counterspell', 1, 0, [at('red', 1, { section: 'Blue' })], { language: 'ja' }),
      entry('atx', 'Atraxa, Praetors\' Voice', 1, 0, [at('rares', 1, { page: 2, slot: 1 })]),
    ],
  },
]
const DECKS = [normalizeDeck({ id: 'd', name: 'Burn', ownership: 'PHYSICAL', createdAt: 1, cards: [{ scryfallId: 'bolt2', name: 'Lightning Bolt', imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null }] })]

const PLACES = placesOf(COLLECTIONS)
const RED = cardsIn(COLLECTIONS, 'red')
const RARES = cardsIn(COLLECTIONS, 'rares')
const ALL = [...RED, ...RARES]
const ATRAXA = RARES.find((c) => c.entry.scryfallId === 'atx')!
const BOLT_FOIL = RARES.find((c) => c.entry.scryfallId === 'bolt')!

const card = (over: Partial<ScryfallCard>): ScryfallCard => ({ id: 'x', name: 'X', ...over }) as ScryfallCard
const DATA = new Map<string, ScryfallCard>([
  ['bolt', card({ id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', rarity: 'common', color_identity: ['R'], colors: ['R'], oracle_text: 'Lightning Bolt deals 3 damage to any target.', prices: { usd: '2.50', usd_foil: '9.00' }, finishes: ['nonfoil', 'foil'] })],
  ['gg', card({ id: 'gg', name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', rarity: 'rare', color_identity: ['R'], colors: ['R'], power: '2', toughness: '2', prices: { usd: '3.00' } })],
  ['cs', card({ id: 'cs', name: 'Counterspell', type_line: 'Instant', rarity: 'uncommon', color_identity: ['U'], colors: ['U'], oracle_text: 'Counter target spell.', prices: { usd: '1.00' } })],
  ['atx', card({ id: 'atx', name: 'Atraxa, Praetors\' Voice', type_line: 'Legendary Creature — Phyrexian Angel Horror', rarity: 'mythic', color_identity: ['W', 'U', 'B', 'G'], colors: ['W', 'U', 'B', 'G'], prices: { usd: '20.00' } })],
])
const cardFacts = (id: string): CardFacts | undefined => {
  const c = DATA.get(id)
  return c ? { colors: new Set(c.color_identity ?? []), typeLine: c.type_line ?? '', rarity: c.rarity ?? '', text: c.oracle_text ?? '' } : undefined
}
const FACTS: FilterFacts = {
  card: cardFacts,
  advanced: (id) => { const c = DATA.get(id); return c ? advancedFactsOf(c) : undefined },
  copies: copyFactsOf(COLLECTIONS, DECKS),
  chains: placeChains(PLACES),
  usedNames: namesDecksUse(DECKS),
}

const f = (over: Partial<CardsFilter> = {}): CardsFilter => ({ ...NO_CARDS_FILTER, ...over })
const basic = (over: Partial<CollectionFilter>): CollectionFilter => ({ ...NO_COLLECTION_FILTER, ...over })
const adv = (over: Partial<AdvancedFilter>): AdvancedFilter => ({ ...NO_ADVANCED_FILTER, ...over })
const names = (copies: PlacedCard[]) => copies.map((c) => `${c.entry.name}${c.line.foil ? ' (foil)' : ''} ×${c.line.qty}`)

test('nothing on: every copy, and the filter is off', () => {
  assert.equal(cardsFilterActive(NO_CARDS_FILTER), false)
  assert.equal(cardsFilterCount(NO_CARDS_FILTER), 0)
  assert.equal(filterCopies(ALL, NO_CARDS_FILTER, FACTS), ALL)
})

test('the search finds copies by name', () => {
  assert.deepEqual(names(filterCopies(ALL, f({ query: ' bolt ' }), FACTS)), ['Lightning Bolt ×2', 'Lightning Bolt (foil) ×1'])
  assert.equal(cardsFilterCount(f({ query: 'bolt' })), 0, 'the search is not a filter on the badge')
  // As Cards searches, when the page gives it the tags too.
  const byTag: FilterFacts = { ...FACTS, searchMatches: (c, q) => q === 'burn' && c.entry.name === 'Lightning Bolt' }
  assert.deepEqual(names(filterCopies(RED, f({ query: 'burn' }), byTag)), ['Lightning Bolt ×2'])
})

test('the filter panel: type, text, colours and rarity, as on Cards', () => {
  assert.deepEqual(names(filterCopies(RED, f({ basic: basic({ type: 'instant' }) }), FACTS)), ['Counterspell ×1', 'Lightning Bolt ×2'])
  assert.deepEqual(names(filterCopies(ALL, f({ basic: basic({ colors: ['R'] }) }), FACTS)), ['Goblin Guide ×1', 'Lightning Bolt ×2', 'Lightning Bolt (foil) ×1'])
  assert.deepEqual(names(filterCopies(ALL, f({ basic: basic({ rarities: ['mythic', 'uncommon'] }) }), FACTS)), ['Counterspell ×1', 'Atraxa, Praetors\' Voice ×1'])
  assert.deepEqual(names(filterCopies(ALL, f({ basic: basic({ text: 'counter target' }) }), FACTS)), ['Counterspell ×1'])
  // A card whose data hasn't loaded can't be judged: left out while a filter is on.
  const none: FilterFacts = { ...FACTS, card: () => undefined }
  assert.deepEqual(filterCopies(ALL, f({ basic: basic({ type: 'instant' }) }), none), [])
})

test('Your copies are judged copy by copy: the foil here, the LP one, the Japanese one', () => {
  assert.deepEqual(names(filterCopies(ALL, f({ advanced: adv({ finishes: ['foil'] }) }), FACTS)), ['Lightning Bolt (foil) ×1'])
  assert.deepEqual(names(filterCopies(ALL, f({ advanced: adv({ finishes: ['nonfoil'] }) }), FACTS)), ['Counterspell ×1', 'Goblin Guide ×1', 'Lightning Bolt ×2', 'Atraxa, Praetors\' Voice ×1'])
  assert.deepEqual(names(filterCopies(ALL, f({ advanced: adv({ conditions: ['LP'] }) }), FACTS)), ['Goblin Guide ×1'])
  assert.deepEqual(names(filterCopies(ALL, f({ advanced: adv({ language: 'ja' }) }), FACTS)), ['Counterspell ×1'])
  assert.deepEqual(names(filterCopies(ALL, f({ advanced: adv({ binder: 'b1' }) }), FACTS)).length, 5)
  // A place: the copies in it, and in the places inside it.
  assert.deepEqual(names(filterCopies(ALL, f({ advanced: adv({ place: 'rares' }) }), FACTS)), ['Atraxa, Praetors\' Voice ×1', 'Lightning Bolt (foil) ×1'])
  assert.equal(filterCopies(ALL, f({ advanced: adv({ place: 'shelf' }) }), FACTS).length, ALL.length)
  // Every copy in a place has one.
  assert.deepEqual(filterCopies(ALL, f({ advanced: adv({ place: 'none' }) }), FACTS), [])
  // The card's copies everywhere: Bolt has 3 in binders and 1 in a deck.
  assert.deepEqual(names(filterCopies(ALL, f({ advanced: adv({ copiesOp: '>=', copies: '3' }) }), FACTS)), ['Lightning Bolt ×2', 'Lightning Bolt (foil) ×1'])
})

test('a price filter judges a foil copy by its foil price', () => {
  const over5 = f({ advanced: adv({ priceMin: '5' }) })
  assert.deepEqual(names(filterCopies(ALL, over5, FACTS)), ['Atraxa, Praetors\' Voice ×1', 'Lightning Bolt (foil) ×1'])
})

test('Spares only: copies of cards none of your decks use', () => {
  assert.deepEqual(names(filterCopies(RED, f({ sparesOnly: true }), FACTS)), ['Counterspell ×1', 'Goblin Guide ×1'])
  assert.equal(cardsFilterCount(f({ sparesOnly: true })), 1)
  assert.equal(copyMatches(f({ sparesOnly: true }), RED[0], { ...FACTS, usedNames: undefined }), false)
})

test('the totals: matching copies of all, and what the matching ones are worth', () => {
  const price = (c: PlacedCard) => { const k = DATA.get(c.entry.scryfallId); return placedCopyUsd(c, Number(k?.prices?.usd) || null, Number(k?.prices?.usd_foil) || null) }
  const matching = filterCopies(ALL, f({ basic: basic({ colors: ['R'] }) }), FACTS)
  const t = filterTotals(ALL, matching, price)
  assert.deepEqual(t, { matching: 4, total: 6, usd: 2.5 * 2 + 3 + 9 })
  assert.equal(totalsLine(t, (n) => `$${Math.round(n)}`), '4 of 6 cards · $17')
  assert.equal(totalsLine(filterTotals(ALL, matching, null), (n) => `$${n}`), '4 of 6 cards')
  assert.equal(totalsLine({ matching: 1, total: 1, usd: null }, String), '1 of 1 card')
  assert.equal(totalsLine({ matching: 14, total: 1312, usd: null }, String), '14 of 1,312 cards')
  // A foil copy with no foil price is priced as a plain one, and the other way round.
  assert.equal(placedCopyUsd(BOLT_FOIL, 2, null), 2)
  assert.equal(placedCopyUsd(RED[0], null, 4), 4)
  assert.equal(placedCopyUsd(RED[0], null, null), null)
})

test('the chips: the search, each filter, Spares only — each comes off, and one Clear', () => {
  const on = f({ query: 'bolt', basic: basic({ type: 'instant', colors: ['R'] }), advanced: adv({ finishes: ['foil'] }), sparesOnly: true })
  const chips = cardsFilterChips(on, { binderName: () => undefined, formatLocal: (n) => `$${n}` })
  assert.deepEqual(chips.map(filterChipText), ['“bolt”', 'Instant', 'Colour R', 'Foil', 'Spares only'])
  assert.equal(removeCardsFilterChip(on, 'search').query, '')
  assert.equal(removeCardsFilterChip(on, 'spares').sparesOnly, false)
  assert.deepEqual(removeCardsFilterChip(on, 'color:R').basic.colors, [])
  assert.deepEqual(removeCardsFilterChip(on, 'finish:foil').advanced.finishes, [])
  assert.equal(cardsFilterCount(on), 4)
})

test('a binder: the pockets and pages with a match', () => {
  const matching = filterCopies(RARES, f({ query: 'atraxa' }), FACTS)
  assert.deepEqual([...matchingPockets(rares, RARES, matching)], [9])
  assert.deepEqual(matchingPages(rares, RARES, filterCopies(RARES, f({ basic: basic({ rarities: ['common', 'mythic'] }) }), FACTS)), [1, 2])
  assert.deepEqual([...matchingPockets(rares, RARES, [])], [])
})

test("the Storage tab's heading", () => {
  assert.equal(storageMatchingTitle(f({ query: 'ramp' })), 'Cards in storage matching “ramp”')
  assert.equal(storageMatchingTitle(f({ query: 'ramp', basic: basic({ colors: ['G', 'U'] }) })), 'Cards in storage matching “ramp” · 2 filters')
  assert.equal(storageMatchingTitle(f({ sparesOnly: true })), 'Cards in storage matching your filter')
  assert.equal(storageMatchingTitle(f({ sparesOnly: true, basic: basic({ type: 'land' }) })), 'Cards in storage matching your filters')
})

test("results grouped by place › section in walking order, each row's place chip", () => {
  const groups = copiesByPlace([...ALL].reverse(), PLACES)
  assert.deepEqual(groups.map((g) => `${g.title} (${g.detail}): ${names(g.copies).join(', ')}`), [
    'Red box › Blue (Shelf, study): Counterspell ×1',
    'Red box › Red (Shelf, study): Goblin Guide ×1, Lightning Bolt ×2',
    'Rares binder (Shelf, study): Lightning Bolt (foil) ×1, Atraxa, Praetors\' Voice ×1',
  ])
  assert.deepEqual(names(walkingOrder(ALL, PLACES)), ['Counterspell ×1', 'Goblin Guide ×1', 'Lightning Bolt ×2', 'Lightning Bolt (foil) ×1', 'Atraxa, Praetors\' Voice ×1'])
  // A place that's gone has no group.
  assert.deepEqual(copiesByPlace(ALL, [shelf, red]).map((g) => g.title), ['Red box › Blue', 'Red box › Red'])
  assert.equal(chipText(copyChip(RED.find((c) => c.entry.name === 'Lightning Bolt')!, red)), 'Red box › Red ×2')
  assert.equal(chipText(copyChip(ATRAXA, rares)), 'Rares binder ×1')
  assert.equal(copyChip(ATRAXA, rares).page, 2)
})

test('Walk this list: the copies as a pull list, place by place', () => {
  const list = walkPullList(filterCopies(ALL, f({ basic: basic({ colors: ['R'] }) }), FACTS), PLACES)
  assert.deepEqual(list.groups.map((g) => [g.title, g.rows.map((r) => `${r.name} ×${r.qty}${r.hint ? ` — ${r.hint}` : ''}`)]), [
    ['Red box › Red', ['Goblin Guide ×1 — around “G”', 'Lightning Bolt ×2 — around “L”']],
    ['Rares binder', ['Lightning Bolt ×1 — Page 1, slot 2 · foil']],
  ])
  assert.equal(list.total, 4)
  assert.equal(list.places, 2)
  assert.equal(list.toBuy, 0)
  // Keys stay the same while the collection does, so a tick sticks.
  assert.deepEqual(walkPullList(RED, PLACES).groups.flatMap((g) => g.rows.map((r) => r.key)), walkPullList(RED, PLACES).groups.flatMap((g) => g.rows.map((r) => r.key)))
  assert.equal(new Set(list.groups.flatMap((g) => g.rows.map((r) => r.key))).size, 3)
})

test('filters are kept per place while the app runs, and forgotten when cleared', () => {
  let memory: FilterMemory = new Map()
  memory = withFilter(memory, 'red', f({ query: 'bolt' }))
  memory = withFilter(memory, STORAGE_FILTER_KEY, f({ sparesOnly: true }))
  assert.equal(filterIn(memory, 'red').query, 'bolt')
  assert.equal(filterIn(memory, 'rares'), NO_CARDS_FILTER)
  assert.equal(filterIn(memory, STORAGE_FILTER_KEY).sparesOnly, true)
  memory = withFilter(memory, 'red', NO_CARDS_FILTER)
  assert.equal(memory.has('red'), false)
  assert.equal(memory.size, 1)
})

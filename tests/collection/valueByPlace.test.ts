import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unitPrice, valueCsv, valueGroups, valueRows, type PrintingFacts } from '../../src/collection/valueByPlace.ts'
import type { Collection, CollectionEntry, CopyPlace, Deck, Loan, StoragePlace } from '../../src/types/models.ts'

// What the collection is worth, place by place, and the spreadsheet of it — the same on both apps. The
// Android app has the same checks — see ValueByPlaceTest.kt.

const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CopyPlace[], over: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}), ...over })
const shelf: StoragePlace = { id: 'shelf', name: 'Shelf', kind: 'SHELF', createdAt: 1 }
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', parentId: 'shelf', createdAt: 2 }
const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 3 }
const loan: Loan = { id: 'L1', to: 'Sam', lentAt: 1, cards: [{ name: 'Sol Ring', scryfallId: 'sol', qty: 1, deckId: 'atraxa' }, { name: 'Opt', scryfallId: 'opt', qty: 1, collectionId: 'unsorted' }] }
const COLS: Collection[] = [
  {
    id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', storagePlaces: [shelf, red, rares], loans: [loan],
    entries: [
      entry('bolt', 'Lightning Bolt', 2, 1, [at('red', 2, { section: 'Red' }), at('rares', 1, { foil: true, page: 1, slot: 2 })], { condition: 'NM', language: 'ja' }),
      entry('opt', 'Opt', 3),
      entry('mystery', 'Mystery, the "Card"', 1, 0, [at('rares', 1, { page: 1, slot: 1 })]),
    ],
  },
  { id: 'wish', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries: [entry('ring', 'The One Ring', 1)] },
]
const atraxa = {
  id: 'atraxa', name: 'Atraxa', commander: null, partnerCommander: null, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL',
  cards: [{ scryfallId: 'sol', name: 'Sol Ring', imageUrl: null, quantity: 2, canBeCommander: false, typeLine: null, partnerAbility: null }],
} as unknown as Deck
const PRICES: Record<string, PrintingFacts> = {
  bolt: { set: 'm10', number: '146', usd: 1.5, usdFoil: 12.25 },
  opt: { set: 'xln', number: '65', usd: 0.1, usdFoil: null },
  sol: { set: 'cmm', number: '410', usd: 2, usdFoil: 5 },
}
const ROWS = valueRows(COLS, [atraxa], (id) => PRICES[id])

test('a foil copy is priced as a foil, or as plain when there is no foil price', () => {
  assert.equal(unitPrice(PRICES.bolt, true), 12.25)
  assert.equal(unitPrice(PRICES.opt, true), 0.1)
  assert.equal(unitPrice({ set: 'x', number: '1', usd: null, usdFoil: 3 }, false), 3)
  assert.equal(unitPrice(undefined, false), null)
})

test('every copy owned, by where it is', () => {
  assert.deepEqual(ROWS.map((r) => `${r.name}${r.foil ? ' foil' : ''} ×${r.qty} · ${r.where}${r.spot ? ` · ${r.spot}` : ''} · ${r.unitUsd ?? '-'}`), [
    'Lightning Bolt ×2 · Shelf › Red box · Red · 1.5',
    'Lightning Bolt foil ×1 · Rares binder · Page 1, slot 2 · 12.25',
    'Opt ×2 · No place yet · 0.1',
    'Mystery, the "Card" ×1 · Rares binder · Page 1, slot 1 · -',
    'Sol Ring ×1 · Deck boxes › Atraxa · 2',
    'Sol Ring ×1 · Lent out › Sam · 2',
    'Opt ×1 · Lent out › Sam · 0.1',
  ])
})

test('the total and each place, the most valuable first and no place last', () => {
  const v = valueGroups(ROWS, COLS)
  assert.deepEqual(v.groups.map((g) => `${g.label} (${g.detail}) ${g.usd.toFixed(2)} ×${g.copies}`), [
    'Rares binder () 12.25 ×2',
    'Red box (Shelf) 3.00 ×2',
    'Lent out () 2.10 ×2',
    'Deck boxes () 2.00 ×1',
    'No place yet () 0.20 ×2',
  ])
  assert.equal(v.usd.toFixed(2), '19.55')
  assert.equal(v.copies, 9)
})

test('the spreadsheet, in the currency chosen', () => {
  assert.equal(valueCsv(ROWS, { code: 'GBP', rate: 0.8, decimals: 2 }), [
    'Name,Set,Number,Finish,Condition,Language,Quantity,Place,Spot,Unit price (GBP),Total (GBP)',
    'Sol Ring,CMM,410,Normal,,,1,Deck boxes › Atraxa,,1.60,1.60',
    'Opt,XLN,65,Normal,,,1,Lent out › Sam,,0.08,0.08',
    'Sol Ring,CMM,410,Normal,,,1,Lent out › Sam,,1.60,1.60',
    'Opt,XLN,65,Normal,,,2,No place yet,,0.08,0.16',
    '"Mystery, the ""Card""",,,Normal,,,1,Rares binder,"Page 1, slot 1",,',
    'Lightning Bolt,M10,146,Foil,Near Mint,Japanese,1,Rares binder,"Page 1, slot 2",9.80,9.80',
    'Lightning Bolt,M10,146,Normal,Near Mint,Japanese,2,Shelf › Red box,Red,1.20,2.40',
  ].join('\n'))
  assert.equal(valueCsv(ROWS.slice(0, 1), { code: 'JPY', rate: 150, decimals: 0 }).split('\n')[1], 'Lightning Bolt,M10,146,Normal,Near Mint,Japanese,2,Shelf › Red box,Red,225,450')
})

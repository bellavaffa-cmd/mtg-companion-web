import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cardmarketCondition, cardmarketCsv, forSaleOf, keepForSaleFromOlderApp, markSold, markSparesToSell, markUnusedToSell, sellRows, sellRowTitle,
  sellRowUsd, sellSplit, sellTotalUsd, tcgplayerMassEntry, withForSale, type SellPrinting,
} from '../../src/collection/selling.ts'
import { sellPullList } from '../../src/collection/pullList.ts'
import { cardsIn } from '../../src/collection/storagePlaces.ts'
import type { Collection, CollectionEntry, CopyPlace, Deck, StoragePlace } from '../../src/types/models.ts'

// The To sell list: where each card to sell is, its worth, the quick rules, the exports, the pull list
// and marking cards sold — the same on both apps. The Android app has the same checks — see
// SellingTest.kt.

const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const entry = (id: string, name: string, quantity: number, over: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity: 0, ...over })
const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 1 }
const trade: StoragePlace = { id: 'trade', name: 'Trade binder', kind: 'BINDER', createdAt: 2 }
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', sections: ['Blue'], createdAt: 3 }
const COLS: Collection[] = [
  {
    id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', storagePlaces: [rares, trade, red],
    entries: [
      entry('ring', 'The One Ring', 1, { places: [at('rares', 1, { page: 2, slot: 1 })], condition: 'NM', forSale: 1 }),
      entry('rag', 'Ragavan, Nimble Pilferer', 1, { places: [at('rares', 1, { page: 6, slot: 3 })], condition: 'LP', forSale: 1 }),
      entry('fof', 'Fact or Fiction', 4, { places: [at('trade', 4, { page: 4, slot: 6 })], forSale: 3, forTrade: 4 }),
      entry('opt', 'Opt', 2, { foilQuantity: 1, places: [at('red', 1, { section: 'Blue' }), at('rares', 1, { foil: true, page: 1, slot: 1 })], language: 'ja', forSale: 3 }),
      entry('bolt', 'Lightning Bolt', 5),
      entry('island', 'Island', 30),
      entry('sheoldred', 'Sheoldred, the Apocalypse', 2),
      entry('sol', 'Sol Ring', 1, { forSale: 0 }),
    ],
  },
  { id: 'stuff', name: 'Trade stuff', createdAt: 1, type: 'OWNED', entries: [entry('bolt', 'Lightning Bolt', 2)] },
  { id: 'wish', name: 'Wishlist', createdAt: 2, type: 'WISHLIST', entries: [entry('bolt', 'Lightning Bolt', 9)] },
]
const deck = {
  id: 'd', name: 'Burn', commander: null, partnerCommander: null, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL',
  cards: [
    { scryfallId: 'bolt', name: 'Lightning Bolt', imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null },
    { scryfallId: 'sol', name: 'Sol Ring', imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null },
  ],
} as unknown as Deck
const PRICES = new Map<string, SellPrinting>([
  ['ring', { set: 'ltr', number: '246', usd: 62, usdFoil: null, eur: 55 }],
  ['rag', { set: 'mh2', number: '138', usd: 48, usdFoil: null, eur: 40 }],
  ['fof', { set: 'tsr', number: '64', usd: 1.5, usdFoil: null }],
  ['opt', { set: 'xln', number: '65', usd: 0.1, usdFoil: 0.5, eur: 0.08 }],
  ['bolt', { set: 'm10', number: '146', usd: 2, usdFoil: null }],
  ['sheoldred', { set: 'dmu', number: '107', usd: 80, usdFoil: null }],
  ['sol', { set: 'cmm', number: '410', usd: 10, usdFoil: null }],
])
const facts = (id: string) => PRICES.get(id)
const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`)

test('copies to sell never more than the entry has', () => {
  const e = entry('x', 'X', 2, { foilQuantity: 1, forSale: 9 })
  assert.equal(forSaleOf(e), 3)
  assert.deepEqual(sellSplit(e), { plain: 2, foil: 1 })
  assert.equal(withForSale(e, 1).forSale, 1)
  assert.equal(withForSale(e, 0).forSale, 0)
  const plain = entry('x', 'X', 2)
  assert.equal(withForSale(plain, 0), plain)
})

test('the list says where each copy is and what it is worth', () => {
  const rows = sellRows(COLS)
  assert.deepEqual(rows.map(sellRowTitle), ['Fact or Fiction ×3', 'Opt ×3', 'Ragavan, Nimble Pilferer', 'The One Ring'])
  assert.deepEqual(rows.map((r) => r.where), ['Trade binder · p4 s6', 'Red box › Blue · Rares binder · p1 s1 · No place yet', 'Rares binder · p6 s3 · LP', 'Rares binder · p2 s1 · NM'])
  const opt = rows[1]
  assert.equal(opt.plain, 2)
  assert.equal(opt.foil, 1)
  assert.equal(opt.loose, 1)
  assert.deepEqual(opt.lines, [at('red', 1, { section: 'Blue' }), at('rares', 1, { foil: true, page: 1, slot: 1 })])
  near(sellRowUsd(rows[0], facts), 4.5)
  near(sellRowUsd(opt, facts), 0.7)
  assert.equal(sellRowUsd(rows[0], () => undefined), null)
  near(sellTotalUsd(rows, facts), 115.2)
})

test('spares over 4 marks the copies beyond four from the binders, Unsorted first', () => {
  const { collections: after, added } = markSparesToSell(COLS, [deck])
  // 5 + 2 in binders and 1 in the deck: 4 beyond four. Islands are basic lands.
  assert.equal(added, 4)
  assert.equal(after[0].entries.find((e) => e.scryfallId === 'bolt')!.forSale, 4)
  assert.equal(after[1].entries[0].forSale, undefined)
  assert.equal(after[0].entries.find((e) => e.scryfallId === 'island')!.forSale, undefined)
  // Again: nothing more to mark.
  assert.equal(markSparesToSell(after, [deck]).added, 0)
})

test('not in any deck, over $5 marks every copy', () => {
  const { collections: after, added } = markUnusedToSell(COLS, [deck], 5, facts)
  assert.equal(added, 2)
  assert.equal(after[0].entries.find((e) => e.scryfallId === 'sheoldred')!.forSale, 2)
  // Sol Ring is in the deck; the One Ring is to sell already; Fact or Fiction is cheap.
  assert.equal(after[0].entries.find((e) => e.scryfallId === 'sol')!.forSale, 0)
  assert.equal(after[0].entries.find((e) => e.scryfallId === 'fof')!.forSale, 3)
})

test('sold copies leave the collection and their pockets', () => {
  const result = markSold(COLS, new Set(['unsorted|ring', 'unsorted|fof', 'unsorted|opt']))
  assert.equal(result.copies, 7)
  const pile = new Map(result.collections[0].entries.map((e) => [e.scryfallId, e]))
  assert.equal(pile.get('ring'), undefined)
  assert.equal(pile.get('opt'), undefined)
  const fof = pile.get('fof')!
  assert.equal(fof.quantity, 1)
  assert.equal(fof.forSale, 0)
  assert.equal(fof.forTrade, 1)
  assert.deepEqual(fof.places, [at('trade', 1, { page: 4, slot: 6 })])
  assert.deepEqual(cardsIn(result.collections, 'red'), [])
  assert.deepEqual(cardsIn(result.collections, 'rares').map((c) => c.entry.scryfallId), ['rag'])
  assert.equal(markSold(COLS, new Set(['nothing'])).collections, COLS)
})

test('the exports', () => {
  const rows = sellRows(COLS)
  assert.equal(tcgplayerMassEntry(rows, facts), '3 Fact or Fiction [TSR]\n3 Opt [XLN]\n1 Ragavan, Nimble Pilferer [MH2]\n1 The One Ring [LTR]')
  assert.equal(cardmarketCsv(rows, facts), [
    'Count,Name,Expansion,Number,Condition,Language,Foil,Price (EUR)',
    '3,Fact or Fiction,TSR,64,,English,,',
    '2,Opt,XLN,65,,Japanese,,0.08',
    '1,Opt,XLN,65,,Japanese,Foil,',
    '1,"Ragavan, Nimble Pilferer",MH2,138,EX,English,,40.00',
    '1,The One Ring,LTR,246,NM,English,,55.00',
  ].join('\n'))
  assert.equal(cardmarketCondition('DMG'), 'PO')
  assert.equal(cardmarketCondition(null), '')
})

test('the pull list walks round the places', () => {
  const list = sellPullList(COLS)
  assert.deepEqual(list.groups.map((g) => g.title), ['Rares binder', 'Trade binder', 'Red box › Blue', 'No place yet'])
  assert.deepEqual(list.groups[0].rows.map((r) => r.name), ['Opt', 'The One Ring', 'Ragavan, Nimble Pilferer'])
  assert.equal(list.groups[0].rows[0].hint, 'Page 1, slot 1 · foil')
  assert.deepEqual(list.groups[1].rows.map((r) => r.qty), [3])
  assert.equal(list.groups[3].rows[0].hint, 'In Unsorted')
  assert.equal(list.total, 8)
  assert.equal(list.places, 3)
})

test('an entry saved by an older app keeps its copies to sell', () => {
  const pile = COLS[0]
  const older = { ...pile, entries: pile.entries.map(({ forSale: _s, ...e }) => e) }
  assert.deepEqual(keepForSaleFromOlderApp(pile, older).entries.map((e) => e.forSale), pile.entries.map((e) => e.forSale))
  // One no longer to sell (0) stays so.
  const cleared = { ...pile, entries: pile.entries.map((e) => (e.forSale !== undefined ? { ...e, forSale: 0 } : e)) }
  assert.equal(keepForSaleFromOlderApp(pile, cleared), cleared)
})

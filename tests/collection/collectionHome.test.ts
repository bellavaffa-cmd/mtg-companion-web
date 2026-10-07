import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeNumbers, homeTiles, homeTodo } from '../../src/collection/collectionHome.ts'
import type { UpkeepItem } from '../../src/collection/upkeep.ts'
import { normalizeDeck } from '../../src/types/models.ts'
import type { Collection, CollectionEntry, CopyPlace, DeckCardEntry } from '../../src/types/models.ts'

// The Collection's home: the tiles' numbers and the To do. The Android app has the same cases — see
// CollectionHomeTest.kt.

const entry = (id: string, quantity: number, more: Partial<CollectionEntry> = {}, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity: 0, ...more, ...(places ? { places } : {}) })
const card = (id: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })

const pile: Collection = {
  id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED',
  entries: [entry('ring', 3, {}, [{ placeId: 'red', qty: 2 }]), entry('bolt', 4, { forSale: 3 })],
  storagePlaces: [{ id: 'red', name: 'Red box', kind: 'BOX', createdAt: 1 }, { id: 'shelf', name: 'Shelf', kind: 'SHELF', createdAt: 1 }],
  sealed: [{ id: 's1', name: 'Play box', kind: 'PLAY_BOX', count: 2, valueUsd: 100, createdAt: 1 }],
  graded: [{ id: 'g1', scryfallId: 'ring', name: 'ring', company: 'PSA', grade: '9', valueUsd: 40, createdAt: 1 }],
  loans: [{ id: 'l1', to: 'Sam', cards: [{ name: 'bolt', scryfallId: 'bolt', qty: 1, collectionId: 'unsorted' }], lentAt: 1 }],
}
const trades: Collection = { id: 'trades', name: 'Trade binder', createdAt: 0, type: 'OWNED', entries: [entry('elf', 2), entry('ring', 1)] }
const wishlist: Collection = { id: 'wishlist', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries: [entry('dream', 1), entry('other', 1)] }
const deck = normalizeDeck({ id: 'd1', name: 'Krenko', cards: [card('gob', 4), card('ring')], ownership: 'PHYSICAL', createdAt: 1 })

test('the tiles count cards, places, binders, sealed and graded, loans and selling', () => {
  const n = homeNumbers([pile, trades, wishlist], [deck])
  // ring, bolt, elf, gob: printings, not copies; the wishlist's don't count.
  assert.equal(n.cards, 4)
  assert.equal(n.places, 2)
  assert.equal(n.binders, 1)
  assert.equal(n.wishlist, 2)
  assert.equal(n.sealedAndGraded, 3)
  assert.equal(n.sealedAndGradedUsd, 240)
  assert.equal(n.lentOut, 1)
  assert.equal(n.toSell, 3)
  // 3 + 4 + 2 + 1 binder copies and 5 in the deck: 2 in the Red box, 5 in the deck, 1 lent.
  assert.equal(n.placedPercent, Math.floor((8 * 100) / 15))
  const tiles = homeTiles(n, (usd) => `$${usd}`)
  assert.deepEqual(tiles.map((t) => `${t.title}: ${t.line}`), [
    'All cards: 4 · filters',
    'Storage: 2 places · 53% placed',
    'Binders: 1 · wishlist',
    'Sets: completion',
    'Sealed and graded: 3 items · $240',
    'Loans and selling: 1 out · 3 to sell',
  ])
})

test('an empty collection asks to set up places', () => {
  const tiles = homeTiles(homeNumbers([], []), (usd) => `$${usd}`)
  assert.equal(tiles[1].line, 'Set up your places')
  assert.equal(tiles[4].line, 'Boxes and slabs')
  assert.equal(tiles[5].line, '0 out · 0 to sell')
})

const item = (kind: UpkeepItem['kind'], title: string, more: Partial<UpkeepItem> = {}): UpkeepItem =>
  ({ kind, title, detail: '', action: kind === 'PUT_AWAY' ? 'Put away' : kind === 'CARRY_ON' ? 'Carry on' : 'Check', ...more })

test('the To do: one of each kind first, put away and a pull list on top, at most three', () => {
  const items = [
    item('PUT_AWAY', '118 copies have no place'),
    item('CHECK', 'Red box not checked in 120 days'),
    item('CHECK', 'Blue box not checked in 100 days'),
    item('SPLIT', 'Old box is 96% full', { action: 'Split' }),
    item('CARRY_ON', 'Krenko deck pull list half done', { detail: '30 of 60 pulled, started Tuesday', deckId: 'd1' }),
  ]
  const todo = homeTodo(items, [deck])
  assert.deepEqual(todo.map((t) => `${t.title} · ${t.action}`), [
    '118 copies have no place · Put away',
    'Krenko pull list: 30 of 60 · Carry on',
    'Red box not checked in 120 days · Check',
  ])
  assert.equal(homeTodo(items, [deck], 10).length, 5)
  // Blue box comes after the Split, as the second Check.
  assert.deepEqual(homeTodo(items, [deck], 10).slice(3).map((t) => t.title), ['Old box is 96% full', 'Blue box not checked in 100 days'])
  assert.deepEqual(homeTodo([], [deck]), [])
})

test('a pull list whose deck is gone keeps Upkeep words', () => {
  const todo = homeTodo([item('CARRY_ON', 'Old deck pull list started', { detail: '2 of 10 pulled', deckId: 'gone' })], [])
  assert.equal(todo[0].title, 'Old deck pull list started')
  const named = homeTodo([item('CARRY_ON', 'x', { detail: '2 of 10 pulled', deckId: 'g' })], [{ id: 'g', name: 'Goblin deck' }])
  assert.equal(named[0].title, 'Goblin pull list: 2 of 10')
})

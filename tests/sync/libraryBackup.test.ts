import { test } from 'node:test'
import assert from 'node:assert/strict'
import { libraryCounts, withBackupAdded } from '../../src/sync/libraryBackup.ts'
import type { Collection, CollectionEntry, Deck } from '../../src/types/models.ts'

const entry = (id: string, quantity = 1, auto?: boolean): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity: 0, ...(auto === undefined ? {} : { auto }) })
const binder = (id: string, entries: CollectionEntry[], type: Collection['type'] = 'OWNED'): Collection =>
  ({ id, name: id, entries, createdAt: 1, type })
const deck = (id: string): Deck =>
  ({ id, name: id, commander: null, partnerCommander: null, cards: [], gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL' })

let n = 0
const newId = () => `new-${++n}`

test("the always-there Wishlist and Unsorted pile aren't counted while they're empty", () => {
  assert.deepEqual(libraryCounts({ decks: [deck('d')], collections: [binder('wishlist', [], 'WISHLIST'), binder('unsorted', []), binder('b', [])] }),
    { decks: 1, collections: 1 })
  assert.deepEqual(libraryCounts({ decks: [], collections: [binder('unsorted', [entry('bolt')])] }), { decks: 0, collections: 1 })
})

test('a backup comes back as new decks and binders, overwriting nothing', () => {
  n = 0
  const current = { decks: [deck('d1')], collections: [binder('b1', [entry('sol')])] }
  const backup = { decks: [deck('d1')], collections: [binder('b1', [entry('bolt')])] }
  const out = withBackupAdded(current, backup, newId)
  assert.deepEqual(out.decks.map((d) => d.id), ['d1', 'new-1'])
  assert.deepEqual(out.collections.map((c) => [c.id, c.entries.map((e) => e.scryfallId)]), [['b1', ['sol']], ['new-2', ['bolt']]])
})

test("the backup's pile and wishlist cards go into the library's own", () => {
  n = 0
  const current = { decks: [], collections: [binder('unsorted', [entry('bolt', 1)]), binder('wishlist', [entry('sol')], 'WISHLIST')] }
  const backup = {
    decks: [],
    collections: [binder('unsorted', [entry('bolt', 2), entry('elf')]), binder('wishlist', [entry('sol'), entry('rhystic'), entry('auto', 1, true)], 'WISHLIST')],
  }
  const out = withBackupAdded(current, backup, newId)
  assert.equal(out.collections.length, 2)
  const pile = out.collections.find((c) => c.id === 'unsorted')!
  assert.deepEqual(pile.entries.map((e) => [e.scryfallId, e.quantity]), [['bolt', 3], ['elf', 1]])
  const wishlist = out.collections.find((c) => c.id === 'wishlist')!
  // Cards it only held for a deck's Considering list come back with that deck, by themselves.
  assert.deepEqual(wishlist.entries.map((e) => e.scryfallId), ['sol', 'rhystic'])
})

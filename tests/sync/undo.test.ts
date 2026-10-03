import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeBetween, isNoChange, undoChange } from '../../src/sync/undo.ts'
import type { Library } from '../../src/sync/cloudSync.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'

// The Undo bar takes back exactly what one add, move or copy did — and nothing done since.

const card = (name: string, quantity = 1): DeckCardEntry => ({
  scryfallId: `id-${name}`, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null,
})
const entry = (name: string, quantity = 1, foilQuantity = 0, extra: Partial<CollectionEntry> = {}): CollectionEntry => ({
  scryfallId: `id-${name}`, name, imageUrl: null, quantity, foilQuantity, ...extra,
})
const deck = (id: string, cards: DeckCardEntry[], considering?: DeckCardEntry[]): Deck => ({
  id, name: id, commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL',
  ...(considering ? { considering } : {}),
})
const binder = (id: string, entries: CollectionEntry[]): Collection => ({ id, name: id, entries, createdAt: 1, type: 'OWNED' })

test('nothing changed, nothing to undo', () => {
  const lib: Library = { decks: [deck('Elves', [card('Llanowar Elves')])], collections: [] }
  assert.ok(isNoChange(changeBetween(lib, lib)))
})

test('an add is taken back, leaving a card added since', () => {
  const before: Library = { decks: [deck('Elves', [card('Llanowar Elves')])], collections: [] }
  const after: Library = { decks: [deck('Elves', [card('Llanowar Elves', 2), card('Sol Ring')])], collections: [] }
  const change = changeBetween(before, after)
  // Meanwhile another card went in.
  const later: Library = { decks: [deck('Elves', [...after.decks[0].cards, card('Forest', 3)])], collections: [] }
  assert.deepEqual(undoChange(later, change).decks[0].cards, [card('Llanowar Elves'), card('Forest', 3)])
})

test('a move from a binder into a deck puts the copies back, entry and all', () => {
  const kept = entry('Sol Ring', 1, 1, { priceAlert: 2, userTags: ['signed'] })
  const before: Library = { decks: [deck('Elves', [])], collections: [binder('Trades', [kept])] }
  const after: Library = { decks: [deck('Elves', [card('Sol Ring', 2)])], collections: [binder('Trades', [])] }
  const undone = undoChange(after, changeBetween(before, after))
  assert.deepEqual(undone.collections[0].entries, [kept])
  assert.deepEqual(undone.decks[0].cards, [])
})

test('foil copies are counted apart from regular ones', () => {
  const before: Library = { decks: [], collections: [binder('Blue', [entry('Sol Ring', 1, 0)])] }
  const after: Library = { decks: [], collections: [binder('Blue', [entry('Sol Ring', 1, 2)])] }
  const undone = undoChange(after, changeBetween(before, after))
  assert.deepEqual(undone.collections[0].entries, [entry('Sol Ring', 1, 0)])
})

test('Considering is undone on its own list', () => {
  const before: Library = { decks: [deck('Elves', [], [card('Sol Ring')])], collections: [] }
  const after: Library = { decks: [deck('Elves', [card('Sol Ring')], [])], collections: [] }
  const undone = undoChange(after, changeBetween(before, after))
  assert.deepEqual(undone.decks[0].cards, [])
  assert.deepEqual(undone.decks[0].considering, [card('Sol Ring')])
})

test('a deck deleted since is left alone', () => {
  const before: Library = { decks: [deck('Elves', [])], collections: [] }
  const after: Library = { decks: [deck('Elves', [card('Sol Ring')])], collections: [] }
  const change = changeBetween(before, after)
  assert.deepEqual(undoChange({ decks: [], collections: [] }, change), { decks: [], collections: [] })
})

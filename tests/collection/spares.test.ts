import { test } from 'node:test'
import assert from 'node:assert/strict'
import { namesDecksUse, spareValue, spares } from '../../src/collection/spares.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'

// Cards in your binders that no deck plays. The Android app has the same checks — see SparesTest.kt.

const entry = (name: string, quantity = 1, foilQuantity = 0): CollectionEntry => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, foilQuantity })
const binder = (id: string, entries: CollectionEntry[], type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries, createdAt: 0, type })
const card = (name: string) => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity: 1 }) as unknown as DeckCardEntry
const deck = (name: string, cards: string[], considering: string[] = []) =>
  ({ id: name, name, ownership: 'PHYSICAL', cards: cards.map(card), considering: considering.map(card) }) as unknown as Deck

test('a card a deck plays, wants or is thinking about is not a spare', () => {
  const decks = [deck('Omnath', ['Sol Ring'], ['Cultivate'])]
  assert.deepEqual([...namesDecksUse(decks)].sort(), ['cultivate', 'sol ring'])

  const collections = [
    binder('Blue', [entry('Sol Ring'), entry('Cultivate'), entry('Rhystic Study', 2), entry('Ponder', 1, 3)]),
    binder('wish', [entry('Mox Opal')], 'WISHLIST'),
  ]
  const out = spares(collections, decks)
  // Most copies first; the wishlist card isn't yours to trade.
  assert.deepEqual(out.map((s) => [s.entry.name, s.copies, s.foils]), [['Ponder', 4, 3], ['Rhystic Study', 2, 0]])
})

test('copies across binders add up, and you can ask for only the ones you hold several of', () => {
  const collections = [binder('A', [entry('Ponder', 1)]), binder('B', [entry('Ponder', 2)]), binder('C', [entry('Brainstorm')])]
  const all = spares(collections, [])
  assert.deepEqual(all.map((s) => [s.entry.name, s.copies, s.binders]), [['Ponder', 3, ['A', 'B']], ['Brainstorm', 1, ['C']]])
  assert.deepEqual(spares(collections, [], 2).map((s) => s.entry.name), ['Ponder'])
})

test('what the pile is worth puts the money on top', () => {
  const collections = [binder('A', [entry('Ponder', 4), entry('Black Lotus')])]
  const out = spares(collections, [])
  const prices = new Map([['id-Ponder', 1], ['id-Black Lotus', 5000]])
  assert.deepEqual(
    [...out].sort((a, b) => spareValue(b, prices) - spareValue(a, prices)).map((s) => s.entry.name),
    ['Black Lotus', 'Ponder'],
  )
})

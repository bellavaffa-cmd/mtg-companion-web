import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shuffledLibrary } from '../../src/decks/goldfish.ts'
import type { Deck } from '../../src/types/models.ts'

// Goldfishing a deck. The Android app has the same check — see GoldfishTest.kt.

const entry = (id: string, quantity = 1) => ({ scryfallId: id, name: id, imageUrl: null, quantity })

test('the library is every copy of the deck, less the commanders in the command zone', () => {
  const deck = {
    commander: entry('omnath'),
    partnerCommander: null,
    // A deck's commander is in its card list too.
    cards: [entry('omnath'), entry('forest', 3), entry('sol')],
  } as unknown as Deck
  const library = shuffledLibrary(deck)
  assert.deepEqual(library.map((c) => c.entry.scryfallId).sort(), ['forest', 'forest', 'forest', 'sol'])
  assert.equal(new Set(library.map((c) => c.key)).size, 4)
  // Shuffled: a different order comes up.
  const orders = new Set(Array.from({ length: 20 }, () => shuffledLibrary(deck).map((c) => c.entry.scryfallId).join()))
  assert.ok(orders.size > 1)
})

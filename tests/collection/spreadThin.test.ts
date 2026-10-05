import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortBuyList, shortCost, spreadThin, thinLine } from '../../src/collection/spreadThin.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'

// Cards your decks use more copies of than you own. The Android app has the same checks — see
// SpreadThinTest.kt.

const entry = (name: string, quantity = 1, foilQuantity = 0): CollectionEntry => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, foilQuantity })
const binder = (id: string, entries: CollectionEntry[], type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries, createdAt: 0, type })
const card = (name: string, quantity = 1, id = `id-${name}`, proxyQuantity?: number) => ({ scryfallId: id, name, imageUrl: null, quantity, proxyQuantity }) as unknown as DeckCardEntry
const deck = (name: string, ownership: string, ...cards: DeckCardEntry[]) => ({ id: name, name, ownership, cards }) as unknown as Deck

test('copies in binders and in decks you hold are owned; every deck asks for its own', () => {
  const decks = [
    deck('Shelf', 'PHYSICAL', card('Sol Ring')),
    deck('Building', 'PROTOTYPE', card('Sol Ring')),
    deck('Dream', 'VIRTUAL', card('Sol Ring'), card('Rhystic Study')),
    deck('Another', 'PROTOTYPE', card('Sol Ring', 1, 'id-sol-2')),
  ]
  // One normal and one foil in binders, one in the Physical deck; a wishlist copy isn't one.
  const collections = [binder('Artifacts', [entry('Sol Ring', 0, 1)]), binder('Unsorted', [entry('Rhystic Study')]), binder('wish', [entry('Sol Ring', 3)], 'WISHLIST')]
  const thin = spreadThin(collections, decks)
  assert.deepEqual(thin.map((c) => [c.name, c.owned, c.used, c.short]), [['Sol Ring', 2, 4, 2]])
  assert.equal(thinLine(thin[0]), 'You own 2 · 4 decks use 4')
  // Any printing fills a slot: both printings the decks play are priced.
  assert.deepEqual(thin[0].scryfallIds, ['id-Sol Ring', 'id-sol-2'])
})

test('enough to go round is not short, and basic lands never are', () => {
  const decks = [deck('A', 'PROTOTYPE', card('Swamp', 30), card('Ponder')), deck('B', 'PHYSICAL', card('Ponder'))]
  assert.deepEqual(spreadThin([binder('Blue', [entry('Ponder')])], decks), [])
})

test('a proxy deck asks for nothing, but a physical deck short of its proxies is', () => {
  const proxy = deck('Pile', 'PROXY', card('Black Lotus'))
  assert.deepEqual(spreadThin([], [proxy]), [])
  const physical = deck('Shelf', 'PHYSICAL', card('Mana Crypt', 1, 'id-Mana Crypt', 1))
  assert.deepEqual(spreadThin([], [physical]).map((c) => [c.name, c.short]), [['Mana Crypt', 1]])
})

test('shortest first, decks with the most copies first, two printings in one deck are one deck', () => {
  const decks = [
    deck('Burn', 'PROTOTYPE', card('Lightning Bolt', 2, 'bolt-a'), card('Lightning Bolt', 2, 'bolt-b')),
    deck('Red', 'VIRTUAL', card('Lightning Bolt', 1, 'bolt-a'), card('Sol Ring')),
  ]
  const thin = spreadThin([], decks)
  assert.deepEqual(thin.map((c) => [c.name, c.short]), [['Lightning Bolt', 5], ['Sol Ring', 1]])
  assert.deepEqual(thin[0].decks.map((u) => [u.deckName, u.copies]), [['Burn', 4], ['Red', 1]])
  // The cheapest printing, for every copy short; no price at all, no cost.
  assert.equal(shortCost(thin[0], new Map([['bolt-a', 2], ['bolt-b', 0.5]])), 2.5)
  assert.equal(shortCost(thin[1], new Map([['id-Sol Ring', null]])), null)
  assert.equal(shortBuyList(thin), '5 Lightning Bolt\n1 Sol Ring')
})

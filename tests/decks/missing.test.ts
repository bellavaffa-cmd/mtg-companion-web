import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copiesHeld, missingCards } from '../../src/decks/missing.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'

// The cards in a deck you don't own. The Android app has the same rule — see MissingCardsTest.kt.

const entry = (name: string, quantity = 1): CollectionEntry => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, foilQuantity: 0 })
const binder = (id: string, entries: CollectionEntry[], type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries, createdAt: 0, type })
const card = (name: string, quantity = 1, proxyQuantity?: number) => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, proxyQuantity }) as unknown as DeckCardEntry
const deck = (name: string, ownership: string, ...cards: DeckCardEntry[]) => ({ id: name, name, ownership, cards }) as unknown as Deck

test('a card sitting in another deck you hold is a card you own', () => {
  const building = deck('Building', 'PROTOTYPE', card('Sol Ring'), card('Rhystic Study'))
  const physical = deck('Old deck', 'PHYSICAL', card('Sol Ring'))
  const virtual = deck('Dream', 'VIRTUAL', card('Rhystic Study'))
  const missing = missingCards(building, [], [building, physical, virtual])
  // Sol Ring is in a deck on the shelf; Rhystic Study only in one that doesn't exist.
  assert.deepEqual(missing.map((c) => [c.name, c.quantity]), [['Rhystic Study', 1]])
})

test('basic lands are never missing, and a wishlist copy is not a copy', () => {
  const d = deck('Mono-black', 'PROTOTYPE', card('Swamp', 30), card('Snow-Covered Swamp', 4), card('Sol Ring'))
  const wish = binder('wish', [entry('Sol Ring')], 'WISHLIST')
  assert.deepEqual(missingCards(d, [wish], [d]).map((c) => c.name), ['Sol Ring'])
})

test('only what the binders and decks are short of is listed', () => {
  const d = deck('Burn', 'PROTOTYPE', card('Lightning Bolt', 4))
  const binders = [binder('Red', [entry('Lightning Bolt', 1)])]
  const other = deck('Old burn', 'PHYSICAL', card('Lightning Bolt', 2))
  assert.deepEqual(missingCards(d, binders, [d, other]).map((c) => [c.name, c.quantity]), [['Lightning Bolt', 1]])
})

test('a deck you hold covers itself, and a proxy deck is built', () => {
  const physical = deck('Shelf', 'PHYSICAL', card('Sol Ring'), card('Mox Opal'))
  assert.deepEqual(missingCards(physical, [], [physical]), [])

  const proxy = deck('Pile', 'PROXY', card('Black Lotus'))
  assert.deepEqual(missingCards(proxy, [], [proxy]), [])
  // Its proxies aren't copies for another deck, but a card swapped in for real is.
  const swapped = deck('Pile', 'PROXY', card('Black Lotus'), card('Sol Ring', 1, 0))
  assert.deepEqual([...copiesHeld(swapped)], [['sol ring', 1]])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allCardsOf, copiesInBinders, dashboardOf, exportEntries, gatherInto, primaryType, removeEverywhere } from '../../src/collection/allCards.ts'
import type { Collection, CollectionEntry, Deck } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The Collection page's All cards tab: every card owned in binders and decks, its totals, and what
// picking cards does. The Android app does the same in CollectionsViewModel / CollectionRepository.

const entry = (scryfallId: string, name: string, quantity = 1, foilQuantity = 0): CollectionEntry => ({ scryfallId, name, imageUrl: null, quantity, foilQuantity })
const binder = (id: string, entries: CollectionEntry[], type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries, createdAt: 0, type })
const deck = (name: string, ...cards: [string, string, number][]) =>
  ({ id: name, name, cards: cards.map(([scryfallId, n, quantity]) => ({ scryfallId, name: n, imageUrl: null, quantity })) }) as unknown as Deck

const collections = [
  binder('Blue', [entry('study', 'Rhystic Study'), entry('sol', 'Sol Ring', 1, 1)]),
  binder('Unsorted', [entry('sol', 'Sol Ring', 2)]),
  binder('wishlist', [entry('opal', 'Mox Opal'), entry('sol', 'Sol Ring', 5)], 'WISHLIST'),
]
const decks = [deck('Omnath', ['sol', 'Sol Ring', 1], ['cult', 'Cultivate', 1])]

test('all cards adds up binders and decks, never the Wishlist', () => {
  const cards = allCardsOf(collections, decks)
  assert.deepEqual(cards.map((c) => [c.name, c.total]), [['Cultivate', 1], ['Rhystic Study', 1], ['Sol Ring', 5]])
  assert.deepEqual(cards[2].sources.map((s) => `${s.kind}:${s.name}:${s.quantity}`), ['binder:Blue:2', 'binder:Unsorted:2', 'deck:Omnath:1'])
})

test('gathering takes every binder copy into one; removing leaves decks and the Wishlist', () => {
  const ids = new Set(['sol'])
  const gathered = gatherInto(collections, 'Blue', ids)
  assert.deepEqual(gathered[0].entries.find((e) => e.scryfallId === 'sol'), { ...entry('sol', 'Sol Ring', 3, 1) })
  assert.equal(gathered[1].entries.length, 0)
  assert.equal(gathered[2], collections[2])

  assert.equal(copiesInBinders(collections, ids), 4)
  const removed = removeEverywhere(collections, ids)
  assert.deepEqual(removed.map((c) => c.entries.map((e) => e.name)), [['Rhystic Study'], [], ['Mox Opal', 'Sol Ring']])
})

test("export takes the binders' copies, or a deck's for a card only in decks", () => {
  const cards = allCardsOf(collections, decks)
  const out = exportEntries(collections, cards, new Set(['sol', 'cult']))
  assert.deepEqual(out.map((e) => [e.name, e.quantity, e.foilQuantity]), [['Sol Ring', 3, 1], ['Cultivate', 1, 0]])
})

test('the totals: value, colours and types', () => {
  const card = (id: string, usd: string | null, identity: string[], type: string) =>
    ({ id, name: id, prices: { usd }, color_identity: identity, type_line: type }) as unknown as ScryfallCard
  const byId = new Map([
    ['sol', card('sol', '1.50', [], 'Artifact')],
    ['study', card('study', '30.00', ['U'], 'Enchantment')],
    ['cult', card('cult', null, ['G'], 'Sorcery')],
  ])
  const d = dashboardOf(allCardsOf(collections, decks), byId)!
  assert.equal(d.totalUsd, 30 + 1.5 * 5)
  assert.equal(d.pricedCount, 6)
  assert.deepEqual(d.colorCounts, [['U', 1], ['G', 1], ['Colorless', 5]])
  assert.deepEqual(d.typeCounts[0], ['Artifact', 5])
  assert.equal(primaryType('Artifact Creature — Golem'), 'Creature')
})

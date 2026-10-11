import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allCardsOf } from '../../src/collection/allCards.ts'
import { homeNumbers } from '../../src/collection/collectionHome.ts'
import { ownedPrintings } from '../../src/collection/setCompletion.ts'
import { ownedCounts } from '../../src/collection/sortPiles.ts'
import { copyFactsOf } from '../../src/collection/advancedFilter.ts'
import { countsAsOwned, ownedCopies, ownedProxies } from '../../src/collection/ownedCopies.ts'
import { holdsOwnCopies } from '../../src/collection/unsorted.ts'
import { ownedSummary } from '../../src/scan/scanCardPanel.ts'
import { DECK_OWNERSHIP_OPTIONS, ownershipOf, type Collection, type Deck, type DeckCardEntry, type DeckOwnership } from '../../src/types/models.ts'

// Which deck copies count as owned (src/collection/ownedCopies.ts): Virtual and Prototype decks and
// cubes own nothing, a Proxy deck's proxies are copies but worth nothing, a Physical deck (or one saved
// with no ownership) still counts. The cases in ownedCopiesVectors.json are run by the Android app's
// OwnedCopiesTest.kt too.

interface VCard { id: string; qty?: number; proxies?: number }
interface Case {
  name: string
  binders: { wishlist?: boolean; cards: VCard[] }[]
  decks: { ownership?: string; cube?: boolean; sample?: boolean; cards: VCard[] }[]
  expect: {
    allCards: Record<string, [number, number]>
    valued: Record<string, number>
    homeCards: number
    ownedPrintings: Record<string, number>
    youOwn: Record<string, number>
  }
}
const V = JSON.parse(readFileSync(new URL('./ownedCopiesVectors.json', import.meta.url), 'utf8')) as { cases: Case[] }

const collectionsOf = (c: Case): Collection[] => c.binders.map((b, i) => ({
  id: b.wishlist ? 'wishlist' : `b${i}`, name: `Binder ${i}`, createdAt: 1, type: b.wishlist ? 'WISHLIST' : 'OWNED',
  entries: b.cards.map((e) => ({ scryfallId: e.id, name: e.id, imageUrl: null, quantity: e.qty ?? 1, foilQuantity: 0 })),
}) as Collection)

const decksOf = (c: Case): Deck[] => c.decks.map((d, i) => ({
  id: `d${i}`, name: `Deck ${i}`, commander: null, partnerCommander: null, createdAt: 1, tags: [], gameResults: [],
  gameMode: d.cube ? 'CUBE' : 'COMMANDER',
  ownership: (d.ownership ?? 'PHYSICAL') as DeckOwnership,
  ...(d.cube ? { archived: true } : {}),
  ...(d.sample ? { sample: true } : {}),
  cards: d.cards.map((e): DeckCardEntry => ({ scryfallId: e.id, name: e.id, imageUrl: null, quantity: e.qty ?? 1, ...(e.proxies !== undefined ? { proxyQuantity: e.proxies } : {}) }) as DeckCardEntry),
}) as Deck)

for (const c of V.cases) {
  test(`owned copies: ${c.name}`, () => {
    const collections = collectionsOf(c)
    const decks = decksOf(c)
    const all = allCardsOf(collections, decks)
    assert.deepEqual(Object.fromEntries(all.map((a) => [a.scryfallId, [a.total, a.proxies]])), c.expect.allCards)
    assert.deepEqual(Object.fromEntries(all.filter((a) => a.total - a.proxies > 0).map((a) => [a.scryfallId, a.total - a.proxies])), c.expect.valued)
    assert.equal(homeNumbers(collections, decks).cards, c.expect.homeCards)
    assert.deepEqual(Object.fromEntries(ownedPrintings(collections, decks)), c.expect.ownedPrintings)
    assert.deepEqual(Object.fromEntries(ownedCounts(collections, decks)), c.expect.youOwn)
    // All cards' filters see the same copies.
    const facts = copyFactsOf(collections, decks)
    assert.deepEqual(Object.fromEntries([...facts].map(([id, f]) => [id, f.copies])), Object.fromEntries(Object.entries(c.expect.allCards).map(([id, [n]]) => [id, n])))
  })
}

const deck = (ownership: unknown, cards: DeckCardEntry[] = [], more: Partial<Deck> = {}): Deck =>
  ({ id: 'd', name: 'D', commander: null, partnerCommander: null, createdAt: 1, tags: [], gameResults: [], gameMode: 'COMMANDER', ownership, cards, ...more }) as Deck
const card = (name: string, quantity = 1, proxyQuantity?: number): DeckCardEntry =>
  ({ scryfallId: name, name, imageUrl: null, quantity, ...(proxyQuantity !== undefined ? { proxyQuantity } : {}) }) as DeckCardEntry

test('owned copies: only Physical and Proxy decks count, never a cube or a sample', () => {
  assert.deepEqual(DECK_OWNERSHIP_OPTIONS.map((o) => countsAsOwned(deck(o))), [true, true, false, false])
  assert.equal(countsAsOwned(deck('PHYSICAL', [], { gameMode: 'CUBE' })), false)
  assert.equal(countsAsOwned(deck('PHYSICAL', [], { sample: true })), false)
})

test('owned copies: a deck saved with no ownership is Physical, as on Android', () => {
  for (const o of [undefined, null, '', 'SOMETHING_NEW']) {
    assert.equal(ownershipOf(deck(o)), 'PHYSICAL')
    assert.equal(countsAsOwned(deck(o)), true)
    assert.equal(holdsOwnCopies(deck(o)), true)
  }
  const d = deck(undefined, [card('Sol Ring', 2)])
  assert.deepEqual(allCardsOf([], [d]).map((a) => [a.scryfallId, a.total, a.proxies]), [['Sol Ring', 2, 0]])
})

test('owned copies: a proxy is a copy but never a valued one', () => {
  const d = deck('PROXY', [card('Lotus'), card('Bolt', 4, 3)])
  assert.deepEqual(d.cards.map((e) => ownedCopies(d, e)), [0, 1])
  assert.deepEqual(d.cards.map((e) => ownedProxies(d, e)), [1, 3])
  const v = deck('VIRTUAL', [card('Bolt', 4, 1)])
  assert.equal(ownedCopies(v, v.cards[0]), 0)
  assert.equal(ownedProxies(v, v.cards[0]), 0)
})

test("owned copies: the scan panel's You own N leaves unowned decks out", () => {
  const virtual = { ...deck('VIRTUAL', [card('Sol Ring', 2)]), id: 'v' }
  const physical = { ...deck('PHYSICAL', [card('Sol Ring')]), id: 'p', name: 'Krenko' }
  const s = ownedSummary([], [virtual, physical], 'Sol Ring', 'Sol Ring')
  assert.equal(s.samePrinting, 1)
  assert.deepEqual(s.places, [['Krenko deck', 1]])
})

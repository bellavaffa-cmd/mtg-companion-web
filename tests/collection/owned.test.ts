import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownedCards, ownedForTag } from '../../src/collection/owned.ts'
import { cardsTheyWant, hitsAsTrade } from '../../src/social/tradeLogic.ts'
import type { Collection, Deck, DeckCardEntry } from '../../src/types/models.ts'

// A deck's "you own N more" gaps and trade matching with friends. The Android app has the same
// checks — see RoleTagsTest.kt and TradeLogicTest.kt.

const entry = (scryfallId: string, name: string, quantity = 1, foilQuantity = 0) => ({ scryfallId, name, imageUrl: null, quantity, foilQuantity })
const binder = (id: string, name: string, entries: Collection['entries'], type: Collection['type'] = 'OWNED'): Collection => ({ id, name, entries, createdAt: 0, type })
const deckEntry = (name: string) => ({ scryfallId: name, name, imageUrl: null, quantity: 1 }) as DeckCardEntry

test("a deck short of ramp is offered the owned ramp in its commander's colours", () => {
  const owned = ownedCards([binder('a', 'My binder', [entry('sol', 'Sol Ring'), entry('cult', 'Cultivate'), entry('signet', 'Rakdos Signet'), entry('study', 'Rhystic Study')])])
  const tags: Record<string, string[]> = { 'sol ring': ['ramp'], cultivate: ['ramp'], 'rakdos signet': ['ramp'], 'rhystic study': ['draw'] }
  const identity: Record<string, string> = { 'sol ring': '', cultivate: 'G', 'rakdos signet': 'BR', 'rhystic study': 'U', 'omnath, locus of mana': 'G' }
  const tagsOf = (n: string) => tags[n.toLowerCase()]
  const identityOf = (n: string) => identity[n.toLowerCase()]
  const deck = { id: 'd', name: 'Omnath', commander: deckEntry('Omnath, Locus of Mana'), partnerCommander: null, cards: [deckEntry('Sol Ring')] } as unknown as Deck

  // Sol Ring is already in the deck; the Signet is off-colour for a green commander.
  assert.deepEqual(ownedForTag(owned, deck, 'ramp', tagsOf, identityOf).map((c) => c.name), ['Cultivate'])
  // No commander: any colour.
  assert.deepEqual(ownedForTag(owned, { ...deck, commander: null }, 'ramp', tagsOf, identityOf).map((c) => c.name), ['Cultivate', 'Rakdos Signet'])
  // The commander's colours not known yet: nothing, rather than off-colour cards.
  assert.deepEqual(ownedForTag(owned, { ...deck, commander: deckEntry('Unknown') }, 'ramp', tagsOf, identityOf), [])
})

test("a friend's wishlist finds the user's cards, offered from their best binder", () => {
  const mine = [
    binder('m1', 'Main', [entry('sol-f', 'Sol Ring', 0, 1), entry('bolt', 'Lightning Bolt')]),
    binder('m2', 'Trades', [entry('sol', 'Sol Ring', 2)]),
    // The user's own wishlist isn't something they have.
    binder('mw', 'Wants', [entry('opal', 'Mox Opal')], 'WISHLIST'),
  ]
  const theirs = [
    binder('t1', 'Upgrades', [entry('x', 'sol ring'), entry('y', 'Mox Opal')], 'WISHLIST'),
    // Their binder isn't what they want.
    binder('t2', 'Binder', [entry('bolt2', 'Lightning Bolt', 4)]),
  ]
  const wanted = cardsTheyWant(mine, theirs)
  assert.deepEqual(wanted.map((w) => w.name), ['Sol Ring'])
  assert.equal(wanted[0].copies, 3)
  assert.equal(wanted[0].wishlist, 'Upgrades')
  // Offered from the binder with regular copies, not the foil.
  assert.deepEqual(wanted[0].card, { scryfallId: 'sol', name: 'Sol Ring', imageUrl: null, foil: false, quantity: 1, collectionId: 'm2' })
  assert.deepEqual(cardsTheyWant(mine, theirs.slice(1)), [])
})

test("wishlist hits become one copy of each card", () => {
  const hit = (item: string, q: number, f: number) => ({ owner: 'u', kind: 'collection' as const, item_id: item, item_name: 'Binder', scryfall_id: `id-${item}`, name: 'Rhystic Study', image_url: null, quantity: q, foil_quantity: f })
  assert.deepEqual(hitsAsTrade([hit('b1', 0, 2), hit('b2', 3, 0)]), [
    { scryfallId: 'id-b1', name: 'Rhystic Study', imageUrl: null, foil: true, quantity: 1, collectionId: 'b1' },
  ])
})

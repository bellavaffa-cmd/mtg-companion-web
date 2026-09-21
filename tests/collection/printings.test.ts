import { test } from 'node:test'
import assert from 'node:assert/strict'
import { regularInSet, withDeckPrinting, withEntryPrinting } from '../../src/collection/printings.ts'
import { isBinder } from '../../src/collection/unsorted.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Switching a card to another printing. The Android app has the same checks — see PrintingsTest.kt.

const printing = (id: string, name = 'Sol Ring'): ScryfallCard =>
  ({ id, name, type_line: 'Artifact', image_uris: { normal: `https://img/${id}.jpg` } }) as unknown as ScryfallCard
const entry = (id: string, quantity = 1, foilQuantity = 0, extra: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name: 'Sol Ring', imageUrl: `https://img/${id}.jpg`, quantity, foilQuantity, ...extra })
const card = (id: string, quantity = 1, proxyQuantity?: number): DeckCardEntry =>
  ({ scryfallId: id, name: 'Sol Ring', imageUrl: null, quantity, canBeCommander: false, typeLine: 'Artifact', partnerAbility: null, proxyQuantity })
const deck = (ownership: string, cards: DeckCardEntry[], commander: DeckCardEntry | null = null): Deck =>
  ({ id: 'd', name: 'Deck', cards, commander, partnerCommander: null, ownership }) as unknown as Deck

test("a binder card takes the new printing's look and keeps its copies", () => {
  const out = withEntryPrinting([entry('frc', 2, 1, { priceAlert: 5 } as never)], 'frc', printing('msc'))
  assert.equal(out.length, 1)
  assert.equal(out[0].scryfallId, 'msc')
  assert.equal(out[0].imageUrl, 'https://img/msc.jpg')
  // Two plain and one foil, and the price alert, all still there.
  assert.equal(out[0].quantity, 2)
  assert.equal(out[0].foilQuantity, 1)
  assert.equal((out[0] as unknown as { priceAlert: number }).priceAlert, 5)
})

test('switching to a printing the binder already holds adds the copies together', () => {
  const out = withEntryPrinting([entry('frc', 2, 0), entry('msc', 1, 1)], 'frc', printing('msc'))
  // One entry, not two for the same printing each showing half the count.
  assert.deepEqual(out.map((e) => [e.scryfallId, e.quantity, e.foilQuantity]), [['msc', 3, 1]])
})

test('nothing changes for the same printing, or a card that is not there', () => {
  const entries = [entry('frc')]
  assert.equal(withEntryPrinting(entries, 'frc', printing('frc')), entries)
  assert.equal(withEntryPrinting(entries, 'nope', printing('msc')), entries)
})

test('a deck card takes the new printing and keeps its copies and proxies', () => {
  const out = withDeckPrinting(deck('PHYSICAL', [card('frc', 1, 1)]), 'frc', printing('msc'))
  assert.equal(out.cards[0].scryfallId, 'msc')
  assert.equal(out.cards[0].proxyQuantity, 1)
})

test('a commander is switched too', () => {
  const commander = { ...card('atraxa'), name: 'Atraxa', canBeCommander: true }
  const out = withDeckPrinting(deck('PHYSICAL', [commander], commander), 'atraxa', printing('atraxa-alt', 'Atraxa'))
  assert.equal(out.commander?.scryfallId, 'atraxa-alt')
  assert.equal(out.cards[0].scryfallId, 'atraxa-alt')
})

test('switching to a printing the deck already holds adds the copies and proxies together', () => {
  // In a proxy deck an unset proxy count means "all of them": that has to be counted out before
  // it's added to an entry that says a number.
  const out = withDeckPrinting(deck('PROXY', [card('frc', 2), card('msc', 1, 0)]), 'frc', printing('msc'))
  assert.equal(out.cards.length, 1)
  assert.equal(out.cards[0].quantity, 3)
  assert.equal(out.cards[0].proxyQuantity, 2)
  // Neither set: it stays unset, "whatever the deck is".
  const plain = withDeckPrinting(deck('PHYSICAL', [card('frc', 2), card('msc', 1)]), 'frc', printing('msc'))
  assert.equal(plain.cards[0].proxyQuantity, undefined)
})

test('the Wishlist and the Unsorted pile are not binders', () => {
  const c = (id: string, type: Collection['type'] = 'OWNED') => ({ id, name: id, entries: [], createdAt: 0, type }) as Collection
  assert.deepEqual([c('wishlist', 'WISHLIST'), c('unsorted'), c('blue')].filter(isBinder).map((x) => x.id), ['blue'])
})

test("a set's regular version is its lowest numbered one", () => {
  const numbered = (n: string) => ({ id: n, name: 'Sol Ring', collector_number: n }) as unknown as ScryfallCard
  // Borderless and showcase versions are numbered after the set's main run.
  assert.equal(regularInSet(['300', '12a', '★', '12', '45'].map(numbered))?.id, '12')
  assert.equal(regularInSet([numbered('★')])?.id, '★')
  assert.equal(regularInSet([]), null)
})

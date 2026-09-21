import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deckProxyCopies, proxiesHeldElsewhere, proxyCopies, proxySwaps, spareCopies, withSwapIn } from '../../src/decks/proxies.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'

// Proxies in a deck, and swapping them for the real card. The Android app has the same checks —
// see ProxiesTest.kt.

const entry = (name: string, quantity = 1, foilQuantity = 0): CollectionEntry => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, foilQuantity })
const binder = (id: string, entries: CollectionEntry[], type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries, createdAt: 0, type })
const card = (name: string, quantity = 1, proxyQuantity?: number) => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, proxyQuantity }) as unknown as DeckCardEntry
const deck = (name: string, ownership: string, ...cards: DeckCardEntry[]) => ({ id: name, name, ownership, cards }) as unknown as Deck

test('a deck marked Proxy is proxies until copies are swapped in', () => {
  const proxy = deck('Pile', 'PROXY', card('Sol Ring'), card('Lightning Bolt', 4), card('Cultivate', 2, 1))
  assert.equal(proxyCopies(proxy, proxy.cards[0]), 1)
  assert.equal(proxyCopies(proxy, proxy.cards[1]), 4)
  // Half swapped in already: one of the two copies is the real card.
  assert.equal(proxyCopies(proxy, proxy.cards[2]), 1)
  assert.equal(deckProxyCopies(proxy), 6)

  // Any other deck holds no proxies unless it says so.
  const real = deck('Real', 'PHYSICAL', card('Sol Ring'), card('Mox Opal', 1, 1))
  assert.equal(deckProxyCopies(real), 1)
})

test('only proxies you own a spare of are offered, and a spare is offered once', () => {
  const collections = [binder('Blue', [entry('Sol Ring', 1), entry('Cultivate', 0, 1)]), binder('wish', [entry('Lightning Bolt', 4)], 'WISHLIST')]
  assert.deepEqual([...spareCopies(collections)], [['sol ring', 1], ['cultivate', 1]])

  const a = deck('A', 'PROXY', card('Sol Ring'), card('Lightning Bolt', 4))
  const b = deck('B', 'PROXY', card('Sol Ring'))
  const swaps = proxySwaps(collections, [a, b])
  // A wishlist copy isn't a card you hold, and the one Sol Ring can only go in one deck.
  assert.deepEqual(swaps.map((s) => [s.deck.name, s.entry.name, s.spare]), [['A', 'Sol Ring', 1]])
})

test('swapping one in takes the copy out of the binder and off the proxy count', () => {
  const collections = [binder('Blue', [entry('Sol Ring', 2)])]
  const decks = [deck('Pile', 'PROXY', card('Sol Ring', 2))]
  const first = withSwapIn(collections, decks, 'Pile', 'id-Sol Ring')
  assert.equal(proxyCopies(first.decks[0], first.decks[0].cards[0]), 1)
  assert.equal(first.collections[0].entries[0].quantity, 1)

  // And again: the last binder copy goes, and the entry with it.
  const second = withSwapIn(first.collections, first.decks, 'Pile', 'id-Sol Ring')
  assert.equal(deckProxyCopies(second.decks[0]), 0)
  assert.deepEqual(second.collections[0].entries, [])

  // Nothing left to swap: the very same objects come back.
  const third = withSwapIn(second.collections, second.decks, 'Pile', 'id-Sol Ring')
  assert.equal(third.decks, second.decks)
  assert.equal(third.collections, second.collections)
})

test('a real copy in another deck is pointed out, never offered as a swap', () => {
  const pile = deck('Pile', 'PROXY', card('Sol Ring'), card('Cultivate', 2), card('Mana Crypt'))
  const decks = [
    pile,
    deck('Atraxa', 'PHYSICAL', card('Sol Ring'), card('Cultivate')),
    deck('Kinnan', 'PHYSICAL', card('Sol Ring')),
    // Proxies of it elsewhere, and decks you don't hold, aren't a real copy anywhere.
    deck('Other pile', 'PROXY', card('Mana Crypt')),
    deck('Idea', 'VIRTUAL', card('Mana Crypt')),
  ]
  const found = proxiesHeldElsewhere([], decks, pile)
  assert.deepEqual(
    found.map((f) => [f.entry.name, f.proxies, f.decks.map((d) => `${d.deck.name}:${d.copies}`)]),
    [['Sol Ring', 1, ['Atraxa:1', 'Kinnan:1']], ['Cultivate', 2, ['Atraxa:1']]],
  )
  // Nothing moved: it's a pointer, not a swap.
  assert.deepEqual(proxySwaps([], decks.slice(0, 1)), [])
})

test('a proxy a binder copy covers is left to the swap', () => {
  const pile = deck('Pile', 'PROXY', card('Sol Ring'), card('Cultivate', 2))
  const decks = [pile, deck('Atraxa', 'PHYSICAL', card('Sol Ring'), card('Cultivate', 2))]
  // One Cultivate is in a binder, so only the second still needs finding.
  const found = proxiesHeldElsewhere([binder('Blue', [entry('Sol Ring'), entry('Cultivate')])], decks, pile)
  assert.deepEqual(found.map((f) => [f.entry.name, f.proxies]), [['Cultivate', 1]])
})

test('the deck itself is never where its own proxy is held', () => {
  const mixed = deck('Mixed', 'PHYSICAL', card('Sol Ring', 2, 1))
  // One real Sol Ring and one proxy, in the same deck: the real one is no answer to the proxy.
  assert.deepEqual(proxiesHeldElsewhere([], [mixed], mixed), [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WISHLIST_ID, WISHLIST_NAME, decksConsidering, isWishlist, withWishlist } from '../../src/collection/wishlist.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'

// The one Wishlist: always there, old wishlists folded in, and the cards decks are considering that
// aren't owned. The Android app has the same checks — see WishlistTest.kt.

const entry = (scryfallId: string, name: string, quantity = 1, priceAlert: number | null = null, auto = false): CollectionEntry =>
  ({ scryfallId, name, imageUrl: null, quantity, foilQuantity: 0, priceAlert, auto })
const binder = (id: string, name: string, entries: CollectionEntry[], type: Collection['type'] = 'OWNED'): Collection =>
  ({ id, name, entries, createdAt: 0, type })
const deck = (name: string, ...considering: string[]) =>
  ({ id: name, name, cards: [], considering: considering.map((c) => ({ scryfallId: `id-${c}`, name: c, imageUrl: null, quantity: 1 }) as DeckCardEntry) }) as unknown as Deck

test('the Wishlist is always there, and old wishlists fold into it', () => {
  const made = withWishlist([binder('b', 'Binder', [entry('sol', 'Sol Ring')])], [])
  assert.deepEqual(made.map((c) => c.id), ['b', WISHLIST_ID])
  assert.equal(made[1].type, 'WISHLIST')

  const old1 = binder('w1', 'Upgrades', [entry('opal', 'Mox Opal', 1, 50), entry('dt', 'Demonic Tutor')], 'WISHLIST')
  const old2 = binder('w2', 'Cheap stuff', [entry('opal', 'Mox Opal', 2)], 'WISHLIST')
  const merged = withWishlist([...made, old1, old2], [])
  assert.deepEqual(merged.map((c) => c.id), ['b', WISHLIST_ID])
  const wish = new Map(merged[1].entries.map((e) => [e.name, e]))
  assert.equal(wish.get('Mox Opal')?.quantity, 3)
  assert.equal(wish.get('Mox Opal')?.priceAlert, 50)
  assert.ok(wish.has('Demonic Tutor'))

  // Nothing to change: the very same array, so nothing is written.
  assert.equal(withWishlist(merged, []), merged)
})

test("cards decks are considering that aren't owned come and go by themselves", () => {
  const start = withWishlist([
    binder('b', 'Binder', [entry('sol', 'Sol Ring')]),
    binder(WISHLIST_ID, WISHLIST_NAME, [entry('x', 'Rhystic Study')], 'WISHLIST'),
  ], [])
  const decks = [deck('Omnath', 'Sol Ring', 'Cultivate', 'Rhystic Study'), deck('Krenko', 'cultivate', 'Goblin Bombardment')]

  const withConsidering = withWishlist(start, decks)
  const wish = withConsidering.find(isWishlist)!.entries
  // Sol Ring is owned; Rhystic Study was added by hand already; Cultivate once, however many decks.
  assert.deepEqual(wish.map((e) => e.name), ['Rhystic Study', 'Cultivate', 'Goblin Bombardment'])
  assert.deepEqual(wish.map((e) => !!e.auto), [false, true, true])
  assert.deepEqual(decksConsidering(decks, 'Cultivate'), ['Omnath', 'Krenko'])

  // Bought a Cultivate, and Krenko stopped considering the Bombardment: both go. Rhystic Study,
  // added by hand, stays though no deck considers it any more.
  const bought = withConsidering.map((c) => (c.id === 'b' ? { ...c, entries: [...c.entries, entry('cult', 'Cultivate')] } : c))
  const after = withWishlist(bought, [deck('Omnath', 'Sol Ring', 'Cultivate')])
  assert.deepEqual(after.find(isWishlist)!.entries.map((e) => e.name), ['Rhystic Study'])
})

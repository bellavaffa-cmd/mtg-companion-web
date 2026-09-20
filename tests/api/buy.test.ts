import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buyCardUrl, buyListUrl } from '../../src/api/buy.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Where the Buy buttons send you. The Android app builds the same mass-entry link — see
// DeckDetailViewModel.buyMissingUrl.

test("a printing's own shop link is used, and a name falls back to a search", () => {
  const card = { name: 'Sol Ring', purchase_uris: { tcgplayer: 'https://tcgplayer.test/sol-ring' } } as unknown as ScryfallCard
  assert.equal(buyCardUrl(card), 'https://tcgplayer.test/sol-ring')

  const noLink = { name: "Kenrith's Transformation" } as unknown as ScryfallCard
  const search = buyCardUrl(noLink)
  assert.ok(search.startsWith('https://www.tcgplayer.com/search/magic/product?q='))
  // encodeURIComponent leaves an apostrophe alone and turns a space into %20.
  assert.ok(search.includes("Kenrith's%20Transformation"), search)
  // A binder entry has no card data at all, only the name.
  assert.equal(buyCardUrl(null, "Kenrith's Transformation"), search)
})

test('a list of cards becomes one TCGplayer basket', () => {
  const url = buyListUrl([{ name: 'Sol Ring', quantity: 1 }, { name: 'Lightning Bolt', quantity: 4 }])!
  assert.equal(decodeURIComponent(url.split('?c=')[1]), '1 Sol Ring||4 Lightning Bolt')
  // Nothing to buy, nowhere to go.
  assert.equal(buyListUrl([]), null)
  assert.equal(buyListUrl([{ name: '  ', quantity: 2 }]), null)
  // A missing or silly count still buys one.
  assert.equal(decodeURIComponent(buyListUrl([{ name: 'Sol Ring', quantity: 0 }])!.split('?c=')[1]), '1 Sol Ring')
})

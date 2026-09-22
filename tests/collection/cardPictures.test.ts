import { test } from 'node:test'
import assert from 'node:assert/strict'
import { biggerImageUrl, largeImageUrl } from '../../src/types/scryfall.ts'

// Feeding the hover preview: a thumbnail's address has to lead back to the whole card.

const NORMAL = 'https://cards.scryfall.io/normal/front/6/a/6a0b230b.jpg?1783909057'

test('any size of a card picture leads back to the big one', () => {
  assert.equal(biggerImageUrl(NORMAL), 'https://cards.scryfall.io/large/front/6/a/6a0b230b.jpg?1783909057')
  assert.equal(biggerImageUrl(NORMAL.replace('/normal/', '/small/')), 'https://cards.scryfall.io/large/front/6/a/6a0b230b.jpg?1783909057')
  // The rows show art crops (kit.tsx's toArtCrop), and that's what the mouse is resting on.
  assert.equal(biggerImageUrl(NORMAL.replace('/normal/', '/art_crop/')), 'https://cards.scryfall.io/large/front/6/a/6a0b230b.jpg?1783909057')
})

test('a picture that isn\'t a card\'s gets no preview, rather than a guess that would 404', () => {
  assert.equal(biggerImageUrl('https://example.com/normal/cat.jpg'), null)
  assert.equal(biggerImageUrl('https://svgs.scryfall.io/card-symbols/G.svg'), null)
  assert.equal(biggerImageUrl(null), null)
  assert.equal(biggerImageUrl(undefined), null)
  assert.equal(biggerImageUrl(''), null)
})

test('the big picture falls back when Scryfall has no large size', () => {
  assert.equal(largeImageUrl({ id: '1', name: 'A', image_uris: { large: 'L', normal: 'N' } } as never), 'L')
  assert.equal(largeImageUrl({ id: '1', name: 'A', image_uris: { normal: 'N' } } as never), 'N')
  // Two-faced cards show their front.
  assert.equal(largeImageUrl({ id: '1', name: 'A', card_faces: [{ image_uris: { large: 'FL' } }] } as never), 'FL')
  assert.equal(largeImageUrl(null), null)
})

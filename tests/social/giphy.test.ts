import { test } from 'node:test'
import assert from 'node:assert/strict'
import { giphyId, giphyRenditions } from '../../src/social/giphy.ts'

test('the GIF id is read from every kind of Giphy link', () => {
  const id = '3o7TKSjRrfIPjeiVyM'
  assert.equal(giphyId(`https://giphy.com/gifs/happy-dance-${id}`), id)
  assert.equal(giphyId(`https://giphy.com/gifs/${id}`), id)
  assert.equal(giphyId(`https://giphy.com/stickers/cat-wave-${id}?utm_source=share`), id)
  assert.equal(giphyId(`https://giphy.com/embed/${id}`), id)
  assert.equal(giphyId(`https://media.giphy.com/media/${id}/giphy.gif`), id)
  assert.equal(giphyId(`https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/${id}/giphy.gif?cid=abc`), id)
  assert.equal(giphyId(`https://i.giphy.com/${id}.gif`), id)
  assert.equal(giphyId(`https://i.giphy.com/media/${id}/giphy.webp`), id)
  assert.equal(giphyId(`  https://giphy.com/gifs/${id}  `), id)
})

test('other links are not Giphy GIFs', () => {
  assert.equal(giphyId('https://giphy.com/'), null)
  assert.equal(giphyId('https://giphy.com/search/cats'), null)
  assert.equal(giphyId('https://notgiphy.com/gifs/x-3o7TKSjRrfIPjeiVyM'), null)
  assert.equal(giphyId('https://example.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif'), null)
  assert.equal(giphyId('cats'), null)
})

test('the original is tried first, then smaller versions', () => {
  assert.deepEqual(giphyRenditions('abc123'), [
    'https://media.giphy.com/media/abc123/giphy.gif',
    'https://media.giphy.com/media/abc123/giphy-downsized.gif',
    'https://media.giphy.com/media/abc123/200.gif',
    'https://media.giphy.com/media/abc123/100.gif',
  ])
})

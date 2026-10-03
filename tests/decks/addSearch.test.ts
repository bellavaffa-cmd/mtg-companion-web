import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addSearchQuery, addableCards, latestOnly } from '../../src/decks/addSearch.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The deck search's "Add to this deck" list, as on the phone (DeckDetailViewModel.addResults).

const found = (name: string) => ({ id: `id-${name}`, name }) as ScryfallCard

test('Scryfall is asked only once three letters are typed', () => {
  assert.equal(addSearchQuery('  so '), null)
  assert.equal(addSearchQuery(' sol '), 'sol')
})

test('cards the deck already has are not offered, from the first twelve answers', () => {
  const results = Array.from({ length: 14 }, (_, i) => found(`Card ${i}`))
  const offered = addableCards(results, ['Card 0', 'Card 13'])
  assert.equal(offered.length, 11)
  assert.ok(!offered.some((c) => c.name === 'Card 0'))
})

test('an answer to an older search is stale once a newer one starts', () => {
  const requests = latestOnly()
  const older = requests.start()
  const newer = requests.start()
  assert.equal(older(), false)
  assert.equal(newer(), true)
})

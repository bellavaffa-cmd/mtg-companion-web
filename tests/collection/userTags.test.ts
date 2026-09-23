import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allUserTags, collectionWithTags, deckWithTags, tidyTags, userTagsOf } from '../../src/collection/userTags.ts'
import type { Collection, Deck, DeckCardEntry } from '../../src/types/models.ts'

// A tag belongs to the copy, so it reads the same wherever that copy is held.

const BOLT = 'bolt-id'

const card = (scryfallId: string, extra: Partial<DeckCardEntry> = {}): DeckCardEntry => ({
  scryfallId, name: 'Lightning Bolt', imageUrl: null, quantity: 1,
  canBeCommander: false, typeLine: 'Instant', partnerAbility: null, ...extra,
})

const deck = (cards: DeckCardEntry[], extra: Partial<Deck> = {}): Deck => ({
  id: 'd1', name: 'Burn', commander: null, partnerCommander: null, cards,
  gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'PHYSICAL', ...extra,
})

const binder = (entries: Collection['entries']): Collection =>
  ({ id: 'c1', name: 'Binder', type: 'OWNED', createdAt: 0, entries } as Collection)

test('what the user typed is tidied, not taken literally', () => {
  assert.deepEqual(tidyTags(['  proxy ', 'Proxy', 'signed']), ['proxy', 'signed'])
  assert.deepEqual(tidyTags(['lent   to   Sam']), ['lent to Sam'])
  assert.deepEqual(tidyTags(['', '   ']), [])
  assert.equal(tidyTags(['x'.repeat(60)])[0].length, 30)
})

test('a tag put on a copy reads the same from the deck and from the binder', () => {
  const d = deckWithTags(deck([card(BOLT)]), BOLT, ['proxy'])
  const c = collectionWithTags(binder([{ scryfallId: BOLT, name: 'Lightning Bolt', imageUrl: null, quantity: 2, foilQuantity: 0 }]), BOLT, ['proxy'])
  assert.deepEqual(d.cards[0].userTags, ['proxy'])
  assert.deepEqual(c.entries[0].userTags, ['proxy'])
  assert.deepEqual(userTagsOf([d], [c], BOLT), ['proxy'])
})

test('it follows the copy, not the card: another printing is untouched', () => {
  const d = deckWithTags(deck([card(BOLT), card('other-art')]), BOLT, ['signed'])
  assert.deepEqual(d.cards[0].userTags, ['signed'])
  assert.equal(d.cards[1].userTags, undefined)
  assert.deepEqual(userTagsOf([d], [], 'other-art'), [])
})

test('commanders and cards being considered carry the tag too', () => {
  const d = deckWithTags(
    deck([], { commander: card(BOLT), considering: [card(BOLT)] }),
    BOLT, ['proxy'],
  )
  assert.deepEqual(d.commander!.userTags, ['proxy'])
  assert.deepEqual(d.considering![0].userTags, ['proxy'])
})

test('taking every tag off leaves no leftover field behind', () => {
  const tagged = deckWithTags(deck([card(BOLT)]), BOLT, ['proxy'])
  const bare = deckWithTags(tagged, BOLT, [])
  assert.equal('userTags' in bare.cards[0], false)
})

test('nothing is rewritten when the tags already read that way', () => {
  const tagged = deckWithTags(deck([card(BOLT)]), BOLT, ['proxy'])
  assert.equal(deckWithTags(tagged, BOLT, ['proxy']), tagged)
})

test('tags already used are offered again, the most used first', () => {
  const d = deck([card(BOLT, { userTags: ['proxy', 'signed'] }), card('x', { userTags: ['proxy'] })])
  const c = binder([{ scryfallId: 'y', name: 'Y', imageUrl: null, quantity: 1, foilQuantity: 0, userTags: ['Proxy'] }])
  assert.deepEqual(allUserTags([d], [c]), ['proxy', 'signed'])
})

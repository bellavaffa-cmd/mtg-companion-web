import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allUserTags, collectionWithTags, deckWithTags, keepUserTags, ledgerWith, tidyTags, userTagsOf } from '../../src/collection/userTags.ts'
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

// What the emulator caught: tagging a card in a binder, then moving it into a deck, lost the tag.
// A move removes the binder entry and makes a fresh deck entry, which knows nothing about the copy.

test('a tagged copy moved from a binder into a deck keeps its tag', () => {
  const tagged = keepUserTags({
    decks: [],
    collections: [binder([{ scryfallId: BOLT, name: 'Lightning Bolt', imageUrl: null, quantity: 1, foilQuantity: 0, userTags: ['proxy'] }])],
  })
  assert.deepEqual(tagged.userTags, { [BOLT]: ['proxy'] })

  // The move: out of the binder, into a deck as a brand-new entry with no tags of its own.
  const moved = keepUserTags({
    ...tagged,
    decks: [deck([card(BOLT)])],
    collections: [binder([])],
  })
  assert.deepEqual(moved.decks[0].cards[0].userTags, ['proxy'])
})

test('a copy added again later is tagged as it was before', () => {
  const had = keepUserTags({ decks: [deck([card(BOLT, { userTags: ['signed'] })])], collections: [] })
  // Removed from everywhere, then added back by a scan or a search.
  const gone = keepUserTags({ ...had, decks: [deck([])] })
  const again = keepUserTags({ ...gone, decks: [deck([card(BOLT)])] })
  assert.deepEqual(again.decks[0].cards[0].userTags, ['signed'])
})

test('taking a tag off is not undone by the copies that still carry it', () => {
  const had = keepUserTags({ decks: [deck([card(BOLT, { userTags: ['proxy'] })])], collections: [] })
  // setCardTags writes the note first, then the copies — both in one go.
  const cleared = keepUserTags({
    ...had,
    userTags: ledgerWith(had, BOLT, []),
    decks: [deckWithTags(had.decks[0], BOLT, [])],
  })
  assert.equal('userTags' in cleared.decks[0].cards[0], false)
  assert.deepEqual(cleared.userTags, {})
})

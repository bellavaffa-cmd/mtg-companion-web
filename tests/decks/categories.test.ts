import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  categoryCounts, categoryLine, deckCategoryNames, groupCards, removedCategory, renamedCategory, suggestedCategories,
  tidyCategory, withCardCategories, withCategoryTarget, withSuggestedCategories, type CardFacts,
} from '../../src/decks/categories.ts'
import { normalizeDeck, type DeckCardEntry } from '../../src/types/models.ts'

// A deck's categories, the other ways to group its cards, and "Suggest categories". The Android app
// runs the same cases — see DeckCategoriesTest.kt.

const card = (id: string, quantity = 1, categories?: string[]): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...(categories ? { categories } : {}) })
const deckOf = (cards: DeckCardEntry[]) => normalizeDeck({ id: 'd', name: 'D', cards })

test("setting a card's categories tidies them and marks the deck's categories known", () => {
  const deck = withCardCategories(deckOf([card('sol'), card('bolt')]), 'sol', [' Ramp ', 'ramp', 'Mana  rocks', ''])
  assert.deepEqual(deck.cards[0].categories, ['Ramp', 'Mana rocks'])
  assert.deepEqual(deck.categoryTargets, {})
  const cleared = withCardCategories(deck, 'sol', [])
  assert.equal('categories' in cleared.cards[0], false)
  assert.deepEqual(cleared.categoryTargets, {})
  assert.equal(tidyCategory('x'.repeat(50)).length, 40)
})

test('counts and targets', () => {
  let deck = deckOf([card('sol', 1, ['Ramp']), card('signet', 2, ['ramp', 'Draw']), card('bolt', 4)])
  deck = withCategoryTarget(deck, 'Ramp', 12)
  deck = withCategoryTarget(deck, 'Win cons', 3)
  assert.deepEqual(deckCategoryNames(deck), ['Draw', 'Ramp', 'Win cons'])
  assert.deepEqual(categoryCounts(deck), { Draw: 2, Ramp: 3, 'Win cons': 0 })
  assert.equal(categoryLine('Ramp', 3, 12), 'Ramp 3/12')
  assert.equal(categoryLine('Draw', 2, null), 'Draw 2')
  assert.deepEqual(withCategoryTarget(deck, 'ramp', null).categoryTargets, { 'Win cons': 3 })
  assert.deepEqual(withCategoryTarget(deck, 'Ramp', 0).categoryTargets, { 'Win cons': 3 })
})

test('renaming and removing a category', () => {
  let deck = withCategoryTarget(deckOf([card('sol', 1, ['Ramp']), card('signet', 1, ['Rocks', 'Ramp'])]), 'Rocks', 5)
  deck = renamedCategory(deck, 'rocks', 'Ramp')
  assert.deepEqual(deck.cards.map((c) => c.categories), [['Ramp'], ['Ramp']])
  assert.deepEqual(deck.categoryTargets, { Ramp: 5 })
  deck = removedCategory(deck, 'RAMP')
  assert.deepEqual(deck.cards.map((c) => c.categories), [undefined, undefined])
  assert.deepEqual(deck.categoryTargets, {})
})

test('suggesting categories from role tags fills only cards without any', () => {
  const tags: Record<string, string[]> = { sol: ['mana-rock', 'ramp'], bolt: ['removal', 'burn'], wrath: ['board-wipe'], bear: [], cs: ['counterspell'] }
  const deck = deckOf([card('sol'), card('bolt'), card('wrath', 1, ['Mine']), card('bear'), card('cs')])
  assert.deepEqual([...suggestedCategories(deck, (n) => tags[n] ?? [])], [['sol', ['Ramp']], ['bolt', ['Removal', 'Burn']], ['cs', ['Counterspells']]])
  const { deck: filled, filled: n } = withSuggestedCategories(deck, (n) => tags[n] ?? [])
  assert.equal(n, 3)
  assert.deepEqual(filled.cards.map((c) => c.categories), [['Ramp'], ['Removal', 'Burn'], ['Mine'], undefined, ['Counterspells']])
  assert.deepEqual(filled.categoryTargets, {})
  assert.equal(withSuggestedCategories(deckOf([card('bear')]), () => []).filled, 0)
})

const facts: Record<string, CardFacts> = {
  sol: { cmc: 1, colors: [], land: false, roles: ['Mana rock', 'Mana ramp'] },
  bolt: { cmc: 1, colors: ['R'], land: false, roles: ['Removal'] },
  hoof: { cmc: 8, colors: ['G'], land: false, roles: [] },
  kolaghan: { cmc: 2, colors: ['B', 'R'], land: false, roles: ['Removal'] },
  forest: { cmc: 0, colors: [], land: true, roles: [] },
}
const cards = [card('sol', 1, ['Ramp']), card('bolt', 4, ['Removal', 'Ramp']), card('hoof'), card('kolaghan', 1, ['Removal']), card('forest', 10), card('mystery')]
const shown = (groups: ReturnType<typeof groupCards>) => groups.map((g) => [g.label, g.cards.map((c) => c.scryfallId), g.count, g.target])

test('grouped by category, mana value, colour and role tag', () => {
  const f = (e: DeckCardEntry) => facts[e.scryfallId]
  assert.deepEqual(shown(groupCards(cards, 'CATEGORY', f, { Ramp: 10, 'Win cons': 2, Draw: 0 })), [
    ['Draw', [], 0, 0],
    ['Ramp', ['bolt', 'sol'], 5, 10],
    ['Removal', ['bolt', 'kolaghan'], 5, null],
    ['Win cons', [], 0, 2],
    ['No category', ['forest', 'hoof', 'mystery'], 12, null],
  ])
  assert.deepEqual(shown(groupCards(cards, 'MANA_VALUE', f)), [
    ['1 mana', ['bolt', 'sol'], 5, null],
    ['2 mana', ['kolaghan'], 1, null],
    ['7+ mana', ['hoof'], 1, null],
    ['Lands', ['forest'], 10, null],
    ['Not known yet', ['mystery'], 1, null],
  ])
  assert.deepEqual(shown(groupCards(cards, 'COLOUR', f)), [
    ['Red', ['bolt'], 4, null],
    ['Green', ['hoof'], 1, null],
    ['Multicolour', ['kolaghan'], 1, null],
    ['Colourless', ['sol'], 1, null],
    ['Lands', ['forest'], 10, null],
    ['Not known yet', ['mystery'], 1, null],
  ])
  assert.deepEqual(shown(groupCards(cards, 'ROLE', f)), [
    ['Removal', ['bolt', 'kolaghan'], 5, null],
    ['Mana ramp', ['sol'], 1, null],
    ['Mana rock', ['sol'], 1, null],
    ['No role tag', ['forest', 'hoof', 'mystery'], 12, null],
  ])
})

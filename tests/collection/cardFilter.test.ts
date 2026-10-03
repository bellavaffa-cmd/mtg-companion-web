import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardFactsOf, filterActive, filterCount, filterMatches, NO_COLLECTION_FILTER, type CollectionFilter } from '../../src/collection/cardFilter.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The All cards filter, as the Android app's CollectionFilter.

const card = (over: Partial<ScryfallCard>): ScryfallCard => ({ id: 'x', name: 'X', ...over }) as ScryfallCard
const f = (over: Partial<CollectionFilter>): CollectionFilter => ({ ...NO_COLLECTION_FILTER, ...over })

const atraxa = cardFactsOf(card({
  type_line: 'Legendary Creature — Phyrexian Angel Horror', rarity: 'mythic', color_identity: ['W', 'U', 'B', 'G'],
  oracle_text: 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.',
}))
const bolt = cardFactsOf(card({ type_line: 'Instant', rarity: 'common', colors: ['R'], oracle_text: 'Lightning Bolt deals 3 damage to any target.' }))
const solRing = cardFactsOf(card({ type_line: 'Artifact', rarity: 'Uncommon', oracle_text: '{T}: Add {C}{C}.' }))

test('no filter lets everything through, even cards not loaded yet', () => {
  assert.equal(filterActive(NO_COLLECTION_FILTER), false)
  assert.equal(filterMatches(NO_COLLECTION_FILTER, undefined), true)
})

test('a card not loaded yet is left out while a filter is on', () => {
  assert.equal(filterMatches(f({ type: 'creature' }), undefined), false)
})

test('type needs every word typed, in any order and case', () => {
  assert.equal(filterMatches(f({ type: 'creature legendary' }), atraxa), true)
  assert.equal(filterMatches(f({ type: 'legendary  artifact' }), atraxa), false)
})

test('text is one phrase in the rules text', () => {
  assert.equal(filterMatches(f({ text: ' Deals 3 damage ' }), bolt), true)
  assert.equal(filterMatches(f({ text: '3 damage to target' }), bolt), false)
})

test('colours are "at least": every chosen colour, from the colour identity', () => {
  assert.equal(filterMatches(f({ colors: ['W', 'G'] }), atraxa), true)
  assert.equal(filterMatches(f({ colors: ['W', 'R'] }), atraxa), false)
  assert.equal(filterMatches(f({ colors: ['R'] }), bolt), true)
  assert.equal(filterMatches(f({ colors: ['R'] }), solRing), false)
})

test('rarity is any of the chosen ones, ignoring case', () => {
  assert.equal(filterMatches(f({ rarities: ['uncommon', 'rare'] }), solRing), true)
  assert.equal(filterMatches(f({ rarities: ['rare'] }), atraxa), false)
})

test('the count is one per text field plus each colour and rarity', () => {
  assert.equal(filterCount(f({ type: 'creature', text: ' ', colors: ['W', 'U'], rarities: ['rare'] })), 4)
})

test('every face\'s rules text is searched', () => {
  const dfc = cardFactsOf(card({ card_faces: [{ name: 'A', type_line: 'Creature', oracle_text: 'Transform it.' }, { name: 'B', type_line: 'Land', oracle_text: 'Add {G}.' }] as ScryfallCard['card_faces'] }))
  assert.equal(filterMatches(f({ text: 'add {g}' }), dfc), true)
})

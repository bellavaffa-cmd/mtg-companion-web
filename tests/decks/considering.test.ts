import { test } from 'node:test'
import assert from 'node:assert/strict'
import { breakText, combosWithCard, moveToConsidering, nearMisses, swapConsidered, swapOptions } from '../../src/decks/considering.ts'
import type { ComboVariant } from '../../src/api/relay.ts'
import type { Deck, DeckCardEntry } from '../../src/types/models.ts'

// Considering moves and the combo warning, as the phone does them (DeckRepository.swap/moveToConsidering,
// ComboPieceWarningDialog, near misses in DeckDetailViewModel).

const entry = (name: string, extra: Partial<DeckCardEntry> = {}) => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null, ...extra }) as DeckCardEntry
const deck = (cards: DeckCardEntry[], considering: DeckCardEntry[] = []): Deck => ({
  id: 'd', name: 'Deck', commander: null, partnerCommander: null, cards, considering, gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'PHYSICAL',
})
const combo = (id: string, names: string[], popularity = 0): ComboVariant => ({ id, uses: names.map((name) => ({ card: { name } })), produces: [], popularity })

test('moving a card to Considering takes every copy out and drops its cut flag', () => {
  const d = moveToConsidering(deck([entry('A', { quantity: 2, replaceable: true }), entry('B')]), 'id-A')
  assert.deepEqual(d.cards.map((c) => c.name), ['B'])
  assert.equal(d.considering![0].name, 'A')
  assert.equal(d.considering![0].replaceable, false)
  // Already there: not listed twice.
  const again = moveToConsidering(deck([entry('A')], [entry('A')]), 'id-A')
  assert.equal(again.considering!.length, 1)
})

test('a swap trades a deck card for a considered one in one step', () => {
  const d = swapConsidered(deck([entry('A', { replaceable: true }), entry('B')], [entry('C')]), 'id-A', 'id-C')
  assert.deepEqual(d.cards.map((c) => c.name).sort(), ['B', 'C'])
  assert.deepEqual(d.considering!.map((c) => c.name), ['A'])
  // Unknown halves leave the deck alone.
  const same = deck([entry('A')])
  assert.equal(swapConsidered(same, 'id-A', 'id-X'), same)
})

test('cut candidates come first in the swap picker', () => {
  const ordered = swapOptions([entry('b'), entry('Z', { replaceable: true }), entry('a')])
  assert.deepEqual(ordered.map((c) => c.name), ['Z', 'a', 'b'])
})

test('the combos a card is a piece of, by either face', () => {
  const combos = [combo('1', ['Delver of Secrets // Insectile Aberration', 'X']), combo('2', ['Y', 'Z'])]
  assert.deepEqual(combosWithCard(combos, 'Delver of Secrets').map((c) => c.id), ['1'])
  assert.equal(breakText(1), 'Cutting it would break this combo:')
  assert.equal(breakText(3), 'Cutting it would break these 3 combos:')
})

test('near misses: exactly one card short, most popular first', () => {
  const found = nearMisses({ included: [], almostIncluded: [combo('a', ['A', 'X'], 5), combo('b', ['A', 'X', 'Y'], 9), combo('c', ['A', 'B', 'W'], 7)] }, ['A', 'B'])
  assert.deepEqual(found.map((n) => [n.combo.id, n.missing]), [['c', ['W']], ['a', ['X']]])
})

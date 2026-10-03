import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDeck } from '../../src/sync/mergeItems.ts'
import { normalizeDeck, type Deck, type DeckCardEntry } from '../../src/types/models.ts'

// The three-way deck merge. The Android app's ItemMergeTest has the same case.

const card = (id: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })
const deck = (sideboard?: DeckCardEntry[]): Deck =>
  normalizeDeck({ id: 'd', name: 'Burn', gameMode: 'MODERN', createdAt: 1, ...(sideboard ? { sideboard } : {}) })

test('the sideboard merges like the deck itself', () => {
  const base = deck([card('a', 2), card('gone')])
  const mine = deck([card('a', 3), card('b')])
  const theirs = deck([card('a', 4), card('gone'), card('c')])
  const onMine = mergeDeck(base, mine, theirs, true)
  const shown = (d: Deck) => (d.sideboard ?? []).map((c) => `${c.scryfallId}x${c.quantity}`).sort()
  // Added on each side kept, removed on one side gone, counts changed on both add up.
  assert.deepEqual(shown(onMine), ['ax5', 'bx1', 'cx1'])
  // Both devices land on the same list.
  assert.deepEqual(shown(mergeDeck(base, theirs, mine, false)), shown(onMine))
  // A deck saved before sideboards existed merges as an empty one.
  assert.deepEqual(shown(mergeDeck(deck(), deck([card('b')]), deck(), true)), ['bx1'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareCount, deckCounts, diffDecks, identical, versionCounts } from '../../src/decks/deckCompare.ts'
import { normalizeDeck, type DeckCardEntry } from '../../src/types/models.ts'

// Comparing a deck with another deck or with one of its saved versions. The Android app's
// DeckCompareTest has the same cases.

const card = (id: string, name: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })

test('cards only here, only there, and in both with their counts', () => {
  const diff = diffDecks(
    new Map([['Sol Ring', 1], ['Forest', 30], ['Cultivate', 1]]),
    new Map([['sol ring', 1], ['Forest', 28], ['Rampant Growth', 1]]),
  )
  assert.deepEqual(diff.onlyHere, [{ name: 'Cultivate', here: 1, there: 0 }])
  assert.deepEqual(diff.onlyThere, [{ name: 'Rampant Growth', here: 0, there: 1 }])
  // The counts that differ first.
  assert.deepEqual(diff.both, [{ name: 'Forest', here: 30, there: 28 }, { name: 'Sol Ring', here: 1, there: 1 }])
  assert.deepEqual(diff.both.map(compareCount), ['30 → 28', '1'])
})

test('a deck reads like a saved version of itself, so an unchanged deck is identical', () => {
  const atraxa = card('a', 'Atraxa')
  const deck = normalizeDeck({
    id: 'd', name: 'A', commander: atraxa,
    cards: [atraxa, card('f1', 'Forest', 10), card('f2', 'Forest', 5)],
    sideboard: [card('x', 'Duress')],
  })
  assert.deepEqual([...deckCounts(deck)], [['Atraxa', 1], ['Forest', 15]])
  const version = { id: 'v', savedAt: 0, cards: { Forest: 15, Atraxa: 1 }, commanders: ['Atraxa'] }
  assert.ok(identical(diffDecks(deckCounts(deck), versionCounts(version))))
})

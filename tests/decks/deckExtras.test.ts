import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keepDeckExtrasFromOlderApp, mergeCategoryTargets } from '../../src/decks/deckExtras.ts'
import { mergeDeck } from '../../src/sync/mergeItems.ts'
import { normalizeDeck, type Deck, type DeckCardEntry } from '../../src/types/models.ts'

// How a deck's primer, folder, archive flag, companion and categories merge, and survive a save by an
// app from before them. The Android app runs the same cases — see DeckExtrasTest.kt.

const card = (id: string, categories?: string[]): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null, ...(categories ? { categories } : {}) })
const deck = (more: Partial<Deck> = {}): Deck => normalizeDeck({ id: 'd', name: 'D', createdAt: 1, cards: [card('a'), card('b')], ...more })

test("an older app's save keeps this device's primer, folder, flag, companion and categories", () => {
  const mine = deck({
    description: 'Go wide', folder: 'Modern', archived: false, companion: 'Lurrus of the Dream-Den',
    categoryTargets: { Ramp: 10 }, cards: [card('a', ['Ramp']), card('b')],
  })
  const old = deck({ name: 'Renamed', cards: [card('a'), card('b'), card('c')] })
  const healed = keepDeckExtrasFromOlderApp(mine, old)
  assert.equal(healed.name, 'Renamed')
  assert.equal(healed.description, 'Go wide')
  assert.equal(healed.folder, 'Modern')
  assert.equal(healed.archived, false)
  assert.equal(healed.companion, 'Lurrus of the Dream-Den')
  assert.deepEqual(healed.categoryTargets, { Ramp: 10 })
  assert.deepEqual(healed.cards.map((c) => c.categories), [['Ramp'], undefined, undefined])
  // A save that knows them is left as it is — cleared ones included.
  const knowing = deck({ description: '', folder: '', categoryTargets: {} })
  assert.equal(keepDeckExtrasFromOlderApp(mine, knowing).description, '')
  assert.equal(keepDeckExtrasFromOlderApp(deck(), old), old)
})

test("each category's target merges on its own", () => {
  assert.deepEqual(mergeCategoryTargets({ Ramp: 10, Draw: 8 }, { Ramp: 12, Draw: 8 }, { Ramp: 10, Removal: 5 }, false), { Ramp: 12, Removal: 5 })
  assert.equal(mergeCategoryTargets(undefined, undefined, undefined, true), undefined)
  assert.deepEqual(mergeCategoryTargets({ Ramp: 10 }, { Ramp: 11 }, { Ramp: 9 }, true), { Ramp: 11 })
})

test('primer, folder and companion go to whoever changed them; categories keep both sides', () => {
  const base = deck({ description: 'v1', folder: 'A', categoryTargets: {}, cards: [card('a', ['Ramp']), card('b')] })
  const mine = deck({ description: 'v2', folder: 'A', archived: true, categoryTargets: {}, cards: [card('a', ['Ramp', 'Draw']), card('b')] })
  const theirs = deck({ description: 'v1', folder: 'B', companion: 'Yorion, Sky Nomad', categoryTargets: { Ramp: 9 }, cards: [card('a'), card('b', ['Removal'])] })
  const merged = mergeDeck(base, mine, theirs, false)
  assert.equal(merged.description, 'v2')
  assert.equal(merged.folder, 'B')
  assert.equal(merged.archived, true)
  assert.equal(merged.companion, 'Yorion, Sky Nomad')
  assert.deepEqual(merged.categoryTargets, { Ramp: 9 })
  // Draw added here, Ramp taken off there; Removal added there.
  assert.deepEqual(merged.cards.map((c) => c.categories), [['Draw'], ['Removal']])
  // Both devices land on the same deck.
  assert.deepEqual(mergeDeck(base, theirs, mine, true), merged)
  // An older app's side doesn't clear them.
  const old = deck({ cards: [card('a'), card('b')] })
  const kept = mergeDeck(base, mine, old, false)
  assert.equal(kept.description, 'v2')
  assert.deepEqual(kept.cards.map((c) => c.categories), [['Ramp', 'Draw'], undefined])
})

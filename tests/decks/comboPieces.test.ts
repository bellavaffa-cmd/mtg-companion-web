import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardNameKeys, comboLookupNames, comboPieces, filterCounts, hasNameKey, passesFilter } from '../../src/decks/comboPieces.ts'
import type { ComboVariant } from '../../src/api/relay.ts'
import type { Deck, DeckCardEntry } from '../../src/types/models.ts'

// The Cards tab's combo badges and filter chips. The Android app has the same rules — see
// cardNameKeys/comboPieces in DeckBuilding.kt and the near misses in DeckDetailViewModel.

const combo = (id: string, ...names: string[]): ComboVariant => ({ id, uses: names.map((name) => ({ card: { name } })), produces: [] })
const card = (name: string, extra: Partial<DeckCardEntry> = {}) => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity: 1, ...extra }) as DeckCardEntry

test('a double-faced card matches by its whole name and by its front face', () => {
  assert.deepEqual(cardNameKeys(' Delver of Secrets // Insectile Aberration '), ['delver of secrets // insectile aberration', 'delver of secrets'])
  assert.deepEqual(cardNameKeys('Sol Ring'), ['sol ring'])
  assert.ok(hasNameKey(new Set(['delver of secrets']), 'Delver of Secrets // Insectile Aberration'))
})

test('every card of a combo the deck has is a piece of it', () => {
  const found = comboPieces({ included: [combo('a', 'Dramatic Reversal', 'Isochron Scepter')], almostIncluded: [] }, ['Dramatic Reversal', 'Isochron Scepter', 'Forest'])
  assert.ok(hasNameKey(found.pieces, 'Isochron Scepter'))
  assert.ok(!hasNameKey(found.pieces, 'Forest'))
})

test('only a combo one card short makes near misses, and only of cards the deck has', () => {
  const found = comboPieces({
    included: [],
    almostIncluded: [combo('one', 'Thassa\'s Oracle', 'Demonic Consultation'), combo('two', 'Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts', 'Pestermite')],
  }, ['Thassa\'s Oracle', 'Kiki-Jiki, Mirror Breaker'])
  assert.deepEqual([...found.nearMiss], ['thassa\'s oracle'])
})

test('a back face in a combo matches the deck card by its front', () => {
  const found = comboPieces({ included: [combo('a', 'Delver of Secrets // Insectile Aberration', 'Sol Ring')], almostIncluded: [] }, ['Delver of Secrets'])
  assert.ok(hasNameKey(found.pieces, 'Delver of Secrets'))
})

test('the chips filter cut candidates and combo pieces, and count them', () => {
  const pieces = { pieces: new Set(['sol ring']), nearMiss: new Set<string>() }
  const cards = [card('Sol Ring'), card('Mind Stone', { replaceable: true }), card('Forest')]
  assert.deepEqual(cards.filter((c) => passesFilter(c, 'CUT', pieces)).map((c) => c.name), ['Mind Stone'])
  assert.deepEqual(cards.filter((c) => passesFilter(c, 'COMBO', pieces)).map((c) => c.name), ['Sol Ring'])
  assert.equal(cards.filter((c) => passesFilter(c, 'ALL', pieces)).length, 3)
  assert.deepEqual(filterCounts(cards, pieces), { cut: 1, combo: 1 })
})

test('the combo lookup asks about the commanders apart from the rest, each name once', () => {
  const commander = card('Urza, Lord High Artificer')
  const deck = { commander, partnerCommander: null, cards: [commander, card('Sol Ring'), card('Sol Ring', { scryfallId: 'other' })] } as unknown as Deck
  assert.deepEqual(comboLookupNames(deck), { commanders: ['Urza, Lord High Artificer'], main: ['Sol Ring'] })
})

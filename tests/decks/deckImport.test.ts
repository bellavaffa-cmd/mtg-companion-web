import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importSummary, splitBySection } from '../../src/decks/deckImport.ts'
import { parseCardList } from '../../src/collection/cardListText.ts'

// "Import list" into a deck, as on the phone: sideboard lines to the sideboard where the format has
// one, else to Considering; maybeboard to Considering.

test('in Commander, main deck lines go to the deck, sideboard and maybeboard to Considering', () => {
  const { lines } = parseCardList('Deck\n1 Sol Ring\n2x Island\n\nSideboard\n1 Duress\nSB: 1 Negate\nMaybeboard\n1 Opt')
  const { main, sideboard, considering } = splitBySection(lines, 'COMMANDER')
  assert.deepEqual(main.map((l) => [l.quantity, l.name]), [[1, 'Sol Ring'], [2, 'Island']])
  assert.deepEqual(sideboard, [])
  assert.deepEqual(considering.map((l) => l.name), ['Duress', 'Negate', 'Opt'])
})

test('in a format with a sideboard, sideboard lines go there and maybeboard to Considering', () => {
  const { lines } = parseCardList('4 Lightning Bolt\n\nSideboard\n2 Duress\nSB: 1 Negate\nMaybeboard\n1 Opt')
  const { main, sideboard, considering } = splitBySection(lines, 'MODERN')
  assert.deepEqual(main.map((l) => l.name), ['Lightning Bolt'])
  assert.deepEqual(sideboard.map((l) => [l.quantity, l.name]), [[2, 'Duress'], [1, 'Negate']])
  assert.deepEqual(considering.map((l) => l.name), ['Opt'])
})

test("an Arena list's sideboard after a blank line is read as the sideboard", () => {
  const { lines } = parseCardList('Deck\n4 Lightning Bolt\n\n2 Duress')
  assert.deepEqual(splitBySection(lines, 'MODERN').sideboard.map((l) => l.name), ['Duress'])
  // A plain list with a gap in it stays all one deck.
  assert.deepEqual(splitBySection(parseCardList('4 Lightning Bolt\n\n2 Duress').lines, 'MODERN').main.length, 2)
})

test('copies are capped at 99, as on the phone', () => {
  const { main } = splitBySection(parseCardList('500 Relentless Rats').lines)
  assert.equal(main[0].quantity, 99)
})

test('the summary says what was imported, what went to the sideboard and Considering, and what failed', () => {
  assert.deepEqual(importSummary(1, 0, 0, []), ['Imported 1 card.'])
  const s = importSummary(60, 2, 0, ['Foo', 'Bar'])
  assert.equal(s[0], 'Imported 60 cards.')
  assert.equal(s[1], '2 sideboard/maybeboard cards went to Considering.')
  assert.equal(s[2], "2 lines couldn't be matched:\n• Foo\n• Bar")
  assert.deepEqual(importSummary(60, 1, 15, []), ['Imported 60 cards.', '15 cards went to the sideboard.', '1 sideboard/maybeboard card went to Considering.'])
  const many = importSummary(0, 0, 0, Array.from({ length: 27 }, (_, i) => `C${i}`))
  assert.ok(many[1].endsWith('…and 2 more'))
})

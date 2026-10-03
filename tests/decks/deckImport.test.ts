import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importSummary, splitBySection } from '../../src/decks/deckImport.ts'
import { parseCardList } from '../../src/collection/cardListText.ts'

// "Import list" into a deck, as on the phone: sideboard and maybeboard go to Considering.

test('main deck lines go to the deck, sideboard and maybeboard to Considering', () => {
  const { lines } = parseCardList('Deck\n1 Sol Ring\n2x Island\n\nSideboard\n1 Duress\nSB: 1 Negate\nMaybeboard\n1 Opt')
  const { main, considering } = splitBySection(lines)
  assert.deepEqual(main.map((l) => [l.quantity, l.name]), [[1, 'Sol Ring'], [2, 'Island']])
  assert.deepEqual(considering.map((l) => l.name), ['Duress', 'Negate', 'Opt'])
})

test('copies are capped at 99, as on the phone', () => {
  const { main } = splitBySection(parseCardList('500 Relentless Rats').lines)
  assert.equal(main[0].quantity, 99)
})

test('the summary says what was imported, what went to Considering and what failed', () => {
  assert.deepEqual(importSummary(1, 0, []), ['Imported 1 card.'])
  const s = importSummary(60, 2, ['Foo', 'Bar'])
  assert.equal(s[0], 'Imported 60 cards.')
  assert.equal(s[1], '2 sideboard/maybeboard cards went to Considering.')
  assert.equal(s[2], "2 lines couldn't be matched:\n• Foo\n• Bar")
  const many = importSummary(0, 0, Array.from({ length: 27 }, (_, i) => `C${i}`))
  assert.ok(many[1].endsWith('…and 2 more'))
})

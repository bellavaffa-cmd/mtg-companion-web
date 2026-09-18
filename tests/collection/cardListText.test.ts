import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCardListText, csvCells, parseCardList } from '../../src/collection/cardListText.ts'

const line = (quantity: number, name: string | null, set: string | null = null, number: string | null = null, foil = false, scryfallId: string | null = null) =>
  ({ quantity, name, set, number, scryfallId, foil })

test('plain text lists in the usual shapes are read', () => {
  const { lines, skipped } = parseCardList([
    '4 Lightning Bolt',
    '2x Counterspell',
    '1 Sol Ring (CMR) 472',
    '1 Sol Ring [CMR] 472 *F*',
    '3 Llanowar Elves (M19) 314 *E*',
    '1 Arcane Signet (foil)',
    'Swords to Plowshares',
    '1 Delver of Secrets // Insectile Aberration (ISD) 51',
    '1 Rhystic Study (PCMR) #Trade',
  ].join('\n'))
  assert.deepEqual(lines, [
    line(4, 'Lightning Bolt'),
    line(2, 'Counterspell'),
    line(1, 'Sol Ring', 'cmr', '472'),
    line(1, 'Sol Ring', 'cmr', '472', true),
    line(3, 'Llanowar Elves', 'm19', '314', true),
    line(1, 'Arcane Signet', null, null, true),
    line(1, 'Swords to Plowshares'),
    line(1, 'Delver of Secrets // Insectile Aberration', 'isd', '51'),
    line(1, 'Rhystic Study', 'pcmr', null),
  ])
  assert.deepEqual(skipped, [])
})

test('headers, comments and blank lines are passed over', () => {
  const { lines } = parseCardList('Deck\n// my binder\n\nCreatures (30)\nLands: 36\nSideboard:\n1 Forest\n# note')
  assert.deepEqual(lines, [line(1, 'Forest')])
})

test('CSV rows keep their quotes and commas', () => {
  assert.deepEqual(csvCells('1,"Borrowing 100,000 Arrows",pls,"He said ""hi"""'), ['1', 'Borrowing 100,000 Arrows', 'pls', 'He said "hi"'])
})

test('ManaBox CSV: set code, number, foil and Scryfall id are used', () => {
  const csv = [
    'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price',
    'Sol Ring,CMR,Commander Legends,472,foil,uncommon,2,123,a5f3e6a9-1234-4bcd-9e8f-0123456789ab,1.5',
    '"Borrowing 100,000 Arrows",PLS,Portal Three Kingdoms,25,normal,uncommon,1,124,,',
  ].join('\n')
  assert.deepEqual(parseCardList(csv).lines, [
    line(2, 'Sol Ring', 'cmr', '472', true, 'a5f3e6a9-1234-4bcd-9e8f-0123456789ab'),
    line(1, 'Borrowing 100,000 Arrows', 'pls', '25'),
  ])
})

test('Moxfield and Deckbox CSV: a set name in Edition is ignored, a code is used', () => {
  const moxfield = 'Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number\r\n3,0,Counterspell,mh2,Near Mint,English,foil,,2024-01-01,267\r\n'
  assert.deepEqual(parseCardList(moxfield).lines, [line(3, 'Counterspell', 'mh2', '267', true)])
  const deckbox = 'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil\n1,0,Lightning Bolt,Magic 2010,146,Near Mint,English,'
  assert.deepEqual(parseCardList(deckbox).lines, [line(1, 'Lightning Bolt', null, '146')])
})

test('the list is written back one line per finish, with printings when given', () => {
  const entries = [
    { scryfallId: 'b', name: 'Sol Ring', quantity: 2, foilQuantity: 1 },
    { scryfallId: 'a', name: 'Lightning Bolt', quantity: 4, foilQuantity: 0 },
    { scryfallId: 'c', name: 'Mox Opal', quantity: 0, foilQuantity: 1 },
  ]
  assert.equal(buildCardListText(entries), '4 Lightning Bolt\n1 Mox Opal *F*\n2 Sol Ring\n1 Sol Ring *F*')
  const printings = new Map([['b', { set: 'cmr', number: '472' }]])
  assert.equal(buildCardListText(entries, printings), '4 Lightning Bolt\n1 Mox Opal *F*\n2 Sol Ring (CMR) 472\n1 Sol Ring (CMR) 472 *F*')
  // What this app writes, it reads back the same.
  const back = parseCardList(buildCardListText(entries, printings)).lines
  assert.deepEqual(back.map((l) => [l.quantity, l.name, l.foil]), [[4, 'Lightning Bolt', false], [1, 'Mox Opal', true], [2, 'Sol Ring', false], [1, 'Sol Ring', true]])
})

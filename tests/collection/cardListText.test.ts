import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCardListText, csvCells, parseCardList, sectionOf } from '../../src/collection/cardListText.ts'

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
  assert.deepEqual(lines, [{ ...line(1, 'Forest'), section: 'sideboard' }])
})

test('each line says which part of a deck list it was under', () => {
  const { lines } = parseCardList([
    'Deck', '4 Lightning Bolt', '',
    'Sideboard (2)', '2 Duress', '',
    'Maybeboard', '1 Thoughtseize', '',
    'Creatures (1)', '1 Goblin Guide',
    'SB: 3 Pyroblast',
  ].join('\n'))
  assert.deepEqual(lines.map((l) => [l.name, l.quantity, sectionOf(l)]), [
    ['Lightning Bolt', 4, 'main'],
    ['Duress', 2, 'sideboard'],
    ['Thoughtseize', 1, 'maybeboard'],
    ['Goblin Guide', 1, 'main'],
    ['Pyroblast', 3, 'sideboard'],
  ])
  // Main-deck lines carry no section, so they read the same as before.
  assert.equal('section' in lines[0], false)
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
  // Their Condition and Language columns come along too (see copyDetails.test.ts).
  assert.deepEqual(parseCardList(moxfield).lines, [{ ...line(3, 'Counterspell', 'mh2', '267', true), condition: 'NM', language: 'en' }])
  const deckbox = 'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil\n1,0,Lightning Bolt,Magic 2010,146,Near Mint,English,'
  assert.deepEqual(parseCardList(deckbox).lines, [{ ...line(1, 'Lightning Bolt', null, '146'), condition: 'NM', language: 'en' }])
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

// Real export headers from each app the welcome flow names (trimmed to a row or two). The Android
// app's CardListTextTest has the same cases.
test('Archidekt CSV: Edition Code over Edition Name, Finish says foil', () => {
  const csv = [
    'Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Multiverse Id,Scryfall ID,MTGO ID,Collector Number',
    '1,Sol Ring,Foil,NM,2024-02-01,EN,,,Commander Legends,cmr,,a5f3e6a9-1234-4bcd-9e8f-0123456789ab,,472',
    '2,Counterspell,Normal,LP,2024-02-01,JA,,,Modern Horizons 2,mh2,,,,267',
  ].join('\n')
  assert.deepEqual(parseCardList(csv).lines, [
    { ...line(1, 'Sol Ring', 'cmr', '472', true, 'a5f3e6a9-1234-4bcd-9e8f-0123456789ab'), condition: 'NM', language: 'en' },
    { ...line(2, 'Counterspell', 'mh2', '267'), condition: 'LP', language: 'ja' },
  ])
})

test('TCGplayer CSV: Simple Name and Set Code are used, the finish can sit in Printing', () => {
  const csv = [
    'Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID,SKU',
    '1,Sol Ring (Foil Etched),Sol Ring,Commander Legends,472,CMR,Foil,Near Mint Foil,English,Uncommon,229952,4637171',
    '3,Lightning Bolt,Lightning Bolt,Magic 2010,146,M10,Normal,Lightly Played,English,Common,33350,123',
  ].join('\n')
  assert.deepEqual(parseCardList(csv).lines, [
    { ...line(1, 'Sol Ring', 'cmr', '472', true), condition: 'NM', language: 'en' },
    { ...line(3, 'Lightning Bolt', 'm10', '146'), condition: 'LP', language: 'en' },
  ])
  // The seller inventory export names things differently.
  const seller = 'TCGplayer Id,Product Line,Set Name,Product Name,Title,Number,Rarity,Condition,TCG Market Price,Total Quantity,Add to Quantity\n'
    + '33350,Magic,Magic 2010,Lightning Bolt,,146,Common,Near Mint,1.20,4,0'
  assert.deepEqual(parseCardList(seller).lines, [{ ...line(4, 'Lightning Bolt', null, '146'), condition: 'NM' }])
})

test('Dragon Shield CSV: the sep= line is passed over and run-together conditions are read', () => {
  const csv = [
    '"sep=,"',
    'Folder Name,Quantity,Trade Quantity,Card Name,Set Code,Set Name,Card Number,Condition,Printing,Language,Price Bought,Date Bought,LOW,MID,MARKET',
    'Binder,2,0,Arcane Signet,CMR,Commander Legends,297,NearMint,Foil,English,0.50,2024-03-01,0.3,0.4,0.5',
    'Binder,1,0,Counterspell,MH2,Modern Horizons 2,267,LightPlayed,Normal,German,1.00,2024-03-01,0.8,0.9,1.0',
  ].join('\r\n')
  assert.deepEqual(parseCardList(csv).lines, [
    // Its Folder Name says where they're kept (importPlaces.ts).
    { ...line(2, 'Arcane Signet', 'cmr', '297', true), condition: 'NM', language: 'en', location: 'Binder' },
    { ...line(1, 'Counterspell', 'mh2', '267'), condition: 'LP', language: 'de', location: 'Binder' },
  ])
  // Excel in much of Europe separates with semicolons and says so the same way.
  const semi = 'sep=;\nQuantity;Card Name;Set Code;Card Number;Printing\n1;Sol Ring;CMR;472;Normal'
  assert.deepEqual(parseCardList(semi).lines, [line(1, 'Sol Ring', 'cmr', '472')])
})

test('ManaBox, Moxfield and Deckbox headers still read in full', () => {
  const manabox = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency\n'
    + 'Sol Ring,CMR,Commander Legends,472,etched,uncommon,1,1,,0.5,false,false,near_mint,en,GBP'
  assert.deepEqual(parseCardList(manabox).lines, [{ ...line(1, 'Sol Ring', 'cmr', '472', true), condition: 'NM', language: 'en' }])
  const moxfield = '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"\n'
    + '"1","0","Sol Ring","cmr","Near Mint","English","etched","","2024-01-01 00:00:00.000000","472","False","False",""'
  assert.deepEqual(parseCardList(moxfield).lines, [{ ...line(1, 'Sol Ring', 'cmr', '472', true), condition: 'NM', language: 'en' }])
  const deckbox = 'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Signed,Artist Proof,Altered Art,Misprint,Promo,Textless,My Price\n'
    + '2,0,Counterspell,Modern Horizons 2,267,Good (Lightly Played),Japanese,foil,,,,,,,$1.00'
  assert.deepEqual(parseCardList(deckbox).lines, [{ ...line(2, 'Counterspell', null, '267', true), condition: 'LP', language: 'ja' }])
})

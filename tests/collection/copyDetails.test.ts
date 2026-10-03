import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conditionCode, copyBadges, languageCode, withCopiesOf, withCopyDetails } from '../../src/collection/copyDetails.ts'
import { buildCardListCsv, CARD_LIST_CSV_HEADER, parseCardList } from '../../src/collection/cardListText.ts'
import type { CollectionEntry } from '../../src/types/models.ts'

// A binder card's condition and language: read from other apps' CSVs, written back out, and kept
// under fixed JSON keys. The Android app has the same checks — CopyDetailsTest.kt.

const entry = (extra: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: 'a', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0, ...extra })

test("conditions are read from every app's words", () => {
  const cases: [string, string | null][] = [
    ['Near Mint', 'NM'], ['near_mint', 'NM'], ['Near Mint Foil', 'NM'], ['Lightly Played', 'LP'],
    ['Good (Lightly Played)', 'LP'], ['excellent', 'LP'], ['Played', 'MP'], ['Moderately Played', 'MP'],
    ['heavily_played', 'HP'], ['Damaged', 'DMG'], ['poor', 'DMG'], ['lp', 'LP'], ['', null], ['Mostly fine', null],
  ]
  for (const [raw, code] of cases) assert.equal(conditionCode(raw), code, raw)
})

test('languages are read from names and codes', () => {
  const cases: [string, string | null][] = [
    ['English', 'en'], ['Japanese', 'ja'], ['JP', 'ja'], ['Chinese Simplified', 'zhs'], ['zh-TW', 'zht'],
    ['Portuguese (Brazil)', 'pt'], ['ko', 'ko'], ['Klingon', null], [' ', null],
  ]
  for (const [raw, code] of cases) assert.equal(languageCode(raw), code, raw)
})

test("a row shows badges only for what's set", () => {
  assert.deepEqual(copyBadges(entry()), [])
  assert.deepEqual(copyBadges(entry({ condition: 'LP', language: 'ja' })), ['LP', 'JA'])
  assert.deepEqual(copyBadges(entry({ language: 'zhs' })), ['ZHS'])
})

test('a Moxfield CSV brings condition and language', () => {
  const csv = [
    '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number"',
    '"2","0","Sol Ring","cmr","Lightly Played","Japanese","","","2024-01-01","472"',
    '"1","0","Arcane Signet","cmr","Near Mint","English","foil","","2024-01-01","297"',
  ].join('\n')
  const lines = parseCardList(csv).lines
  assert.deepEqual(lines.map((l) => [l.condition, l.language]), [['LP', 'ja'], ['NM', 'en']])
  assert.deepEqual(lines.map((l) => l.foil), [false, true])
})

test('ManaBox, Deckbox and TCGplayer CSVs too', () => {
  const manabox = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language\n' +
    'Sol Ring,cmr,Commander Legends,472,normal,uncommon,1,1,0afa0e33-4804-4b00-b625-c2d6b61090fc,1.0,false,false,near_mint,de'
  const m = parseCardList(manabox).lines[0]
  assert.deepEqual([m.condition, m.language], ['NM', 'de'])

  const deckbox = 'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil\n1,0,Sol Ring,Commander Legends,472,Good (Lightly Played),French,'
  const d = parseCardList(deckbox).lines[0]
  assert.deepEqual([d.condition, d.language], ['LP', 'fr'])

  const tcgplayer = 'Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language\n1,Sol Ring,Sol Ring,Commander Legends,472,CMR,Foil,Near Mint Foil,English'
  const t = parseCardList(tcgplayer).lines[0]
  assert.deepEqual([t.condition, t.language], ['NM', 'en'])
  assert.equal(t.foil, true)

  // No such columns: nothing said.
  const plain = parseCardList('Count,Name\n1,Sol Ring').lines[0]
  assert.equal(plain.condition ?? null, null)
  assert.equal(plain.language ?? null, null)
})

test('the CSV export reads back the same', () => {
  const entries = [
    entry({ scryfallId: '0afa0e33-4804-4b00-b625-c2d6b61090fc', quantity: 2, foilQuantity: 1, condition: 'LP', language: 'ja' }),
    entry({ scryfallId: '11111111-2222-3333-4444-555555555555', name: 'Kozilek, Butcher of Truth' }),
  ]
  const csv = buildCardListCsv(entries, new Map([['0afa0e33-4804-4b00-b625-c2d6b61090fc', { set: 'cmr', number: '472' }]]))
  assert.ok(csv.startsWith(CARD_LIST_CSV_HEADER))
  assert.ok(csv.includes('"Kozilek, Butcher of Truth"'), 'a name with a comma is quoted')
  const back = parseCardList(csv).lines
  assert.equal(back.length, 3)
  const sol = back.filter((l) => l.name === 'Sol Ring')
  assert.deepEqual(sol.map((l) => [l.quantity, l.foil]), [[2, false], [1, true]])
  assert.ok(sol.every((l) => l.condition === 'LP' && l.language === 'ja' && l.set === 'cmr' && l.number === '472'))
  const kozilek = back.find((l) => l.name === 'Kozilek, Butcher of Truth')!
  assert.equal(kozilek.condition ?? null, null)
  assert.equal(kozilek.foil, false)
  assert.equal(kozilek.scryfallId, '11111111-2222-3333-4444-555555555555')
})

test("the entry's JSON keys are fixed, and left out when not set", () => {
  const json = JSON.stringify(withCopyDetails({ ...entry(), priceAlertAbove: 40 }, 'HP', 'ko'))
  assert.ok(json.includes('"condition":"HP"'))
  assert.ok(json.includes('"language":"ko"'))
  assert.ok(json.includes('"priceAlertAbove":40'))
  const bare = JSON.stringify(withCopyDetails(entry({ condition: 'NM', language: 'en' }), null, null))
  assert.ok(!bare.includes('condition') && !bare.includes('language') && !bare.includes('priceAlertAbove'), bare)
})

test("adding copies keeps the entry's own say", () => {
  const merged = withCopiesOf(entry({ condition: 'NM' }), entry({ quantity: 2, foilQuantity: 1, condition: 'HP', language: 'de', priceAlertAbove: 9 }))
  assert.deepEqual([merged.quantity, merged.foilQuantity, merged.condition, merged.language, merged.priceAlertAbove], [3, 1, 'NM', 'de', 9])
  const plain = withCopiesOf(entry(), entry())
  assert.ok(!('condition' in plain) && !('language' in plain) && !('priceAlertAbove' in plain))
})

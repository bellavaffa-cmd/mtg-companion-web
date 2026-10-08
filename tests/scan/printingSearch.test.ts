import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { foldText, searchPrintings, setCodeQuery, type PrintingFacts } from '../../src/scan/printingSearch.ts'

// The printing picker's search. The cases in printingSearchVectors.json are run by the Android app
// too (PrintingSearchTest.kt), so both apps narrow and rank a card's printings the same way.

interface Printing extends PrintingFacts { id: string }
interface Vectors {
  printings: Printing[]
  searches: { query: string; expect: string[] }[]
  setCodes: { query: string; set: string | null; number: string | null }[]
}

const V = JSON.parse(readFileSync(new URL('./printingSearchVectors.json', import.meta.url), 'utf8')) as Vectors

test('searching a card’s printings by set name, set code, number and year, best first', () => {
  for (const s of V.searches) {
    assert.deepEqual(searchPrintings(V.printings, s.query, (p) => p).map((p) => p.id), s.expect, `"${s.query}"`)
  }
})

test('the set code a search could name, to ask Scryfall when the printings aren’t all in yet', () => {
  for (const c of V.setCodes) {
    const got = setCodeQuery(c.query)
    assert.deepEqual(got, c.set === null ? null : { set: c.set, number: c.number }, `"${c.query}"`)
  }
})

test('folding text: case, accents and punctuation', () => {
  assert.equal(foldText('Lim-Dûl’s Vault'), 'lim dul s vault')
  assert.equal(foldText('  FIN·306 '), 'fin 306')
  assert.equal(foldText(null), '')
})

test('a search keeps the printings it’s given untouched', () => {
  const list = V.printings.slice()
  searchPrintings(list, 'fin', (p) => p)
  assert.deepEqual(list, V.printings)
})

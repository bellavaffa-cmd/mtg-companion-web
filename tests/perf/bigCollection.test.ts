import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bigCollection, fakeCard, ownedCopies, timed, PRINTINGS } from './bigCollection.ts'
import { allCardsOf, allCardTags, gatherInto, searchAllCards } from '../../src/collection/allCards.ts'
import { cardFactsOf, filterMatches, NO_COLLECTION_FILTER } from '../../src/collection/cardFilter.ts'
import { advancedFactsOf, advancedMatches, copyFactsOf, NO_ADVANCED_FILTER } from '../../src/collection/advancedFilter.ts'
import { placesOf, storageSummary } from '../../src/collection/storagePlaces.ts'
import { upkeep } from '../../src/collection/upkeep.ts'
import { valueGroups, valueRows } from '../../src/collection/valueByPlace.ts'
import { keepUserTags, userTagIndex, userTagsOf } from '../../src/collection/userTags.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import { libraryJson } from '../../src/sync/cloudSync.ts'
import { canonicalJson, canonicalJsonSlow } from '../../src/sync/canonicalJson.ts'
import { backupJson, buildBackup, parseBackup, restoreLibrary } from '../../src/sync/backupFile.ts'

// Speed guards over a 25,000-copy collection (bigCollection.ts): each hot path has to stay well
// inside a generous limit — CI machines vary, so the limits are several times what a laptop takes
// (see bench.ts for the timings themselves). What they catch is something going quadratic again: the
// All cards search took 12 seconds before it stopped looking up each card's tags in the whole library.
// The Android app has the same guards — see BigCollectionPerfTest.kt.

const lib = bigCollection()
const cards = Array.from({ length: PRINTINGS }, (_, i) => fakeCard(i))
const all = allCardsOf(lib.collections, lib.decks)
const under = (label: string, limitMs: number, fn: () => unknown, runs = 2) => {
  const { ms } = timed(fn, runs)
  assert.ok(ms < limitMs, `${label} took ${ms.toFixed(0)} ms (limit ${limitMs} ms)`)
}

test('the big collection is 25,000 copies of thousands of printings, in many places and decks', () => {
  assert.equal(ownedCopies(lib), 25_000)
  assert.equal(all.length, PRINTINGS)
  assert.ok(placesOf(lib.collections).length >= 80)
  assert.equal(lib.decks.length, 60)
  assert.deepEqual(bigCollection(), lib, 'the same every time')
})

test('All cards: listing, searching and filtering stay quick', () => {
  under('allCardsOf', 600, () => allCardsOf(lib.collections, lib.decks))
  const tags = userTagIndex(lib.decks, lib.collections)
  under('searching with nothing typed', 150, () => searchAllCards(all, '', (c) => allCardTags(c, new Map(), tags)))
  under('searching by name or tag', 400, () => { const index = userTagIndex(lib.decks, lib.collections); return searchAllCards(all, 'ka', (c) => allCardTags(c, new Map(), index)) })
  const facts = new Map(cards.map((c) => [c.id, cardFactsOf(c)]))
  const adv = new Map(cards.map((c) => [c.id, advancedFactsOf(c)]))
  under('copyFactsOf', 600, () => copyFactsOf(lib.collections, lib.decks))
  const copies = copyFactsOf(lib.collections, lib.decks)
  const basic = { ...NO_COLLECTION_FILTER, type: 'creature', colors: ['G' as const] }
  const advanced = { ...NO_ADVANCED_FILTER, mv: '3', place: 'shelf-1', priceMin: '1' }
  under('filters and advanced filters', 400, () => all.filter((c) => filterMatches(basic, facts.get(c.scryfallId)) && advancedMatches(advanced, adv.get(c.scryfallId), copies.get(c.scryfallId))))
})

test("the tag index answers what looking up each card's tags did", () => {
  const index = userTagIndex(lib.decks, lib.collections)
  for (const c of all.slice(0, 400)) assert.deepEqual(index.get(c.scryfallId) ?? [], userTagsOf(lib.decks, lib.collections, c.scryfallId))
})

test('Storage: summaries, upkeep and value by place stay quick', () => {
  under('storageSummary', 600, () => storageSummary(lib.collections, lib.decks))
  under('upkeep', 1200, () => upkeep({ collections: lib.collections, decks: lib.decks, now: 1_790_000_000_000, today: '2026-10-07', utc: true }))
  const byId = new Map(cards.map((c) => [c.id, c]))
  const priceOf = (id: string) => { const c = byId.get(id); return c ? { set: c.set!, number: c.collector_number!, usd: Number(c.prices?.usd) || null, usdFoil: Number(c.prices?.usd_foil) || null } : undefined }
  under('value by place', 1200, () => valueGroups(valueRows(lib.collections, lib.decks, priceOf), lib.collections))
})

test('every edit, and gathering thousands of cards, stay quick', () => {
  under('keepUserTags', 400, () => keepUserTags(lib))
  // Once tags are where they belong, another edit changes nothing: the same library back.
  const tagged = keepUserTags(lib)
  assert.equal(keepUserTags(tagged), tagged)
  const ids = new Set(all.slice(0, 2000).map((c) => c.scryfallId))
  under('gatherInto', 400, () => gatherInto(lib.collections, 'binder-col-0', ids))
})

test('sync: the library as JSON and merging the big pile stay quick', () => {
  const fresh = JSON.parse(JSON.stringify(lib)) as typeof lib
  under('libraryJson, every item new', 2000, () => libraryJson(fresh), 1)
  // After one edit only that binder is written out again.
  const edited = { ...fresh, collections: fresh.collections.map((c, i) => (i === 2 ? { ...c, name: 'Renamed' } : c)) }
  under('libraryJson after one edit', 150, () => libraryJson(edited), 1)
  assert.equal(libraryJson(edited).get('collection:binder-col-0'), canonicalJsonSlow(fresh.collections[2]).replace('"name":"Binder 1"', '"name":"Renamed"'))
  const pile = lib.collections[0]
  const mine = { ...pile, entries: pile.entries.map((e, i) => (i % 10 === 0 ? { ...e, quantity: e.quantity + 1 } : e)) }
  const theirs = { ...pile, entries: pile.entries.filter((_, i) => i % 13 !== 0) }
  under('mergeCollection', 1500, () => mergeCollection(pile, mine, theirs, true), 1)
})

test('canonical JSON is written the same as before, only faster', () => {
  for (const v of [lib, { b: 1, a: [undefined, () => 1, NaN, { z: undefined, y: null }], 10: 1, 2: 2, '01': 3, c: 'é"\n' }, [1, 'x'], 'str', 0, true, null]) {
    assert.equal(canonicalJson(v), canonicalJsonSlow(v))
  }
})

test('backup: writing, reading and restoring 25,000 copies stay quick', () => {
  const file = buildBackup({ library: lib, from: 'web', createdAt: 1, copyHistory: [], photos: [], photoFiles: {}, settings: {} })
  let text = ''
  under('writing the backup', 2000, () => { text = backupJson(file) })
  let parsed: ReturnType<typeof parseBackup> | null = null
  under('reading the backup', 2000, () => { parsed = parseBackup(text) })
  assert.ok(parsed!.ok)
  const backup = (parsed! as { ok: true; backup: typeof file }).backup
  const changed = { ...lib, collections: lib.collections.map((c, i) => (i === 3 ? { ...c, entries: c.entries.slice(1) } : c)) }
  under('merge restore', 3000, () => restoreLibrary(changed, backup, 'merge'), 1)
})

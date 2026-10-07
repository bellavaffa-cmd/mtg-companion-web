// Times the hot paths over the synthetic 25,000-copy collection (bigCollection.ts) and prints a
// table. Not a test: run it by hand to compare before and after a change —
//   node --import ./tests/register.mjs tests/perf/bench.ts
// The guards that fail the build when one of these gets slow are in bigCollection.test.ts.

import { bigCollection, fakeCard, ownedCopies, timed, PRINTINGS } from './bigCollection.ts'
import { allCardsOf, csvExportEntries, dashboardOf, gatherInto } from '../../src/collection/allCards.ts'
import { cardFactsOf, filterMatches, NO_COLLECTION_FILTER } from '../../src/collection/cardFilter.ts'
import { advancedFactsOf, advancedMatches, copyFactsOf, NO_ADVANCED_FILTER } from '../../src/collection/advancedFilter.ts'
import { storageSummary } from '../../src/collection/storagePlaces.ts'
import { upkeep } from '../../src/collection/upkeep.ts'
import { valueGroups, valueRows } from '../../src/collection/valueByPlace.ts'
import { spares } from '../../src/collection/spares.ts'
import { spreadThin } from '../../src/collection/spreadThin.ts'
import { keepUserTags, userTagIndex, userTagsOf } from '../../src/collection/userTags.ts'
import { mergeCollection, mergeDeck } from '../../src/sync/mergeItems.ts'
import { libraryJson } from '../../src/sync/cloudSync.ts'
import { matchesNameOrTag } from '../../src/tags/roleTags.ts'
import * as allCardsSearch from '../../src/collection/allCards.ts'
import * as backup from "../../src/sync/backupFile.ts"

const lib = bigCollection()
const cards = Array.from({ length: PRINTINGS }, (_, i) => fakeCard(i))
const byId = new Map(cards.map((c) => [c.id, c]))
const rows: [string, number][] = []
const time = (label: string, fn: () => unknown, runs = 3) => {
  const { ms } = timed(fn, runs)
  rows.push([label, ms])
}

console.log(`Copies: ${ownedCopies(lib)} · printings: ${PRINTINGS} · decks: ${lib.decks.length} · binders: ${lib.collections.length}`)

const all = allCardsOf(lib.collections, lib.decks)
time('All cards (allCardsOf)', () => allCardsOf(lib.collections, lib.decks))
time('useCardData key (sort ids)', () => [...all.map((c) => c.scryfallId)].sort().join(','))
const search = (allCardsSearch as Record<string, unknown>).searchAllCards as undefined | ((...a: unknown[]) => unknown)
const cardTags = (allCardsSearch as Record<string, unknown>).allCardTags as (...a: unknown[]) => string[]
if (search) {
  time('All cards render: name/tag search, no query', () => {
    const idx = userTagIndex(lib.decks, lib.collections)
    return search(all, '', (c: unknown) => cardTags(c, new Map(), idx))
  })
  time('All cards render: name/tag search, "ka"', () => {
    const idx = userTagIndex(lib.decks, lib.collections)
    return search(all, 'ka', (c: unknown) => cardTags(c, new Map(), idx))
  })
} else {
  time('All cards render: name/tag search (userTagsOf each)', () =>
    all.filter((c) => matchesNameOrTag(c.name, userTagsOf(lib.decks, lib.collections, c.scryfallId), '')), 1)
}
const facts = new Map(cards.map((c) => [c.id, cardFactsOf(c)]))
const adv = new Map(cards.map((c) => [c.id, advancedFactsOf(c)]))
time('card facts (cardFactsOf ×18k)', () => cards.map(cardFactsOf))
time('advanced facts (advancedFactsOf ×18k)', () => cards.map(advancedFactsOf))
const copyFacts = copyFactsOf(lib.collections, lib.decks)
time('copyFactsOf', () => copyFactsOf(lib.collections, lib.decks))
const basic = { ...NO_COLLECTION_FILTER, type: 'creature', colors: ['G' as const] }
const advanced = { ...NO_ADVANCED_FILTER, mv: '3', place: 'shelf-1', priceMin: '1' }
time('filters + advanced filters over All cards', () => all.filter((c) => filterMatches(basic, facts.get(c.scryfallId)) && advancedMatches(advanced, adv.get(c.scryfallId), copyFacts.get(c.scryfallId))))
time('dashboardOf', () => dashboardOf(all, byId))
time('storageSummary', () => storageSummary(lib.collections, lib.decks))
time('upkeep', () => upkeep({ collections: lib.collections, decks: lib.decks, now: 1_790_000_000_000, today: '2026-10-07', utc: true }))
const priceOf = (id: string) => { const c = byId.get(id); return c ? { set: c.set!, number: c.collector_number!, usd: Number(c.prices?.usd ?? 0) || null, usdFoil: Number(c.prices?.usd_foil ?? 0) || null } : undefined }
time('value by place (valueRows + valueGroups)', () => valueGroups(valueRows(lib.collections, lib.decks, priceOf), lib.collections))
time('spares', () => spares(lib.collections, lib.decks))
time('spreadThin', () => spreadThin(lib.collections, lib.decks))
time('keepUserTags (every edit)', () => keepUserTags(lib), 1)
const ids = new Set(all.slice(0, 2000).map((c) => c.scryfallId))
time('gatherInto 2,000 cards', () => gatherInto(lib.collections, 'binder-col-0', ids), 1)
time('csvExportEntries 2,000 cards', () => csvExportEntries(lib.collections, all, ids), 1)

// Sync: the whole library as JSON, and merging the big pile with edits on both sides.
time('sync: libraryJson (canonical JSON)', () => libraryJson(lib))
const pile = lib.collections[0]
const mine = { ...pile, entries: pile.entries.map((e, i) => (i % 10 === 0 ? { ...e, quantity: e.quantity + 1 } : e)) }
const theirs = { ...pile, entries: [...pile.entries.filter((_, i) => i % 13 !== 0), { scryfallId: 'new', name: 'New', imageUrl: null, quantity: 1, foilQuantity: 0 }] }
time('sync: mergeCollection (6,000-entry pile)', () => mergeCollection(pile, mine, theirs, true), 1)
const deck = lib.decks[0]
time('sync: mergeDeck ×60', () => lib.decks.forEach(() => mergeDeck(deck, deck, { ...deck, name: 'x' }, true)))
const json = JSON.stringify(lib)
time('JSON.stringify library', () => JSON.stringify(lib))
time('JSON.parse library', () => JSON.parse(json))
if ('buildBackup' in backup) {
  const b = backup as unknown as {
    buildBackup: (i: unknown) => unknown; backupJson: (b: unknown) => string; parseBackup: (t: string) => { ok: boolean; backup?: unknown }
    restoreLibrary: (l: unknown, b: unknown, m: string) => unknown
  }
  const file = b.buildBackup({ library: lib, from: 'web', createdAt: 1, copyHistory: [], photos: [], photoFiles: {}, settings: {} })
  const text = b.backupJson(file)
  time('backup: write file', () => b.backupJson(file))
  time('backup: read file', () => b.parseBackup(text))
  const parsed = b.parseBackup(text).backup
  time('backup: merge restore', () => b.restoreLibrary(lib, parsed, 'merge'), 1)
}

console.log(`json size: ${(json.length / 1e6).toFixed(1)} MB`)
for (const [label, ms] of rows) console.log(`${label.padEnd(52)} ${ms.toFixed(1).padStart(9)} ms`)

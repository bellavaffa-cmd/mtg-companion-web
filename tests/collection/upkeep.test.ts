import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deckTitle, importWhen, possessive, pullStage, startedWhen, unplacedHint, upkeep, upkeepHeadline,
} from '../../src/collection/upkeep.ts'
import { pullList } from '../../src/collection/pullList.ts'
import { normalizeDeck } from '../../src/types/models.ts'
import type { Collection, CollectionEntry, CopyPlace, Deck, StoragePlace } from '../../src/types/models.ts'

// Upkeep: the share of copies with a place and the things worth doing this week. The Android app has
// the same checks — see UpkeepTest.kt.

const day = 86_400_000
/** 2026-10-06, noon UTC. */
const now = Date.UTC(2026, 9, 6, 12)
const today = '2026-10-06'

const entry = (id: string, quantity: number, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity: 0, ...(places ? { places } : {}) })

const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: now - 200 * day, lastChecked: now - 120 * day }
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', createdAt: now - 10 * day, capacity: 100 }
const old: StoragePlace = { id: 'old', name: 'Old box', kind: 'BOX', createdAt: now - 100 * day }

const pile: Collection = {
  id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED',
  entries: [entry('ring', 3, [{ placeId: 'rares', qty: 1 }]), entry('bolt', 96, [{ placeId: 'red', qty: 96 }]), entry('elf', 5, [{ placeId: 'old', qty: 5 }])],
  storagePlaces: [rares, red, old],
  loans: [{ id: 'l1', to: 'Priya', cards: [{ name: 'Goblin', scryfallId: 'gob', qty: 4 }], lentAt: now - 20 * day, backBy: '2026-10-03' }],
}
const trades: Collection = { id: 'trades', name: 'Trade binder', createdAt: 0, type: 'OWNED', entries: [entry('gob', 4), entry('cheap', 1)] }

const PRICES: Record<string, number> = { ring: 2000, gob: 7, elf: 0 }
const price = (id: string) => PRICES[id] ?? null
const lines = (items: { kind: string; title: string; detail: string; action: string }[]) => items.map((i) => `${i.kind}|${i.title}|${i.detail}|${i.action}`)

test('the things worth doing this week', () => {
  const report = upkeep({ collections: [pile, trades], decks: [], now, today, price, utc: true })
  // 109 copies; 96 + 1 + 5 have a place and 4 are lent: 2 ring and 1 cheap have none.
  assert.equal(report.total, 109)
  assert.equal(report.placed, 106)
  assert.equal(report.percent, 97)
  assert.deepEqual(lines(report.items), [
    'PUT_AWAY|3 copies have no place|Most are in Unsorted|Put away',
    'CHECK|Rares binder not checked in 120 days|$2,000 inside|Check',
    "REMIND|Priya's loan is 3 days late|4 cards · $28|Remind",
    'SPLIT|Red box is 96% full|Room for about 4 more|Split',
  ])
  assert.equal(report.items[1].placeId, 'rares')
  assert.equal(report.items[2].personKey, 'n:priya')
  assert.equal(upkeepHeadline(report.items.length), '4 things worth doing this week')
  assert.equal(upkeepHeadline(1), '1 thing worth doing this week')
  assert.equal(upkeepHeadline(0), 'Nothing to do this week')
})

test('a place with nothing of value, or checked lately, is left alone', () => {
  const checked = { ...pile, storagePlaces: [{ ...rares, lastChecked: now - 30 * day }, { ...red, capacity: undefined }, old] }
  const report = upkeep({ collections: [checked], decks: [], now, today: '2026-10-01', price, utc: true })
  assert.deepEqual(report.items.map((i) => i.kind), ['PUT_AWAY'])
  // Never checked, made long ago, with something in it.
  const { lastChecked: _, ...neverChecked } = rares
  const never = upkeep({ collections: [{ ...pile, storagePlaces: [neverChecked] }], decks: [], now, today, price, utc: true })
  assert.ok(never.items.some((i) => i.title === 'Rares binder never checked'))
})

test('where the copies with no place came from', () => {
  const cols = [{ ...pile, loans: [] }, trades]
  // 2 ring in Unsorted, 4 gob and 1 cheap in Trade binder.
  assert.equal(unplacedHint(cols, [], null, now, true), 'Most are in Trade binder')
  const note = { at: now - 9 * day, copies: 5, collectionId: 'trades' }
  assert.equal(unplacedHint(cols, [], note, now, true), "Most came from last week's import")
  assert.equal(unplacedHint(cols, [], { ...note, at: now }, now, true), "Most came from today's import")
  assert.equal(unplacedHint(cols, [], { ...note, at: now - 35 * day }, now, true), 'Most came from the import on 1 Sep')
  // An import into another binder doesn't explain them.
  assert.equal(unplacedHint(cols, [], { ...note, collectionId: 'unsorted' }, now, true), 'Most are in Trade binder')
  const even: Collection[] = [{ ...pile, loans: [] }, { ...trades, entries: [entry('gob', 2)] }, { id: 'c', name: 'Cube', createdAt: 0, type: 'OWNED', entries: [entry('x', 1)] }]
  assert.equal(unplacedHint(even, [], null, now, true), 'In Unsorted, Trade binder and 1 more')
})

test('a pull list started and not finished', () => {
  const box: StoragePlace = { id: 'box', name: 'Box', kind: 'BOX', createdAt: now }
  const cols: Collection[] = [{ id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', entries: [entry('a', 1, [{ placeId: 'box', qty: 1 }]), entry('b', 1, [{ placeId: 'box', qty: 1 }])], storagePlaces: [box] }]
  const card = (id: string) => ({ scryfallId: id, name: id, imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null })
  const deck: Deck = normalizeDeck({ id: 'krenko', name: 'Krenko', cards: [card('a'), card('b')], ownership: 'PROTOTYPE', createdAt: 1 })
  const rows = pullList(deck, cols, [deck]).groups.flatMap((g) => g.rows)
  assert.equal(rows.length, 2)
  const pulls = [{ deckId: 'krenko', ticked: [rows[0].key], startedAt: now - 3 * day }, { deckId: 'gone', ticked: ['x'] }]
  const report = upkeep({ collections: cols, decks: [deck], now, today, pulls, utc: true })
  assert.deepEqual(lines(report.items), ['CARRY_ON|Krenko deck pull list half done|1 of 2 pulled, started Saturday|Carry on'])
  assert.equal(report.items[0].deckId, 'krenko')
  // All ticked: done, nothing to carry on with.
  assert.equal(upkeep({ collections: cols, decks: [deck], now, today, pulls: [{ deckId: 'krenko', ticked: rows.map((r) => r.key) }], utc: true }).items.length, 0)
})

test('the words for when', () => {
  assert.equal(startedWhen(now - day, now, true), 'yesterday')
  assert.equal(startedWhen(now, now, true), 'today')
  assert.equal(startedWhen(now - 10 * day, now, true), '26 Sep')
  assert.equal(importWhen(now - 3 * day, now, true), "this week's import")
  assert.equal(importWhen(now - day, now, true), "yesterday's import")
  assert.equal(pullStage(1, 10), 'started')
  assert.equal(pullStage(8, 10), 'nearly done')
  assert.equal(deckTitle('Krenko deck'), 'Krenko deck')
  assert.equal(possessive('James'), "James'")
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASELINE_PREFIX, MAX_VERSIONS, SESSION_MS, changeSummary, versionSummaries, withVersion } from '../../src/decks/versions.ts'
import type { Deck, DeckCardEntry, GameResult } from '../../src/types/models.ts'

// Version history, recorded the way the phone records it (DeckRepository.withVersion) and summed up
// as its VersionHistoryPanel does (versionSummaries in DeckBuilding.kt).

const entry = (name: string, quantity = 1, id = `id-${name}`) => ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null }) as DeckCardEntry
const deck = (cards: DeckCardEntry[], extra: Partial<Deck> = {}): Deck => ({
  id: 'd', name: 'Deck', commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'PHYSICAL', ...extra,
})
let n = 0
const ids = () => `v${++n}`

test('a change that leaves the list alone records nothing', () => {
  const before = deck([entry('Sol Ring')])
  const after = deck([{ ...entry('Sol Ring'), replaceable: true }], { tags: ['x'] })
  assert.equal(withVersion(before, after, 1000, ids), after)
  // A new printing of the same card isn't a change either: versions are by name.
  assert.equal(withVersion(before, deck([entry('Sol Ring', 1, 'other-printing')]), 1000, ids).versions, undefined)
})

test('the first edit saves the list from before it as the baseline, then the new list', () => {
  const before = deck([entry('Sol Ring'), entry('Island', 30)])
  const after = withVersion(before, deck([entry('Sol Ring'), entry('Island', 31)]), 10_000, ids)
  assert.equal(after.versions!.length, 2)
  assert.ok(after.versions![0].id.startsWith(BASELINE_PREFIX))
  assert.deepEqual(after.versions![0].cards, { 'Sol Ring': 1, Island: 30 })
  assert.equal(after.versions![0].savedAt, 9_999)
  assert.deepEqual(after.versions![1].cards, { 'Sol Ring': 1, Island: 31 })
})

test('edits in one sitting replace that sitting’s version; after half an hour a new one starts', () => {
  let d = withVersion(deck([entry('A')]), deck([entry('A'), entry('B')]), 0, ids)
  d = withVersion(d, { ...d, cards: [...d.cards, entry('C')] }, 60_000, ids)
  assert.equal(d.versions!.length, 2)
  assert.deepEqual(Object.keys(d.versions![1].cards), ['A', 'B', 'C'])
  assert.equal(d.versions![1].savedAt, 60_000)
  d = withVersion(d, { ...d, cards: [...d.cards, entry('D')] }, 60_000 + SESSION_MS, ids)
  assert.equal(d.versions!.length, 3)
})

test('a game logged on a version closes it', () => {
  let d = withVersion(deck([entry('A')]), deck([entry('A'), entry('B')]), 0, ids)
  const game: GameResult = { id: 'g', result: 'WIN', opponent: null, playedAt: 1_000 }
  d = { ...d, gameResults: [game] }
  d = withVersion(d, { ...d, cards: [...d.cards, entry('C')] }, 2_000, ids)
  assert.equal(d.versions!.length, 3)
})

test('a whole list into an empty deck is the starting list', () => {
  const d = withVersion(deck([]), deck([entry('A'), entry('B')]), 5, ids)
  assert.equal(d.versions!.length, 1)
  assert.ok(d.versions![0].id.startsWith(BASELINE_PREFIX))
  // One card at a time from nothing isn't an import.
  const one = withVersion(deck([]), deck([entry('A')]), 5, ids)
  assert.equal(one.versions!.length, 1)
  assert.ok(!one.versions![0].id.startsWith(BASELINE_PREFIX))
})

test('the history keeps the newest 40', () => {
  let d = deck([entry('A')])
  for (let i = 0; i < 50; i++) d = withVersion(d, { ...d, cards: [entry('A', i + 2)] }, i * SESSION_MS, ids)
  assert.equal(d.versions!.length, MAX_VERSIONS)
  assert.deepEqual(d.versions!.at(-1)!.cards, { A: 51 })
})

test('summaries: newest first, what changed, and the games played on each', () => {
  const d = deck([], {
    versions: [
      { id: 'baseline:x', savedAt: 0, cards: { A: 1, B: 2 }, commanders: ['A'] },
      { id: 'v2', savedAt: 100, cards: { A: 1, B: 1, C: 1 }, commanders: ['A'] },
      { id: 'v3', savedAt: 200, cards: { A: 1, B: 1, C: 1 }, commanders: ['C'] },
    ],
    gameResults: [
      { id: '1', result: 'WIN', opponent: null, playedAt: 50 },
      { id: '2', result: 'LOSS', opponent: null, playedAt: 150 },
      { id: '3', result: 'DRAW', opponent: null, playedAt: 160 },
    ],
  })
  const [v3, v2, base] = versionSummaries(d)
  assert.equal(changeSummary(base), 'Starting list · 3 cards')
  assert.deepEqual([base.wins, base.losses], [1, 0])
  assert.deepEqual(v2.added, [['C', 1]])
  assert.deepEqual(v2.removed, [['B', 1]])
  assert.equal(changeSummary(v2), '+1  −1')
  assert.deepEqual([v2.losses, v2.draws, v2.games], [1, 1, 2])
  assert.equal(changeSummary(v3), 'Commander changed')
})

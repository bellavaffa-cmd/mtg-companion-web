import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deckLegality, legalityReport, type Issue, type IssueKind } from '../../src/decks/deckLegality.ts'
import { LEGALITY_CHECKING, deckSizeFix, deckSizeFixLabel, groupLegalityIssues, legalitySummary, uncheckedNote } from '../../src/decks/legalitySummary.ts'
import { normalizeDeck, type Deck, type DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Why a deck isn't legal. The cases in legalitySummaryVectors.json are run by the Android app too
// (LegalitySummaryTest.kt), so both apps say the same words.

interface Case {
  name: string
  mode: string
  totalCards: number
  unchecked: number
  loading: boolean
  issues: { card: string | null; reason: string; kind: IssueKind; sideboard?: boolean }[]
  summary: string
  groups: [IssueKind, string, (string | null)[]][]
  sizeFix: number
  sizeFixLabel: string | null
}

const V = JSON.parse(readFileSync(new URL('./legalitySummaryVectors.json', import.meta.url), 'utf8')) as { cases: Case[] }

test('the shared cases', () => {
  assert.ok(V.cases.length > 10)
  for (const c of V.cases) {
    const issues: Issue[] = c.issues.map((i) => ({ card: i.card, reason: i.reason, kind: i.kind, ...(i.sideboard ? { sideboard: true } : {}) }))
    const r = legalityReport(c.mode, c.totalCards, issues, c.unchecked)
    assert.equal(legalitySummary(r, c.loading), c.summary, c.name)
    assert.deepEqual(groupLegalityIssues(r).map((g) => [g.kind, g.heading, g.issues.map((i) => i.card)]), c.groups, c.name)
    assert.equal(deckSizeFix(r), c.sizeFix, c.name)
    assert.equal(deckSizeFixLabel(r), c.sizeFixLabel, c.name)
  }
})

test('no report yet is still checking', () => {
  assert.equal(legalitySummary(undefined), LEGALITY_CHECKING)
})

const entry = (id: string, name = id, quantity = 1): DeckCardEntry => ({ scryfallId: id, name, imageUrl: null, quantity, typeLine: 'Instant' })
const modern = (cards: DeckCardEntry[], sideboard: DeckCardEntry[] = []): Deck =>
  normalizeDeck({ id: 'd', name: 'Burn', cards, sideboard, gameMode: 'MODERN' } as unknown as Deck)
const scry = (id: string, legalities?: Record<string, string>) => ({ id, name: id, legalities }) as unknown as ScryfallCard

test('cards without card data are counted as not checked', () => {
  const deck = modern([entry('bolt', 'bolt', 4), entry('shock', 'shock', 4)], [entry('oko')])
  const none = deckLegality(deck, new Map())
  assert.equal(none.unchecked, 3)
  // A card with no legality for the format isn't checked either.
  assert.equal(deckLegality(deck, new Map([['bolt', scry('bolt', { modern: 'legal' })], ['shock', scry('shock')]])).unchecked, 2)
  const all = new Map(['bolt', 'shock', 'oko'].map((id) => [id, scry(id, { modern: 'legal' })]))
  assert.equal(uncheckedNote(deckLegality(deck, all)), null)
  assert.ok(uncheckedNote(none)!.startsWith("3 cards couldn't be checked yet"))
})

test('a banned sideboard card says so and can be opened', () => {
  const deck = modern([entry('mountain', 'Mountain', 60)], [entry('oko', 'Oko')])
  const r = deckLegality(deck, new Map([['oko', scry('oko', { modern: 'banned' })]]))
  const issue = r.issues.find((i) => i.kind === 'LEGALITY')!
  assert.equal(issue.sideboard, true)
  assert.equal(issue.scryfallId, 'oko')
  assert.equal(issue.reason, "Banned in Modern — it's in the sideboard.")
  assert.equal(legalitySummary(r), 'Not legal · 1 banned')
})

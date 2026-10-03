import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasSideboard, importPart, movedToMain, movedToSideboard, sideboardCount, withSideboardCopies, withSideboardQuantity } from '../../src/decks/sideboard.ts'
import { deckIssues } from '../../src/decks/deckLegality.ts'
import { duplicateWarning, normalizeDeck, type Deck, type DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// A deck's sideboard: which formats have one, moving cards, importing, and the rules on it. The
// Android app has the same checks — see SideboardTest.kt.

const card = (id: string, quantity = 1, name = id): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: 'Instant', partnerAbility: null })

const modern = (cards: DeckCardEntry[], sideboard: DeckCardEntry[] = []): Deck =>
  normalizeDeck({ id: 'd', name: 'Burn', cards, sideboard, gameMode: 'MODERN' })

test('only formats without a commander have a sideboard', () => {
  assert.equal(hasSideboard('COMMANDER'), false)
  assert.equal(hasSideboard('BRAWL'), false)
  assert.equal(hasSideboard('MODERN'), true)
  assert.equal(hasSideboard('STANDARD'), true)
})

test('moving a card to the sideboard and back keeps every copy', () => {
  const deck = modern([card('bolt', 4), card('guide', 4)], [card('bolt', 1)])
  const sided = movedToSideboard(deck, 'bolt')
  assert.deepEqual(sided.cards.map((c) => c.scryfallId), ['guide'])
  assert.equal(sided.sideboard!.length, 1)
  assert.equal(sided.sideboard![0].quantity, 5)
  const back = movedToMain(sided, 'bolt')
  assert.deepEqual(back.cards.map((c) => [c.scryfallId, c.quantity]), [['guide', 4], ['bolt', 5]])
  assert.deepEqual(back.sideboard, [])
})

test("a commander isn't sided out, and a cut flag doesn't follow a card there", () => {
  const atraxa = card('atraxa')
  const deck = normalizeDeck({ id: 'd', name: 'A', commander: atraxa, cards: [atraxa, { ...card('sol'), replaceable: true }] })
  assert.equal(movedToSideboard(deck, 'atraxa'), deck)
  assert.ok(!movedToSideboard(deck, 'sol').sideboard![0].replaceable)
})

test('sideboard counts can be set, and zero takes the card off', () => {
  const deck = modern([], [card('duress', 2)])
  assert.equal(withSideboardQuantity(deck, 'duress', 3).sideboard![0].quantity, 3)
  assert.deepEqual(withSideboardQuantity(deck, 'duress', 0).sideboard, [])
  assert.equal(sideboardCount(withSideboardCopies(deck, card('duress', 2))), 4)
})

test('imported sideboard lines go to the sideboard where there is one, else to Considering', () => {
  assert.equal(importPart('sideboard', 'MODERN'), 'sideboard')
  assert.equal(importPart('sideboard', 'COMMANDER'), 'considering')
  assert.equal(importPart('sideboard', 'BRAWL'), 'considering')
  assert.equal(importPart('maybeboard', 'MODERN'), 'considering')
  assert.equal(importPart('main', 'MODERN'), 'main')
})

test('old saved decks without a sideboard read as an empty one, under the phone\'s key', () => {
  const old = JSON.parse('{"id":"d","name":"Old","cards":[],"gameMode":"MODERN"}') as Deck
  assert.equal(sideboardCount(old), 0)
  assert.ok(JSON.stringify(modern([], [card('x')])).includes('"sideboard":['))
})

const scry = (id: string, name = id, legalities: Record<string, string> = { modern: 'legal' }, type = 'Instant') =>
  ({ id, name, type_line: type, legalities }) as unknown as ScryfallCard

test('copy limits count the main deck and the sideboard together', () => {
  const deck = modern([card('bolt', 3, 'Lightning Bolt')], [card('bolt2', 2, 'Lightning Bolt')])
  const issues = deckIssues(deck, new Map([['bolt', scry('bolt', 'Lightning Bolt')], ['bolt2', scry('bolt2', 'Lightning Bolt')]]))
    .filter((i) => i.kind === 'COPY_LIMIT')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].reason, 'Max 4 copies allowed (has 3 + 2 in the sideboard).')
  assert.equal(issues[0].scryfallId, 'bolt')
  assert.equal(issues[0].fixQuantity, 2)
})

test("when cutting the main deck can't fix it, no fix is offered", () => {
  const deck = modern([card('bolt', 1, 'Lightning Bolt')], [card('bolt', 4, 'Lightning Bolt')])
  const issue = deckIssues(deck, new Map([['bolt', scry('bolt', 'Lightning Bolt')]])).find((i) => i.kind === 'COPY_LIMIT')!
  assert.equal(issue.fixQuantity, undefined)
})

test('the main deck alone reads as it always did, and basics are unlimited', () => {
  const deck = modern([card('bolt', 5, 'Lightning Bolt'), card('mtn', 20, 'Mountain')], [card('mtn2', 3, 'Mountain')])
  const issues = deckIssues(deck, new Map()).filter((i) => i.kind === 'COPY_LIMIT')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].reason, 'Max 4 copies allowed (has 5).')
  assert.equal(issues[0].fixQuantity, 4)
})

test('a sideboard holds at most fifteen, and Commander has none', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => card(`c${i}`))
  assert.ok(deckIssues(modern([], many(16)), new Map()).some((i) => i.reason.startsWith('Sideboard has 16 cards')))
  assert.ok(!deckIssues(modern([], many(15)), new Map()).some((i) => i.reason.startsWith('Sideboard')))
  const commander = normalizeDeck({ id: 'd', name: 'C', sideboard: [card('x')] })
  assert.ok(deckIssues(commander, new Map()).some((i) => i.reason.startsWith('Commander has no sideboard')))
})

test('a banned sideboard card is an issue too', () => {
  const deck = modern([], [card('oko', 1, 'Oko')])
  const issue = deckIssues(deck, new Map([['oko', scry('oko', 'Oko', { modern: 'banned' })]])).find((i) => i.kind === 'LEGALITY')!
  assert.equal(issue.reason, 'Banned in Modern (sideboard).')
})

test('adding a card warns about copies already in the sideboard', () => {
  const deck = modern([card('bolt', 2)], [card('bolt', 2)])
  assert.ok(duplicateWarning(deck, scry('bolt', 'Lightning Bolt'))!.includes("you'll have 5"))
})

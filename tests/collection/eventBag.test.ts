import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allTicked, bagHeading, bagLines, dayLabel, homeSummary, isComing, lentFromDeckLine, newBag, setComingHome, shownLines, stillAway, tickAll, toggleTick,
  type BagInput,
} from '../../src/collection/eventBag.ts'
import { countersLabel, countersNeeded, makesHowMany, tokensToBring } from '../../src/decks/tokens.ts'
import type { Collection, Deck, DeckCardEntry, GearItem, Loan, StoragePlace } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Packing for an event: the checklist from the decks, loans, wants and borrowed cards, the tokens and
// counters a deck needs, ticking, and coming home — the same on both apps. See EventBagTest.kt.

const card = (id: string, name: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })
const deck = (id: string, name: string, commander: DeckCardEntry | null, cards: DeckCardEntry[]): Deck => ({
  id, name, commander, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL',
})
const GOBLIN = { id: 'tok-goblin', component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' }
const KRENKO = deck('krenko', 'Krenko goblins', card('krenko-c', 'Krenko, Mob Boss'), [card('mogg', 'Mogg War Marshal'), card('mountain', 'Mountain', 30)])
const ATRAXA = deck('atraxa', 'Atraxa', card('atraxa-c', "Atraxa, Praetors' Voice"), [card('sol', 'Sol Ring'), card('hydra', 'Hydra'), card('blight', 'Blightsteel')])
const CARDS = new Map<string, ScryfallCard>([
  ['krenko-c', { id: 'krenko-c', name: 'Krenko, Mob Boss', oracle_text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.', all_parts: [GOBLIN] }],
  ['mogg', { id: 'mogg', name: 'Mogg War Marshal', oracle_text: 'When this enters or dies, create a 1/1 red Goblin creature token.', all_parts: [{ ...GOBLIN, id: 'tok-goblin-2' }] }],
  ['mountain', { id: 'mountain', name: 'Mountain', type_line: 'Basic Land — Mountain' }],
  ['atraxa-c', { id: 'atraxa-c', name: "Atraxa, Praetors' Voice", oracle_text: 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.' }],
  ['sol', { id: 'sol', name: 'Sol Ring', oracle_text: '{T}: Add {C}{C}.' }],
  ['hydra', { id: 'hydra', name: 'Hydra', oracle_text: 'This creature enters with X +1/+1 counters on it.' }],
  ['blight', { id: 'blight', name: 'Blightsteel', keywords: ['Infect'], oracle_text: 'Infect, indestructible' }],
] as [string, ScryfallCard][])

test('how many tokens a deck needs: what each card making it makes at once, added up', () => {
  assert.equal(makesHowMany('create two 1/1 tokens'), 2)
  assert.equal(makesHowMany('Create X 1/1 tokens'), 10)
  assert.equal(makesHowMany('creates 3 Food tokens'), 3)
  assert.equal(makesHowMany('Whenever you attack, investigate.'), 1)
  assert.deepEqual(tokensToBring(KRENKO, CARDS), [{ name: 'Goblin', count: 11, madeBy: ['Krenko, Mob Boss', 'Mogg War Marshal'] }])
  assert.deepEqual(tokensToBring(KRENKO, null), [])
})

test('the counters a deck asks for, most cards first, and how they are said', () => {
  assert.deepEqual(countersNeeded(ATRAXA, CARDS), ['+1/+1', 'poison'])
  assert.deepEqual(countersNeeded(KRENKO, CARDS), [])
  assert.equal(countersLabel(['poison', '+1/+1']), 'Poison and +1/+1 counters')
  assert.equal(countersLabel(['charge']), 'Charge counters')
  assert.equal(countersNeeded(deck('x', 'X', null, [card('c', 'Counterspell')]), new Map([['c', { id: 'c', name: 'Counterspell', oracle_text: 'Counter target spell.' }]])).length, 0)
})

const binder: StoragePlace = { id: 'trade', name: 'Trade binder', kind: 'BINDER', createdAt: 1 }
const box: StoragePlace = { id: 'box', name: 'Red box', kind: 'BOX', createdAt: 2 }
const loan = (over: Partial<Loan> = {}): Loan => ({
  id: 'L1', to: 'Sam', lentAt: 1, cards: [{ name: 'Sol Ring', scryfallId: 'sol', qty: 1, deckId: 'atraxa' }], ...over,
})
const pile = (loans: Loan[]): Collection => ({ id: 'unsorted', name: 'Unsorted', entries: [], createdAt: 0, type: 'OWNED', storagePlaces: [binder, box], loans })
const placed = (name: string, placeId: string, page?: number) => ({
  collectionId: 'unsorted', entry: { scryfallId: name, name, imageUrl: null, quantity: 1, foilQuantity: 0 }, line: { placeId, qty: 1, ...(page ? { page, slot: 1 } : {}) },
})
const GEAR: GearItem[] = [
  { id: 'b1', kind: 'DECK_BOX', name: 'Red', count: 1, holds: 'krenko', createdAt: 1 },
  { id: 'd1', kind: 'DICE', name: 'Dice', count: 6, createdAt: 2 },
  { id: 'p1', kind: 'PLAYMAT', name: 'Playmat', count: 1, createdAt: 3 },
]
const INPUT: BagInput = {
  decks: [KRENKO, ATRAXA],
  collections: [pile([loan(), loan({ id: 'L2', to: 'Ana', returnedAt: 5, cards: [{ name: 'Hydra', scryfallId: 'hydra', qty: 1, deckId: 'atraxa', back: 1 }] })])],
  gear: GEAR,
  tokens: { krenko: [{ name: 'Goblin', count: 20, madeBy: ['Krenko, Mob Boss'] }] },
  counters: { atraxa: ['poison', '+1/+1'] },
  wants: [
    { friend: 'Priya Shah', cards: [placed('A', 'trade', 4), placed('B', 'trade', 7), placed('C', 'trade', 4)] },
    { friend: 'Jo', cards: [placed('D', 'box')] },
  ],
  borrowed: [{ from: 'Sam', cards: 2 }, { from: 'Ana', cards: 1 }],
  attendees: ['Priya', 'Sam'],
}

test('the bag: decks with their deck box or what is lent, tokens and extras, and for trades', () => {
  assert.deepEqual(bagLines(INPUT).map((l) => [l.section, l.title, l.detail, l.warn]), [
    ['DECKS', 'Krenko goblins', 'Deck box, red', false],
    ['DECKS', 'Atraxa', 'Sol Ring lent to Sam', true],
    ['EXTRAS', 'Goblin tokens ×20', 'for Krenko', false],
    ['EXTRAS', 'Poison and +1/+1 counters', 'for Atraxa', false],
    ['EXTRAS', 'Dice, playmat', 'Gear', false],
    ['TRADES', '3 cards Priya Shah wants', 'Trade binder p4, p7', false],
    ['TRADES', "Sam's borrowed cards", 'to give back', false],
  ])
})

test('who is coming: the same name, or a first name', () => {
  assert.equal(isComing('Priya Shah', ['priya']), true)
  assert.equal(isComing('Priyanka', ['Priya']), false)
  assert.equal(isComing('', ['Priya']), false)
  assert.equal(lentFromDeckLine(ATRAXA, [loan({ cards: [
    { name: 'Sol Ring', scryfallId: 'sol', qty: 1, deckId: 'atraxa' }, { name: 'Hydra', scryfallId: 'hydra', qty: 1, deckId: 'atraxa' },
    { name: 'Blightsteel', scryfallId: 'blight', qty: 1, deckId: 'atraxa' },
  ] })]), 'Sol Ring and 2 more lent to Sam')
  assert.equal(lentFromDeckLine(KRENKO, [loan()]), null)
})

test('ticking, All packed, and coming home re-checks what went out', () => {
  const lines = bagLines(INPUT)
  let bag = newBag('b', "Game night at Priya's", '2026-10-10', ['Priya', 'Sam'], ['krenko', 'atraxa'], 1)
  bag = toggleTick(bag, 'deck:krenko')
  assert.equal(allTicked(bag, lines), false)
  bag = tickAll(bag, lines)
  assert.equal(allTicked(bag, lines), true)
  bag = toggleTick(bag, 'counters:atraxa')
  bag = setComingHome(bag, true)
  assert.deepEqual(shownLines(bag, lines).map((l) => l.key), ['deck:krenko', 'deck:atraxa', 'token:goblin', 'gear:extras'], 'trades stay gone; what never went is not asked about')
  bag = toggleTick(bag, 'deck:krenko')
  bag = toggleTick(bag, 'gear:extras')
  assert.deepEqual(stillAway(bag, lines).map((l) => l.key), ['deck:atraxa', 'token:goblin'])
  assert.equal(homeSummary(bag, lines), 'Still to come back: Atraxa and Goblin tokens ×20.')
  bag = tickAll(bag, lines)
  assert.equal(homeSummary(bag, lines), 'Everything came back.')
  assert.equal(bag.packed.includes('deck:krenko'), true, 'coming home leaves the packing ticks alone')
})

test('the day: today, tomorrow, a weekday within the week, else the date', () => {
  assert.equal(dayLabel('2026-10-06', '2026-10-06'), 'Today')
  assert.equal(dayLabel('2026-10-07', '2026-10-06'), 'Tomorrow')
  assert.equal(dayLabel('2026-10-10', '2026-10-06'), 'Saturday')
  assert.equal(dayLabel('2026-10-20', '2026-10-06'), '20 Oct')
  assert.equal(bagHeading(newBag('b', "Game night at Priya's", '2026-10-10', [], [], 1), '2026-10-06'), "Saturday · Game night at Priya's")
})

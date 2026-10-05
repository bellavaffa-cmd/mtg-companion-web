import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  basicLandSplit, basicsWanted, cardColours, isLimited, mainDeckPips, manaPips, poolCopies, poolGroupOf, poolGroups, strongestPairs,
} from '../../src/decks/limited.ts'
import { addProblems } from '../../src/decks/addCheck.ts'
import { deckIssues } from '../../src/decks/deckLegality.ts'
import { manaBaseAdvice } from '../../src/decks/deckAnalysis.ts'
import { budgetSwapQuery } from '../../src/decks/budgetSwaps.ts'
import { hasSideboard, sideboardChoice, sideboardLimit, sideboardName } from '../../src/decks/sideboard.ts'
import { duplicateWarning, GAME_MODE_LABELS, GAME_MODES, normalizeDeck, type Deck, type DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Draft and sealed: the Limited format's rules, the pool by colour, its strongest pairs, and the basic
// lands to add. The Android app has the same cases — see LimitedTest.kt.

const entry = (id: string, quantity = 1, typeLine = 'Creature'): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine, partnerAbility: null })

const card = (id: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id, name: id, type_line: 'Creature', legalities: { standard: 'not_legal' }, ...extra }) as ScryfallCard

const known = (...cards: ScryfallCard[]) => new Map(cards.map((c) => [c.id, c]))

const limited = (cards: DeckCardEntry[], sideboard: DeckCardEntry[] = []): Deck =>
  normalizeDeck({ id: 'd', name: 'Draft', gameMode: 'LIMITED', cards, sideboard })

test('Limited is a format, called that, with a pool for a sideboard', () => {
  assert.ok(GAME_MODES.includes('LIMITED'))
  assert.equal(GAME_MODE_LABELS.LIMITED, 'Limited')
  assert.ok(isLimited('LIMITED'))
  assert.ok(!isLimited('MODERN'))
  assert.ok(hasSideboard('LIMITED'))
  assert.equal(sideboardLimit('LIMITED'), null)
  assert.equal(sideboardLimit('MODERN'), 15)
  assert.equal(sideboardName('LIMITED'), 'Pool')
  assert.equal(sideboardName('MODERN'), 'Sideboard')
  assert.equal(sideboardChoice(['LIMITED']), 'Pool')
  assert.equal(sideboardChoice(['LIMITED', 'MODERN']), 'Sideboard')
})

test('a Limited deck needs 40 cards, takes any card, any number of copies, and any size of pool', () => {
  const cards = known(card('a'), card('b'))
  const short = limited([entry('a', 39)], [entry('b', 60)])
  assert.deepEqual(deckIssues(short, cards).map((i) => i.reason), ['Deck has 39 cards; Limited requires at least 40.'])
  assert.deepEqual(deckIssues(limited([entry('a', 40)], [entry('b', 60)]), cards), [])
  // No commander asked for either.
  assert.ok(!deckIssues(short, cards).some((i) => i.kind === 'COMMANDER'))
})

test('adding to a Limited deck or its pool is never stopped', () => {
  const deck = limited([entry('a', 6)], [entry('b', 30)])
  const cards = known(card('a', { legalities: { standard: 'banned' } }), card('b'))
  assert.deepEqual(addProblems(deck, [{ scryfallId: 'a', name: 'a', quantity: 2 }], cards), [[]])
  assert.deepEqual(addProblems(deck, [{ scryfallId: 'b', name: 'b', quantity: 5, toSideboard: true }], cards), [[]])
  assert.equal(duplicateWarning(deck, card('a'), 3), null)
})

test('Limited land advice is about 17, and budget swaps ask for no format', () => {
  assert.deepEqual(manaBaseAdvice([], [], 17, 'LIMITED'), [])
  assert.match(manaBaseAdvice([], [], 14, 'LIMITED')[0], /16–18/)
  assert.match(manaBaseAdvice([], [], 20, 'LIMITED')[0], /heavy/)
  const query = budgetSwapQuery({ name: 'Bear', price: 1, role: null, typeLine: 'Creature', cmc: 2, identity: 'g', format: 'LIMITED' })
  assert.ok(!query.includes('f:'))
})

test('mana symbols count each colour, hybrid towards both', () => {
  assert.deepEqual(manaPips('{2}{W}{W}'), { W: 2 })
  assert.deepEqual(manaPips('{W/U}{B/P}{G}'), { W: 1, U: 1, B: 1, G: 1 })
  assert.deepEqual(manaPips(null), {})
  assert.deepEqual(manaPips('{X}{C}'), {})
})

test("a card's colours: Scryfall's, or its front face's cost", () => {
  assert.deepEqual(cardColours(card('a', { colors: ['G', 'W'] })), ['W', 'G'])
  assert.deepEqual(cardColours(card('dfc', { card_faces: [{ name: 'Front', mana_cost: '{1}{R}' }, { name: 'Back' }] } as Partial<ScryfallCard>)), ['R'])
  assert.deepEqual(cardColours(undefined), [])
})

test('the pool by colour: each colour, multicolour, colourless, lands', () => {
  const cards = known(
    card('angel', { colors: ['W'] }), card('drake', { colors: ['U'] }), card('gold', { colors: ['W', 'U'] }),
    card('golem', { colors: [], type_line: 'Artifact Creature' }), card('gate', { colors: [], type_line: 'Land — Gate' }),
  )
  assert.equal(poolGroupOf(entry('gate', 1, 'Land'), cards.get('gate')), 'L')
  // An unknown card is sorted by its saved type line: a land is still a land.
  assert.equal(poolGroupOf(entry('x', 1, 'Basic Land — Forest'), undefined), 'L')
  const groups = poolGroups([entry('gate'), entry('golem'), entry('gold'), entry('drake', 2), entry('angel')], cards)
  assert.deepEqual(groups.map((g) => [g.key, g.label, g.count]), [['W', 'White', 1], ['U', 'Blue', 2], ['M', 'Multicolour', 1], ['C', 'Colourless', 1], ['L', 'Lands', 1]])
})

test('the strongest pairs count playable cards in the pair or colourless, top three', () => {
  const cards = known(
    card('w', { colors: ['W'] }), card('u', { colors: ['U'] }), card('b', { colors: ['B'] }),
    card('wu', { colors: ['W', 'U'] }), card('c', { colors: [] }), card('land', { colors: [], type_line: 'Land' }),
  )
  const pool = [entry('w', 3), entry('u', 2), entry('b', 2), entry('wu'), entry('c'), entry('land', 5, 'Land')]
  // WU: 3 + 2 + 1 + 1 = 7; WB: 3 + 2 + 1 = 6; UB: 2 + 2 + 1 = 5; WR only 4.
  assert.deepEqual(strongestPairs(pool, cards), [{ colours: 'WU', count: 7 }, { colours: 'WB', count: 6 }, { colours: 'UB', count: 5 }])
  assert.deepEqual(strongestPairs([], cards), [])
})

test('basic lands: 17 for 40 cards, split by mana symbols, at least one of each colour', () => {
  assert.deepEqual(basicLandSplit({ W: 10, U: 5 }, 17), { W: 11, U: 6 })
  assert.deepEqual(basicLandSplit({ W: 20, G: 1 }, 17), { W: 16, G: 1 })
  assert.deepEqual(basicLandSplit({ R: 3 }, 17), { R: 17 })
  assert.deepEqual(basicLandSplit({ W: 1, U: 1, B: 1 }, 2), { W: 1, U: 1, B: 1 })
  assert.deepEqual(basicLandSplit({}, 17), {})
  assert.deepEqual(basicLandSplit({ W: 4 }, 0), {})
})

test("the main deck's symbols leave out lands, and lands already in come off the 17", () => {
  const cards = known(card('a', { mana_cost: '{1}{W}' }), card('b', { mana_cost: '{U}{U}' }), card('dual', { type_line: 'Land', mana_cost: '' }))
  const main = [entry('a', 2), entry('b'), entry('dual', 2, 'Land')]
  assert.deepEqual(mainDeckPips(main, cards), { W: 2, U: 2 })
  assert.equal(basicsWanted(main, cards), 15)
  assert.equal(basicsWanted([entry('x', 20, 'Basic Land — Plains')], new Map()), 0)
})

test('the pool for a binder: deck and pool together, one row per printing', () => {
  const deck = limited([entry('a', 2), entry('b')], [entry('a', 1), entry('c', 3)])
  assert.deepEqual(poolCopies(deck).map((e) => [e.scryfallId, e.quantity]), [['a', 3], ['b', 1], ['c', 3]])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addCheckText, addProblems } from '../../src/decks/addCheck.ts'
import { normalizeDeck, type Deck, type DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The check before a card goes into a deck. The Android app has the same cases — see AddCheckTest.kt.

const entry = (id: string, quantity = 1, name = id): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: 'Instant', partnerAbility: null })

const card = (id: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id, name: id, type_line: 'Instant', color_identity: [], legalities: {}, ...extra }) as ScryfallCard

const known = (...cards: ScryfallCard[]) => new Map(cards.map((c) => [c.id, c]))
const adding = (id: string, quantity = 1) => [{ scryfallId: id, name: id, quantity }]

const deck = (gameMode: string, extra: Partial<Deck> = {}): Deck => normalizeDeck({ id: 'd', name: 'Test', gameMode, ...extra })

test('a card not legal in the format, and a banned one', () => {
  const pauper = deck('PAUPER')
  assert.deepEqual(addProblems(pauper, adding('rare'), known(card('rare', { legalities: { pauper: 'not_legal' } }))), [['Not legal in Pauper']])
  assert.deepEqual(addProblems(pauper, adding('bolt'), known(card('bolt', { legalities: { pauper: 'legal' } }))), [[]])
  const modern = deck('MODERN')
  assert.deepEqual(addProblems(modern, adding('oko'), known(card('oko', { legalities: { modern: 'banned' } }))), [['Banned in Modern']])
})

test('a restricted card is fine once, not twice', () => {
  const vintage = deck('VINTAGE', { cards: [entry('ring')] })
  const ring = card('ring', { legalities: { vintage: 'restricted' } })
  assert.deepEqual(addProblems(deck('VINTAGE'), adding('ring'), known(ring)), [[]])
  assert.deepEqual(addProblems(vintage, adding('ring'), known(ring)), [['Restricted in Vintage']])
})

test("off-colour cards against the commander's colours, a pair's colours together", () => {
  const atraxa = entry('atraxa', 1, 'Atraxa')
  const edh = deck('COMMANDER', { commander: atraxa, cards: [atraxa] })
  const cards = known(card('atraxa', { color_identity: ['W', 'U', 'B', 'G'] }), card('bolt', { color_identity: ['R'] }), card('growth', { color_identity: ['G'] }))
  assert.deepEqual(addProblems(edh, adding('bolt'), cards), [["Outside Atraxa's colours"]])
  assert.deepEqual(addProblems(edh, adding('growth'), cards), [[]])

  const pair = deck('COMMANDER', { commander: entry('kraum', 1, 'Kraum'), partnerCommander: entry('tymna', 1, 'Tymna') })
  const pairCards = known(card('kraum', { color_identity: ['U', 'R'] }), card('tymna', { color_identity: ['W', 'B'] }), card('bolt', { color_identity: ['R'] }), card('growth', { color_identity: ['G'] }))
  assert.deepEqual(addProblems(pair, adding('bolt'), pairCards), [[]])
  assert.deepEqual(addProblems(pair, adding('growth'), pairCards), [["Outside Kraum & Tymna's colours"]])
})

test('a colourless commander allows only colourless cards', () => {
  const edh = deck('COMMANDER', { commander: entry('kozilek', 1, 'Kozilek') })
  const cards = known(card('kozilek'), card('sol'), card('bolt', { color_identity: ['R'] }))
  assert.deepEqual(addProblems(edh, adding('sol'), cards), [[]])
  assert.deepEqual(addProblems(edh, adding('bolt'), cards), [["Outside Kozilek's colours"]])
})

test('no colour check without a commander, or outside commander formats', () => {
  const red = known(card('bolt', { color_identity: ['R'] }))
  assert.deepEqual(addProblems(deck('COMMANDER'), adding('bolt'), red), [[]])
  assert.deepEqual(addProblems(deck('MODERN', { commander: entry('x') }), adding('bolt'), red), [[]])
})

test('copies count the main deck and sideboard together, by name, and earlier cards in the list', () => {
  const modern = deck('MODERN', { cards: [entry('bolt-a', 2, 'Bolt')], sideboard: [entry('bolt-b', 1, 'Bolt')] })
  const bolt = known(card('bolt-c', { name: 'Bolt' }))
  assert.deepEqual(addProblems(modern, [{ scryfallId: 'bolt-c', name: 'Bolt', quantity: 1 }], bolt), [[]])
  assert.deepEqual(addProblems(modern, [{ scryfallId: 'bolt-c', name: 'Bolt', quantity: 2 }], bolt), [['Over the copy limit (4 max)']])
  assert.deepEqual(addProblems(deck('COMMANDER', { cards: [entry('sol')] }), adding('sol'), known()), [['Singleton: only 1 copy allowed in Commander']])
  assert.deepEqual(
    addProblems(deck('COMMANDER'), [{ scryfallId: 'a', name: 'Sol', quantity: 1 }, { scryfallId: 'b', name: 'Sol', quantity: 1 }], known()),
    [[], ['Singleton: only 1 copy allowed in Commander']],
  )
  assert.deepEqual(addProblems(deck('BRAWL', { cards: [entry('sol')] }), adding('sol'), known()), [['Singleton: only 1 copy allowed in Brawl']])
})

test('basics and "any number" cards have no copy limit', () => {
  const edh = deck('COMMANDER', { cards: [entry('forest', 30, 'Forest'), entry('rats', 20, 'Relentless Rats')] })
  assert.deepEqual(addProblems(edh, [{ scryfallId: 'forest', name: 'Forest', quantity: 5 }], known()), [[]])
  const rats = card('rats', { name: 'Relentless Rats', oracle_text: 'A deck can have any number of cards named Relentless Rats.' })
  assert.deepEqual(addProblems(edh, [{ scryfallId: 'rats', name: 'Relentless Rats', quantity: 1 }], known(rats)), [[]])
  const wastes = card('snowy', { name: 'Snow-Covered Wastes', type_line: 'Basic Snow Land' })
  assert.deepEqual(addProblems(edh, [{ scryfallId: 'snowy', name: 'Snow-Covered Wastes', quantity: 3 }], known(wastes)), [[]])
})

test("missing card data skips legality and colours but still counts copies", () => {
  const edh = deck('COMMANDER', { commander: entry('atraxa', 1, 'Atraxa'), cards: [entry('bolt')] })
  // Neither the card nor the commander is known (offline).
  assert.deepEqual(addProblems(edh, adding('mystery'), known()), [[]])
  assert.deepEqual(addProblems(edh, adding('bolt'), known()), [['Singleton: only 1 copy allowed in Commander']])
  // The card is known but the commander isn't: no colour check.
  assert.deepEqual(addProblems(edh, adding('red'), known(card('red', { color_identity: ['R'] }))), [[]])
})

test('several problems on one card, in order', () => {
  const edh = deck('COMMANDER', { commander: entry('g', 1, 'Omnath'), cards: [entry('x')] })
  const cards = known(card('g', { color_identity: ['G'] }), card('x', { color_identity: ['R'], legalities: { commander: 'banned' } }))
  assert.deepEqual(addProblems(edh, adding('x'), cards), [['Banned in Commander', "Outside Omnath's colours", 'Singleton: only 1 copy allowed in Commander']])
})

test('one more copy (a "+") checks only the copy limit', () => {
  const edh = deck('COMMANDER', { commander: entry('g', 1, 'Omnath'), cards: [entry('x'), entry('m', 1, 'Mountain')] })
  const cards = known(card('g', { color_identity: ['G'] }), card('x', { color_identity: ['R'], legalities: { commander: 'banned' } }))
  assert.deepEqual(addProblems(edh, adding('x'), cards, true), [['Singleton: only 1 copy allowed in Commander']])
  assert.deepEqual(addProblems(edh, [{ scryfallId: 'm', name: 'Mountain', quantity: 1 }], cards, true), [[]])
  const modern = deck('MODERN', { cards: [entry('bolt', 3, 'Bolt')] })
  const banned = known(card('bolt', { name: 'Bolt', legalities: { modern: 'banned' } }))
  assert.deepEqual(addProblems(modern, [{ scryfallId: 'bolt', name: 'Bolt', quantity: 1 }], banned, true), [[]])
  const full = deck('MODERN', { cards: [entry('bolt', 4, 'Bolt')] })
  assert.deepEqual(addProblems(full, [{ scryfallId: 'bolt', name: 'Bolt', quantity: 1 }], banned, true), [['Over the copy limit (4 max)']])
})

test("the dialog's words, for one card and for several", () => {
  assert.deepEqual(addCheckText('Elves', [{ name: 'Sol Ring', problems: ['Banned in Modern'] }]), { title: 'Add Sol Ring anyway?', lines: ['Banned in Modern'], single: true })
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `C${i}`, problems: i === 0 ? [] : ['Not legal in Modern'] }))
  const text = addCheckText('Burn', many)
  assert.equal(text.title, "9 of these cards aren't allowed in Burn")
  assert.equal(text.lines.length, 9)
  assert.equal(text.lines[0], 'C1: Not legal in Modern')
  assert.equal(text.lines[8], 'and 1 more')
  assert.equal(text.single, false)
})

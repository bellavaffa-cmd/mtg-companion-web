import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKGROUND_QUERY, commanderQuery, defaultDeckName, fitsIdentity, landingTab, matchesSearch, secondCommanderOffer,
  secondCommanderQuery, secondCommanders, sortCommanders,
} from '../../src/decks/newDeck.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Starting a deck from scratch (src/decks/newDeck.ts).

const card = (name: string, extra: Partial<ScryfallCard> = {}) => ({ id: `id-${name}`, name, ...extra }) as ScryfallCard

test('each format asks Scryfall for its own commanders, and the rest pick none', () => {
  assert.equal(commanderQuery('COMMANDER'), 'is:commander legal:commander')
  assert.equal(commanderQuery('BRAWL'), 'legal:brawl (t:legendary (t:creature or t:planeswalker) or o:"can be your commander")')
  for (const format of ['STANDARD', 'PIONEER', 'MODERN', 'PAUPER', 'LEGACY', 'VINTAGE'] as const) {
    assert.equal(commanderQuery(format), null)
  }
})

test('a commander fits when its whole colour identity was chosen', () => {
  assert.ok(fitsIdentity(['W', 'U'], []))
  assert.ok(fitsIdentity(['W', 'U'], ['W', 'U']))
  assert.ok(fitsIdentity(['W'], ['W', 'U']))
  assert.ok(fitsIdentity(['W', 'U'], ['W', 'U', 'B']))
  assert.ok(!fitsIdentity(['W', 'U', 'B'], ['W', 'U']))
  assert.ok(!fitsIdentity(['G'], ['W', 'U']))
})

test('colourless commanders fit any colours; colourless alone shows only them', () => {
  assert.ok(fitsIdentity([], ['R']))
  assert.ok(fitsIdentity(undefined, ['C']))
  assert.ok(!fitsIdentity(['R'], ['C']))
  assert.ok(fitsIdentity(['R'], ['R', 'C']))
})

test('the search finds name, type line and rules text', () => {
  const krenko = card('Krenko, Mob Boss', { type_line: 'Legendary Creature — Goblin Warrior', oracle_text: 'Create X 1/1 red Goblin creature tokens' })
  assert.ok(matchesSearch(krenko, 'krenko'))
  assert.ok(matchesSearch(krenko, 'warrior'))
  assert.ok(matchesSearch(krenko, 'TOKENS'))
  assert.ok(matchesSearch(krenko, '  '))
  assert.ok(!matchesSearch(krenko, 'elf'))
})

test('Popular is EDHREC rank, Name is A to Z, Newest is the latest release first', () => {
  const a = card('Atraxa', { edhrec_rank: 3, released_at: '2016-11-11' })
  const b = card('Krenko', { edhrec_rank: 1, released_at: '2012-07-13' })
  const c = card('Edgar', { released_at: '2020-01-01' })
  const names = (cards: ScryfallCard[]) => cards.map((x) => x.name)
  assert.deepEqual(names(sortCommanders([a, c, b], 'POPULAR')), ['Krenko', 'Atraxa', 'Edgar'])
  assert.deepEqual(names(sortCommanders([a, c, b], 'NAME')), ['Atraxa', 'Edgar', 'Krenko'])
  assert.deepEqual(names(sortCommanders([a, c, b], 'NEWEST')), ['Edgar', 'Atraxa', 'Krenko'])
})

test("a deck is named for its commander, both for a pair, or its format", () => {
  assert.equal(defaultDeckName('COMMANDER', { name: 'Krenko, Mob Boss' }), 'Krenko, Mob Boss')
  assert.equal(defaultDeckName('COMMANDER', { name: 'Wilson, Refined Grizzly' }, { name: 'Acolyte of Bahamut' }), 'Wilson, Refined Grizzly & Acolyte of Bahamut')
  assert.equal(defaultDeckName('BRAWL', { name: 'Esika, God of the Tree // The Prismatic Bridge' }), 'Esika, God of the Tree')
  assert.equal(defaultDeckName('STANDARD'), 'New Standard deck')
  assert.equal(defaultDeckName('PAUPER', null), 'New Pauper deck')
})

test('a new deck opens on Suggestions with a commander, on its cards without', () => {
  assert.equal(landingTab('COMMANDER'), 'Suggestions')
  assert.equal(landingTab('BRAWL'), 'Suggestions')
  assert.equal(landingTab('MODERN'), 'Cards')
})

test('the second commander offered, and where it comes from', () => {
  const wilson = card('Wilson, Refined Grizzly', { type_line: 'Legendary Creature — Bear', oracle_text: 'Choose a Background (You can have a Background as a second commander.)' })
  const tymna = card('Tymna the Weaver', { type_line: 'Legendary Creature — Human', oracle_text: 'Partner' })
  const kraum = card("Kraum, Ludevic's Opus", { type_line: 'Legendary Creature — Zombie', oracle_text: 'Partner' })
  const atraxa = card('Atraxa', { type_line: 'Legendary Creature — Angel', oracle_text: 'Flying' })
  assert.equal(secondCommanderOffer(wilson, 'COMMANDER'), 'BACKGROUND')
  assert.equal(secondCommanderOffer(wilson, 'BRAWL'), null)
  assert.equal(secondCommanderOffer(tymna, 'BRAWL'), 'PARTNER')
  assert.equal(secondCommanderOffer(atraxa, 'COMMANDER'), null)
  assert.equal(secondCommanderQuery('BACKGROUND'), BACKGROUND_QUERY)
  assert.equal(secondCommanderQuery('PARTNER'), null)
  assert.deepEqual(secondCommanders(tymna, [tymna, kraum, atraxa, wilson]).map((c) => c.name), ["Kraum, Ludevic's Opus"])
})

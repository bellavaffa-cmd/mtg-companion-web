import { test } from 'node:test'
import assert from 'node:assert/strict'
import { madeByLabel, tokensNeeded } from '../../src/decks/tokens.ts'
import type { Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard, ScryfallPart } from '../../src/types/scryfall.ts'

const entry = (id: string, name: string): DeckCardEntry => ({
  scryfallId: id, name, imageUrl: null, quantity: 1,
  canBeCommander: false, typeLine: null, partnerAbility: null,
})

const deck = (cards: DeckCardEntry[], commander: DeckCardEntry | null = null): Deck => ({
  id: 'd1', name: 'Tokens', commander, partnerCommander: null, cards,
  gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'PHYSICAL',
})

const card = (id: string, name: string, parts: ScryfallPart[]): ScryfallCard =>
  ({ id, name, all_parts: [{ id, component: 'combo_piece', name }, ...parts] })

const SOLDIER = { id: 'tok-soldier', component: 'token', name: 'Soldier', type_line: 'Token Creature — Soldier' }
// The same token, printed in another set: a different id, but one piece of cardboard to bring.
const SOLDIER_AGAIN = { ...SOLDIER, id: 'tok-soldier-2' }
const TREASURE = { id: 'tok-treasure', component: 'token', name: 'Treasure', type_line: 'Token Artifact — Treasure' }
const EMBLEM = { id: 'tok-emblem', component: 'token', name: 'Elspeth', type_line: 'Emblem — Elspeth' }

test('a deck asks for the tokens its cards make, and says which cards make them', () => {
  const cards = new Map([
    ['a', card('a', 'Captain', [SOLDIER])],
    ['b', card('b', 'Sergeant', [SOLDIER_AGAIN])],
    ['c', card('c', 'Pirate', [TREASURE])],
  ])
  const needed = tokensNeeded(deck([entry('a', 'Captain'), entry('b', 'Sergeant'), entry('c', 'Pirate')]), cards)

  assert.deepEqual(needed.map((t) => t.name), ['Soldier', 'Treasure'])
  // Counted once, credited to both cards — a different printing is the same token to bring.
  assert.deepEqual(needed[0].madeBy, ['Captain', 'Sergeant'])
  assert.deepEqual(needed[1].madeBy, ['Pirate'])
})

test('the commander counts, and a card is only credited once', () => {
  const cards = new Map([['a', card('a', 'Captain', [SOLDIER, SOLDIER_AGAIN])]])
  const needed = tokensNeeded(deck([], entry('a', 'Captain')), cards)
  assert.equal(needed.length, 1)
  assert.deepEqual(needed[0].madeBy, ['Captain'])
})

test('meld halves and combo pieces are cards you own, not things to bring', () => {
  const cards = new Map([
    ['a', { id: 'a', name: 'Brisela Half', all_parts: [
      { id: 'm1', component: 'meld_part', name: 'Other Half' },
      { id: 'm2', component: 'meld_result', name: 'Brisela' },
    ] } as ScryfallCard],
  ])
  assert.deepEqual(tokensNeeded(deck([entry('a', 'Brisela Half')]), cards), [])
})

test('emblems are listed after the tokens', () => {
  const cards = new Map([
    ['a', card('a', 'Elspeth', [EMBLEM])],
    ['b', card('b', 'Pirate', [TREASURE])],
  ])
  const needed = tokensNeeded(deck([entry('a', 'Elspeth'), entry('b', 'Pirate')]), cards)
  assert.deepEqual(needed.map((t) => t.name), ['Treasure', 'Elspeth'])
  assert.equal(needed[1].isEmblem, true)
})

test('nothing is claimed while the cards are still loading', () => {
  assert.deepEqual(tokensNeeded(deck([entry('a', 'Captain')]), undefined), [])
  assert.deepEqual(tokensNeeded(deck([entry('a', 'Captain')]), null), [])
})

test('what to say under a token', () => {
  const one = { id: 'x', name: 'Soldier', typeLine: null, madeBy: ['Captain'], isEmblem: false }
  assert.equal(madeByLabel(one), 'Captain')
  assert.equal(madeByLabel({ ...one, madeBy: ['Captain', 'Sergeant'] }), 'Captain and Sergeant')
  assert.equal(madeByLabel({ ...one, madeBy: ['Captain', 'Sergeant', 'Pirate'] }), 'Captain and 2 more')
})

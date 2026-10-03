import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canKeep, cardsToBottom, choosingHand, createToken, keep, mulligan, newGame, nextTurn, play, playCards, putOnBottom, reset,
  toGraveyard, toHand, toggleTap, withOnThePlay, type PlaytestState, type Random,
} from '../../src/decks/playtest.ts'
import { normalizeDeck, type DeckCardEntry } from '../../src/types/models.ts'

// Playtesting a deck: London mulligan, play/draw, turns, the battlefield, tokens. The Android app's
// PlaytestTest has the same cases.

/** A seeded random source (mulberry32), so a test shuffles the same way every time. */
function seeded(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const entry = (id: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })
const deck = normalizeDeck({
  id: 'd', name: 'Omnath', commander: entry('omnath'),
  cards: [entry('omnath'), entry('forest', 30), entry('sol'), entry('bolt', 20)],
  sideboard: [entry('duress', 2)],
})

function game(seed = 1, onThePlay = true, free = false): PlaytestState {
  const { library, commandZone } = playCards(deck)
  return newGame(library, commandZone, seeded(seed), onThePlay, free)
}

test('the commander starts in the command zone and seven are drawn', () => {
  const g = game()
  assert.deepEqual(g.commandZone.map((c) => c.id), ['omnath#cmd'])
  assert.equal(g.hand.length, 7)
  assert.equal(g.library.length, 51 - 7)
  assert.ok(choosingHand(g))
  // The same seed shuffles the same way; the sideboard isn't played.
  assert.deepEqual(g.hand, game().hand)
  assert.ok(![...g.hand, ...g.library].some((c) => c.name === 'duress'))
})

test('a London mulligan draws seven and puts one on the bottom per mulligan', () => {
  let g = mulligan(mulligan(game(), seeded(2)), seeded(3))
  assert.equal(g.hand.length, 7)
  assert.equal(g.toBottom, 2)
  assert.ok(!canKeep(g))
  const first = g.hand[0]
  g = putOnBottom(g, first.id)
  assert.equal(g.library[g.library.length - 1], first)
  g = putOnBottom(g, g.hand[0].id)
  assert.equal(g.hand.length, 5)
  assert.equal(g.hand.length + g.library.length, 51)
  assert.equal(putOnBottom(g, g.hand[0].id), g) // no more asked for
  assert.ok(canKeep(g))
})

test('the first mulligan is free when asked', () => {
  assert.equal(mulligan(game(1, true, true), seeded(2)).toBottom, 0)
  assert.equal(mulligan(mulligan(game(1, true, true), seeded(2)), seeded(3)).toBottom, 1)
  assert.equal(cardsToBottom(1, false), 1)
})

test('no draw on turn one on the play, one on the draw', () => {
  const onPlay = keep(game())
  assert.equal(onPlay.turn, 1)
  assert.equal(onPlay.hand.length, 7)
  assert.equal(keep(withOnThePlay(game(), false)).hand.length, 8)
  // Play or draw can't change once the game is under way.
  assert.equal(withOnThePlay(onPlay, false), onPlay)
})

test('next turn untaps everything and draws', () => {
  let g = keep(game())
  const land = g.hand[0].id
  g = toggleTap(play(g, land), land)
  assert.ok(g.battlefield[0].tapped)
  const libraryBefore = g.library.length
  g = nextTurn(g)
  assert.equal(g.turn, 2)
  assert.ok(!g.battlefield[0].tapped)
  assert.equal(g.library.length, libraryBefore - 1)
  assert.equal(g.hand.length, 7)
})

test('cards go to the graveyard, a commander to the command zone, a token nowhere', () => {
  let g = keep(game())
  const card = g.hand[0].id
  g = toGraveyard(g, card)
  assert.deepEqual(g.graveyard.map((c) => c.id), [card])
  g = play(g, 'omnath#cmd')
  assert.deepEqual(g.commandZone, [])
  g = toGraveyard(g, 'omnath#cmd')
  assert.deepEqual(g.commandZone.map((c) => c.id), ['omnath#cmd'])
  g = createToken(createToken(g, 'Elemental', null), 'Elemental', null)
  assert.deepEqual(g.battlefield.map((p) => p.card.id), ['token#1', 'token#2'])
  g = toHand(toGraveyard(g, 'token#1'), 'token#2')
  assert.deepEqual(g.battlefield, [])
  assert.equal(g.graveyard.length, 1)
})

test('reset puts every card back and starts over', () => {
  let g = keep(game())
  g = nextTurn(toGraveyard(createToken(play(play(g, g.hand[0].id), 'omnath#cmd'), 'Elemental', null), g.hand[1].id))
  const fresh = reset(g, seeded(5))
  assert.equal(fresh.turn, 0)
  assert.equal(fresh.library.length + fresh.hand.length, 51)
  assert.deepEqual(fresh.commandZone.map((c) => c.id), ['omnath#cmd'])
  assert.ok(fresh.battlefield.length === 0 && fresh.graveyard.length === 0)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SIM_HANDS, handStats, seededRandom, simLibrary, type SimCard } from '../../src/decks/handSim.ts'
import { handOdds } from '../../src/decks/handOdds.ts'
import { cardsToBottom, keep, mulligan, newGame, nextTurn, putOnBottom, type PlayCard } from '../../src/decks/playtest.ts'
import type { Deck, DeckCardEntry } from '../../src/types/models.ts'

// Test hands by the thousand. The Android app's HandSimTest.kt has the same cases and, with the same
// seed, the very same numbers.

const cards = (n: number, card: SimCard): SimCard[] => Array.from({ length: n }, () => ({ ...card }))
/** 60 cards: 24 lands, 8 two-drops, 28 three-drops. */
const sixty = [...cards(24, { land: true, manaValue: null }), ...cards(8, { land: false, manaValue: 2 }), ...cards(28, { land: false, manaValue: 3 })]

test('the seeded random numbers repeat, and match the phone', () => {
  const r = seededRandom(7)
  const first = [r(), r(), r()]
  const again = seededRandom(7)
  assert.deepEqual([again(), again(), again()], first)
  // The phone's HandSimTest checks the same three numbers.
  assert.deepEqual(first.map((x) => Math.round(x * 1e6)), [11705, 61958, 976908])
})

test('10,000 hands land close to the exact odds', () => {
  const s = handStats(sixty)!
  assert.equal(s.hands, SIM_HANDS)
  assert.equal(s.library, 60)
  assert.equal(s.lands, 24)
  assert.equal(s.twoDrops, 8)
  const exact = handOdds(60, 24, 0, false)!
  assert.ok(Math.abs(s.twoToFourLands - exact.keepable) < 0.02, `${s.twoToFourLands} vs ${exact.keepable}`)
  assert.ok(Math.abs(s.averageLands - (7 * 24) / 60) < 0.05)
  assert.ok(Math.abs(s.landsInOpener.reduce((a, b) => a + b, 0) - 1) < 1e-9)
  // On the draw sees a card more, so it hits its land drops at least as often.
  for (const d of s.landDrops) assert.ok(d.onTheDraw >= d.onThePlay - 0.02)
  assert.ok(Math.abs(s.landDrops[2].onThePlay - exact.landDrops[0].chance) < 0.02)
  assert.ok(s.twoDropOnTurn2.onTheDraw >= s.twoDropOnTurn2.onThePlay)
  assert.ok(s.mulliganRate > 0.05 && s.mulliganRate < 0.2, `${s.mulliganRate}`)
})

test('the same seed gives the same numbers, and the phone gets them too', () => {
  const a = handStats(sixty, 2000, 42)!
  const b = handStats(sixty, 2000, 42)!
  assert.deepEqual(a, b)
  assert.deepEqual(
    [a.twoToFourLands, a.averageLands, a.mulliganRate, a.twoDropOnTurn2.onThePlay, a.landDrops[3].onTheDraw],
    [0.783, 2.861, 0.1405, 0.6455, 0.751],
  )
})

test('a deck of only lands always has its land drops, and never a two-drop', () => {
  const s = handStats(cards(40, { land: true, manaValue: null }), 500)!
  assert.equal(s.landsInOpener[7], 1)
  assert.equal(s.mulliganRate, 1)
  assert.ok(s.landDrops.every((d) => d.onThePlay === 1 && d.onTheDraw === 1))
  assert.equal(s.twoDropOnTurn2.onThePlay, 0)
})

test('too small a library has no numbers', () => {
  assert.equal(handStats(cards(10, { land: true, manaValue: null })), null)
})

test('a Commander deck: 99 in the library, the commander in the command zone', () => {
  const e = (name: string, quantity: number, typeLine: string): DeckCardEntry =>
    ({ scryfallId: name, name, imageUrl: null, quantity, canBeCommander: false, typeLine, partnerAbility: null })
  const commander = e('Omnath', 1, 'Legendary Creature — Elemental')
  const deck = { id: 'd', name: 'Omnath', commander, partnerCommander: null, cards: [commander, e('Forest', 38, 'Basic Land — Forest'), e('Bear', 61, 'Creature — Bear')] } as unknown as Deck
  const lib = simLibrary(deck, (x) => x.typeLine, (x) => (x.name === 'Bear' ? 2 : null))
  assert.equal(lib.length, 99)
  assert.equal(lib.filter((c) => c.land).length, 38)
  assert.equal(lib.filter((c) => c.manaValue === 2).length, 61)
})

test('a London mulligan: seven again, then one to the bottom per mulligan', () => {
  const library: PlayCard[] = Array.from({ length: 60 }, (_, i) => ({ id: `c#${i}`, name: `c${i}`, imageUrl: null }))
  const r = seededRandom(3)
  let g = mulligan(mulligan(newGame(library, [], r), r), r)
  assert.equal(g.hand.length, 7)
  assert.equal(g.toBottom, 2)
  g = putOnBottom(putOnBottom(g, g.hand[0].id), g.hand[1].id)
  assert.equal(g.hand.length, 5)
  assert.equal(g.library.length, 55)
  g = nextTurn(keep(g))
  assert.equal(g.hand.length, 6)
  assert.equal(cardsToBottom(1, true), 0)
})

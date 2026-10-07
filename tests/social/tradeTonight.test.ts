import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isComing } from '../../src/collection/eventBag.ts'
import type { PlacedCard } from '../../src/collection/storagePlaces.ts'
import type { MatchCard, TradeMatch } from '../../src/social/more.ts'
import {
  addFriendLine, playersFromNames, tonightAsDeckCards, tonightLine, tradeMatchesTonight, whereTonight,
} from '../../src/social/tradeTonight.ts'

// Trade matches tonight: grouping the trade matches by the friends at the table, where the cards are,
// and the guests. The Android app has the same checks — see TradeTonightTest.kt.

const placed = (name: string, placeId: string, opts: { page?: number; slot?: number; section?: string; forTrade?: number } = {}): PlacedCard => ({
  collectionId: 'c1',
  entry: { scryfallId: name.toLowerCase(), name, imageUrl: null, quantity: 1, foilQuantity: 0, ...(opts.forTrade ? { forTrade: opts.forTrade } : {}) },
  line: { placeId, qty: 1, ...(opts.page ? { page: opts.page } : {}), ...(opts.slot ? { slot: opts.slot } : {}), ...(opts.section ? { section: opts.section } : {}) },
})
const mc = (name: string, forTrade = false): MatchCard => ({ scryfallId: name.toLowerCase(), name, foil: false, quantity: 1, collectionId: 'c1', ...(forTrade ? { forTrade } : {}) })
const places = new Map([['binder', 'Trade binder'], ['box', 'Red box']])
const here = [
  placed('Brainstorm', 'box', { section: 'Blue' }),
  placed('Brainstorm', 'binder', { page: 2, slot: 5 }),
  placed('Cyclonic Rift', 'binder', { page: 4, slot: 1, forTrade: 1 }),
  placed('Impulse', 'box'),
]

test('where a card is: the copy that would go first', () => {
  assert.equal(whereTonight('Brainstorm', here, places), 'Trade binder · Page 2, slot 5')
  assert.equal(whereTonight('cyclonic rift', here, places), 'Trade binder · Page 4, slot 1')
  assert.equal(whereTonight('Impulse', here, places), 'Red box')
  assert.equal(whereTonight('Opt', here, places), 'No place yet')
  assert.equal(whereTonight('Brainstorm', [here[0]], places), 'Red box › Blue')
})

test('friends at the table are grouped with what can change hands; guests are named', () => {
  const matches: TradeMatch[] = [
    { friend: 'priya', they_have: [mc('Rhystic Study', true), mc('Sheoldred')], they_want: [mc('Brainstorm'), mc('Sol Ring'), mc('Cyclonic Rift', true), mc('brainstorm')] },
    { friend: 'sam', they_have: [mc('Mana Crypt')], they_want: [mc('Sol Ring')] },
    { friend: 'noor', they_have: [mc('Opt', true)], they_want: [] },
  ]
  const tonight = tradeMatchesTonight(
    [
      { name: 'Sam', userId: 'sam' },
      { name: 'Priya', userId: 'priya' },
      { name: 'Jo', userId: null },
      { name: 'Priya', userId: 'priya' },
      { name: 'Ex', userId: 'ex' },
      { name: 'Noor', userId: 'noor' },
    ],
    new Set(['priya', 'sam', 'noor']),
    matches,
    new Set(['sol ring', 'cyclonic rift']),
    here,
    places,
  )
  assert.deepEqual(tonight.matches.map((m) => m.name), ['Priya', 'Noor'])
  const priya = tonight.matches[0]
  // Sol Ring is played in a deck; Cyclonic Rift too, but it's marked for trade.
  assert.deepEqual(priya.theyWant.map((c) => [c.card.name, c.where]), [['Brainstorm', 'Trade binder · Page 2, slot 5'], ['Cyclonic Rift', 'Trade binder · Page 4, slot 1']])
  // Only their cards marked for trade.
  assert.deepEqual(priya.theyHave.map((c) => c.name), ['Rhystic Study'])
  assert.equal('forTrade' in priya.theyHave[0], false)
  assert.equal(tonightLine(priya), 'Priya wants 2 of your cards · has 1 card for trade that you want')
  assert.equal(tonightLine(tonight.matches[1]), 'Noor has 1 card for trade that you want')
  // Sam wants only Sol Ring, which a deck plays, and has nothing for trade.
  assert.deepEqual(tonight.nothing, ['Sam'])
  assert.deepEqual(tonight.notFriends, ['Jo', 'Ex'])
  assert.equal(addFriendLine('Jo'), 'Add Jo as a friend to see what they want')
})

test('Bring them puts one of each on the game night deck', () => {
  const lines = tonightAsDeckCards([{ card: { ...mc('Brainstorm'), quantity: 3 }, where: 'Red box' }])
  assert.deepEqual(lines.map((l) => [l.name, l.quantity, l.scryfallId]), [['Brainstorm', 1, 'brainstorm']])
})

test('the bag’s names find friends by name or first name', () => {
  const people = [{ userId: 'priya', name: 'Priya Shah' }, { userId: 'sam', name: 'Sam' }]
  assert.deepEqual(playersFromNames(['Priya', 'sam', 'Jo'], people, isComing), [
    { name: 'Priya', userId: 'priya' }, { name: 'sam', userId: 'sam' }, { name: 'Jo', userId: null },
  ])
})

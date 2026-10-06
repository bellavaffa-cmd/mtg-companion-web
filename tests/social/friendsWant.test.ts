import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bringToGameNight, friendsWantHere, GAME_NIGHT_DECK, hasLine, wantedAsTrade, wantedWhere, wantsLine,
} from '../../src/social/friendsWant.ts'
import type { PlacedCard } from '../../src/collection/storagePlaces.ts'
import type { MatchCard, TradeMatch } from '../../src/social/more.ts'
import { normalizeDeck, type DeckCardEntry } from '../../src/types/models.ts'

// "Friends want these" on a binder: grouping the trade matches by friend, the lines, and Bring to game
// night. The Android app has the same checks — see FriendsWantTest.kt.

const placed = (name: string, page?: number, slot?: number, forTrade?: number, collection = 'c1'): PlacedCard => ({
  collectionId: collection,
  entry: { scryfallId: name.toLowerCase(), name, imageUrl: null, quantity: 1, foilQuantity: 0, ...(forTrade ? { forTrade } : {}) },
  line: { placeId: 'b', qty: 1, ...(page ? { page } : {}), ...(slot ? { slot } : {}) },
})
const want = (name: string): MatchCard => ({ scryfallId: name.toLowerCase(), name, foil: false, quantity: 1 })
const match = (friend: string, theyHave: MatchCard[], theyWant: MatchCard[]): TradeMatch => ({ friend, they_have: theyHave, they_want: theyWant })
const card = (scryfallId: string, name: string): DeckCardEntry =>
  ({ scryfallId, name, imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null })

const prices: Record<string, number> = { 'Fact or Fiction': 9, Brainstorm: 2, 'Cyclonic Rift': 10, Impulse: 3 }
const price = (c: PlacedCard) => prices[c.entry.name] ?? null
const here = [placed('Brainstorm', 4, 1), placed('Fact or Fiction', 4, 6), placed('Impulse', 4, 7), placed('Cyclonic Rift', 7, 2), placed('Opt', 4, 3)]

test('friends are grouped with the cards they want here', () => {
  const wants = friendsWantHere([
    match('sam', [], [want('Impulse'), want('Lightning Bolt')]),
    match('priya', [want('Sheoldred'), want('Smothering Tithe')], [want('Brainstorm'), want('Fact or Fiction'), want('cyclonic rift'), want('Brainstorm')]),
    match('noor', [want('Sol Ring')], [want('Mana Crypt')]),
  ], here, price)
  assert.deepEqual(wants.map((w) => w.friend), ['priya', 'sam'])
  const priya = wants[0]
  assert.deepEqual(priya.cards.map((c) => c.card.entry.name), ['Cyclonic Rift', 'Fact or Fiction', 'Brainstorm'])
  assert.equal(priya.value, 21)
  assert.deepEqual(priya.cards.map(wantedWhere), ['Page 7, slot 2', 'Page 4, slot 6', 'Page 4, slot 1'])
  assert.equal(wantsLine(priya.cards.length, '$21'), '3 cards · $21')
  assert.equal(wantsLine(1, null), '1 card')
  assert.equal(hasLine('Priya', priya.theyHave), 'Priya has 2 cards you want: Sheoldred, Smothering Tithe')
  assert.equal(hasLine('Sam', wants[1].theyHave), null)
  assert.equal(hasLine('Ana', ['A', 'B', 'C', 'D', 'E', 'a'].map(want)), 'Ana has 5 cards you want: A, B, C and 2 more')
})

test('the copy marked for trade goes first', () => {
  const copies = [placed('Opt', 2, 1, undefined, 'c1'), placed('Opt', undefined, undefined, 1, 'trade'), placed('Opt', 1, 4, undefined, 'c3')]
  const wants = friendsWantHere([match('sam', [], [want('Opt')])], copies, () => null)
  assert.equal(wants[0].cards[0].card.collectionId, 'trade')
  assert.equal(wantedWhere(wants[0].cards[0]), 'Not in a pocket yet')
  assert.equal(wants[0].value, 0)
  const inPockets = friendsWantHere([match('sam', [], [want('Opt')])], copies.filter((c) => c.collectionId !== 'trade'), () => null)
  assert.equal(inPockets[0].cards[0].card.collectionId, 'c3')
  assert.deepEqual(wantedAsTrade(wants[0].cards), [{ scryfallId: 'opt', name: 'Opt', imageUrl: null, foil: false, quantity: 1, collectionId: 'trade' }])
})

test('bringing cards to game night puts them on its pull list', () => {
  const other = normalizeDeck({ id: 'd1', name: 'Atraxa' })
  const made = bringToGameNight([other], [card('fof', 'Fact or Fiction'), card('bs', 'Brainstorm')], 'new', 5)
  assert.equal(made.deckId, 'new')
  const deck = made.decks.find((d) => d.id === 'new')!
  assert.equal(deck.name, GAME_NIGHT_DECK)
  assert.equal(deck.ownership, 'VIRTUAL')
  assert.deepEqual(deck.cards.map((c) => c.name), ['Fact or Fiction', 'Brainstorm'])
  // Again, with one already on it: added once, onto the same deck.
  const again = bringToGameNight(made.decks, [card('bs2', 'Brainstorm'), card('imp', 'Impulse')], 'other')
  assert.equal(again.deckId, 'new')
  assert.equal(again.decks.length, 2)
  assert.deepEqual(again.decks.find((d) => d.id === 'new')!.cards.map((c) => c.name), ['Fact or Fiction', 'Brainstorm', 'Impulse'])
  // Once pulled into a deck box, new cards come in as proxies — still to pull.
  const pulled = again.decks.map((d) => (d.id === 'new' ? { ...d, ownership: 'PHYSICAL' as const } : d))
  const after = bringToGameNight(pulled, [card('rift', 'Cyclonic Rift')], 'x')
  assert.equal(after.decks.find((d) => d.id === 'new')!.cards.at(-1)?.proxyQuantity, 1)
})

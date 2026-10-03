import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cardFace, currentCard, loadingMode, MODE_QUERY, planarFace, planeswalk, revealNextBounty, revealNextScheme, startedMode,
} from '../../src/lifecounter/gameModes.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The life counter's game modes, as the Android app's LifeCounterViewModel plays them.

const card = (id: string, name: string, type_line: string, over: Partial<ScryfallCard> = {}) => ({ id, name, type_line, ...over }) as ScryfallCard
const noShuffle = () => 0.999999

test('each mode searches Scryfall as the app does', () => {
  assert.equal(MODE_QUERY.PLANECHASE, 't:plane or t:phenomenon')
  assert.equal(MODE_QUERY.ARCHENEMY, 't:scheme')
  assert.equal(MODE_QUERY.BOUNTY, 'set:totc name:"Bounty:" include:extras')
})

test('Archenemy starts with its archenemy, shuffling', () => {
  const s = loadingMode('ARCHENEMY', 3)
  assert.equal(s.loading, true)
  assert.equal(s.archenemyPlayerId, 3)
  assert.equal(loadingMode('BOUNTY', 3).archenemyPlayerId, null)
})

test('Planechase turns the first plane up; other cards a search brings back are left out', () => {
  const s = startedMode('PLANECHASE', [card('a', 'Akoum', 'Plane — Zendikar'), card('x', 'Sol Ring', 'Artifact'), card('b', 'Chaotic Aether', 'Phenomenon')], null, noShuffle)
  assert.equal(s.currentPlane?.name, 'Akoum')
  assert.deepEqual(s.planeDeck.map((c) => c.name), ['Chaotic Aether'])
  const walked = planeswalk(s)
  assert.equal(walked.currentPlane?.name, 'Chaotic Aether')
  assert.deepEqual(walked.planeDeck.map((c) => c.name), ['Akoum'])
})

test('the planar die: one Chaos, one Planeswalk, four blanks', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(planarFace), ['CHAOS', 'PLANESWALK', 'BLANK', 'BLANK', 'BLANK', 'BLANK'])
})

test('schemes are revealed one by one; ongoing ones stay face up', () => {
  let s = startedMode('ARCHENEMY', [
    card('1', 'All in Good Time', 'Scheme'),
    card('2', 'Feed the Machine', 'Ongoing Scheme'),
    card('3', 'Grizzly Bears', 'Creature — Bear'),
  ], 2, noShuffle)
  assert.equal(s.currentScheme, null)
  assert.equal(s.schemeDeck.length, 2)
  s = revealNextScheme(s)
  assert.equal(s.currentScheme?.name, 'All in Good Time')
  assert.deepEqual(s.ongoingSchemes, [])
  s = revealNextScheme(s)
  assert.equal(s.currentScheme?.name, 'Feed the Machine')
  assert.deepEqual(s.ongoingSchemes.map((c) => c.name), ['Feed the Machine'])
  assert.equal(revealNextScheme(s), s, 'an empty deck reveals nothing')
})

test('bounties: the front face is the bounty, the shared back face the rules; claimed ones go to the bottom', () => {
  const bounty = (id: string, outlaw: string) => card(id, `Bounty: ${outlaw} // Wanted!`, 'Card // Card', {
    card_faces: [
      { name: `Bounty: ${outlaw}`, oracle_text: `Collect bounty — ${outlaw}`, image_uris: { normal: `https://img/${id}.jpg` } },
      { name: 'Wanted!', oracle_text: 'Reveal a bounty as the third turn begins.' },
    ],
  })
  let s = startedMode('BOUNTY', [bounty('1', 'Big Joe'), bounty('2', 'Nine Lives'), card('t', 'Treasure', 'Token Artifact')], null, noShuffle)
  assert.equal(s.bountyDeck.length, 2)
  assert.equal(s.bountyRules, 'Reveal a bounty as the third turn begins.')
  s = revealNextBounty(s)
  const first = currentCard(s)!
  assert.deepEqual(cardFace(s, first), { name: 'Bounty: Big Joe', imageUrl: 'https://img/1.jpg', text: 'Collect bounty — Big Joe' })
  s = revealNextBounty(s)
  assert.equal(currentCard(s)?.id, '2')
  assert.deepEqual(s.bountyDeck.map((c) => c.id), ['1'], 'the claimed bounty went back under')
})

test('no cards (offline) leaves an empty deck, nothing to reveal', () => {
  const s = startedMode('ARCHENEMY', [], 1)
  assert.equal(s.loading, false)
  assert.equal(revealNextScheme(s), s)
  assert.equal(startedMode('PLANECHASE', []).currentPlane, null)
})

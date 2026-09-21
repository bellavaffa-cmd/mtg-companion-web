import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { IndexMatch } from '../../src/scan/cardIndex.ts'
import { cardBySight, looksLikeAnotherCard, printingBySight, sameCard } from '../../src/scan/sight.ts'

// Decisions from what the card looks like. The Android app has the same checks — see SightTest.kt.

let row = 0
const m = (name: string, group: number, score: number, set = 'x'): IndexMatch =>
  ({ row: row++, id: `id${row}`, face: 0, name, set, number: '1', group, score })

test('the printing whose picture is clearly nearest is the one', () => {
  const pick = printingBySight([m('Sol Ring', 1, 0.86, 'msc'), m('Sol Ring', 2, 0.61), m('Sol Ring', 3, 0.55)])
  assert.equal(pick?.entry.set, 'msc')
  assert.equal(pick?.certain, true)
})

test('a picture reprinted in several sets is the right picture but not a certain printing', () => {
  const pick = printingBySight([m('Llanowar Elves', 4, 0.9, 'm19'), m('Llanowar Elves', 4, 0.9, 'dom'), m('Llanowar Elves', 5, 0.6)])
  assert.equal(pick?.entry.group, 4)
  assert.equal(pick?.certain, false)
})

test('two different pictures too close to call pick nothing', () => {
  assert.equal(printingBySight([m('Island', 1, 0.8), m('Island', 2, 0.78)]), null)
  assert.equal(printingBySight([]), null)
})

test('a card is known by sight only when it is clearly that card', () => {
  assert.equal(cardBySight([m('Lightning Bolt', 1, 0.85), m('Chain Lightning', 2, 0.66)])?.name, 'Lightning Bolt')
  // Too faint a likeness — a bare table can look this much like something.
  assert.equal(cardBySight([m('Lightning Bolt', 1, 0.7), m('Chain Lightning', 2, 0.4)]), null)
  // Two names nearly as likely.
  assert.equal(cardBySight([m('Lightning Bolt', 1, 0.85), m('Chain Lightning', 2, 0.8)]), null)
  // All of the nearest are printings of the one card: clear.
  assert.equal(cardBySight([m('Island', 1, 0.8), m('Island', 2, 0.79)])?.name, 'Island')
})

test("either face's name is the same card", () => {
  assert.ok(sameCard('Delver of Secrets // Insectile Aberration', 'Insectile Aberration'))
  assert.ok(sameCard('delver of secrets', 'Delver of Secrets // Insectile Aberration'))
  assert.ok(!sameCard('Lightning Bolt', 'Lightning Helix'))
})

test('a misread title shows when the card plainly looks like another card', () => {
  const anywhere = [m('Lightning Helix', 7, 0.88), m('Boros Charm', 8, 0.6)]
  assert.equal(looksLikeAnotherCard('Lightning Bolt', [m('Lightning Bolt', 9, 0.55)], anywhere)?.name, 'Lightning Helix')
  // Its own name looks about as much like it: no reason to doubt the read.
  assert.equal(looksLikeAnotherCard('Lightning Bolt', [m('Lightning Bolt', 9, 0.84)], anywhere), null)
  // The look agrees with the read.
  assert.equal(looksLikeAnotherCard('Lightning Helix', [m('Lightning Helix', 7, 0.88)], anywhere), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canBeFoil, cardsLabel, deckPlace, doneMessage, kindDetail, kindsToChoose, onlyFoil, sheetTitle, takeCopies } from '../../src/collection/addTo.ts'

// Whether the "add to…" sheet asks binder or deck first, before listing either. The Android app's
// MoveTargetKindsTest checks the same.

test('binders and decks together are asked about first', () => {
  assert.deepEqual(kindsToChoose(2, 1), ['binder', 'deck'])
})

test('only one kind goes straight to its list', () => {
  assert.equal(kindsToChoose(0, 3), null)
  assert.equal(kindsToChoose(2, 0), null)
  assert.equal(kindsToChoose(0, 0), null)
})

test('the first step counts what each kind holds', () => {
  assert.equal(kindDetail('deck', 1), '1 deck')
  assert.equal(kindDetail('binder', 4), '4 binders')
})

// The same words on every flow, and in the Android app.

test('the sheet is titled by what it does', () => {
  assert.equal(sheetTitle('add', cardsLabel(['Sol Ring'])), 'Add Sol Ring to…')
  assert.equal(sheetTitle('move', cardsLabel(['A', 'B', 'C'])), 'Move 3 cards to…')
  assert.equal(sheetTitle('copy', 'Sol Ring'), 'Copy Sol Ring to…')
})

test('the Undo bar says what was done, and where', () => {
  assert.equal(doneMessage('add', 'Sol Ring', 'Elves'), 'Added Sol Ring to Elves')
  assert.equal(doneMessage('move', '3 cards', 'Trades'), 'Moved 3 cards to Trades')
  assert.equal(doneMessage('copy', 'Sol Ring', deckPlace('Elves', true)), 'Copied Sol Ring to Elves · Considering')
  assert.equal(deckPlace('Elves', false), 'Elves')
})

test('the Foil switch shows for printings that come in foil', () => {
  assert.equal(canBeFoil({}), true)
  assert.equal(canBeFoil({ finishes: ['nonfoil'] }), false)
  assert.equal(canBeFoil({ finishes: ['nonfoil', 'foil'] }), true)
  assert.equal(onlyFoil({ finishes: ['foil'] }), true)
  assert.equal(onlyFoil({ finishes: ['nonfoil', 'foil'] }), false)
  assert.equal(onlyFoil({}), false)
})

test('moving some of a binder card takes the regular copies first, never more than there are', () => {
  assert.deepEqual(takeCopies({ quantity: 2, foilQuantity: 1 }, 1), { quantity: 1, foilQuantity: 0 })
  assert.deepEqual(takeCopies({ quantity: 2, foilQuantity: 1 }, 3), { quantity: 2, foilQuantity: 1 })
  assert.deepEqual(takeCopies({ quantity: 0, foilQuantity: 2 }, 1), { quantity: 0, foilQuantity: 1 })
  assert.deepEqual(takeCopies({ quantity: 1, foilQuantity: 0 }, 5), { quantity: 1, foilQuantity: 0 })
})

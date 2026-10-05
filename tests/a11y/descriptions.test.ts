// The same cases as the Android app's A11yTextTest.kt.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { colourIdentityName, manaCostName, manaSymbolName, recordWords, seatDescription } from '../../src/a11y/descriptions.ts'

test('mana symbols read as words', () => {
  assert.equal(manaSymbolName('W'), 'white mana')
  assert.equal(manaSymbolName('U'), 'blue mana')
  assert.equal(manaSymbolName('B'), 'black mana')
  assert.equal(manaSymbolName('R'), 'red mana')
  assert.equal(manaSymbolName('G'), 'green mana')
  assert.equal(manaSymbolName('C'), 'colourless mana')
  assert.equal(manaSymbolName('Colorless'), 'colourless mana')
  assert.equal(manaSymbolName('{W}'), 'white mana')
  assert.equal(manaSymbolName('w'), 'white mana')
  assert.equal(manaSymbolName('2'), '2 generic mana')
  assert.equal(manaSymbolName('X'), 'X mana')
  assert.equal(manaSymbolName('T'), 'tap')
  assert.equal(manaSymbolName('Q'), 'untap')
  assert.equal(manaSymbolName('S'), 'snow mana')
  assert.equal(manaSymbolName('E'), 'energy')
})

test('hybrid and Phyrexian symbols', () => {
  assert.equal(manaSymbolName('W/U'), 'white or blue mana')
  assert.equal(manaSymbolName('2/W'), '2 generic or white mana')
  assert.equal(manaSymbolName('G/P'), 'Phyrexian green mana')
  assert.equal(manaSymbolName('{G/U/P}'), 'Phyrexian green or blue mana')
})

test('unknown symbols are read as written', () => {
  assert.equal(manaSymbolName('HW'), 'HW')
  assert.equal(manaSymbolName('CHAOS'), 'chaos')
})

test('a whole cost', () => {
  assert.equal(manaCostName('{2}{W}{W}'), '2 generic mana, white mana, white mana')
  assert.equal(manaCostName(''), '')
})

test('colour identities', () => {
  assert.equal(colourIdentityName([]), 'colourless')
  assert.equal(colourIdentityName(['C']), 'colourless')
  assert.equal(colourIdentityName(['W']), 'white')
  assert.equal(colourIdentityName(['W', 'U']), 'white and blue')
  assert.equal(colourIdentityName(['W', 'U', 'B']), 'white, blue and black')
})

test('a seat read as a whole', () => {
  assert.equal(
    seatDescription({ seat: 2, name: 'Sam', life: 34, commanderDamage: [{ from: 'Atraxa', amount: 6 }] }),
    'Seat 2, Sam, 34 life, 6 commander damage from Atraxa',
  )
  assert.equal(seatDescription({ seat: 1, name: null, life: 40 }), 'Seat 1, 40 life')
  assert.equal(seatDescription({ seat: 1, name: '  ', life: 40 }), 'Seat 1, 40 life')
  assert.equal(seatDescription({ seat: 3, name: 'Kim', life: 0, poison: 10, out: true }), 'Seat 3, Kim, 0 life, 10 poison, out of the game')
  assert.equal(
    seatDescription({ seat: 4, name: 'Jo', life: 21, commanderDamage: [{ from: 'Atraxa', amount: 6 }, { from: 'Sam', amount: 0 }, { from: "Kim's partner", amount: 3 }] }),
    "Seat 4, Jo, 21 life, 6 commander damage from Atraxa, 3 commander damage from Kim's partner",
  )
})

test('match records in words', () => {
  assert.equal(recordWords(3, 2), '3 wins, 2 losses')
  assert.equal(recordWords(1, 1, 1), '1 win, 1 loss, 1 draw')
  assert.equal(recordWords(0, 0), '0 wins, 0 losses')
})

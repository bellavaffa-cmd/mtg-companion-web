import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canPair, isBackground, isTimeLordDoctor, pairingAbility, secondCommanderKind, type PairCard,
} from '../../src/decks/pairing.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Two commanders at once (src/decks/pairing.ts) — the rules the Android app is to copy.

const oracle = (oracle_text: string, keywords: string[] = []) => ({ oracle_text, keywords }) as ScryfallCard
const card = (name: string, typeLine: string, partnerAbility: string | null = null): PairCard => ({ name, typeLine, partnerAbility })

const tymna = card('Tymna the Weaver', 'Legendary Creature — Human Cleric', 'Partner')
const kraum = card("Kraum, Ludevic's Opus", 'Legendary Creature — Zombie Horror', 'Partner')
const pir = card('Pir, Imaginative Rascal', 'Legendary Creature — Human', 'Toothy, Imaginary Friend')
const toothy = card('Toothy, Imaginary Friend', 'Legendary Creature — Illusion', 'Pir, Imaginative Rascal')
const will = card('Will the Wise', 'Legendary Creature — Human Cleric', 'Friends forever')
const mike = card('Mike, the Dungeon Master', 'Legendary Creature — Human', 'Friends forever')
const wilson = card('Wilson, Refined Grizzly', 'Legendary Creature — Bear Warrior', 'Choose a Background')
const acolyte = card('Acolyte of Bahamut', 'Legendary Enchantment — Background')
const notLegendaryBackground = card('Some Background', 'Enchantment — Background')
const clara = card('Clara Oswald', 'Legendary Creature — Human', "Doctor's companion")
const tenth = card('The Tenth Doctor', 'Legendary Creature — Time Lord Doctor')
const humanDoctor = card('A Human Doctor', 'Legendary Creature — Time Lord Doctor Human')
const atraxa = card('Atraxa, Praetors\' Voice', 'Legendary Creature — Phyrexian Angel Horror')
const survivorA = card('Survivor A', 'Legendary Creature — Human Survivor', 'Partner—Survivors')
const survivorB = card('Survivor B', 'Legendary Creature — Human Survivor', 'Partner—Survivors')

test('the ability is read off the oracle text, reminder text and all', () => {
  assert.equal(pairingAbility(oracle('Partner (You can have two commanders if both have partner.)\nFlying')), 'Partner')
  assert.equal(pairingAbility(oracle('Partner with Toothy, Imaginary Friend (When this creature enters…)')), 'Toothy, Imaginary Friend')
  assert.equal(pairingAbility(oracle('Friends forever (You can have two commanders if both have friends forever.)')), 'Friends forever')
  assert.equal(pairingAbility(oracle('Partner—Friends forever (You can have two commanders…)')), 'Friends forever')
  assert.equal(pairingAbility(oracle('Partner—Survivors (You can have two commanders if both have this ability.)')), 'Partner—Survivors')
  assert.equal(pairingAbility(oracle('Choose a Background (You can have a Background as a second commander.)')), 'Choose a Background')
  assert.equal(pairingAbility(oracle("Doctor's companion (You can have two commanders if the other is the Doctor.)")), "Doctor's companion")
  assert.equal(pairingAbility(oracle('Doctor’s companion')), "Doctor's companion")
  assert.equal(pairingAbility(oracle('Flying\nWhenever a partner attacks, draw a card.')), null)
})

test('the keyword list backs up the fixed phrases', () => {
  assert.equal(pairingAbility(oracle('', ['Choose a Background'])), 'Choose a Background')
  assert.equal(pairingAbility(oracle('', ['Flying'])), null)
})

test('a two-faced card is read on every face', () => {
  const dfc = { card_faces: [{ oracle_text: 'Flying' }, { oracle_text: 'Partner' }] } as ScryfallCard
  assert.equal(pairingAbility(dfc), 'Partner')
})

test('plain Partner pairs with plain Partner only', () => {
  assert.ok(canPair(tymna, kraum))
  assert.ok(canPair(kraum, tymna))
  assert.ok(!canPair(tymna, pir))
  assert.ok(!canPair(tymna, will))
  assert.ok(!canPair(tymna, atraxa))
  assert.ok(!canPair(tymna, tymna))
})

test('"Partner with" pairs only with the card it names, either way round', () => {
  assert.ok(canPair(pir, toothy))
  assert.ok(canPair(toothy, pir))
  // One side naming the other is enough (an entry saved before its pair's ability was known).
  assert.ok(canPair(pir, { ...toothy, partnerAbility: null }))
  assert.ok(!canPair(pir, kraum))
  assert.ok(!canPair(pir, atraxa))
})

test('Friends forever pairs with Friends forever, and a Partner variant with the same variant', () => {
  assert.ok(canPair(will, mike))
  assert.ok(canPair(mike, will))
  assert.ok(!canPair(will, kraum))
  assert.ok(canPair(survivorA, survivorB))
  assert.ok(!canPair(survivorA, will))
  assert.ok(!canPair(survivorA, tymna))
})

test('Choose a Background pairs with a legendary Background, either way round', () => {
  assert.ok(isBackground(acolyte))
  assert.ok(!isBackground(notLegendaryBackground))
  assert.ok(canPair(wilson, acolyte))
  assert.ok(canPair(acolyte, wilson))
  assert.ok(!canPair(wilson, notLegendaryBackground))
  assert.ok(!canPair(wilson, tymna))
  assert.ok(!canPair(tymna, acolyte))
})

test("Doctor's companion pairs with a Time Lord Doctor and nothing else, either way round", () => {
  assert.ok(isTimeLordDoctor(tenth))
  assert.ok(!isTimeLordDoctor(humanDoctor))
  assert.ok(canPair(clara, tenth))
  assert.ok(canPair(tenth, clara))
  assert.ok(!canPair(clara, humanDoctor))
  assert.ok(!canPair(clara, clara))
  assert.ok(!canPair(clara, { ...clara, name: 'Another companion' }))
  assert.ok(!canPair(tenth, tymna))
})

test('what kind of second commander a card can have', () => {
  assert.equal(secondCommanderKind(tymna), 'PARTNER')
  assert.equal(secondCommanderKind(pir), 'PARTNER')
  assert.equal(secondCommanderKind(will), 'PARTNER')
  assert.equal(secondCommanderKind(wilson), 'BACKGROUND')
  assert.equal(secondCommanderKind(clara), 'DOCTOR')
  assert.equal(secondCommanderKind(tenth), 'COMPANION')
  assert.equal(secondCommanderKind(atraxa), null)
  assert.equal(secondCommanderKind(humanDoctor), null)
})

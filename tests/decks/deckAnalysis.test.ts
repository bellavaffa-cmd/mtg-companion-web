import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateBracket, gameChangersOf, isLandType, landSources, manaBaseAdvice, probabilityAtLeastOne } from '../../src/decks/deckAnalysis.ts'
import type { DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Bracket and mana advice, with the phone's thresholds and wording (estimateBracket in
// DeckDetailViewModel, manaBaseAdvice in DeckBuilding.kt).

test('brackets from Game Changers and combos', () => {
  assert.deepEqual([estimateBracket(0, 0).bracket, estimateBracket(0, 0).name], [2, 'Core'])
  const upgraded = estimateBracket(1, 2)
  assert.equal(upgraded.bracket, 3)
  assert.equal(upgraded.reason, '1 Game Changer and 2 combos — within the Upgraded ceiling of 3 Game Changers.')
  assert.equal(estimateBracket(0, 1).bracket, 3)
  const optimized = estimateBracket(5, 1)
  assert.equal(optimized.bracket, 4)
  assert.equal(optimized.reason, '5 Game Changers exceed the 3 allowed at Upgraded and 1 combo(s) are present, pushing this to Optimized.')
})

test('combos unchecked are said, not assumed away', () => {
  assert.match(estimateBracket(0, null).reason, /^No Game Changers found\. Combos weren't checked/)
  assert.match(estimateBracket(2, null).reason, /Combos weren't checked — Commander Spellbook couldn't be reached\.$/)
})

const e = (name: string, quantity = 1, typeLine: string | null = null) => ({ scryfallId: name, name, imageUrl: null, quantity, canBeCommander: false, typeLine, partnerAbility: null }) as DeckCardEntry

test('Game Changers and land sources come from the full cards', () => {
  const cards = new Map<string, ScryfallCard>([
    ['Rhystic Study', { id: 'Rhystic Study', name: 'Rhystic Study', game_changer: true, type_line: 'Enchantment' } as ScryfallCard],
    ['Island', { id: 'Island', name: 'Island', type_line: 'Basic Land — Island', produced_mana: ['U'] } as ScryfallCard],
    ['Watery Grave', { id: 'Watery Grave', name: 'Watery Grave', type_line: 'Land — Island Swamp', produced_mana: ['U', 'B'] } as ScryfallCard],
    ['Sol Ring', { id: 'Sol Ring', name: 'Sol Ring', type_line: 'Artifact', produced_mana: ['C'] } as ScryfallCard],
  ])
  const entries = [e('Rhystic Study'), e('Island', 10), e('Watery Grave'), e('Sol Ring')]
  assert.deepEqual(gameChangersOf(entries, cards), ['Rhystic Study'])
  assert.deepEqual(landSources(entries, cards), { sources: [['U', 11], ['B', 1]], lands: 11 })
  assert.ok(isLandType('Land — Urza’s'))
  assert.ok(!isLandType('Sorcery // Land'))
})

test('mana advice: missing colours, under-supplied colours, and land counts', () => {
  const advice = manaBaseAdvice([['U', 30], ['B', 20], ['G', 5], ['Colorless', 3]], [['U', 30], ['B', 5]], 35, 'COMMANDER')
  assert.deepEqual(advice, [
    '{B} is 36% of your mana symbols but only 14% of your land sources — add more {B} sources.',
    'No lands make {G}, but 5 of your mana symbols need it.',
  ])
  assert.deepEqual(manaBaseAdvice([], [], 30, 'COMMANDER'), ['30 lands is light — most decks like this run 36–38, fewer only with plenty of cheap ramp.'])
  assert.deepEqual(manaBaseAdvice([], [], 28, 'MODERN'), ['28 lands is on the heavy side — most decks like this run 22–26.'])
  assert.deepEqual(manaBaseAdvice([['U', 10]], [['U', 37]], 37, 'COMMANDER'), [])
})

test('odds of a source in the opening hand and by turn 3', () => {
  assert.equal(probabilityAtLeastOne(99, 0, 7), 0)
  assert.equal(probabilityAtLeastOne(10, 10, 1), 1)
  // 1 − C(89,7)/C(99,7)
  assert.ok(Math.abs(probabilityAtLeastOne(99, 10, 7) - 0.5372) < 0.0001)
})

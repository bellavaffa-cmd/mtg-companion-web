import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canBeCommander, entryCanBeCommander, type ScryfallCard } from '../../src/types/scryfall.ts'

const card = (type_line: string, oracle_text = '') => ({ id: 'x', name: 'x', type_line, oracle_text }) as ScryfallCard
const entry = (typeLine: string | null, flag: boolean) => ({ canBeCommander: flag, typeLine })

test('Commander takes legendary creatures and cards that say they can be your commander', () => {
  assert.ok(canBeCommander(card('Legendary Creature — Elf Druid')))
  assert.ok(canBeCommander(card('Legendary Planeswalker — Teferi', 'Teferi can be your commander.')))
  assert.ok(!canBeCommander(card('Legendary Planeswalker — Jace')))
  assert.ok(!canBeCommander(card('Creature — Elf')))
  assert.ok(!canBeCommander(card('Legendary Enchantment')))
})

test('Brawl also takes any legendary planeswalker', () => {
  assert.ok(canBeCommander(card('Legendary Planeswalker — Jace'), 'BRAWL'))
  assert.ok(canBeCommander(card('Legendary Creature — Elf Druid'), 'BRAWL'))
  assert.ok(!canBeCommander(card('Planeswalker — Jace'), 'BRAWL'))
  assert.ok(!canBeCommander(card('Legendary Planeswalker — Jace'), 'COMMANDER'))
})

test("a deck's cards are checked against the deck's format", () => {
  // The stored flag is the Commander rule, so a planeswalker added to any deck carries false.
  const jace = entry('Legendary Planeswalker — Jace', false)
  assert.ok(entryCanBeCommander(jace, 'BRAWL'))
  assert.ok(!entryCanBeCommander(jace, 'COMMANDER'))
  assert.ok(entryCanBeCommander(entry('Legendary Creature — Elf', true), 'COMMANDER'))
  assert.ok(!entryCanBeCommander(entry(null, false), 'BRAWL'))
})

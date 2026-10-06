import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deckNeeds, deckNeedsLine, deleteGear, gearOf, gearRows, keepGearFromOlderApp, mergeGear, runningLow, saveGear, shortDeckName, sleevesFor, tokensLine,
} from '../../src/collection/gear.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import type { Collection, Deck, DeckCardEntry, GearItem, StoragePlace } from '../../src/types/models.ts'

// Gear: sleeves running low, deck boxes and what they hold, tokens, "This deck needs", and two devices'
// gear merging — the same on both apps. The Android app has the same checks — see GearTest.kt.

const card = (name: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: name.toLowerCase(), name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })
const deck = (id: string, name: string, commander: string | null, cards: number): Deck => ({
  id, name, commander: commander ? card(commander) : null, partnerCommander: null, cards: [card('Mountain', cards)],
  gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL',
})
const KRENKO = deck('krenko', 'Krenko goblins', 'Krenko, Mob Boss', 99)
const ATRAXA = deck('atraxa', 'Atraxa', "Atraxa, Praetors' Voice", 99)
const LIMITED = deck('limited', 'Limited pool', null, 40)
const DECKS = [KRENKO, ATRAXA, LIMITED]
const tokenBox: StoragePlace = { id: 'tb', name: 'Token box', kind: 'BOX', createdAt: 1 }
const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 2 }
const g = (id: string, kind: GearItem['kind'], name: string, count: number, over: Partial<GearItem> = {}): GearItem =>
  ({ id, kind, name, count, createdAt: Number(id.replace(/\D/g, '')) || 1, ...over })
const GEAR: GearItem[] = [
  g('g1', 'SLEEVES', 'Black matte sleeves', 38, { usedBy: ['krenko', 'atraxa'] }),
  g('g2', 'INNER_SLEEVES', 'Clear inner sleeves', 412, { usedBy: ['rares', 'krenko'] }),
  g('g3', 'DECK_BOX', 'Red', 1, { holds: 'krenko' }),
  g('g4', 'DECK_BOX', 'Black', 1, { holds: 'atraxa' }),
  g('g5', 'DECK_BOX', 'White', 1, { holds: 'limited' }),
  g('g6', 'DECK_BOX', 'Blue', 1),
  g('g7', 'TOKENS', 'Goblin', 24, { placeId: 'tb' }),
  g('g8', 'TOKENS', 'Treasure', 18, { placeId: 'tb' }),
  g('g9', 'TOKENS', 'Soldier', 12, { placeId: 'tb' }),
  g('g10', 'TOKENS', 'Zombie', 32, { placeId: 'tb' }),
]
const pile = (gear?: GearItem[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries: [], createdAt: 0, type: 'OWNED', storagePlaces: [tokenBox, rares], ...(gear ? { gear } : {}) })
const COLS = [pile(GEAR)]

test('a deck takes a sleeve for each card, its commander and its sideboard', () => {
  assert.equal(sleevesFor(KRENKO), 100)
  assert.equal(sleevesFor({ ...LIMITED, sideboard: [card('Island', 15)] }), 55)
  assert.equal(shortDeckName(KRENKO), 'Krenko')
  assert.equal(shortDeckName(LIMITED), 'Limited pool')
})

test('sleeves run low when fewer are left than a deck using them takes', () => {
  assert.equal(runningLow(GEAR[0], DECKS), true)
  assert.equal(runningLow({ ...GEAR[0], count: 100 }, DECKS), false)
  assert.equal(runningLow({ ...GEAR[0], usedBy: [] }, DECKS), false, 'on no deck: nothing to compare with')
  assert.equal(runningLow(GEAR[6], DECKS), false, 'tokens never run low')
})

test('the Gear list: sleeves, inner sleeves, the deck boxes and the tokens as the mockup says them', () => {
  const rows = gearRows(GEAR, DECKS, COLS)
  assert.deepEqual(rows.map((r) => [r.title, r.value, r.line, r.warn]), [
    ['Black matte sleeves', '38 left', 'On Krenko and Atraxa · a deck needs 100 · running low', true],
    ['Clear inner sleeves', '412 left', 'Double-sleeving: Rares binder, Krenko', false],
    ['Deck boxes', '4 · 1 empty', 'Red (Krenko), Black (Atraxa), White (Limited pool), Blue (empty)', false],
    ['Tokens', '86', 'Zombie ×32, Goblin ×24, Treasure ×18 and more · Token box', false],
  ])
  assert.equal(tokensLine(GEAR.slice(6, 9), COLS), 'Goblin ×24, Treasure ×18, Soldier ×12 · Token box')
})

test('a deck box holding a deck that is gone counts as empty', () => {
  const rows = gearRows([g('g1', 'DECK_BOX', 'Red', 1, { holds: 'gone' })], DECKS, COLS)
  assert.deepEqual([rows[0].value, rows[0].line], ['1 · 1 empty', 'Red (empty)'])
})

test('This deck needs: sleeves, a deck box and its tokens — you have them all, or what is missing', () => {
  const needs = deckNeeds(KRENKO, GEAR, ['Goblin'], DECKS, COLS)
  assert.equal(deckNeedsLine(KRENKO, needs), 'Krenko goblins: 100 sleeves, a deck box and Goblin tokens. You have them all.')
  const fresh = deck('new', 'Elves', 'Lathril, Blade of the Elves', 99)
  const missing = deckNeeds(fresh, GEAR, ['Elf Warrior', 'Goblin'], [...DECKS, fresh], COLS)
  assert.equal(deckNeedsLine(fresh, missing), 'Elves: 100 sleeves, a deck box and Elf Warrior and Goblin tokens. Missing: 100 sleeves, a deck box and Elf Warrior tokens. Blue is an empty deck box.')
  const sleeved = deckNeeds(fresh, [...GEAR, g('g20', 'SLEEVES', 'Green', 120)], [], [...DECKS, fresh], COLS)
  assert.equal(sleeved.hasSleeves, true, 'a pack with enough left will do')
})

test('saving and deleting gear keeps it on the Unsorted pile, written the same way', () => {
  const saved = saveGear([], { id: 'x', kind: 'DICE', name: ' Spindown ', count: 2.4, usedBy: [], createdAt: 5 })
  assert.deepEqual(gearOf(saved), [{ id: 'x', kind: 'DICE', name: 'Spindown', count: 2, createdAt: 5 }])
  assert.deepEqual(gearOf(deleteGear(saved, 'x')), [], 'kept as [] once none are left')
})

test('two devices: added on either kept, deleted on either stays deleted, decks on a pack merge like tags', () => {
  const base = [GEAR[0], GEAR[6]]
  const mine = [{ ...GEAR[0], count: 30, usedBy: ['krenko'] }, g('g30', 'PLAYMAT', 'Playmat', 1)]
  const theirs = [{ ...GEAR[0], usedBy: ['krenko', 'atraxa', 'limited'] }, GEAR[6], g('g31', 'DICE', 'Dice', 6)]
  const merged = mergeGear(base, mine, theirs, false)!
  assert.deepEqual(merged.map((x) => x.id), ['g1', 'g30', 'g31'], 'Goblin deleted here stays deleted')
  assert.equal(merged[0].count, 30)
  assert.deepEqual(merged[0].usedBy, ['krenko', 'limited'])
  assert.equal(mergeGear(undefined, undefined, undefined, true), undefined)
})

test('a pile saved by an app that does not know gear keeps this device’s, also through the merge', () => {
  const older = pile()
  assert.deepEqual(keepGearFromOlderApp(pile(GEAR), older).gear, GEAR)
  assert.equal(keepGearFromOlderApp(pile(), older), older)
  const merged = mergeCollection(pile(GEAR), pile([...GEAR, g('g40', 'OTHER', 'Life pad', 1)]), older, false)
  assert.deepEqual(merged.gear?.map((x) => x.id), [...GEAR.map((x) => x.id), 'g40'])
})

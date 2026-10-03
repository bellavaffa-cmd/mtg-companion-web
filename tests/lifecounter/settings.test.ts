import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dealColors, DEFAULT_SETTINGS, defeatMessageFor, gameReducer, lowLife, newGame, normalizeSettings, pickMessage, resetSettings,
  tileCounters, victoryMessageFor, wantsHighRoll, type Player,
} from '../../src/lifecounter/game.ts'

// The life counter's settings, as the Android app's LifeCounterSettings: same defaults, same effects.

const player = (over: Partial<Player> = {}): Player => ({ id: 1, life: 40, commanderDamage: {}, poison: 0, colorIndex: 0, name: null, killed: false, ...over })

test('the defaults are the app’s', () => {
  const s = DEFAULT_SETTINGS
  assert.equal(s.highRollAtStart, false)
  assert.equal(s.countersOnTile, true)
  assert.equal(s.keepZeroCounters, false)
  assert.deepEqual(s.pinnedCounters, [])
  assert.equal(s.showCommanderDamageOnTile, true)
  assert.equal(s.playerNamesOnTile, true)
  assert.equal(s.saltyMessages, true)
  assert.equal(s.cycleMessages, false)
  assert.equal(s.shuffleColors, false)
  assert.equal(s.verticalTapAreas, false)
  assert.equal(s.minimalist, false)
  assert.equal(s.underlineSixNine, true)
  assert.equal(s.lowLifeWarning, true)
  assert.equal(s.tapAmount, 1)
  assert.equal(s.longPressAmount, 10)
  assert.deepEqual(s.victoryMessages, ['Victory!', 'Last one standing', 'The table is yours', 'Winner'])
})

test('settings saved by an older version gain the new ones, keeping what was chosen', () => {
  const s = normalizeSettings({ layoutId: 'x', turnTracker: true, longPressAmount: 5, remotes: false })
  assert.equal(s.turnTracker, true)
  assert.equal(s.longPressAmount, 5)
  assert.equal(s.remotes, false)
  assert.equal(s.underlineSixNine, true)
  assert.equal(s.tapAmount, 1)
})

test('stored values of the wrong shape are put right', () => {
  const s = normalizeSettings({ tapAmount: 0, longPressAmount: 5000, minimalist: 'yes', pinnedCounters: ['storm', 'bogus', 'poison'], victoryMessages: ['  ', 'GG', 3] })
  assert.equal(s.tapAmount, 1)
  assert.equal(s.longPressAmount, 10)
  assert.equal(s.minimalist, false)
  assert.deepEqual(s.pinnedCounters, ['poison', 'storm'])
  assert.deepEqual(s.victoryMessages, ['GG'])
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
})

test('Reset settings keeps the seating and whose seat is yours', () => {
  const s = resetSettings({ ...DEFAULT_SETTINGS, layoutId: 'six', minimalist: true, meSeat: 2, meDeckId: 'd' })
  assert.equal(s.layoutId, 'six')
  assert.equal(s.minimalist, false)
  assert.equal(s.meSeat, 2)
})

test('defeat messages come from the list for why they lost; their own wins; plain without salt', () => {
  const s = { ...DEFAULT_SETTINGS, poisonDefeatMessages: ['Poisoned'], commanderDefeatMessages: ['21 and done'], defeatMessages: ['Gone'] }
  assert.equal(defeatMessageFor(player(), 'POISON', s, 0, 0), 'Poisoned')
  assert.equal(defeatMessageFor(player(), 'COMMANDER_DAMAGE', s, 0, 0), '21 and done')
  assert.equal(defeatMessageFor(player(), 'KILLED', s, 0, 0), 'Gone')
  assert.equal(defeatMessageFor(player({ defeatMessage: 'Rigged' }), 'LIFE', s, 0, 0), 'Rigged')
  assert.equal(defeatMessageFor(player(), 'LIFE', { ...s, saltyMessages: false }, 0, 0), 'Defeated')
  assert.equal(defeatMessageFor(player(), 'LIFE', { ...s, defeatMessages: [] }, 0, 0), 'Defeated')
  assert.equal(victoryMessageFor(player(), { ...s, saltyMessages: false }, 0, 0), 'Victory!')
  assert.equal(victoryMessageFor(player({ victoryMessage: 'Too easy' }), s, 0, 0), 'Too easy')
})

test('a message holds for the game and moves on with each tick, as the app picks it', () => {
  const list = ['a', 'b', 'c', 'd']
  // floorMod(playerId * 31 + gameNumber * 17 + tick, size)
  assert.equal(pickMessage(list, 'x', 2, 3, 0), list[(2 * 31 + 3 * 17) % 4])
  assert.equal(pickMessage(list, 'x', 2, 3, 1), list[(2 * 31 + 3 * 17 + 1) % 4])
  assert.equal(pickMessage([], 'x', 2, 3, 0), 'x')
})

test('counters on the tile: above 0, at 0 once used with Keep zero counters, pinned always', () => {
  const p = player({ poison: 2, counters: { energy: 0, storm: 3 } })
  assert.deepEqual(tileCounters(p, DEFAULT_SETTINGS), ['poison', 'storm'])
  assert.deepEqual(tileCounters(p, { ...DEFAULT_SETTINGS, keepZeroCounters: true }), ['poison', 'energy', 'storm'])
  assert.deepEqual(tileCounters(p, { ...DEFAULT_SETTINGS, countersOnTile: false }), [])
  assert.deepEqual(tileCounters(player(), { ...DEFAULT_SETTINGS, countersOnTile: false, pinnedCounters: ['loyalty'] }), ['loyalty'])
  assert.deepEqual(tileCounters(player({ poisonUsed: true }), { ...DEFAULT_SETTINGS, keepZeroCounters: true }), ['poison'])
})

test('poison counted once is remembered for Keep zero counters', () => {
  let g = newGame(DEFAULT_SETTINGS)
  g = gameReducer(g, { type: 'poison', id: 1, delta: 1 })
  g = gameReducer(g, { type: 'poison', id: 1, delta: -1 })
  assert.equal(g.players[0].poison, 0)
  assert.equal(g.players[0].poisonUsed, true)
})

test('low life is 1 to 9, with the warning on', () => {
  assert.equal(lowLife(player({ life: 9 }), DEFAULT_SETTINGS), true)
  assert.equal(lowLife(player({ life: 10 }), DEFAULT_SETTINGS), false)
  assert.equal(lowLife(player({ life: 0 }), DEFAULT_SETTINGS), false)
  assert.equal(lowLife(player({ life: 5 }), { ...DEFAULT_SETTINGS, lowLifeWarning: false }), false)
})

test('high roll at the start needs two players', () => {
  assert.equal(wantsHighRoll({ ...DEFAULT_SETTINGS, highRollAtStart: true }, 4), true)
  assert.equal(wantsHighRoll({ ...DEFAULT_SETTINGS, highRollAtStart: true }, 1), false)
  assert.equal(wantsHighRoll(DEFAULT_SETTINGS, 4), false)
})

test('colours go in seat order, or shuffled — still all different', () => {
  assert.deepEqual(dealColors(4, false), [0, 1, 2, 3])
  let seed = 7
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  const shuffled = dealColors(6, true, random)
  assert.equal(new Set(shuffled).size, 6)
  assert.ok(shuffled.every((c) => c >= 0 && c < 10))
  assert.notDeepEqual(shuffled, [0, 1, 2, 3, 4, 5])
})

test('a player’s own messages: blank goes back to the table’s', () => {
  let g = newGame(DEFAULT_SETTINGS)
  g = gameReducer(g, { type: 'messages', id: 1, victory: ' Too easy ' })
  assert.equal(g.players[0].victoryMessage, 'Too easy')
  g = gameReducer(g, { type: 'messages', id: 1, victory: '  ', defeat: 'Rigged' })
  assert.equal(g.players[0].victoryMessage, null)
  assert.equal(g.players[0].defeatMessage, 'Rigged')
})

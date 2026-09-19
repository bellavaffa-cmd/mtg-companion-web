import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gameStats, matchupRecord } from '../../src/decks/gameStats.ts'
import type { GameResult } from '../../src/types/models.ts'

// A deck's games summed up for its Stats. The Android app has the same checks — see
// GameStatsTest.kt.

const game = (n: number, result: GameResult['result'], opponent: string | null = null, commanders: string[] = [], minutes: number | null = null, turns: number | null = null): GameResult =>
  ({ id: `g${n}`, result, opponent, playedAt: n * 1000, commanders, minutes, turns })

test("the record, form and length of a deck's games", () => {
  const stats = gameStats([
    game(1, 'LOSS', 'Bob, Carol', ["Atraxa, Praetors' Voice", 'Krenko, Mob Boss'], 60, 10),
    game(2, 'WIN', 'Bob', ["atraxa, praetors' voice"], 40, 8),
    game(3, 'DRAW'),
    game(4, 'WIN', 'Carol', ['Krenko, Mob Boss']),
    game(5, 'WIN', 'Bob ,  Dave'),
  ])
  assert.equal(stats.games, 5)
  assert.equal(stats.winRate, 60)
  assert.deepEqual(stats.recent, ['WIN', 'WIN', 'DRAW', 'WIN', 'LOSS'])
  assert.deepEqual(stats.streak, { result: 'WIN', count: 2 })
  // Only the games that kept time count toward the averages.
  assert.equal(stats.averageMinutes, 50)
  assert.equal(stats.averageTurns, 9)
  // Most-faced first, names matched whatever their case; ties by name.
  assert.deepEqual(stats.commanders, [
    { name: "Atraxa, Praetors' Voice", games: 2, wins: 1, losses: 1 },
    { name: 'Krenko, Mob Boss', games: 2, wins: 1, losses: 1 },
  ])
  assert.deepEqual(stats.opponents, [
    { name: 'Bob', games: 3, wins: 2, losses: 1 },
    { name: 'Carol', games: 2, wins: 1, losses: 1 },
    { name: 'Dave', games: 1, wins: 1, losses: 0 },
  ])
  assert.equal(matchupRecord(stats.opponents[0]), '2–1')
})

test('no games, and one game', () => {
  const none = gameStats([])
  assert.equal(none.winRate, 0)
  assert.equal(none.averageMinutes, null)
  assert.equal(gameStats([game(1, 'WIN')]).streak, null)
})

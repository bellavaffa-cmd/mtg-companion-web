import { test } from 'node:test'
import assert from 'node:assert/strict'
import { longestWinStreak, nemesisOf, playgroupStats } from '../../src/decks/playgroupStats.ts'
import type { Deck, GameResult } from '../../src/types/models.ts'

// Every deck's games together. The Android app has the same checks — see PlaygroupStatsTest.kt.

const game = (n: number, result: GameResult['result'], opponent: string | null = null, commanders: string[] = [], minutes?: number, turns?: number): GameResult =>
  ({ id: `g${n}`, result, opponent, playedAt: n * 1000, minutes, turns, commanders })
const deck = (name: string, ...games: GameResult[]) => ({ id: name, name, gameResults: games }) as unknown as Deck

test('the record across every deck, and against each person', () => {
  const stats = playgroupStats([
    deck('Omnath', game(1, 'LOSS', 'Bob, Carol', ['Atraxa, Praetors\' Voice'], 60, 10), game(3, 'WIN', 'Bob'), game(5, 'LOSS', 'Bob', ['Atraxa, Praetors\' Voice'])),
    deck('Krenko', game(2, 'WIN', 'Carol', [], 40, 8), game(4, 'DRAW', 'Dave')),
    deck('Unplayed'),
  ])
  assert.deepEqual([stats.games, stats.wins, stats.losses, stats.draws, stats.winRate], [5, 2, 2, 1, 40])
  assert.deepEqual(stats.opponents.map((m) => [m.name, m.games, m.wins, m.losses]), [['Bob', 3, 1, 2], ['Carol', 2, 1, 1], ['Dave', 1, 0, 0]])
  assert.equal(stats.averageMinutes, 50)
  assert.equal(stats.averageTurns, 9)
  // Newest is a loss after a draw: no run of two.
  assert.equal(stats.streak, null)
  // Games 2 and 3 were wins, in different decks.
  assert.equal(stats.longestWinStreak, 2)
  // Omnath has three games and is ranked; Krenko has two; a deck with none isn't listed.
  assert.deepEqual(stats.ranked.map((r) => [r.name, r.winRate]), [['Omnath', 33]])
  assert.deepEqual(stats.unranked.map((r) => r.name), ['Krenko'])
  assert.equal(stats.nemesis?.name, 'Bob')
  // Atraxa only beat you twice: not enough games.
  assert.equal(stats.nemesisCommander, null)
})

test('decks rank by win rate, then games played', () => {
  const stats = playgroupStats([
    deck('A', game(1, 'WIN'), game(2, 'LOSS'), game(3, 'LOSS')),
    deck('B', game(4, 'WIN'), game(5, 'WIN'), game(6, 'LOSS'), game(7, 'LOSS'), game(8, 'WIN'), game(9, 'WIN')),
    deck('C', game(10, 'WIN'), game(11, 'WIN'), game(12, 'LOSS')),
  ])
  assert.deepEqual(stats.ranked.map((r) => r.name), ['B', 'C', 'A'])
  assert.equal(stats.streak, null)
})

test('streaks run in the order the games were played, whichever deck', () => {
  const games = [game(5, 'WIN'), game(1, 'WIN'), game(2, 'WIN'), game(3, 'DRAW'), game(4, 'WIN'), game(6, 'WIN')]
  assert.equal(longestWinStreak(games), 3)
  const stats = playgroupStats([deck('A', ...games.slice(0, 3)), deck('B', ...games.slice(3))])
  assert.deepEqual(stats.streak, { result: 'WIN', count: 3 })
})

test('a nemesis beats you more than you beat them', () => {
  const m = (name: string, games: number, wins: number, losses: number) => ({ name, games, wins, losses })
  assert.equal(nemesisOf([m('Even', 4, 2, 2), m('Few', 2, 0, 2)]), null)
  assert.equal(nemesisOf([m('Bob', 4, 1, 3), m('Carol', 6, 1, 5), m('Dave', 3, 0, 3)])?.name, 'Dave')
  // Same share of wins: the one with more losses.
  assert.equal(nemesisOf([m('Bob', 3, 0, 3), m('Carol', 5, 0, 5)])?.name, 'Carol')
})

test('no games at all', () => {
  const stats = playgroupStats([deck('A')])
  assert.deepEqual([stats.games, stats.winRate, stats.longestWinStreak, stats.ranked.length, stats.unranked.length], [0, 0, 0, 0, 0])
  assert.equal(stats.nemesis, null)
  assert.equal(stats.averageMinutes, null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canDeletePodGame, deckResultOf, playerKey, podGameProblem, podStats, type PodGame, type PodPlayer } from '../../src/decks/podStats.ts'

// A pod's games, summed up for the group. The Android app has the same checks — see PodStatsTest.kt.

const ME = '11111111-1111-1111-1111-111111111111'
const BOB = '22222222-2222-2222-2222-222222222222'

const seat = (name: string, result: PodPlayer['result'], commander: string | null = null, userId: string | null = null): PodPlayer =>
  ({ userId, name, commander, deck: null, result })
const game = (n: number, players: PodPlayer[], minutes: number | null = null, turns: number | null = null): PodGame =>
  ({ id: `g${n}`, clientId: `c${n}`, recordedBy: ME, playedAt: n * 1000, format: 'COMMANDER', turns, minutes, players })

test('members are known by account, guests by their name in any case', () => {
  assert.equal(playerKey({ userId: ME, name: 'Me' }), `u:${ME}`)
  assert.equal(playerKey({ userId: null, name: '  Carol ' }), playerKey({ userId: null, name: 'carol' }))
  const stats = podStats([
    game(1, [seat('Me', 'WIN', null, ME), seat('Carol', 'LOSS')]),
    // A renamed member is still the same player, under the newest name.
    game(2, [seat('Me again', 'LOSS', null, ME), seat(' CAROL', 'WIN')]),
  ])
  assert.deepEqual(stats.players.map((p) => [p.name, p.games, p.wins, p.losses]), [['CAROL', 2, 1, 1], ['Me again', 2, 1, 1]])
})

test("the group's table, commanders, length and latest games", () => {
  const stats = podStats([
    game(1, [seat('Me', 'WIN', 'atraxa ', ME), seat('Bob', 'LOSS', 'Krenko', BOB), seat('Carol', 'LOSS', 'Edgar')], 60, 10),
    game(2, [seat('Me', 'LOSS', 'Atraxa', ME), seat('Bob', 'WIN', 'Krenko', BOB), seat('Carol', 'LOSS', 'Edgar')], 40, 8),
    game(3, [seat('Me', 'LOSS', 'Atraxa', ME), seat('Bob', 'WIN', 'Krenko', BOB)]),
    game(4, [seat('Me', 'DRAW', 'Omnath', ME), seat('Bob', 'DRAW', 'Krenko', BOB), seat('Carol', 'DRAW', 'Edgar')]),
  ])
  assert.equal(stats.games, 4)
  assert.deepEqual(stats.players.map((p) => [p.name, p.games, p.wins, p.losses, p.draws, p.winRate]), [
    ['Bob', 4, 2, 1, 1, 50],
    ['Me', 4, 1, 2, 1, 25],
    ['Carol', 3, 0, 2, 1, 0],
  ])
  // Omnath has one game: not ranked. Atraxa's name is matched in any case.
  assert.deepEqual(stats.mostPlayed.map((c) => [c.name, c.games]), [['Krenko', 4], ['Atraxa', 3], ['Edgar', 3]])
  assert.deepEqual(stats.best.map((c) => [c.name, c.winRate]), [['Krenko', 50], ['Atraxa', 33], ['Edgar', 0]])
  assert.equal(stats.averageMinutes, 50)
  assert.equal(stats.averageTurns, 9)
  assert.deepEqual(stats.latest.map((g) => g.id), ['g4', 'g3', 'g2', 'g1'])
})

test("each player's nemesis needs three games and a losing record", () => {
  const stats = podStats([
    game(1, [seat('Me', 'LOSS', null, ME), seat('Bob', 'WIN', null, BOB), seat('Carol', 'LOSS')]),
    game(2, [seat('Me', 'LOSS', null, ME), seat('Bob', 'WIN', null, BOB)]),
    game(3, [seat('Me', 'WIN', null, ME), seat('Bob', 'LOSS', null, BOB), seat('Carol', 'LOSS')]),
    game(4, [seat('Me', 'LOSS', null, ME), seat('Bob', 'WIN', null, BOB)]),
  ])
  const nemeses = Object.fromEntries(stats.nemeses.map((n) => [n.player.name, [n.nemesis.name, n.nemesis.games, n.nemesis.wins, n.nemesis.losses]]))
  // Me: 1–3 against Bob. Carol only met each of them twice. Bob beats everyone.
  assert.deepEqual(nemeses, { Me: ['Bob', 4, 1, 3] })
})

test('only ten latest games', () => {
  const games = Array.from({ length: 12 }, (_, i) => game(i + 1, [seat('A', 'WIN'), seat('B', 'LOSS')]))
  const stats = podStats(games)
  assert.equal(stats.latest.length, 10)
  assert.equal(stats.latest[0].id, 'g12')
})

test('the recorder or the pod owner can delete a game', () => {
  const g = game(1, [seat('A', 'WIN'), seat('B', 'LOSS')])
  assert.equal(canDeletePodGame(g, ME, BOB), true)
  assert.equal(canDeletePodGame(g, BOB, BOB), true)
  assert.equal(canDeletePodGame(g, BOB, ME), false)
})

test("the game on the user's own deck, as the life counter logs it", () => {
  const g = game(5, [seat('Me', 'LOSS', 'Atraxa', ME), seat('Bob', 'WIN', 'Krenko, Mob Boss', BOB), seat(' Carol ', 'LOSS')], 45, 0)
  assert.deepEqual(deckResultOf(g, ME, 'x'), {
    id: 'x', result: 'LOSS', opponent: 'Bob, Carol', playedAt: 5000, turns: null, minutes: 45, commanders: ['Krenko, Mob Boss'],
  })
  assert.equal(deckResultOf(g, '33333333-3333-3333-3333-333333333333', 'x'), null)
})

test('a game is checked before it is recorded', () => {
  assert.equal(podGameProblem([seat('A', 'WIN')]), 'Pick at least two players.')
  assert.equal(podGameProblem([seat('A', 'WIN'), seat(' ', 'LOSS')]), 'Every guest needs a name.')
  assert.equal(podGameProblem([seat('A', 'WIN'), seat('a', 'LOSS')]), 'Someone is in the game twice.')
  assert.equal(podGameProblem([seat('A', 'WIN'), seat('B', 'WIN')]), 'Only one player can win.')
  assert.equal(podGameProblem([seat('A', 'DRAW'), seat('B', 'DRAW')]), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  layoutIdFor, movePlayer, nightResultOf, nextSuggestion, pairingsOf, podSizes, podWinner, powerSpread, seededRandom, splitPods,
  suggestedDecks, tableSeedOf, withPods, withoutPlayer,
  type DeckChoice, type GameNight, type NightPlayer, type NightPod,
} from '../../src/lifecounter/gameNight.ts'

// Game night's pods, suggestions and results. The Android app has the same checks, with the same
// numbers — see GameNightTest.kt.

const player = (id: string, bracket: number | null, kind: NightPlayer['kind'] = 'GUEST'): NightPlayer =>
  ({ id, name: id, kind, deck: null, commander: null, bracket })

const night = (players: NightPlayer[], pods: NightPod[] = []): GameNight =>
  ({ id: 'n', createdAt: 0, format: 'COMMANDER', seed: 0, players, pods })

const pod = (id: string, playerIds: string[], extra: Partial<NightPod> = {}): NightPod =>
  ({ id, playerIds, startedAt: null, winnerId: null, ...extra })

test('the seeded numbers are the same every time (and on the phone)', () => {
  const r = seededRandom(42)
  const first = [r(), r(), r()].map((n) => Math.floor(n * 1000))
  assert.deepEqual(first, [601, 448, 852])
  const again = seededRandom(42)
  assert.equal(Math.floor(again() * 1000), 601)
})

test('pods are 3 or 4 for Commander, pairs for 1v1', () => {
  assert.deepEqual(podSizes(0, 'COMMANDER'), [])
  assert.deepEqual(podSizes(4, 'COMMANDER'), [4])
  assert.deepEqual(podSizes(5, 'COMMANDER'), [5])
  assert.deepEqual(podSizes(6, 'COMMANDER'), [3, 3])
  assert.deepEqual(podSizes(7, 'COMMANDER'), [4, 3])
  assert.deepEqual(podSizes(8, 'COMMANDER'), [4, 4])
  assert.deepEqual(podSizes(9, 'COMMANDER'), [3, 3, 3])
  assert.deepEqual(podSizes(11, 'COMMANDER'), [4, 4, 3])
  assert.deepEqual(podSizes(2, 'DUEL'), [2])
  assert.deepEqual(podSizes(3, 'DUEL'), [3])
  assert.deepEqual(podSizes(6, 'DUEL'), [2, 2, 2])
  assert.deepEqual(podSizes(7, 'DUEL'), [2, 2, 3])
})

test('players close in power share a pod', () => {
  const players = [player('a', 4), player('b', 2), player('c', 4), player('d', 2), player('e', 4), player('f', 2), player('g', 4), player('h', 2)]
  const pods = splitPods(players, 'COMMANDER', 7)
  assert.deepEqual(pods, [['a', 'c', 'e', 'g'], ['b', 'd', 'f', 'h']])
  // Not knowing a bracket counts as the middle.
  const mixed = splitPods([player('a', 1), player('b', null), player('c', 5), player('d', 1), player('e', 5), player('f', 3)], 'DUEL', 3)
  assert.deepEqual(mixed, [['a', 'd'], ['b', 'f'], ['c', 'e']])
  assert.equal(powerSpread([2, 2, 2]), 0)
  assert.equal(powerSpread([1, 3]), 2)
})

test('the same seed gives the same pods; another seed can give others', () => {
  const players = Array.from({ length: 8 }, (_, i) => player(`p${i}`, null))
  const one = splitPods(players, 'COMMANDER', 11)
  assert.deepEqual(splitPods(players, 'COMMANDER', 11), one)
  assert.deepEqual(one, [['p0', 'p1', 'p5', 'p7'], ['p2', 'p3', 'p4', 'p6']])
  assert.deepEqual(splitPods(players, 'COMMANDER', 12), [['p0', 'p2', 'p3', 'p4'], ['p1', 'p5', 'p6', 'p7']])
})

test("last night's pairings aren't repeated when they needn't be", () => {
  const players = [player('a', 3), player('b', 3), player('c', 3), player('d', 3)]
  const last = night(players, [pod('1', ['a', 'b']), pod('2', ['c', 'd'])])
  const previous = pairingsOf(last)
  assert.ok(previous.has('g:a|g:b'))
  for (const seed of [1, 2, 3, 4, 5]) {
    const pods = splitPods(players, 'DUEL', seed, previous)
    assert.ok(!pods.some((p) => p.join() === 'a,b' || p.join() === 'c,d'), `seed ${seed}: ${JSON.stringify(pods)}`)
  }
  // Power still comes first: two 1s and two 5s pair up as before rather than 1 against 5.
  const uneven = [player('a', 1), player('b', 1), player('c', 5), player('d', 5)]
  assert.deepEqual(splitPods(uneven, 'DUEL', 1, pairingsOf(night(uneven, [pod('1', ['a', 'b']), pod('2', ['c', 'd'])]))), [['a', 'b'], ['c', 'd']])
})

test('a player moves between pods, and an emptied pod goes', () => {
  const pods = [pod('1', ['a', 'b', 'c'], { winnerId: 'a', startedAt: 5 }), pod('2', ['d', 'e', 'f'])]
  const moved = movePlayer(pods, 'c', 1, 'new')
  assert.deepEqual(moved.map((p) => p.playerIds), [['a', 'b'], ['d', 'e', 'f', 'c']])
  assert.equal(moved[0].winnerId, null)
  const alone = movePlayer(pods, 'c', 2, 'new')
  assert.deepEqual(alone.map((p) => p.id), ['1', '2', 'new'])
  assert.deepEqual(movePlayer([pod('1', ['a']), pod('2', ['b'])], 'a', 1, 'x').map((p) => p.playerIds), [['b', 'a']])
  const gone = withoutPlayer(night([player('a', 1), player('b', 1)], [pod('1', ['a', 'b'], { winnerId: 'a' })]), 'a')
  assert.deepEqual(gone.pods.map((p) => [p.playerIds, p.winnerId]), [[['b'], null]])
})

test('withPods numbers its pods from the seed', () => {
  const n = withPods(night([player('a', 2), player('b', 2), player('c', 2)]), 9, null)
  assert.deepEqual(n.pods.map((p) => p.id), ['9-1'])
  assert.equal(n.seed, 9)
})

test('a deck is suggested close to the table, then the one played longest ago', () => {
  const decks: DeckChoice[] = [
    { id: '1', name: 'Atraxa', gameMode: 'COMMANDER', bracket: 4, lastPlayed: 100 },
    { id: '2', name: 'Omnath', gameMode: 'COMMANDER', bracket: 2, lastPlayed: 300 },
    { id: '3', name: 'Krenko', gameMode: 'COMMANDER', bracket: 2, lastPlayed: 200 },
    { id: '4', name: 'Burn', gameMode: 'MODERN', bracket: null, lastPlayed: 0 },
  ]
  assert.deepEqual(suggestedDecks(decks, 'COMMANDER', [2, 2, null]).map((d) => d.id), ['3', '2', '1'])
  assert.deepEqual(suggestedDecks(decks, 'COMMANDER', [null]).map((d) => d.id), ['1', '3', '2'])
  assert.deepEqual(suggestedDecks(decks, 'DUEL', []).map((d) => d.id), ['4'])
  const ordered = suggestedDecks(decks, 'COMMANDER', [2])
  assert.equal(nextSuggestion(ordered, null)?.id, '3')
  assert.equal(nextSuggestion(ordered, '3')?.id, '2')
  assert.equal(nextSuggestion(ordered, '1')?.id, '3')
})

test("a pod's table is seeded with its players, and the user's deck", () => {
  const players = [{ ...player('me', 3, 'ME'), name: 'Sam', deckId: 'deck-1', commander: 'Krenko, Mob Boss' }, player('b', 2), player('c', 2)]
  const seed = tableSeedOf(pod('1', ['b', 'me', 'c']), players)
  assert.deepEqual(seed, {
    players: [{ name: 'b', commander: null }, { name: 'Sam', commander: 'Krenko, Mob Boss' }, { name: 'c', commander: null }],
    meSeat: 2,
    meDeckId: 'deck-1',
  })
  assert.equal(tableSeedOf(pod('2', ['b', 'c']), players).meSeat, null)
  assert.equal(layoutIdFor(3, '4-grid'), '3-top')
  assert.equal(layoutIdFor(4, '4-ends'), '4-ends')
  assert.equal(layoutIdFor(2, '4-grid'), '2-facing')
})

test("a pod's winner comes from its life counter game, or the tap", () => {
  const players = [player('Ann', 2), player('Bo', 2), player('Cy', 2)]
  const started = pod('1', ['Ann', 'Bo', 'Cy'], { startedAt: 1000 })
  const game = (endedAt: number, winnerSeat: number | null, names = ['ann', 'Bo', 'Cy']) =>
    ({ endedAt, winnerSeat, players: names.map((name, i) => ({ seat: i + 1, name })) })
  assert.equal(podWinner(started, players, []), undefined)
  // Before the pod started, or other people: not this pod's game.
  assert.equal(podWinner(started, players, [game(500, 1), game(2000, 1, ['Ann', 'Bo', 'Di'])]), undefined)
  assert.deepEqual(podWinner(started, players, [game(2000, 2), game(3000, 1)]), { winnerId: 'Ann', fromTable: true })
  assert.deepEqual(podWinner(started, players, [game(2000, null)]), { winnerId: null, fromTable: true })
  assert.deepEqual(podWinner({ ...started, winnerId: 'Cy' }, players, []), { winnerId: 'Cy', fromTable: false })
})

test("a winner tapped on game night goes onto the user's deck", () => {
  const players = [{ ...player('me', 3, 'ME'), name: 'Sam', deckId: 'deck-1' }, { ...player('b', 2), commander: 'Krenko, Mob Boss' }, player('c', 2)]
  const won = nightResultOf('n1', pod('p1', ['me', 'b', 'c']), players, 'me', 50)
  assert.deepEqual(won, {
    deckId: 'deck-1',
    result: { id: 'night-n1-p1', result: 'WIN', opponent: 'b, c', playedAt: 50, turns: null, minutes: null, commanders: ['Krenko, Mob Boss'] },
  })
  assert.equal(nightResultOf('n1', pod('p1', ['me', 'b']), players, 'b', 50)?.result.result, 'LOSS')
  assert.equal(nightResultOf('n1', pod('p2', ['b', 'c']), players, 'b', 50), null)
})

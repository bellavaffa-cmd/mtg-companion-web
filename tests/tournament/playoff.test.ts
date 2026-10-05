import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canPairNext, currentRound, newTournament, pairNextRound, podResult, standings, withDropped, withResult,
  type EventFormat, type Tournament,
} from '../../src/tournament/tournament.ts'
import {
  canCut, cutSizes, matchWinner, parsePlayoff, playoffChampion, playoffChoices, playoffEditable, playoffRoundName, playoffStatus,
  seedOrder, startPlayoff, withPlayoffResult,
} from '../../src/tournament/playoff.ts'

// The top 8 / 4 / 2 after the Swiss, and the pods' final table. The Android app has the same checks,
// with the same seeds and the same brackets — see PlayoffTest.kt.

const num = (id: string) => Number(id.slice(1))

/** An event of [n] players, every round played with the lower-numbered player winning (2–0, or the pod). */
function played(format: EventFormat, n: number, seed: number): Tournament {
  let t = newTournament({
    id: 'e1', name: 'Friday', format, bestOf: 3, roundCount: format === 'SWISS' ? 3 : 2, roundMinutes: 50, seed, createdAt: 0,
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, userId: null })),
  })
  while (canPairNext(t)) {
    t = pairNextRound(t)
    currentRound(t)!.tables.forEach((tb, i) => {
      if (tb.result) return
      if (format === 'SWISS') t = withResult(t, i, num(tb.players[0]) < num(tb.players[1]) ? { wins: [2, 0], draws: 0 } : { wins: [0, 2], draws: 0 })
      else t = withResult(t, i, podResult(tb.players, [...tb.players].sort((a, b) => num(a) - num(b))[0]))
    })
  }
  return t
}

test('seeds meet in bracket order: 1 v 8, 4 v 5, 2 v 7, 3 v 6', () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6])
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3])
  assert.deepEqual(seedOrder(2), [1, 2])
})

test('the cut is offered once the Swiss is played, for tops that fit the players still in', () => {
  const t = played('SWISS', 8, 7)
  assert.ok(canCut(t))
  assert.deepEqual(cutSizes(t), [8, 4, 2])
  assert.deepEqual(cutSizes(withDropped(withDropped(withDropped(t, 'p1', true), 'p2', true), 'p3', true)), [4, 2])
  const early = pairNextRound(newTournament({ id: 'e', name: 'E', format: 'SWISS', bestOf: 1, roundCount: 3, roundMinutes: 50, seed: 1, createdAt: 0, players: ['A', 'B', 'C', 'D'].map((name) => ({ name, userId: null })) }))
  assert.equal(canCut(early), false)
})

test('a top 8 seeded from the standings, played through to a champion', () => {
  const swiss = played('SWISS', 8, 7)
  const seeds = standings(swiss).map((s) => s.id)
  assert.deepEqual(seeds, ['p1', 'p2', 'p4', 'p3', 'p5', 'p6', 'p7', 'p8'])
  let t = startPlayoff(swiss, 8)
  assert.ok(t.finished)
  assert.equal(canCut(t), false)
  const p = t.playoff!
  assert.equal(p.kind, 'BRACKET')
  assert.deepEqual(p.rounds.map((r) => r.length), [4, 2, 1])
  assert.deepEqual(p.rounds[0].map((m) => m.players.join('v')), ['p1vp8', 'p3vp5', 'p2vp7', 'p4vp6'])
  assert.deepEqual([0, 1, 2].map((r) => playoffRoundName(p, r)), ['Quarterfinals', 'Semifinals', 'Final'])
  assert.equal(playoffEditable(p, 1, 0), false, 'a semifinal waits for its players')

  // The higher seed wins every quarterfinal.
  for (let i = 0; i < 4; i++) t = withPlayoffResult(t, 0, i, { wins: [2, 1], draws: 0 })
  assert.deepEqual(t.playoff!.rounds[1].map((m) => m.players.join('v')), ['p1vp3', 'p2vp4'])
  // A quarterfinal cleared before its semifinal is played takes its winner back out.
  const cleared = withPlayoffResult(t, 0, 1, null)
  assert.deepEqual(cleared.playoff!.rounds[1][0].players, ['p1', null])
  // The underdog takes the first semifinal; then that quarterfinal is settled.
  t = withPlayoffResult(t, 1, 0, { wins: [0, 2], draws: 0 })
  assert.equal(withPlayoffResult(t, 0, 0, { wins: [0, 2], draws: 0 }), t)
  t = withPlayoffResult(t, 1, 1, { wins: [2, 0], draws: 0 })
  assert.deepEqual(t.playoff!.rounds[2][0].players, ['p3', 'p2'])
  assert.equal(playoffChampion(t), null)
  assert.equal(playoffStatus(t, (id) => id.toUpperCase()), 'Top 8')
  t = withPlayoffResult(t, 2, 0, { wins: [1, 2], draws: 0 })
  assert.equal(playoffChampion(t), 'p2')
  assert.equal(playoffStatus(t, (id) => id.toUpperCase()), 'Champion: P2')
})

test('a top 2 is one final; a top 4 two rounds', () => {
  const swiss = played('SWISS', 6, 3)
  const seeds = standings(swiss).map((s) => s.id)
  const top2 = startPlayoff(swiss, 2).playoff!
  assert.deepEqual(top2.rounds.map((r) => r.map((m) => m.players.join('v'))), [[`${seeds[0]}v${seeds[1]}`]])
  const top4 = startPlayoff(swiss, 4).playoff!
  assert.deepEqual(top4.rounds[0].map((m) => m.players.join('v')), [`${seeds[0]}v${seeds[3]}`, `${seeds[1]}v${seeds[2]}`])
  assert.equal(startPlayoff(swiss, 8), swiss, 'not enough players for a top 8')
})

test('bracket matches have a winner: no draws', () => {
  assert.deepEqual(playoffChoices(1).map((c) => c.label), ['1–0', '0–1'])
  assert.deepEqual(playoffChoices(3).map((c) => c.label), ['2–0', '2–1', '1–2', '0–2'])
  assert.equal(matchWinner({ players: ['a', 'b'], result: { wins: [1, 1], draws: 0 } }), null)
  assert.equal(matchWinner({ players: ['a', 'b'], result: null }), null)
})

test("pods end with a final table: the top 4 play one game", () => {
  const pods = played('PODS', 9, 11)
  assert.deepEqual(cutSizes(pods), [4])
  let t = startPlayoff(pods, 4)
  const p = t.playoff!
  assert.equal(p.kind, 'FINAL_TABLE')
  assert.deepEqual(p.rounds[0][0].players, standings(pods).slice(0, 4).map((s) => s.id))
  assert.equal(playoffRoundName(p, 0), 'Final table')
  const third = p.rounds[0][0].players[2]!
  t = withPlayoffResult(t, 0, 0, podResult(p.rounds[0][0].players as string[], third))
  assert.equal(playoffChampion(t), third)
})

test('an event saved before playoffs has none', () => {
  const old = JSON.parse(JSON.stringify(played('SWISS', 4, 5))) as Tournament
  delete old.playoff
  assert.equal(parsePlayoff(old.playoff), null)
  assert.equal(playoffChampion(old), null)
  assert.equal(playoffStatus(old, (id) => id), null)
  assert.ok(canCut(old))
  assert.equal(parsePlayoff({ kind: 'BRACKET', size: 2, rounds: 'x' }), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canFinish, canPairNext, clockText, currentRound, matchChoices, newTournament, pairNextRound, pauseTimer, percentText,
  playersProblem, podResult, podSizes, resultText, seededRandom, seededShuffle, standings, standingsText, startTimer,
  suggestedRounds, timeLeft, withDropped, withResult, type EventFormat, type EventRound, type Tournament,
} from '../../src/tournament/tournament.ts'

// Small tournaments: the seeded shuffle, Swiss pairings and byes, pods, results, standings and
// tiebreakers, and the round clock. The Android app has the same checks, with the same seeds and
// the same expected pairings — see TournamentTest.kt.

const event = (format: EventFormat, n: number, seed: number, bestOf = 3, roundCount = suggestedRounds(format, n)): Tournament =>
  newTournament({
    id: 'e1', name: 'Friday', format, bestOf, roundCount, roundMinutes: 50, seed, createdAt: 0,
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, userId: null })),
  })

/** Plays [t] to the end, each result picked by a generator seeded with seed + 1; one line a round. */
function simulate(t: Tournament): { t: Tournament; lines: string[] } {
  const pick = seededRandom(t.seed + 1)
  const lines: string[] = []
  while (canPairNext(t)) {
    t = pairNextRound(t)
    currentRound(t)!.tables.forEach((tb, i) => {
      if (tb.result) return
      if (t.format === 'SWISS') {
        const choices = matchChoices(t.bestOf)
        const c = choices[Math.floor(pick() * choices.length)]
        t = withResult(t, i, { wins: c.wins, draws: c.draws })
      } else {
        const k = Math.floor(pick() * (tb.players.length + 1))
        t = withResult(t, i, podResult(tb.players, k < tb.players.length ? tb.players[k] : null))
      }
    })
    lines.push(currentRound(t)!.tables.map((tb) => `${tb.players.join('-')}:${resultText(t, tb)}`).join(' '))
  }
  lines.push(standings(t).map((s) => `${s.id}=${s.points}`).join(' '))
  return { t, lines }
}

const pairsMet = (rounds: EventRound[]) =>
  rounds.flatMap((r) => r.tables.filter((tb) => tb.players.length === 2).map((tb) => [...tb.players].sort().join('|')))

test('the seeded generator and shuffle give the same numbers in both apps', () => {
  const next = seededRandom(42)
  assert.deepEqual([next(), next(), next()], [0.6011037519201636, 0.44829055899754167, 0.8524657934904099])
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
  assert.deepEqual(seededShuffle(ids, 12345), ['p4', 'p1', 'p2', 'p6', 'p5', 'p7', 'p3', 'p8'])
  assert.deepEqual(seededShuffle(ids, -7), ['p2', 'p5', 'p6', 'p1', 'p7', 'p8', 'p3', 'p4'])
  assert.deepEqual(seededShuffle(ids, 12345), seededShuffle(ids, 12345))
  assert.deepEqual([...seededShuffle(ids, 9)].sort(), ids)
})

test('rounds are suggested from the player count, pods made of fours and threes', () => {
  assert.deepEqual([4, 5, 8, 9, 16, 17, 32].map((n) => suggestedRounds('SWISS', n)), [2, 3, 3, 4, 4, 5, 5])
  assert.deepEqual([4, 8, 9, 16, 32].map((n) => suggestedRounds('PODS', n)), [2, 2, 3, 3, 4])
  assert.deepEqual(podSizes(4), [4])
  assert.deepEqual(podSizes(5), [3, 2])
  assert.deepEqual(podSizes(6), [3, 3])
  assert.deepEqual(podSizes(7), [4, 3])
  assert.deepEqual(podSizes(9), [3, 3, 3])
  assert.deepEqual(podSizes(10), [4, 3, 3])
  assert.deepEqual(podSizes(11), [4, 4, 3])
  assert.deepEqual(podSizes(13), [4, 3, 3, 3])
  for (let n = 3; n <= 32; n++) assert.equal(podSizes(n).reduce((a, b) => a + b, 0), n)
})

test('an event needs 4 to 32 players with different names', () => {
  assert.equal(playersProblem(['A', 'B', 'C']), 'Add at least 4 players')
  assert.equal(playersProblem(['A', 'B', 'C', 'a ']), 'Two players have the same name')
  assert.equal(playersProblem(['A', 'B', 'C', ' ']), 'Every player needs a name')
  assert.equal(playersProblem(Array.from({ length: 33 }, (_, i) => `P${i}`)), 'At most 32 players')
  assert.equal(playersProblem(['A', 'B', 'C', 'D']), null)
})

test('round 1 pairs the seeded order; the next round waits for every result', () => {
  let t = pairNextRound(event('SWISS', 8, 12345))
  // The same order as seededShuffle(p1…p8, 12345).
  assert.deepEqual(currentRound(t)!.tables.map((tb) => tb.players), [['p4', 'p1'], ['p2', 'p6'], ['p5', 'p7'], ['p3', 'p8']])
  assert.equal(canPairNext(t), false)
  assert.equal(pairNextRound(t), t)
  for (let i = 0; i < 4; i++) t = withResult(t, i, { wins: [2, 0], draws: 0 })
  assert.equal(canPairNext(t), true)
  // A result can change until the next round is paired.
  t = withResult(t, 0, { wins: [1, 2], draws: 0 })
  t = pairNextRound(t)
  assert.equal(t.rounds.length, 2)
  // Winners meet winners: p1 (who won the changed result), p2, p5, p3.
  const winners = new Set(['p1', 'p2', 'p5', 'p3'])
  for (const tb of currentRound(t)!.tables) assert.equal(winners.has(tb.players[0]), winners.has(tb.players[1]))
  // Round 1 is settled now.
  const settled = withResult(t, 0, { wins: [0, 2], draws: 0 })
  assert.deepEqual(settled.rounds[0], t.rounds[0])
})

test('a full Swiss event plays out the same in both apps', () => {
  const { t, lines } = simulate(event('SWISS', 9, 2024, 3, 5))
  assert.deepEqual(lines, [
    'p4-p1:1–2 p2-p9:0–2 p3-p7:2–1 p5-p6:2–1 p8:Bye',
    'p9-p1:1–1 p3-p5:Draw p8-p4:2–0 p7-p6:0–2 p2:Bye',
    'p8-p9:0–2 p5-p1:1–2 p3-p2:2–1 p6-p4:1–1 p7:Bye',
    'p9-p3:0–2 p1-p8:2–0 p5-p7:Draw p6-p2:0–2 p4:Bye',
    'p3-p1:Draw p9-p5:2–1 p2-p8:1–2 p4-p7:2–0 p6:Bye',
    'p1=11 p3=11 p9=10 p8=9 p4=7 p6=7 p2=6 p5=5 p7=4',
  ])
  // Nobody had two byes, nobody met anyone twice.
  const byes = t.rounds.map((r) => r.tables.find((tb) => tb.players.length === 1)!.players[0])
  assert.equal(new Set(byes).size, byes.length)
  const met = pairsMet(t.rounds)
  assert.equal(new Set(met).size, met.length)
})

test('Swiss avoids rematches and second byes whenever it can', () => {
  for (let n = 4; n <= 16; n++) {
    for (const seed of [1, 2, 3]) {
      const { t } = simulate(event('SWISS', n, seed * 101 + n))
      for (const r of t.rounds) {
        const seated = r.tables.flatMap((tb) => tb.players)
        assert.equal(seated.length, n, `everyone plays once (n=${n})`)
        assert.equal(new Set(seated).size, n)
        assert.equal(r.tables.filter((tb) => tb.players.length === 1).length, n % 2)
      }
      const met = pairsMet(t.rounds)
      assert.equal(new Set(met).size, met.length, `no rematch (n=${n}, seed=${seed})`)
      const byes = t.rounds.flatMap((r) => r.tables.filter((tb) => tb.players.length === 1).map((tb) => tb.players[0]))
      assert.equal(new Set(byes).size, byes.length, `no second bye (n=${n})`)
    }
  }
})

test('with four players and more rounds than opponents, a rematch is allowed rather than stopping', () => {
  const { t } = simulate(event('SWISS', 4, 5, 3, 4))
  assert.equal(t.rounds.length, 4)
  assert.equal(pairsMet(t.rounds).length, 8)
})

test('a bye is a 2–0 win and goes to the lowest-placed player without one', () => {
  let t = pairNextRound(event('SWISS', 5, 12345))
  const bye = currentRound(t)!.tables.find((tb) => tb.players.length === 1)!
  assert.equal(resultText(t, bye), 'Bye')
  // The last of the seeded order.
  const order = seededShuffle(['p1', 'p2', 'p3', 'p4', 'p5'], 12345)
  assert.equal(bye.players[0], order[4])
  const row = standings(t).find((s) => s.id === bye.players[0])!
  assert.equal(row.points, 3)
  assert.equal(row.byes, 1)
  assert.equal(row.gw, 1)
  // A bye has no opponent: it doesn't count toward OMW.
  assert.equal(row.omw, 0)
  // Its result can't be changed.
  assert.equal(withResult(t, currentRound(t)!.tables.indexOf(bye), null), t)
  t = withDropped(t, 'p1', true)
  assert.equal(t.players.find((p) => p.id === 'p1')!.dropped, true)
})

// A known event: A beat B 2–0 and C beat D 2–1; then A beat C 2–1 and B beat D 2–1.
function known(): Tournament {
  const t = event('SWISS', 4, 1, 3, 3)
  const named = { ...t, name: 'Known', players: t.players.map((p, i) => ({ ...p, name: 'ABCD'[i] })) }
  const timer = { endsAt: null, leftMs: null }
  return {
    ...named,
    rounds: [
      { number: 1, timer, tables: [{ players: ['p1', 'p2'], result: { wins: [2, 0], draws: 0 } }, { players: ['p3', 'p4'], result: { wins: [2, 1], draws: 0 } }] },
      { number: 2, timer, tables: [{ players: ['p1', 'p3'], result: { wins: [2, 1], draws: 0 } }, { players: ['p2', 'p4'], result: { wins: [2, 1], draws: 0 } }] },
    ],
  }
}

test('standings use match points, then OMW%, GW% and OGW% with the 33% floor', () => {
  const rows = standings(known())
  assert.deepEqual(rows.map((s) => s.name), ['A', 'C', 'B', 'D'])
  const [a, c, b, d] = rows
  assert.deepEqual([a.points, c.points, b.points, d.points], [6, 3, 3, 0])
  assert.deepEqual([a.wins, a.losses, a.draws], [2, 0, 0])
  // A's opponents B and C both won half their matches.
  assert.equal(a.omw, 0.5)
  // C and B tie on OMW — A (100%) and D (0%, floored to 33%) — so GW% decides: 9/18 against 6/15.
  assert.equal(c.omw, (1 + 0.33) / 2)
  assert.equal(b.omw, c.omw)
  assert.equal(c.gw, 0.5)
  assert.equal(b.gw, 0.4)
  // D won 2 of 6 games: 33.3%, above the floor.
  assert.equal(d.gw, 6 / 18)
  assert.equal(a.gw, 12 / 15)
  assert.equal(b.ogw, (12 / 15 + 6 / 18) / 2)
  assert.equal(percentText(c.omw), '66.5%')
  assert.equal(percentText(1 / 3), '33.3%')
  assert.equal(percentText(1), '100.0%')
})

test('the standings as plain text', () => {
  const t = { ...known(), finished: true }
  assert.equal(standingsText(t), [
    'Known',
    '1v1 Swiss · best of 3 · 4 players · 2 rounds',
    'Final standings',
    '',
    '1. A — 6 pts · 2–0–0 · OMW 50.0% · GW 80.0% · OGW 45.0%',
    '2. C — 3 pts · 1–1–0 · OMW 66.5% · GW 50.0% · OGW 56.7%',
    '3. B — 3 pts · 1–1–0 · OMW 66.5% · GW 40.0% · OGW 56.7%',
    '4. D — 0 pts · 0–2–0 · OMW 50.0% · GW 33.3% · OGW 45.0%',
  ].join('\n'))
  assert.equal(canFinish(known()), true)
  assert.equal(canPairNext(t), false)
})

test("a dropped player isn't paired again but still counts for their opponents", () => {
  let t = pairNextRound(event('SWISS', 6, 77))
  for (let i = 0; i < 3; i++) t = withResult(t, i, { wins: [2, 1], draws: 0 })
  const loser = currentRound(t)!.tables[0].players[1]
  const winner = currentRound(t)!.tables[0].players[0]
  t = withDropped(t, loser, true)
  t = pairNextRound(t)
  const seated = currentRound(t)!.tables.flatMap((tb) => tb.players)
  assert.equal(seated.includes(loser), false)
  // Five left: one of them has a bye.
  assert.equal(currentRound(t)!.tables.filter((tb) => tb.players.length === 1).length, 1)
  const rows = standings(t)
  assert.equal(rows.find((s) => s.id === loser)!.dropped, true)
  // The winner's OMW is the dropped player's 0%, floored.
  assert.equal(rows.find((s) => s.id === winner)!.omw, 0.33)
  assert.ok(standingsText(t).includes(' · dropped'))
})

test('best of one has its own results; a 1–1 is a drawn match', () => {
  assert.deepEqual(matchChoices(1).map((c) => c.label), ['1–0', '0–1', 'Draw'])
  assert.deepEqual(matchChoices(3).map((c) => c.label), ['2–0', '2–1', '1–2', '0–2', '1–1', 'Draw'])
  let t = pairNextRound(event('SWISS', 4, 3))
  t = withResult(t, 0, { wins: [1, 1], draws: 0 })
  const [x, y] = currentRound(t)!.tables[0].players
  const rows = standings(t)
  assert.equal(rows.find((s) => s.id === x)!.points, 1)
  assert.equal(rows.find((s) => s.id === y)!.draws, 1)
  assert.equal(resultText(t, currentRound(t)!.tables[0]), '1–1')
})

test('a full pods event plays out the same in both apps', () => {
  const { lines } = simulate(event('PODS', 11, 99, 1, 4))
  assert.deepEqual(lines, [
    'p4-p11-p2-p8:P11 won p7-p10-p1-p6:P10 won p5-p9-p3:P3 won',
    'p11-p10-p3-p5:Draw p9-p4-p7-p2:P7 won p8-p1-p6:P6 won',
    'p10-p9-p8-p3:P10 won p11-p6-p7-p5:P7 won p1-p4-p2:P1 won',
    'p10-p7-p8-p5:P8 won p3-p6-p4-p11:P11 won p1-p9-p2:P1 won',
    'p10=7 p11=7 p7=6 p1=6 p3=4 p6=3 p8=3 p5=1 p4=0 p9=0 p2=0',
  ])
})

test('pods: 3 for a win, 1 each for a draw, ties broken by opponents’ average points', () => {
  let t = pairNextRound(event('PODS', 8, 12345))
  const pods = currentRound(t)!.tables
  assert.deepEqual(pods.map((p) => p.players), [['p4', 'p1', 'p2', 'p6'], ['p5', 'p7', 'p3', 'p8']])
  t = withResult(t, 0, podResult(pods[0].players, 'p2'))
  t = withResult(t, 1, podResult(pods[1].players, null))
  assert.equal(resultText(t, currentRound(t)!.tables[0]), 'P2 won')
  assert.equal(resultText(t, currentRound(t)!.tables[1]), 'Draw')
  const rows = standings(t)
  assert.equal(rows[0].id, 'p2')
  assert.equal(rows[0].points, 3)
  // The draw's four have 1 point each and met players averaging 1; p4, p1 and p6 met p2's 3.
  const p5 = rows.find((s) => s.id === 'p5')!
  const p4 = rows.find((s) => s.id === 'p4')!
  assert.equal(p5.points, 1)
  assert.equal(p5.oppPoints, 1)
  assert.equal(p4.points, 0)
  assert.equal(p4.oppPoints, 1)
  assert.deepEqual(rows.slice(1, 5).map((s) => s.points), [1, 1, 1, 1])
  assert.ok(standingsText(t).includes('Opp. avg 1.0'))
})

test('pods group by standing and keep away from last round’s pod-mates where they can', () => {
  let t = pairNextRound(event('PODS', 16, 4))
  const first = currentRound(t)!.tables
  first.forEach((pod, i) => { t = withResult(t, i, podResult(pod.players, pod.players[0])) })
  t = pairNextRound(t)
  const second = currentRound(t)!.tables
  // The four winners sit together.
  assert.deepEqual([...second[0].players].sort(), first.map((p) => p.players[0]).sort())
  const repeats = second.reduce((sum, pod) => sum + first.reduce((s, old) => {
    const shared = pod.players.filter((p) => old.players.includes(p)).length
    return s + (shared * (shared - 1)) / 2
  }, 0), 0)
  assert.equal(repeats, 0)
})

test('the round clock runs, pauses and survives a reload by its end time', () => {
  const minutes = 50
  let timer = { endsAt: null as number | null, leftMs: null as number | null }
  assert.equal(timeLeft(timer, minutes, 0), 50 * 60_000)
  timer = startTimer(timer, minutes, 1_000)
  assert.equal(timer.endsAt, 1_000 + 50 * 60_000)
  assert.equal(timeLeft(timer, minutes, 61_000), 49 * 60_000)
  timer = pauseTimer(timer, minutes, 61_000)
  assert.equal(timer.endsAt, null)
  assert.equal(timeLeft(timer, minutes, 999_999), 49 * 60_000)
  timer = startTimer(timer, minutes, 100_000)
  assert.equal(timeLeft(timer, minutes, 100_000 + 49 * 60_000 + 30_000), -30_000)
  assert.equal(clockText(49 * 60_000 + 5_000), '49:05')
  assert.equal(clockText(-150_000), '-2:30')
  assert.equal(clockText(400), '0:01')
  assert.equal(clockText(0), '0:00')
})

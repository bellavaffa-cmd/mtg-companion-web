import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGameLog, compactPoints, durationText, gameRecap, lifeChart, recapLines, type LifePoint, type LogEntry,
} from '../../src/lifecounter/lifeChart.ts'

// A finished game's log, its life chart and its recap. The Android app has the same checks, on the
// same game — see LifeChartTest.kt.

// Three players at 40; the table tracks turns, seat 1 goes first.
const entries: LogEntry[] = [
  { seat: 1, ms: 1_000, turn: 1, life: 37, out: null },
  { seat: 2, ms: 60_000, turn: 1, life: 40, out: null, turnStart: true },
  { seat: 2, ms: 90_000, turn: 1, life: 30, out: null },
  { seat: 3, ms: 200_000, turn: 1, life: 40, out: null, turnStart: true },
  { seat: 1, ms: 260_000, turn: 2, life: 37, out: null, turnStart: true },
  { seat: 3, ms: 300_000, turn: 2, life: 25, out: null },
  { seat: 3, ms: 320_000, turn: 2, life: 25, out: null },
  { seat: 2, ms: 400_000, turn: 2, life: 30, out: null, turnStart: true },
  { seat: 2, ms: 410_000, turn: 2, life: 36, out: null },
  { seat: 3, ms: 500_000, turn: 2, life: 25, out: null, turnStart: true },
  { seat: 3, ms: 520_000, turn: 2, life: 0, out: 'LIFE' },
  { seat: 1, ms: 600_000, turn: 3, life: 37, out: null, turnStart: true },
  { seat: 2, ms: 650_000, turn: 3, life: -2, out: 'LIFE' },
]
const start = [{ seat: 1, life: 40 }, { seat: 2, life: 40 }, { seat: 3, life: 40 }]
const finalOuts = [{ seat: 1, out: null }, { seat: 2, out: 'LIFE' }, { seat: 3, out: 'LIFE' }]
const damage = [{ to: 3, from: 1, amount: 15 }, { to: 2, from: 3, amount: 4 }, { to: 3, from: 2, amount: 3 }, { to: 1, from: 2, amount: 0 }]
const log = buildGameLog(entries, start, finalOuts, damage, 700_000, true, 1)
const names: Record<number, string> = { 1: 'Ana', 2: 'Ben', 3: 'Cat' }

test('the log keeps each change of life, who went out when, and the turns', () => {
  assert.deepEqual(log.points.map((p) => `${p.seat}@${p.ms}:${p.life}`), ['1@1000:37', '2@90000:30', '3@300000:25', '2@410000:36', '3@520000:0', '2@650000:-2'])
  assert.deepEqual(log.outs, [
    { seat: 3, ms: 520_000, turn: 2, reason: 'LIFE' },
    { seat: 2, ms: 650_000, turn: 3, reason: 'LIFE' },
  ])
  assert.deepEqual(log.turns.map((t) => `${t.seat}/${t.turn}@${t.ms}`), ['1/1@0', '2/1@60000', '3/1@200000', '1/2@260000', '2/2@400000', '3/2@500000', '1/3@600000'])
  assert.equal(log.damage.length, 3)
})

test('without the turn tracker there are no turns, and a new first player starts them over', () => {
  assert.deepEqual(buildGameLog(entries, start, finalOuts, damage, 700_000, false, 1).turns, [])
  const restarted = buildGameLog([{ seat: 2, ms: 5_000, turn: 1, life: 40, out: null, turnStart: true, first: true }, ...entries.slice(1)], start, finalOuts, damage, 700_000, true, 1)
  assert.deepEqual(restarted.turns.slice(0, 2).map((t) => `${t.seat}/${t.turn}@${t.ms}`), ['2/1@5000', '2/1@60000'])
})

test('someone out with nothing in the history to say when went out at the end', () => {
  const quiet = buildGameLog([], start, [{ seat: 1, out: null }, { seat: 2, out: 'KILLED' }, { seat: 3, out: null }], [], 90_000, false, 1)
  assert.deepEqual(quiet.outs, [{ seat: 2, ms: 90_000, turn: 1, reason: 'KILLED' }])
})

test('by round: each player\'s life at the end of each round, stopping where they went out', () => {
  const chart = lifeChart(log, 'turn')
  assert.deepEqual(chart.series.map((s) => s.points.map((p) => `${p.x}:${p.life}`).join(' ')), [
    '0:40 1:37 2:37 3:37',
    '0:40 1:30 2:36 3:-2',
    '0:40 1:40 2:0',
  ])
  assert.deepEqual([chart.xMax, chart.yMin, chart.yMax], [3, -2, 40])
})

test('by time: a step at each change, to the end of the game or until they went out', () => {
  const chart = lifeChart(log, 'time')
  assert.deepEqual(chart.series.map((s) => s.points.map((p) => `${p.x}:${p.life}`).join(' ')), [
    '0:40 1000:37 700000:37',
    '0:40 90000:30 410000:36 650000:-2',
    '0:40 300000:25 520000:0',
  ])
  assert.equal(chart.xMax, 700_000)
})

test('the recap: most commander damage, biggest swing, longest turn and knock-outs', () => {
  const recap = gameRecap(log)
  assert.deepEqual(recap.mostCommanderDamage, { seat: 1, amount: 15 })
  assert.deepEqual(recap.biggestSwing, { seat: 3, turn: 2, delta: -40 })
  assert.deepEqual(recap.longestTurn, { seat: 2, turn: 1, ms: 140_000 })
  assert.deepEqual(recap.knockouts.map((k) => k.seat), [3, 2])
  assert.deepEqual(recapLines(recap, (s) => names[s]), [
    'Ana dealt the most commander damage: 15',
    'Biggest swing: Cat, −40 in round 2',
    "Longest turn: Ben's, round 1 (2:20)",
    'Cat went out in round 2 (out of life)',
    'Ben went out in round 3 (out of life)',
  ])
})

test('a quiet game has nothing to recap', () => {
  const recap = gameRecap(buildGameLog([], start, [{ seat: 1, out: null }, { seat: 2, out: null }, { seat: 3, out: null }], [], 1_000, false, 1))
  assert.deepEqual(recap, { mostCommanderDamage: null, biggestSwing: null, longestTurn: null, knockouts: [] })
})

test('a long game keeps the last point of each player in each round', () => {
  const points: LifePoint[] = Array.from({ length: 400 }, (_, i) => ({ seat: (i % 2) + 1, ms: i * 1_000, turn: Math.floor(i / 20) + 1, life: 40 - i }))
  const kept = compactPoints(points)
  assert.equal(kept.length, 40)
  assert.deepEqual(kept.slice(0, 2).map((p) => p.ms), [18_000, 19_000])
  assert.equal(compactPoints(points.slice(0, 10)).length, 10)
})

test('lengths of time read as minutes and seconds', () => {
  assert.equal(durationText(140_000), '2:20')
  assert.equal(durationText(3_723_000), '1:02:03')
  assert.equal(durationText(0), '0:00')
})

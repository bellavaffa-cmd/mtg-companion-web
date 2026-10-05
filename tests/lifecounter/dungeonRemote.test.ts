import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, gameReducer, newGame, type Game, type GameAction } from '../../src/lifecounter/game.ts'
import { buildRemoteState, parseRemoteState, remoteToGameAction } from '../../src/lifecounter/remote.ts'
import { gameLogOf, meResultOf, tableGameOf } from '../../src/lifecounter/tableGames.ts'

// Dungeons, rad / speed / the Ring and mulligans at the table and over the remote protocol, and the
// game's log for its chart. The Android app has the same checks — see DungeonRemoteTest.kt.

const settings = { ...DEFAULT_SETTINGS, turnTracker: true, meSeat: 1 }
const ask = (game: Game, seat: number, action: unknown) => remoteToGameAction(game, settings, seat, action)
const play = (game: Game, seat: number, action: unknown): Game => {
  const a = ask(game, seat, action)
  assert.ok(a, `expected ${JSON.stringify(action)} from seat ${seat} to be allowed`)
  return gameReducer(game, a as GameAction)
}
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/android-state-extras.json', import.meta.url), 'utf8'))

test('a remote ventures through a dungeon; the table checks every step', () => {
  let g = newGame(settings)
  assert.equal(gameReducer(g, ask(g, 1, { type: 'venture', to: 'undercity' })!), g, 'Undercity needs venturing into it')
  g = play(g, 1, { type: 'venture', to: 'undercity', undercity: true })
  assert.deepEqual(g.players[0].dungeon, { dungeon: 'undercity', room: 'secret-entrance' })
  const skipped = gameReducer(g, ask(g, 1, { type: 'venture', to: 'trap' })!)
  assert.equal(skipped, g, 'no skipping rooms')
  for (const room of ['forge', 'trap', 'archives', 'throne-of-the-dead-three']) g = play(g, 1, { type: 'venture', to: room })
  assert.equal(g.players[0].dungeonsCompleted, 1)
  assert.equal(g.history[0].text, 'Completed the dungeon in Undercity: Throne of the Dead Three (1 completed)')
  // Undo takes the last step back, completion and all.
  g = gameReducer(g, { type: 'undo', by: 1 })
  assert.deepEqual([g.players[0].dungeon?.room, g.players[0].dungeonsCompleted], ['archives', 0])
  g = play(g, 1, { type: 'leaveDungeon' })
  assert.equal(g.players[0].dungeon, null)
  assert.equal(ask(g, 1, { type: 'venture', to: 7 }), null)
})

test('speed stops at 4 and the Ring at 4; rad keeps counting', () => {
  let g = newGame(settings)
  g = play(g, 2, { type: 'counter', counter: 'speed', delta: 6 })
  g = play(g, 2, { type: 'counter', counter: 'ring', delta: 5 })
  g = play(g, 2, { type: 'counter', counter: 'rad', delta: 12 })
  assert.deepEqual(g.players[1].counters, { speed: 4, ring: 4, rad: 12 })
  g = play(g, 2, { type: 'ringBearer', name: '  Sam  ' })
  assert.equal(g.players[1].ringBearer, 'Sam')
  assert.equal(ask(g, 2, { type: 'counter', counter: 'doom', delta: 1 }), null)
  assert.equal(ask(g, 2, { type: 'ringBearer', name: 3 }), null)
})

test('mulligans are recorded per seat and saved with the owner’s result', () => {
  let g = newGame(settings)
  g = play(g, 1, { type: 'mulligan', value: 2 })
  assert.equal(ask(g, 1, { type: 'mulligan', value: 8 }), null)
  g = gameReducer(g, { type: 'kill', id: 2 })
  g = gameReducer(g, { type: 'kill', id: 3 })
  g = gameReducer(g, { type: 'kill', id: 4 })
  const kept = tableGameOf(g, settings, 1)
  assert.equal(kept.players[0].mulligans, 2)
  assert.equal(kept.players[1].mulligans, null)
  assert.equal(meResultOf(kept, 1, false)!.mulligans, 2)
  assert.equal('mulligans' in meResultOf({ ...kept, players: kept.players.map((p) => ({ ...p, mulligans: null })) }, 1, false)!, false, 'none recorded: none saved')
})

test('the remote state carries the new keys, and a table from before reads as none of it', () => {
  let g = newGame(settings)
  g = play(g, 1, { type: 'venture', to: 'tomb' })
  g = play(g, 1, { type: 'mulligan', value: 0 })
  const sent = JSON.parse(JSON.stringify(buildRemoteState(g, settings)))
  assert.deepEqual(sent.players[0].dungeon, { id: 'tomb', room: 'trapped-entry' })
  assert.deepEqual([sent.players[0].dungeonsCompleted, sent.players[0].ringBearer, sent.players[0].mulligans], [0, null, 0])
  const android = parseRemoteState(fixture())!
  assert.deepEqual(android.players[0].dungeon, { id: 'undercity', room: 'forge' })
  assert.deepEqual([android.players[0].dungeonsCompleted, android.players[0].ringBearer, android.players[0].mulligans], [1, 'Frodo', 1])
  assert.deepEqual(android.players[0].counters, { speed: 4, ring: 2, rad: 3 })
  const old = fixture()
  for (const p of old.players) { delete p.dungeon; delete p.dungeonsCompleted; delete p.ringBearer; delete p.mulligans }
  const s = parseRemoteState(old)!
  assert.deepEqual(s.players.map((p) => [p.dungeon, p.dungeonsCompleted, p.ringBearer, p.mulligans]), [[undefined, undefined, undefined, undefined], [undefined, undefined, undefined, undefined], [undefined, undefined, undefined, undefined]])
  // Nonsense from a newer table reads as nothing.
  const odd = fixture()
  odd.players[1].dungeon = { id: 'tomb', room: 'nowhere' }
  odd.players[1].mulligans = 9
  odd.players[1].dungeonsCompleted = -3
  const o = parseRemoteState(odd)!.players[1]
  assert.deepEqual([o.dungeon, o.dungeonsCompleted, o.mulligans], [null, 0, null])
})

test('the game’s history gives its chart: each change of life, and who went out when', () => {
  let g = newGame(settings)
  g = gameReducer(g, { type: 'life', id: 2, delta: -15 })
  g = gameReducer(g, { type: 'nextTurn', autoKill: true })
  g = gameReducer(g, { type: 'commanderDamage', id: 3, from: 2, delta: 21, costsLife: true })
  const log = gameLogOf(g, settings)
  assert.deepEqual(log.points.map((p) => `${p.seat}:${p.life}`), ['2:25', '3:19'])
  assert.deepEqual(log.outs.map((o) => `${o.seat}:${o.reason}`), ['3:COMMANDER_DAMAGE'])
  assert.deepEqual(log.turns.map((t) => `${t.seat}/${t.turn}`), ['1/1', '2/1'])
  assert.deepEqual(log.damage, [{ to: 3, from: 2, amount: 21 }])
})

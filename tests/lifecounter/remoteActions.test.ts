import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, gameReducer, newGame, type Game, type GameAction } from '../../src/lifecounter/game.ts'
import { buildRemoteState, mayUsePlanes, remoteToGameAction } from '../../src/lifecounter/remote.ts'

// What a player's phone may ask the table for, and what the table makes of it.

const settings = { ...DEFAULT_SETTINGS, layoutId: DEFAULT_SETTINGS.layoutId }
const fresh = (): Game => newGame(settings)
const ask = (game: Game, seat: number, action: unknown) => remoteToGameAction(game, settings, seat, action)
const play = (game: Game, seat: number, action: unknown): Game => {
  const a = ask(game, seat, action)
  assert.ok(a, `expected ${JSON.stringify(action)} from seat ${seat} to be allowed`)
  return gameReducer(game, a as GameAction)
}

test('a player takes the monarch, and only whoever has it can give it up', () => {
  let g = play(fresh(), 1, { type: 'monarch', take: true })
  assert.equal(g.monarchId, 1)
  assert.equal(ask(g, 2, { type: 'monarch', take: false }), null)
  g = play(g, 2, { type: 'monarch', take: true })
  assert.equal(g.monarchId, 2)
  g = play(g, 2, { type: 'monarch', take: false })
  assert.equal(g.monarchId, null)
})

test('the initiative works the same way', () => {
  const g = play(fresh(), 3, { type: 'initiative', take: true })
  assert.equal(g.initiativeId, 3)
  assert.equal(ask(g, 3, { type: 'initiative', take: true }), null, 'taking what you already have does nothing')
})

test('day and night can be set or switched off, nothing else', () => {
  assert.equal(play(fresh(), 1, { type: 'dayNight', value: 'NIGHT' }).dayNight, 'NIGHT')
  assert.equal(ask(fresh(), 1, { type: 'dayNight', value: 'DUSK' }), null)
})

test('the table rolls the dice a phone asks for, and everyone sees the result', () => {
  const g = play(fresh(), 2, { type: 'roll', sides: 20 })
  assert.equal(g.announce?.kind, 'roll')
  assert.equal(g.announce?.seat, 2)
  const n = Number(g.announce?.value)
  assert.ok(n >= 1 && n <= 20)
  assert.match(g.history[0].text, /^Rolled a d20: \d+$/)
  const coin = play(fresh(), 2, { type: 'roll', sides: 2 })
  assert.equal(coin.announce?.kind, 'coin')
  assert.ok(coin.announce?.value === 'Heads' || coin.announce?.value === 'Tails')
  assert.equal(ask(fresh(), 2, { type: 'roll', sides: 7 }), null)
})

test('two rolls of the same die are two announcements', () => {
  const a = play(fresh(), 1, { type: 'roll', sides: 6 })
  const b = play(a, 1, { type: 'roll', sides: 6 })
  assert.notEqual(a.announce?.id, b.announce?.id)
})

test('commander casts count up, never below zero, and undo takes one back', () => {
  let g = play(fresh(), 1, { type: 'commanderCast', delta: 1 })
  g = play(g, 1, { type: 'commanderCast', delta: 1 })
  assert.equal(g.players[0].commanderCasts, 2)
  assert.equal(g.history[0].text, 'Cast their commander (tax 4)')
  assert.equal(buildRemoteState(g, settings).players[0].commanderCasts, 2)
  g = gameReducer(g, { type: 'undo', by: 1 })
  assert.equal(g.players[0].commanderCasts ?? 0, 0, 'quick casts undo together, like any burst')
  assert.equal(gameReducer(fresh(), ask(fresh(), 1, { type: 'commanderCast', delta: -1 }) as GameAction).players[0].commanderCasts ?? 0, 0)
  assert.equal(ask(fresh(), 1, { type: 'commanderCast', delta: 5 }), null)
})

test('holding on is yours to let go of, and passing the turn lets go', () => {
  let g = play(fresh(), 2, { type: 'hold', on: true })
  assert.equal(g.hold, 2)
  assert.equal(ask(g, 3, { type: 'hold', on: false }), null, "someone else can't cancel your hold")
  g = gameReducer(g, { type: 'nextTurn', autoKill: true })
  assert.equal(g.hold, null)
})

test('emotes are from a fixed set', () => {
  assert.equal(play(fresh(), 1, { type: 'emote', emote: 'gg' }).announce?.emote, 'gg')
  assert.equal(ask(fresh(), 1, { type: 'emote', emote: '<script>' }), null)
  assert.equal(ask(fresh(), 1, { type: 'emote', emote: 'toString' }), null)
})

test('a player can point at someone else at the table, not at themselves or an empty seat', () => {
  const g = play(fresh(), 1, { type: 'target', to: 3 })
  assert.deepEqual([g.announce?.kind, g.announce?.seat, g.announce?.to], ['target', 1, 3])
  assert.equal(ask(fresh(), 1, { type: 'target', to: 1 }), null)
  assert.equal(ask(fresh(), 1, { type: 'target', to: 99 }), null)
})

test('conceding knocks a player out, says so, and can be undone', () => {
  let g = play(fresh(), 4, { type: 'concede' })
  assert.equal(g.players[3].killed, true)
  assert.equal(g.history[0].text, 'Conceded')
  assert.equal(ask(g, 4, { type: 'concede' }), null, 'no conceding twice')
  g = gameReducer(g, { type: 'undo', by: 4 })
  assert.equal(g.players[3].killed, false)
})

test('conceding lets go of a hold on', () => {
  const g = play(play(fresh(), 2, { type: 'hold', on: true }), 2, { type: 'concede' })
  assert.equal(g.hold, null)
})

test('the planar die is only for the player whose turn it is, when turns are tracked', () => {
  const plane = { name: 'Tazeem', imageUrl: null, left: 10 }
  const g = fresh()
  assert.equal(mayUsePlanes(g, settings, 2, null), false, 'no Planechase, no planar die')
  assert.equal(mayUsePlanes(g, { ...settings, turnTracker: false }, 2, plane), true)
  assert.equal(mayUsePlanes(g, { ...settings, turnTracker: true }, 2, plane), false)
  assert.equal(mayUsePlanes(g, { ...settings, turnTracker: true }, g.turnPlayerId, plane), true)
})

test("a new game forgets the old one's holds, casts and announcements", () => {
  let g = play(fresh(), 1, { type: 'hold', on: true })
  g = play(g, 1, { type: 'commanderCast', delta: 1 })
  g = play(g, 1, { type: 'emote', emote: 'wow' })
  g = gameReducer(g, { type: 'new', settings })
  assert.equal(g.hold, null)
  assert.equal(g.announce, null)
  assert.equal(g.players[0].commanderCasts ?? 0, 0)
})

test('the state a remote gets carries the table-wide things', () => {
  let g = play(fresh(), 1, { type: 'monarch', take: true })
  g = play(g, 2, { type: 'dayNight', value: 'DAY' })
  const s = buildRemoteState(g, settings, { name: 'Tazeem', imageUrl: null, left: 3 })
  assert.equal(s.monarch, 1)
  assert.equal(s.dayNight, 'DAY')
  assert.deepEqual(s.plane, { name: 'Tazeem', imageUrl: null, left: 3 })
  assert.equal(s.v, 1, 'still version 1: everything new is optional')
})

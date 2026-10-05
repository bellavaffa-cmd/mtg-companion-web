import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DUNGEONS, dungeonById, dungeonDone, dungeonLayout, dungeonPaths, inDungeon, parseDungeonState, roomOf, venture, ventureOptions,
  type Venture,
} from '../../src/lifecounter/dungeons.ts'

// Dungeons: the four cards' rooms and links, and venturing through them. The Android app has the
// same checks — see DungeonsTest.kt.

test('each dungeon has the rooms of its card', () => {
  const summary = DUNGEONS.map((d) => `${d.id}:${d.rooms.length}:${d.rooms[0].name}>${d.rooms[d.rooms.length - 1].name}`)
  assert.deepEqual(summary, [
    'lost-mine:7:Cave Entrance>Temple of Dumathoin',
    'mad-mage:9:Yawning Portal>Mad Wizard\'s Lair',
    'tomb:5:Trapped Entry>Cradle of the Death God',
    'undercity:9:Secret Entrance>Throne of the Dead Three',
  ])
})

test('every room leads somewhere real, below it, and every way through ends at the last room', () => {
  for (const d of DUNGEONS) {
    const ids = new Set(d.rooms.map((r) => r.id))
    assert.equal(ids.size, d.rooms.length, d.id)
    const reached = new Set<string>([d.rooms[0].id])
    for (const r of d.rooms) {
      for (const n of r.next) {
        assert.ok(ids.has(n), `${d.id}: ${r.id} -> ${n}`)
        assert.ok(roomOf({ dungeon: d.id, room: n })!.row > r.row, `${d.id}: ${n} is below ${r.id}`)
        reached.add(n)
      }
    }
    assert.equal(reached.size, d.rooms.length, `${d.id}: every room can be reached`)
    assert.equal(d.rooms.filter((r) => r.next.length === 0).length, 1, `${d.id}: one last room`)
  }
})

test('the ways through each dungeon', () => {
  const paths = (id: string) => dungeonPaths(dungeonById(id)!).map((p) => p.join(' > '))
  assert.deepEqual(paths('lost-mine'), [
    'cave-entrance > goblin-lair > storeroom > temple-of-dumathoin',
    'cave-entrance > goblin-lair > dark-pool > temple-of-dumathoin',
    'cave-entrance > mine-tunnels > dark-pool > temple-of-dumathoin',
    'cave-entrance > mine-tunnels > fungi-cavern > temple-of-dumathoin',
  ])
  assert.deepEqual(paths('mad-mage').length, 4)
  assert.ok(paths('mad-mage').every((p) => p.split(' > ').length === 7))
  assert.deepEqual(paths('tomb'), [
    'trapped-entry > veils-of-fear > sandfall-cell > cradle-of-the-death-god',
    'trapped-entry > oubliette > cradle-of-the-death-god',
  ])
  assert.deepEqual(paths('undercity'), [
    'secret-entrance > forge > trap > archives > throne-of-the-dead-three',
    'secret-entrance > forge > arena > archives > throne-of-the-dead-three',
    'secret-entrance > forge > arena > catacombs > throne-of-the-dead-three',
    'secret-entrance > lost-well > arena > archives > throne-of-the-dead-three',
    'secret-entrance > lost-well > arena > catacombs > throne-of-the-dead-three',
    'secret-entrance > lost-well > stash > catacombs > throne-of-the-dead-three',
  ])
})

test('a venture starts a dungeon, Undercity only by venturing into it', () => {
  assert.deepEqual(ventureOptions(null, false), ['lost-mine', 'mad-mage', 'tomb'])
  assert.deepEqual(ventureOptions(null, true), ['undercity'])
  const none: Venture = { dungeon: null, completed: 0 }
  assert.equal(venture(none, 'undercity'), null)
  assert.deepEqual(venture(none, 'undercity', true), { dungeon: { dungeon: 'undercity', room: 'secret-entrance' }, completed: 0 })
  assert.deepEqual(venture(none, 'tomb'), { dungeon: { dungeon: 'tomb', room: 'trapped-entry' }, completed: 0 })
  assert.equal(venture(none, 'trapped-entry'), null)
})

test('venturing moves to a room below, and the last room completes the dungeon', () => {
  let v: Venture = venture({ dungeon: null, completed: 2 }, 'tomb')!
  assert.deepEqual(ventureOptions(v.dungeon, false), ['veils-of-fear', 'oubliette'])
  assert.equal(venture(v, 'sandfall-cell'), null, 'no skipping rooms')
  assert.equal(venture(v, 'cradle-of-the-death-god'), null)
  v = venture(v, 'oubliette')!
  assert.ok(inDungeon(v.dungeon))
  assert.equal(v.completed, 2)
  v = venture(v, 'cradle-of-the-death-god')!
  assert.equal(v.completed, 3)
  assert.ok(dungeonDone(v.dungeon))
  assert.ok(!inDungeon(v.dungeon))
  // A completed dungeon: the next venture starts a new one.
  assert.deepEqual(ventureOptions(v.dungeon, false), ['lost-mine', 'mad-mage', 'tomb'])
  v = venture(v, 'lost-mine')!
  assert.deepEqual(v, { dungeon: { dungeon: 'lost-mine', room: 'cave-entrance' }, completed: 3 })
})

test('venturing into Undercity while in another dungeon moves on in that one', () => {
  const v = venture({ dungeon: null, completed: 0 }, 'mad-mage')!
  assert.deepEqual(ventureOptions(v.dungeon, true), ['dungeon-level'])
  assert.deepEqual(venture(v, 'dungeon-level', true)!.dungeon, { dungeon: 'mad-mage', room: 'dungeon-level' })
  assert.equal(venture(v, 'undercity', true), null)
})

test('a dungeon from the wire is kept only when it names a real room', () => {
  assert.deepEqual(parseDungeonState({ id: 'undercity', room: 'arena' }), { dungeon: 'undercity', room: 'arena' })
  assert.deepEqual(parseDungeonState({ dungeon: 'tomb', room: 'oubliette' }), { dungeon: 'tomb', room: 'oubliette' })
  assert.equal(parseDungeonState({ id: 'undercity', room: 'oubliette' }), null)
  assert.equal(parseDungeonState({ id: 'nowhere', room: 'arena' }), null)
  assert.equal(parseDungeonState('arena'), null)
  assert.equal(parseDungeonState(null), null)
})

test('the map spaces each row across the card', () => {
  const layout = dungeonLayout(dungeonById('undercity')!)
  const at = (id: string) => layout.find((l) => l.id === id)!
  assert.deepEqual([at('secret-entrance').x, at('secret-entrance').row], [0.5, 0])
  assert.deepEqual([at('trap').x, at('arena').x, at('stash').x], [0.25, 0.5, 0.75])
  const tomb = dungeonLayout(dungeonById('tomb')!).find((l) => l.id === 'oubliette')!
  assert.deepEqual([tomb.x, tomb.row], [0.7, 1.5])
})

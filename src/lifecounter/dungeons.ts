// Dungeons and venturing: the four dungeon cards as small maps of rooms, and where a player's venture
// marker can go next. Pure: no state of its own. Mirrors the Android app's
// ui/lifecounter/Dungeons.kt — the same ids, room names, texts and links, so the remote protocol's
// {"dungeon":{"id":…,"room":…}} means the same room on both.
//
// The rules (CR 309, 701.49): to venture into the dungeon, a player who isn't in one picks Lost Mine
// of Phandelver, Dungeon of the Mad Mage or Tomb of Annihilation and enters its first room; one who
// is moves to a room joined below the one they're in. Undercity is entered only by venturing into
// Undercity (taking the initiative, and the upkeep of whoever holds it) — and venturing into
// Undercity while already in a dungeon moves on in that one instead. Reaching the last room
// completes the dungeon; the next venture starts a new one.

export type DungeonId = 'lost-mine' | 'mad-mage' | 'tomb' | 'undercity'

export interface DungeonRoom {
  id: string
  name: string
  /** The room's ability, as printed (reminder text left out). */
  text: string
  /** How far down the card the room is, from 0 (Oubliette, spanning two rows, is 1.5). */
  row: number
  /** The rooms joined below it; none for the last room. */
  next: string[]
  /** Where it sits across the card, 0 to 1, when it isn't simply spaced along its row. */
  x?: number
}

export interface Dungeon {
  id: DungeonId
  name: string
  rooms: DungeonRoom[]
}

/** Where a player's venture marker is. */
export interface DungeonState {
  dungeon: DungeonId
  room: string
}

const room = (id: string, name: string, row: number, text: string, next: string[] = [], x?: number): DungeonRoom =>
  (x === undefined ? { id, name, text, row, next } : { id, name, text, row, next, x })

export const DUNGEONS: Dungeon[] = [
  {
    id: 'lost-mine',
    name: 'Lost Mine of Phandelver',
    rooms: [
      room('cave-entrance', 'Cave Entrance', 0, 'Scry 1.', ['goblin-lair', 'mine-tunnels']),
      room('goblin-lair', 'Goblin Lair', 1, 'Create a 1/1 red Goblin creature token.', ['storeroom', 'dark-pool']),
      room('mine-tunnels', 'Mine Tunnels', 1, 'Create a Treasure token.', ['dark-pool', 'fungi-cavern']),
      room('storeroom', 'Storeroom', 2, 'Put a +1/+1 counter on target creature.', ['temple-of-dumathoin']),
      room('dark-pool', 'Dark Pool', 2, 'Each opponent loses 1 life and you gain 1 life.', ['temple-of-dumathoin']),
      room('fungi-cavern', 'Fungi Cavern', 2, 'Target creature gets -4/-0 until your next turn.', ['temple-of-dumathoin']),
      room('temple-of-dumathoin', 'Temple of Dumathoin', 3, 'Draw a card.'),
    ],
  },
  {
    id: 'mad-mage',
    name: 'Dungeon of the Mad Mage',
    rooms: [
      room('yawning-portal', 'Yawning Portal', 0, 'You gain 1 life.', ['dungeon-level']),
      room('dungeon-level', 'Dungeon Level', 1, 'Scry 1.', ['goblin-bazaar', 'twisted-caverns']),
      room('goblin-bazaar', 'Goblin Bazaar', 2, 'Create a Treasure token.', ['lost-level']),
      room('twisted-caverns', 'Twisted Caverns', 2, "Target creature can't attack until your next turn.", ['lost-level']),
      room('lost-level', 'Lost Level', 3, 'Scry 2.', ['runestone-caverns', 'muirals-graveyard']),
      room('runestone-caverns', 'Runestone Caverns', 4, 'Exile the top two cards of your library. You may play them.', ['deep-mines']),
      room('muirals-graveyard', "Muiral's Graveyard", 4, 'Create two 1/1 black Skeleton creature tokens.', ['deep-mines']),
      room('deep-mines', 'Deep Mines', 5, 'Scry 3.', ['mad-wizards-lair']),
      room('mad-wizards-lair', "Mad Wizard's Lair", 6, 'Draw three cards and reveal them. You may cast one of them without paying its mana cost.'),
    ],
  },
  {
    id: 'tomb',
    name: 'Tomb of Annihilation',
    rooms: [
      room('trapped-entry', 'Trapped Entry', 0, 'Each player loses 1 life.', ['veils-of-fear', 'oubliette']),
      // The card's right-hand path skips a row: Oubliette sits beside Veils of Fear and Sandfall Cell.
      room('veils-of-fear', 'Veils of Fear', 1, 'Each player loses 2 life unless they discard a card.', ['sandfall-cell'], 0.3),
      room('sandfall-cell', 'Sandfall Cell', 2, 'Each player loses 2 life unless they sacrifice an artifact, a creature, or a land.', ['cradle-of-the-death-god'], 0.3),
      room('oubliette', 'Oubliette', 1.5, 'Discard a card and sacrifice an artifact, a creature, and a land.', ['cradle-of-the-death-god'], 0.7),
      room('cradle-of-the-death-god', 'Cradle of the Death God', 3, 'Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.'),
    ],
  },
  {
    id: 'undercity',
    name: 'Undercity',
    rooms: [
      room('secret-entrance', 'Secret Entrance', 0, 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.', ['forge', 'lost-well']),
      room('forge', 'Forge', 1, 'Put two +1/+1 counters on target creature.', ['trap', 'arena']),
      room('lost-well', 'Lost Well', 1, 'Scry 2.', ['arena', 'stash']),
      room('trap', 'Trap!', 2, 'Target player loses 5 life.', ['archives']),
      room('arena', 'Arena', 2, 'Goad target creature.', ['archives', 'catacombs']),
      room('stash', 'Stash', 2, 'Create a Treasure token.', ['catacombs']),
      room('archives', 'Archives', 3, 'Draw a card.', ['throne-of-the-dead-three']),
      room('catacombs', 'Catacombs', 3, 'Create a 4/1 black Skeleton creature token with menace.', ['throne-of-the-dead-three']),
      room(
        'throne-of-the-dead-three', 'Throne of the Dead Three', 4,
        'Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Then shuffle.',
      ),
    ],
  },
]

/** The dungeons a plain "venture into the dungeon" may start: all but Undercity. */
export const VENTURE_DUNGEONS: DungeonId[] = ['lost-mine', 'mad-mage', 'tomb']

export const dungeonById = (id: unknown): Dungeon | null => DUNGEONS.find((d) => d.id === id) ?? null

export function roomOf(state: DungeonState | null | undefined): DungeonRoom | null {
  if (!state) return null
  return dungeonById(state.dungeon)?.rooms.find((r) => r.id === state.room) ?? null
}

/** Whether [state] is a dungeon's last room: the dungeon is completed. */
export const dungeonDone = (state: DungeonState | null | undefined) => {
  const r = roomOf(state)
  return r != null && r.next.length === 0
}

/** In a dungeon and not yet at its end. */
export const inDungeon = (state: DungeonState | null | undefined) => roomOf(state) != null && !dungeonDone(state)

/**
 * Where a venture can go from [state]: room ids below the current room while in a dungeon, else the
 * dungeons that can be started — Undercity alone when [intoUndercity], the other three otherwise.
 */
export function ventureOptions(state: DungeonState | null | undefined, intoUndercity: boolean): string[] {
  if (inDungeon(state)) return roomOf(state)!.next
  return intoUndercity ? ['undercity'] : [...VENTURE_DUNGEONS]
}

/** A player's venture marker and how many dungeons they've completed this game. */
export interface Venture {
  dungeon: DungeonState | null
  completed: number
}

/**
 * [v] after venturing to [to] (a room id, or a dungeon id when starting one), or null when that
 * isn't a place this venture can go. Entering a dungeon's last room completes it.
 */
export function venture(v: Venture, to: string, intoUndercity = false): Venture | null {
  if (!ventureOptions(v.dungeon, intoUndercity).includes(to)) return null
  if (inDungeon(v.dungeon)) {
    const next: DungeonState = { dungeon: v.dungeon!.dungeon, room: to }
    return { dungeon: next, completed: v.completed + (dungeonDone(next) ? 1 : 0) }
  }
  const d = dungeonById(to)!
  return { dungeon: { dungeon: d.id, room: d.rooms[0].id }, completed: v.completed }
}

/** A dungeon state read from storage or the wire: null unless it names a real room. */
export function parseDungeonState(raw: unknown): DungeonState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const state = { dungeon: o.id ?? o.dungeon, room: o.room } as DungeonState
  return roomOf(state) ? { dungeon: state.dungeon, room: state.room } : null
}

/** A completed-dungeons count read from storage or the wire: a whole number from 0 to 99. */
export const cleanCompleted = (raw: unknown) => (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? Math.min(raw, 99) : 0)

/** Every way through [dungeon], first room to last, as room ids. */
export function dungeonPaths(dungeon: Dungeon): string[][] {
  const byId = new Map(dungeon.rooms.map((r) => [r.id, r]))
  const walk = (id: string): string[][] => {
    const r = byId.get(id)!
    return r.next.length === 0 ? [[id]] : r.next.flatMap((n) => walk(n).map((p) => [id, ...p]))
  }
  return walk(dungeon.rooms[0].id)
}

/** Where each room sits on a small map: [x] from 0 to 1 across its row, [row] down the card. */
export function dungeonLayout(dungeon: Dungeon): { id: string; x: number; row: number }[] {
  const rows = new Map<number, string[]>()
  for (const r of dungeon.rooms) rows.set(r.row, [...(rows.get(r.row) ?? []), r.id])
  // Rows read left to right in the order the card lists them.
  return dungeon.rooms.map((r) => {
    const inRow = rows.get(r.row)!
    return { id: r.id, x: r.x ?? (inRow.indexOf(r.id) + 1) / (inRow.length + 1), row: r.row }
  })
}

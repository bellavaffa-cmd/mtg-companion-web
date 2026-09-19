import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TABLE_GAMES_KEPT, meResultOf, withTableGame, type TableGame } from '../../src/lifecounter/tableGames.ts'
import { DEFAULT_SETTINGS, gameReducer, newGame } from '../../src/lifecounter/game.ts'

// The games a table keeps, the table owner's result saved to their deck, and a seat's commander set
// at the table. The Android app has the same checks — see TableGamesTest.kt.

const game = (id: string, at: number, winner: number | null = 1): TableGame => ({
  id, endedAt: at, turns: 9, minutes: 42, winnerSeat: winner,
  players: [
    { seat: 1, name: 'Me', commander: 'Omnath, Locus of Mana', out: winner === 1 ? null : 'LIFE', me: true },
    { seat: 2, name: 'Bob', commander: "Atraxa, Praetors' Voice", out: winner === 2 ? null : 'LIFE', me: false },
    { seat: 3, name: 'Carol', commander: null, out: 'POISON', me: false },
  ],
})

test('the table keeps each game once, newest first', () => {
  let games: TableGame[] = []
  games = withTableGame(games, game('a', 1))
  games = withTableGame(games, game('b', 2))
  // An undo that changes how "a" ended replaces it.
  games = withTableGame(games, game('a', 3, 2))
  assert.deepEqual(games.map((g) => g.id), ['a', 'b'])
  assert.equal(games[0].winnerSeat, 2)
  let many: TableGame[] = []
  for (let i = 1; i <= 60; i++) many = withTableGame(many, game(`g${i}`, i))
  assert.equal(many.length, TABLE_GAMES_KEPT)
})

test("the owner's seat is saved to their deck only without a phone there", () => {
  const won = meResultOf(game('a', 5), 1, false)!
  assert.equal(won.id, 'table-a')
  assert.equal(won.result, 'WIN')
  assert.equal(won.opponent, 'Bob, Carol')
  assert.deepEqual(won.commanders, ["Atraxa, Praetors' Voice"])
  assert.equal(won.turns, 9)
  assert.equal(won.minutes, 42)
  assert.equal(meResultOf(game('a', 5, 2), 1, false)!.result, 'LOSS')
  assert.equal(meResultOf(game('a', 5, null), 1, false)!.result, 'DRAW')
  // The safeguard: a phone that joined the seat saves the game itself.
  assert.equal(meResultOf(game('a', 5), 1, true), null)
  assert.equal(meResultOf(game('a', 5), null, false), null)
  assert.equal(meResultOf(game('a', 5), 7, false), null)
})

test("a seat's commander set at the table, its art behind a bare tile", () => {
  const art = 'https://cards.scryfall.io/art_crop/front/a/b/x.jpg'
  const seat = (g: ReturnType<typeof newGame>) => g.players.find((p) => p.id === 1)!
  let g = gameReducer(newGame(DEFAULT_SETTINGS), { type: 'seatCommander', id: 1, name: 'Krenko, Mob Boss', art })
  assert.equal(seat(g).commander, 'Krenko, Mob Boss')
  assert.equal(seat(g).background, art)
  // A new commander's art follows, while the old one's is still there…
  const art2 = 'https://cards.scryfall.io/art_crop/front/c/d/y.jpg'
  g = gameReducer(g, { type: 'seatCommander', id: 1, name: 'Edgar Markov', art: art2 })
  assert.equal(seat(g).background, art2)
  // …but not over a picture chosen for the tile.
  const gif = 'https://media.giphy.com/media/abc/giphy.gif'
  g = gameReducer(g, { type: 'background', id: 1, url: gif })
  g = gameReducer(g, { type: 'seatCommander', id: 1, name: 'Krenko, Mob Boss', art })
  assert.equal(seat(g).background, gif)
  // A seat someone joined from a phone is theirs to set.
  g = gameReducer(g, { type: 'link', id: 2, player: { userId: 'b', username: 'bob', displayName: 'Bob', avatarPath: null } })
  g = gameReducer(g, { type: 'seatCommander', id: 2, name: 'Atraxa', art })
  assert.equal(g.players.find((p) => p.id === 2)!.commander ?? null, null)
})

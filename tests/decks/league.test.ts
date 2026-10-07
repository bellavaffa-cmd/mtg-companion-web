import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEAGUE_PRESETS, PRESET_CUSTOM, PRESET_EVERYONE, PRESET_WINS, DEFAULT_RULES,
  canManageSeason, championLine, championNames, gamePoints, leaguePodFor, nextSeasonName, parseRules, parseSeasons,
  rulesJson, rulesSummary, seasonDays, seasonEndedAt, seasonGames, seasonProblem, seasonStatus, seasonTable, standingsJson, streakOf,
  type LeagueRules, type Season,
} from '../../src/decks/league.ts'
import { podGameProblem, type PodGame, type PodPlayer } from '../../src/decks/podStats.ts'
import { nightPodPlayers, nightResultId, type NightPlayer, type NightPod } from '../../src/lifecounter/gameNight.ts'

// League mode: points, the table and its tie-breaks, game nights, and a season ending. The Android
// app has the same checks — see LeagueTest.kt and NightLeagueTest.kt.

const PRIYA = '11111111-1111-1111-1111-111111111111'
const SAM = '22222222-2222-2222-2222-222222222222'

/** October [day] 2026 at [hour] UTC. */
const at = (day: number, hour = 20) => Date.UTC(2026, 9, day) + hour * 3_600_000

const seat = (name: string, result: PodPlayer['result'], o: { userId?: string; deck?: string; place?: number; firstBlood?: boolean } = {}): PodPlayer =>
  ({ userId: o.userId ?? null, name, commander: null, deck: o.deck ?? null, result, place: o.place ?? null, firstBlood: o.firstBlood ?? false })

let n = 0
const game = (playedAt: number, ...players: PodPlayer[]): PodGame => {
  n++
  return { id: `g${n}`, clientId: `c${n}`, recordedBy: PRIYA, playedAt, format: 'COMMANDER', turns: null, minutes: null, players }
}
const reset = () => { n = 0 }

const season = (o: Partial<Season> = {}): Season => ({
  id: 's1', podId: 'pod', name: 'Season 1', startsOn: '2026-10-01', endsOn: null, maxNights: null, rules: DEFAULT_RULES,
  createdBy: PRIYA, createdAt: 0, endedAt: null, champion: null, standings: null, ...o,
})
const custom = (o: Partial<LeagueRules>): LeagueRules => ({ preset: PRESET_CUSTOM, win: 3, second: 0, draw: 0, played: 0, firstBlood: 0, newDeckWin: 0, ...o })
const preset = (id: string) => LEAGUE_PRESETS.find((p) => p.id === id)!.rules

test('points for a win, second place, first blood and a draw', () => {
  const r = DEFAULT_RULES
  assert.equal(gamePoints(seat('A', 'WIN'), r), 3)
  assert.equal(gamePoints(seat('A', 'LOSS'), r), 0)
  assert.equal(gamePoints(seat('A', 'LOSS', { place: 2 }), r), 1)
  assert.equal(gamePoints(seat('A', 'LOSS', { place: 2, firstBlood: true }), r), 2)
  assert.equal(gamePoints(seat('A', 'DRAW'), r), 1)
  // Second place is for the loser who came second; the winner's place 1 adds nothing.
  assert.equal(gamePoints(seat('A', 'WIN', { place: 1 }), r), 3)
  assert.equal(gamePoints(seat('A', 'WIN'), preset(PRESET_EVERYONE), true), 5)
  assert.equal(gamePoints(seat('A', 'LOSS'), preset(PRESET_EVERYONE)), 1)
  assert.equal(gamePoints(seat('A', 'WIN', { firstBlood: true }), preset(PRESET_WINS)), 1)
  assert.equal(gamePoints(seat('A', 'LOSS', { place: 2, firstBlood: true }), preset(PRESET_WINS)), 0)
})

test('the table ranks by points, then wins, then win rate', () => {
  reset()
  const games = [
    game(at(2), seat('Priya', 'WIN', { userId: PRIYA }), seat('Sam', 'LOSS', { userId: SAM, place: 2 }), seat('Dan', 'LOSS')),
    game(at(2, 21), seat('Priya', 'LOSS', { userId: PRIYA }), seat('Sam', 'WIN', { userId: SAM }), seat('Dan', 'LOSS', { place: 2, firstBlood: true })),
    game(at(3), seat('Priya', 'WIN', { userId: PRIYA }), seat('Dan', 'LOSS')),
  ]
  const t = seasonTable(season(), games, true)
  assert.deepEqual(t.standings.map((s) => [s.name, s.points]), [['Priya', 6], ['Sam', 4], ['Dan', 2]])
  assert.deepEqual(t.standings.map((s) => s.rank), [1, 2, 3])
  const p = t.standings[0]
  assert.deepEqual([p.games, p.wins, p.losses, p.draws], [3, 2, 1, 0])
  assert.equal(p.streak, 'W1')
  assert.equal(t.standings[1].streak, 'W1')
  assert.equal(t.standings[2].streak, 'L3')
  assert.equal(t.standings[2].firstBloods, 1)
  assert.equal(t.standings[1].seconds, 1)
  assert.deepEqual(t.champions, [p])
})

test('ties break on wins, then win rate, and a full tie shares the title', () => {
  reset()
  const level = seasonTable(
    season({ rules: custom({ win: 2, second: 2 }) }),
    [
      game(at(2), seat('Ann', 'WIN'), seat('Ben', 'LOSS', { place: 2 })),
      game(at(3), seat('Ben', 'LOSS', { place: 2 }), seat('Cat', 'WIN'), seat('Ann', 'LOSS')),
    ],
    true,
  )
  // Ben 4 with no wins; Cat and Ann 2 with a win each — Cat's better win rate first.
  assert.deepEqual(level.standings.map((s) => s.name), ['Ben', 'Cat', 'Ann'])
  assert.deepEqual(level.standings.map((s) => s.rank), [1, 2, 3])

  const tied = seasonTable(season(), [game(at(2), seat('Zed', 'WIN'), seat('Amy', 'LOSS')), game(at(3), seat('Amy', 'WIN'), seat('Zed', 'LOSS'))], true)
  assert.deepEqual(tied.standings.map((s) => s.name), ['Amy', 'Zed'])
  assert.deepEqual(tied.standings.map((s) => s.rank), [1, 1])
  assert.equal(championNames(tied.champions), 'Amy & Zed')
  assert.equal(championLine('Season 1', championNames(tied.champions)), 'Season 1 champions: Amy & Zed')
  assert.equal(championLine('Season 1', 'Priya'), 'Season 1 champion: Priya')
  assert.equal(championLine('Season 1', null), null)
})

test('a shared rank skips the next places', () => {
  reset()
  const t = seasonTable(season(), [
    game(at(2), seat('A', 'WIN'), seat('B', 'LOSS'), seat('C', 'LOSS')),
    game(at(3), seat('B', 'WIN'), seat('A', 'LOSS'), seat('C', 'LOSS')),
  ], true)
  assert.deepEqual(t.standings.map((s) => s.rank), [1, 1, 3])
})

test("only the season's days count", () => {
  reset()
  const games = [
    game(at(1, 10), seat('A', 'WIN'), seat('B', 'LOSS')),
    game(at(5), seat('A', 'WIN'), seat('B', 'LOSS')),
    game(at(10), seat('B', 'WIN'), seat('A', 'LOSS')),
    game(at(12), seat('B', 'WIN'), seat('A', 'LOSS')),
  ]
  assert.equal(seasonGames(season(), games, true).length, 4)
  assert.deepEqual(seasonGames(season({ startsOn: '2026-10-02', endsOn: '2026-10-10' }), games, true).map((g) => g.id), ['g2', 'g3'])
  // Ended: games after it don't count.
  assert.equal(seasonGames(season({ endedAt: at(5, 23) }), games, true).length, 2)
  // Until 3 game nights: the first three nights only.
  const three = seasonTable(season({ maxNights: 3 }), games, true)
  assert.deepEqual(three.nights, ['2026-10-01', '2026-10-05', '2026-10-10'])
  assert.equal(three.games.length, 3)
})

test('a season is upcoming, running, over or ended', () => {
  reset()
  const games = [game(at(2), seat('A', 'WIN'), seat('B', 'LOSS')), game(at(4), seat('A', 'WIN'), seat('B', 'LOSS'))]
  assert.equal(seasonStatus(season({ startsOn: '2026-10-08' }), games, '2026-10-07', true), 'UPCOMING')
  assert.equal(seasonStatus(season({ endsOn: '2026-10-31' }), games, '2026-10-31', true), 'RUNNING')
  assert.equal(seasonStatus(season({ endsOn: '2026-10-31' }), games, '2026-11-01', true), 'OVER')
  // Two game nights of two: still running on the second night, over the day after.
  assert.equal(seasonStatus(season({ maxNights: 2 }), games, '2026-10-04', true), 'RUNNING')
  assert.equal(seasonStatus(season({ maxNights: 2 }), games, '2026-10-05', true), 'OVER')
  assert.equal(seasonStatus(season({ maxNights: 3 }), games, '2026-10-20', true), 'RUNNING')
  assert.equal(seasonStatus(season({ endedAt: at(5) }), games, '2026-10-05', true), 'ENDED')
  assert.equal(seasonStatus(season(), games, '2027-01-01', true), 'RUNNING')
})

test('an over season ends at the end of its last day', () => {
  reset()
  const games = [game(at(2), seat('A', 'WIN'), seat('B', 'LOSS')), game(at(4), seat('A', 'WIN'), seat('B', 'LOSS'))]
  const byDate = season({ endsOn: '2026-10-31' })
  assert.equal(seasonEndedAt(byDate, seasonTable(byDate, games, true), at(20, 0) + 40 * 86_400_000, true), Date.UTC(2026, 10, 1) - 1)
  const byNights = season({ maxNights: 2 })
  assert.equal(seasonEndedAt(byNights, seasonTable(byNights, games, true), at(9), true), Date.UTC(2026, 9, 5) - 1)
  // Never later than now.
  assert.equal(seasonEndedAt(byNights, seasonTable(byNights, games, true), at(3), true), at(3))
})

test('streaks count the newest run', () => {
  assert.equal(streakOf([]), '')
  assert.equal(streakOf(['LOSS', 'WIN', 'WIN', 'WIN']), 'W3')
  assert.equal(streakOf(['WIN', 'LOSS', 'LOSS']), 'L2')
  assert.equal(streakOf(['WIN', 'DRAW']), 'D1')
})

test('a win with a new deck earns its bonus', () => {
  reset()
  const games = [
    // Before the season: Priya played Krenko.
    game(Date.UTC(2026, 8, 20), seat('Priya', 'LOSS', { userId: PRIYA, deck: 'Krenko' }), seat('Sam', 'WIN', { userId: SAM, deck: 'Edgar' })),
    game(at(2), seat('Priya', 'WIN', { userId: PRIYA, deck: 'krenko ' }), seat('Sam', 'LOSS', { userId: SAM, deck: 'Edgar' })),
    game(at(3), seat('Priya', 'WIN', { userId: PRIYA, deck: 'Atraxa' }), seat('Sam', 'LOSS', { userId: SAM, deck: 'Edgar' })),
    // No deck recorded: no bonus.
    game(at(4), seat('Sam', 'WIN', { userId: SAM }), seat('Priya', 'LOSS', { userId: PRIYA, deck: 'Atraxa' })),
  ]
  const t = seasonTable(season({ rules: custom({ win: 3, newDeckWin: 2 }) }), games, true)
  const p = t.standings.find((s) => s.userId === PRIYA)!
  assert.equal(p.newDeckWins, 1)
  assert.equal(p.points, 8)
  assert.equal(t.standings.find((s) => s.userId === SAM)!.points, 3)
})

test('points per game night, newest first', () => {
  reset()
  const t = seasonTable(season(), [
    game(at(2), seat('A', 'WIN'), seat('B', 'LOSS', { place: 2 })),
    game(at(2, 22), seat('B', 'WIN'), seat('A', 'LOSS')),
    game(at(9), seat('A', 'WIN'), seat('C', 'LOSS')),
  ], true)
  assert.deepEqual(t.perNight.map((x) => x.night), ['2026-10-09', '2026-10-02'])
  assert.deepEqual(t.perNight.map((x) => x.games), [1, 2])
  assert.deepEqual(t.perNight[1].scores.map((s) => [s.name, s.points]), [['B', 4], ['A', 3]])
})

test('a member is one player under their newest name, and a guest is known by name', () => {
  reset()
  const t = seasonTable(season(), [
    game(at(2), seat('Pri', 'WIN', { userId: PRIYA }), seat('carol', 'LOSS')),
    game(at(3), seat('Priya', 'WIN', { userId: PRIYA }), seat(' Carol ', 'LOSS')),
  ], true)
  assert.deepEqual(t.standings.map((s) => [s.name, s.games]), [['Priya', 2], ['Carol', 2]])
})

test('a season with no games has no champion', () => {
  const t = seasonTable(season(), [], true)
  assert.deepEqual(t.champions, [])
  assert.equal(championNames(t.champions), null)
})

test('rules in words, and presets', () => {
  assert.equal(rulesSummary(LEAGUE_PRESETS[0].rules), 'Win 3 · Second 1 · Draw 1 · First blood +1')
  assert.equal(rulesSummary(LEAGUE_PRESETS[1].rules), 'Win 1')
  assert.equal(rulesSummary(LEAGUE_PRESETS[2].rules), 'Win 3 · Second 1 · Draw 1 · Playing 1 · First blood +1 · Win with a new deck +1')
})

test('checks before saving', () => {
  assert.equal(seasonProblem(' ', '2026-10-01', null, null), 'Give the season a name.')
  assert.equal(seasonProblem('S', '2026-10-05', '2026-10-01', null), 'It has to end after it starts.')
  assert.equal(seasonProblem('S', '2026-10-05', null, 0), 'A season runs for 1 to 100 game nights.')
  assert.equal(seasonProblem('S', '', null, null), 'Pick the day it starts.')
  assert.equal(seasonProblem('Season 1', '2026-10-01', '2026-10-01', null), null)
  assert.equal(seasonDays(season({ endsOn: '2026-12-31' })), '1 Oct – 31 Dec')
  assert.equal(seasonDays(season({ maxNights: 8 })), 'From 1 Oct, for 8 game nights')
  assert.equal(seasonDays(season()), 'From 1 Oct')
  assert.equal(nextSeasonName([season(), season()]), 'Season 3')
})

test("the league for a game night is the pod with most of tonight's players", () => {
  const pods: [string, string[]][] = [['a', [PRIYA]], ['b', [PRIYA, SAM]]]
  assert.equal(leaguePodFor(pods, new Set([PRIYA, SAM])), 'b')
  assert.equal(leaguePodFor(pods, new Set([PRIYA])), 'a')
  assert.equal(leaguePodFor([], new Set([PRIYA])), null)
})

test('seasons and their final tables read back as sent', () => {
  reset()
  const t = seasonTable(season(), [game(at(2), seat('Priya', 'WIN', { userId: PRIYA }), seat('Dan', 'LOSS'))], true)
  const raw = JSON.parse(JSON.stringify([{
    id: 's9', podId: 'pod', name: 'Season 2', startsOn: '2026-10-01', endsOn: null, maxNights: 6, rules: rulesJson(LEAGUE_PRESETS[2].rules),
    createdBy: PRIYA, createdAt: 5, endedAt: 99, champion: 'Priya', standings: standingsJson(t.standings),
  }]))
  const [s] = parseSeasons(raw)
  assert.deepEqual(s.rules, LEAGUE_PRESETS[2].rules)
  assert.equal(s.maxNights, 6)
  assert.equal(s.endsOn, null)
  assert.equal(s.endedAt, 99)
  assert.deepEqual(s.standings, t.standings.map((x) => ({ ...x, firstBloods: 0, seconds: 0, newDeckWins: 0 })))
  assert.deepEqual(parseSeasons([]), [])
  // Rules missing a value take Standard's; out-of-range ones are held to 0–10.
  assert.deepEqual(parseRules({ win: 50 }), { ...DEFAULT_RULES, preset: PRESET_CUSTOM, win: 10 })
})

test("a season is changed by whoever started it or the pod's owner", () => {
  assert.equal(canManageSeason(season(), PRIYA, SAM), true)
  assert.equal(canManageSeason(season(), SAM, SAM), true)
  assert.equal(canManageSeason(season(), SAM, 'someone'), false)
})

test('only one player draws first blood', () => {
  assert.equal(podGameProblem([seat('A', 'WIN', { firstBlood: true }), seat('B', 'LOSS', { firstBlood: true })]), 'Only one player can draw first blood.')
  assert.equal(podGameProblem([seat('A', 'WIN', { firstBlood: true }), seat('B', 'LOSS', { place: 2 })]), null)
})

test("a game night pod's result becomes a pod game for the league", () => {
  const players: NightPlayer[] = [
    { id: 'p1', name: 'Priya', kind: 'ME', deck: 'Atraxa deck', commander: 'Atraxa', bracket: null },
    { id: 'p2', name: 'Sam', kind: 'FRIEND', userId: SAM, deck: null, commander: null, bracket: null },
    { id: 'p3', name: ' Dan ', kind: 'GUEST', deck: null, commander: 'Krenko', bracket: null },
  ]
  const pod: NightPod = { id: '1-1', playerIds: ['p1', 'p2', 'p3'], startedAt: null, winnerId: null }
  const seats = nightPodPlayers(pod, players, { winnerId: 'p2', fromTable: false }, PRIYA)!
  assert.deepEqual(seats.map((s) => s.userId), [PRIYA, SAM, null])
  assert.deepEqual(seats.map((s) => s.name), ['Priya', 'Sam', 'Dan'])
  assert.deepEqual(seats.map((s) => s.result), ['LOSS', 'WIN', 'LOSS'])
  assert.deepEqual(seats.map((s) => s.commander), ['Atraxa', null, 'Krenko'])
  assert.deepEqual(seats.map((s) => s.deck), ['Atraxa deck', null, null])
  assert.deepEqual(nightPodPlayers(pod, players, { winnerId: null, fromTable: true }, PRIYA)!.map((s) => s.result), ['DRAW', 'DRAW', 'DRAW'])
  assert.equal(nightPodPlayers(pod, players, null, PRIYA), null)
  assert.equal(nightPodPlayers({ id: 'x', playerIds: ['p1'] }, players, { winnerId: 'p1', fromTable: false }, PRIYA), null)
  assert.equal(nightResultId('n1', pod.id), 'night-n1-1-1')
})

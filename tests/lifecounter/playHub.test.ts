import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventsStatus, gameNightStatus, lastPlayersLine, playgroupStatus, startGameLine } from '../../src/lifecounter/playHub.ts'

// The Play tab's status lines. The Android app has the same checks — see PlayHubTest.kt.

test('the start card names the table a game starts with', () => {
  assert.equal(startGameLine(4, 40), '4 players · 40 life')
  assert.equal(startGameLine(1, 20), '1 player · 20 life')
})

test('the last game names up to three players, then counts the rest', () => {
  assert.equal(lastPlayersLine([]), null)
  assert.equal(lastPlayersLine(['  ']), null)
  assert.equal(lastPlayersLine(['Sam']), 'Last game: Sam')
  assert.equal(lastPlayersLine(['Sam', 'Alex']), 'Last game: Sam and Alex')
  assert.equal(lastPlayersLine(['Sam', 'Alex', 'Jo']), 'Last game: Sam, Alex and Jo')
  assert.equal(lastPlayersLine(['Sam', 'Alex', 'Jo', 'Kim', 'Lee']), 'Last game: Sam, Alex and 3 more')
})

test("game night says tonight's players and pods, or last time's", () => {
  assert.equal(gameNightStatus(0, 0, false), 'Fair pods by power')
  assert.equal(gameNightStatus(0, 0, true), 'Fair pods by power')
  assert.equal(gameNightStatus(5, 0, false), 'Tonight: 5 players')
  assert.equal(gameNightStatus(7, 2, false), 'Tonight: 7 players · 2 pods')
  assert.equal(gameNightStatus(1, 1, false), 'Tonight: 1 player · 1 pod')
  assert.equal(gameNightStatus(7, 2, true), 'Last time: 7 players')
})

test('playgroup counts games and names the nemesis', () => {
  assert.equal(playgroupStatus(0, null), 'No games yet')
  assert.equal(playgroupStatus(1, null), '1 game')
  assert.equal(playgroupStatus(12, 'Sam'), '12 games · nemesis Sam')
})

test('events say how many are running', () => {
  assert.equal(eventsStatus(0, 0), 'Swiss or Commander pods')
  assert.equal(eventsStatus(1, 3), '1 event running')
  assert.equal(eventsStatus(2, 2), '2 events running')
  assert.equal(eventsStatus(0, 1), '1 event')
  assert.equal(eventsStatus(0, 3), '3 events')
})

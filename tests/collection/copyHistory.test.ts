import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addedMove, appendMoves, checkedMove, KEEP_MOVES_MS, lentMove, MAX_MOVES, moveDay, movedMove, movesOfCard, movesOfPlace, pruneMoves,
  pulledMove, putAwayMove, putBackMove, returnedMove, type CopyMove,
} from '../../src/collection/copyHistory.ts'

// A copy's history, kept on the device for a year — the same on both apps. The Android app has the same
// checks — see CopyHistoryTest.kt.

const NOW = 1_790_000_000_000
const DAY = 86_400_000
const ring = { name: 'Sol Ring', scryfallId: 'sol' }
const red = { id: 'red', name: 'Red box' }
const rares = { id: 'rares', name: 'Rares binder' }

test('the words for each move', () => {
  const words = (m: CopyMove) => `${m.title} | ${m.detail ?? ''} | ${(m.places ?? []).join(',')}`
  assert.equal(words(addedMove(NOW, ring, 1, null, 'from a trade with Priya')), 'Added to your collection | from a trade with Priya | ')
  assert.equal(words(addedMove(NOW, ring, 2, red, 'Booster box, Duskmourn')), 'Added to your collection ×2 | into Red box · Booster box, Duskmourn | red')
  assert.equal(words(putAwayMove(NOW, ring, 1, red, null, 'by scanning')), 'Put away in Red box | from no place, by scanning | red')
  assert.equal(words(putAwayMove(NOW, ring, 1, red, { id: '', name: 'Unsorted' })), 'Put away in Red box | from Unsorted | red')
  assert.equal(words(movedMove(NOW, ring, 1, red, rares)), 'Moved to Rares binder | from Red box | red,rares')
  assert.equal(words(movedMove(NOW, ring, 3, red, null)), 'Taken off its place ×3 | from Red box | red')
  assert.equal(words(pulledMove(NOW, ring, 1, 'Atraxa', { id: 'red', name: 'Red box › Colourless' })), 'Pulled into Atraxa deck | from Red box › Colourless | red')
  assert.equal(words(putBackMove(NOW, ring, 1, 'Atraxa', red)), 'Put back in Red box | from Atraxa deck | red')
  assert.equal(words(putBackMove(NOW, ring, 1, 'Atraxa', null)), 'Taken out of Atraxa deck | from Atraxa deck | ')
  assert.equal(words(lentMove(NOW, ring, 1, 'Sam', 'Atraxa deck', null, 'Back by next game night')), 'Lent to Sam | from Atraxa deck · back by next game night | ')
  assert.equal(words(returnedMove(NOW, ring, 1, 'Sam', 'Red box', 'red')), 'Back from Sam | into Red box | red')
  assert.equal(words(checkedMove(NOW, ring, red, 'where it should be')), 'Checked in Red box | where it should be | red')
})

test('moves are kept a year, and no more than the newest few thousand', () => {
  const old = putAwayMove(NOW - KEEP_MOVES_MS - 1, ring, 1, red, null)
  const recent = putAwayMove(NOW - KEEP_MOVES_MS, ring, 1, red, null)
  assert.deepEqual(pruneMoves([old, recent], NOW), [recent])
  const many = Array.from({ length: MAX_MOVES + 3 }, (_, i) => putAwayMove(NOW - 1000 + i, ring, 1, red, null))
  const kept = pruneMoves(many, NOW)
  assert.equal(kept.length, MAX_MOVES)
  assert.equal(kept[0].at, NOW - 1000 + 3)
})

test("a card's moves and a place's, newest first", () => {
  const log = appendMoves([], [
    putAwayMove(NOW - 3 * DAY, ring, 1, red, null),
    pulledMove(NOW - 2 * DAY, ring, 1, 'Atraxa', red),
    // Made earlier, written later: it still goes in order.
    addedMove(NOW - 4 * DAY, { name: 'Delver of Secrets // Insectile Aberration' }, 1, null),
  ], NOW)
  const more = appendMoves(log, [lentMove(NOW, ring, 1, 'Sam', 'Atraxa deck', null, null), movedMove(NOW, { name: 'Opt' }, 1, rares, red)], NOW)
  assert.deepEqual(movesOfCard(more, 'sol ring').map((m) => m.title), ['Lent to Sam', 'Pulled into Atraxa deck', 'Put away in Red box'])
  assert.deepEqual(movesOfCard(more, 'Delver of Secrets').map((m) => m.title), ['Added to your collection'])
  assert.deepEqual(movesOfPlace(more, new Set(['red'])).map((m) => `${m.name}: ${m.title}`), ['Opt: Moved to Red box', 'Sol Ring: Pulled into Atraxa deck', 'Sol Ring: Put away in Red box'])
  assert.equal(movesOfPlace(more, new Set(['red']), 1).length, 1)
})

test('the day of a move', () => {
  assert.equal(moveDay('2026-10-05', '2026-10-05'), 'Today')
  assert.equal(moveDay('2026-10-04', '2026-10-05'), 'Yesterday')
  assert.equal(moveDay('2026-09-30', '2026-10-01'), 'Yesterday')
  assert.equal(moveDay('2026-09-12', '2026-10-05'), '12 Sep')
  assert.equal(moveDay('2025-12-31', '2026-01-02'), '31 Dec 2025')
})

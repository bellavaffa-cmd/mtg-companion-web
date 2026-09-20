// The scanner's decisions (src/scan/scanLogic.ts), frame by frame.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BLANK_FRAMES_TO_RESET, cleanTitle, confirmRead, looksLikeSameCard, parseSetAndNumber, sameCardName, sameRead, ScanTracker } from '../../src/scan/scanLogic.ts'

test('the name is the first line with three letters, without the mana cost or stray marks', () => {
  assert.equal(cleanTitle('Lightning Bolt {R}'), 'Lightning Bolt')
  assert.equal(cleanTitle('Lightning Bolt ®'), 'Lightning Bolt')
  assert.equal(cleanTitle('| Sol Ring 1'), 'Sol Ring')
  assert.equal(cleanTitle("Urza's Saga"), "Urza's Saga")
  assert.equal(cleanTitle('Atraxa, Praetors\' Voice 2 @ @'), "Atraxa, Praetors' Voice")
  assert.equal(cleanTitle('A Good Day to Pie'), 'A Good Day to Pie')
  assert.equal(cleanTitle('~\nSwords to Plowshares W'), 'Swords to Plowshares')
  assert.equal(cleanTitle('Jötun Grunt'), 'Jötun Grunt')
  assert.equal(cleanTitle("Atraxa, Praetors' Voice       Bo"), "Atraxa, Praetors' Voice") // the mana cost, past a wide gap
  assert.equal(cleanTitle('.. 1 |'), null)
  assert.equal(cleanTitle(''), null)
})

test('a read title matches its card despite a misread letter or a cut-off end', () => {
  assert.equal(looksLikeSameCard('Lightning Bolt', 'Lightning Bolt'), true)
  assert.equal(looksLikeSameCard('Lightning Bo', 'Lightning Bolt'), true)
  assert.equal(looksLikeSameCard('Lightnlng Bolt', 'Lightning Bolt'), true) // shares its first 4+ letters
  assert.equal(looksLikeSameCard('Sol Ring', 'Lightning Bolt'), false)
})

test('two frames read the same title within a letter', () => {
  assert.equal(sameRead('Lightning Bolt', 'Lightning Bolt'), true)
  assert.equal(sameRead('Lightning Bolt', 'Lightnlng Bolt'), true)
  assert.equal(sameRead('Swords to Plowshares', 'Swords to Plowsharcs'), true)
  assert.equal(sameRead('Sol Ring', 'Sol Rang'), true)
  assert.equal(sameRead('Sol Ring', 'Mox Ruby'), false)
})

test('a card is looked up once it reads the same three times, and not again while it stays in view', () => {
  const t = new ScanTracker()
  assert.deepEqual(t.onRead('Lightning Bolt'), { kind: 'wait' }) // first sight
  assert.deepEqual(t.onRead('Lightnlng Bolt'), { kind: 'wait' }) // twice isn't steady: a card moving through reads twice
  assert.deepEqual(t.onRead('Lightning Bolt'), { kind: 'lookup', name: 'Lightning Bolt' }) // steady
  t.added('Lightning Bolt')
  for (let i = 0; i < 5; i++) assert.deepEqual(t.onRead('Lightning Bolt'), { kind: 'wait' }) // still there
  assert.deepEqual(t.onRead(null), { kind: 'wait' }) // one glared frame isn't "gone"
  assert.deepEqual(t.onRead('Lightning Bolt'), { kind: 'wait' })
})

test('once the card has left, the next one (even another copy) is new', () => {
  const t = new ScanTracker()
  t.onRead('Sol Ring'); t.onRead('Sol Ring'); t.onRead('Sol Ring'); t.added('Sol Ring')
  for (let i = 0; i < BLANK_FRAMES_TO_RESET; i++) t.onRead(null)
  assert.deepEqual(t.onRead('Sol Ring'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Sol Ring'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Sol Ring'), { kind: 'lookup', name: 'Sol Ring' })
})

test('a new card swapped in is looked up without waiting for blank frames', () => {
  const t = new ScanTracker()
  t.onRead('Sol Ring'); t.onRead('Sol Ring'); t.onRead('Sol Ring'); t.added('Sol Ring')
  assert.deepEqual(t.onRead('Arcane Signet'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Arcane Signet'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Arcane Signet'), { kind: 'lookup', name: 'Arcane Signet' })
})

test('Scan now reads the card in view at once, even the one just added', () => {
  const t = new ScanTracker()
  t.onRead('Sol Ring'); t.onRead('Sol Ring'); t.onRead('Sol Ring'); t.added('Sol Ring')
  assert.deepEqual(t.onRead('Sol Ring', true), { kind: 'lookup', name: 'Sol Ring' })
})

test('reads that keep changing wait for a steady one', () => {
  const t = new ScanTracker()
  assert.deepEqual(t.onRead('Sol Ring'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Arcane Signet'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Sol Ring'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Arcane Signet'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Arcane Signet'), { kind: 'wait' })
  assert.deepEqual(t.onRead('Arcane Signet'), { kind: 'lookup', name: 'Arcane Signet' })
})

test('a card is only added when the read accounts for its whole name', () => {
  assert.equal(confirmRead('Lightning Bolt', 'Lightning Bolt'), 'yes')
  assert.equal(confirmRead('lightning bolt', 'Lightning Bolt'), 'yes')
  // Punctuation and a misread letter or two across a full name still name that card.
  assert.equal(confirmRead('Kenriths Transformation', "Kenrith's Transformation"), 'yes')
  assert.equal(confirmRead('Rhystic Studv', 'Rhystic Study'), 'yes')
  assert.equal(confirmRead('Delver of Secrets', 'Delver of Secrets // Insectile Aberration'), 'yes')

  // The very thing that fouls up a scan: part of a name, answered with a real card.
  assert.equal(confirmRead('Lightning B', 'Lightning Bolt'), 'partial')
  assert.equal(confirmRead('Sol', 'Sol Ring'), 'partial')
  assert.equal(confirmRead('of Secrets', 'Delver of Secrets'), 'partial')
  // More than the name was read — another card's title in the frame, say.
  assert.equal(confirmRead('Sol Ring Cultivate', 'Sol Ring'), 'partial')

  assert.equal(confirmRead('Lightning Helix', 'Lightning Bolt'), 'different')
  assert.equal(confirmRead('', 'Lightning Bolt'), 'different')
})

test('a card printed under another name answers to the name on the card', () => {
  // Universes Beyond: "Kefka's Tower" is printed large, "Bolas's Citadel" in smaller type beneath.
  assert.equal(confirmRead("Kefka's ToWer", "Bolas's Citadel", "Kefka's Tower"), 'yes')
  // The real name underneath is just as good a read.
  assert.equal(confirmRead("Bolas's Citadel", "Bolas's Citadel", "Kefka's Tower"), 'yes')
  // Half of the flavour name is still half a card.
  assert.equal(confirmRead("Kefka's", "Bolas's Citadel", "Kefka's Tower"), 'partial')
  // And something else entirely is still something else.
  assert.equal(confirmRead('Sol Ring', "Bolas's Citadel", "Kefka's Tower"), 'different')
})

test('the exact printing is read from the small print at the bottom', () => {
  assert.deepEqual(parseSetAndNumber('U 0211\nMSC • EN  ARTIST NAME'), { set: 'msc', number: '211' })
  assert.deepEqual(parseSetAndNumber('0211/0280 U\nMSC · EN'), { set: 'msc', number: '211' })
  assert.deepEqual(parseSetAndNumber('R 0007\nFDN * EN'), { set: 'fdn', number: '7' })
  assert.deepEqual(parseSetAndNumber('C 0100\nMH3 • EN'), { set: 'mh3', number: '100' })
  // As the reader actually sees it on a camera frame:
  assert.deepEqual(parseSetAndNumber('RR | U 0806          E\nMSC « EN % MiLivos CEraN'), { set: 'msc', number: '806' })
  assert.deepEqual(parseSetAndNumber('———\nCc 0172\nMSC « EN % DARIUS ZABLOCKIS'), { set: 'msc', number: '172' })
})

test("small print that can't be read with confidence gives no printing", () => {
  assert.equal(parseSetAndNumber('Illus. Some Artist'), null) // an older card: no set code line
  assert.equal(parseSetAndNumber('MSC • EN'), null) // no number
  assert.equal(parseSetAndNumber('U 0211'), null) // no set
  assert.equal(parseSetAndNumber(''), null)
})

test('a printing from the small print must name exactly the card the title read', () => {
  assert.ok(sameCardName('Lightning Bolt', 'Lightning Bolt'))
  assert.ok(sameCardName('Delver of Secrets // Insectile Aberration', 'Delver of Secrets // Insectile Aberration'))
  assert.ok(sameCardName('Delver of Secrets', 'Delver of Secrets // Insectile Aberration'))
  assert.ok(!sameCardName('Lightning Bolt', 'Lightning Helix')) // a misread number landing on a near name
  assert.ok(!sameCardName('Goblin Guide', 'Goblin Bushwhacker'))
  assert.ok(!sameCardName('', ''))
})

test('a failed lookup is tried again while the card stays in view', () => {
  const tracker = new ScanTracker()
  tracker.onRead('Sol Ring'); tracker.onRead('Sol Ring')
  assert.deepEqual(tracker.onRead('Sol Ring'), { kind: 'lookup', name: 'Sol Ring' })
  assert.deepEqual(tracker.onRead('Sol Ring'), { kind: 'wait' }) // still looking it up
  tracker.failed()
  // Steady again — the card hasn't moved, so it's read three more times and tried once more.
  tracker.onRead('Sol Ring'); tracker.onRead('Sol Ring')
  assert.deepEqual(tracker.onRead('Sol Ring'), { kind: 'lookup', name: 'Sol Ring' })
})

test("a card the lookup couldn't confirm isn't looked up again on the same reading", () => {
  const tracker = new ScanTracker()
  tracker.onRead('Lightning B'); tracker.onRead('Lightning B')
  assert.deepEqual(tracker.onRead('Lightning B'), { kind: 'lookup', name: 'Lightning B' })
  // It came back as Lightning Bolt, which that reading doesn't account for.
  tracker.unconfirmed()
  for (let i = 0; i < 5; i++) assert.deepEqual(tracker.onRead('Lightning B'), { kind: 'wait' })
  // The whole card in the frame reads differently, and that is looked up.
  tracker.onRead('Lightning Bolt'); tracker.onRead('Lightning Bolt')
  assert.deepEqual(tracker.onRead('Lightning Bolt'), { kind: 'lookup', name: 'Lightning Bolt' })
})

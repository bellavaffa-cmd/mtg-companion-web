import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  changedTokenCounts, clockElapsed, DECK_INFO_MAX_ITEMS, DECK_INFO_MAX_NAME, deckInfoAction, deckTriggers, formatClock, gameMinutes,
  holdAfterOk, newClock, parseDeckInfo, pauseClock, reminderLines, resumeClock, seatDeckInfoOf, tokenAction, tokenChipText,
  triggerStepsOf, turnTimeLeft, turnTimerText, type SeatDeckInfo,
} from '../../src/lifecounter/tableExtras.ts'
import { DEFAULT_SETTINGS, gameReducer, newGame, normalizeSettings, type Game, type GameAction } from '../../src/lifecounter/game.ts'
import { buildRemoteState, parseRemoteState, remoteToGameAction } from '../../src/lifecounter/remote.ts'
import type { Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Deck tokens and trigger reminders at the table, the game clock and turn timer, and the protocol
// messages that carry them between the table and players' remotes. The same cases as the Android
// app's TableExtrasTest, with the JSON in fixtures/ written exactly as the Android app writes it
// (LifeCounterRemote.kt / TableExtras.kt, org.json) — keep both in step when the protocol changes.

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

// ---- Trigger reminders ----

test('start-of-turn triggers are found', () => {
  assert.deepEqual([...triggerStepsOf('At the beginning of your upkeep, you draw a card and you lose 1 life.')], ['upkeep'])
  assert.deepEqual([...triggerStepsOf('Flying\nAt the beginning of your end step, create a 1/1 token.')], ['end'])
  assert.deepEqual([...triggerStepsOf('At the beginning of combat on your turn, put a +1/+1 counter on target creature.')], ['combat'])
  assert.deepEqual([...triggerStepsOf('At the beginning of your draw step, draw an additional card.')], ['draw'])
})

test('other text is not a trigger', () => {
  assert.equal(triggerStepsOf("At the beginning of each opponent's upkeep, they lose 1 life.").size, 0)
  assert.equal(triggerStepsOf('Draw a card.').size, 0)
  assert.equal(triggerStepsOf(null).size, 0)
  // Reminder text in brackets doesn't count.
  assert.equal(triggerStepsOf('Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent.)').size, 0)
})

test('a card with two triggers counts for both', () => {
  const text = 'At the beginning of your upkeep, scry 1.\nAt the beginning of your end step, gain 1 life.'
  assert.deepEqual([...triggerStepsOf(text)].sort(), ['end', 'upkeep'])
})

test('deck triggers go in step order, once each', () => {
  const cards: [string, string | null][] = [
    ['Bitterblossom', 'At the beginning of your upkeep, you lose 1 life and create a 1/1 Faerie.'],
    ['Llanowar Elves', '{T}: Add {G}.'],
    ['Phyrexian Arena', 'At the beginning of your upkeep, you draw a card and you lose 1 life.'],
    ['Ophiomancer', 'At the beginning of each upkeep, if you control no Snakes, create a 1/1 Snake.'],
    ['Midnight Reaper', null],
    ['Twilight Prophet', "At the beginning of your upkeep, if you have the city's blessing, reveal…"],
    ['Sword of the Meek', 'at the beginning of your end step, untap it.'],
  ]
  const triggers = deckTriggers([...cards, ['Phyrexian Arena', 'At the beginning of your upkeep, you draw a card.']])
  assert.deepEqual(triggers, [
    { name: 'Bitterblossom', step: 'upkeep' },
    { name: 'Phyrexian Arena', step: 'upkeep' },
    { name: 'Twilight Prophet', step: 'upkeep' },
    { name: 'Sword of the Meek', step: 'end' },
  ])
  assert.deepEqual(reminderLines(triggers), ['Upkeep: Bitterblossom, Phyrexian Arena, Twilight Prophet', 'End step: Sword of the Meek'])
  assert.deepEqual(reminderLines([]), [])
})

// ---- Tokens ----

test('a token chip says what it is and how many', () => {
  assert.equal(tokenChipText({ id: 'g', name: 'Goblin', pt: '1/1' }, 3), 'Goblin 1/1 ×3')
  assert.equal(tokenChipText({ id: 't', name: 'Treasure', pt: null }, 0), 'Treasure ×0')
})

test('token counts never go below zero, and only for the deck’s tokens', () => {
  const tokens = [{ id: 'g', name: 'Goblin', pt: '1/1' }]
  assert.deepEqual(changedTokenCounts({ g: 1 }, tokens, 'g', 1), { g: 2 })
  assert.deepEqual(changedTokenCounts({ g: 1 }, tokens, 'g', -5), { g: 0 })
  assert.deepEqual(changedTokenCounts({ g: 1 }, tokens, 'nope', 1), { g: 1 })
})

const entry = (scryfallId: string, name: string): DeckCardEntry =>
  ({ scryfallId, name, imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null })

test('a deck’s tokens and trigger cards come from its cards', () => {
  const deck = {
    id: 'd', name: 'Krenko Goblins', commander: entry('k', 'Krenko, Tin Street Kingpin'), partnerCommander: null,
    cards: [entry('a', 'Phyrexian Arena'), entry('s', 'Sol Ring')],
  } as unknown as Deck
  const cards = new Map<string, ScryfallCard>([
    ['k', { id: 'k', name: 'Krenko, Tin Street Kingpin', oracle_text: 'At the beginning of combat on your turn, put a +1/+1 counter on Krenko.', all_parts: [{ id: 'gob', component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' }] } as ScryfallCard],
    ['a', { id: 'a', name: 'Phyrexian Arena', oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.' } as ScryfallCard],
    ['s', { id: 's', name: 'Sol Ring', oracle_text: '{T}: Add {C}{C}.' } as ScryfallCard],
  ])
  const tokenCards = new Map([['gob', { id: 'gob', name: 'Goblin', power: '1', toughness: '1' } as unknown as ScryfallCard]])
  const info = seatDeckInfoOf(deck, cards, tokenCards)
  assert.deepEqual(info.tokens.map((t) => [t.id, t.name, t.pt]), [['gob', 'Goblin', '1/1']])
  assert.deepEqual(info.triggers, [{ name: 'Phyrexian Arena', step: 'upkeep' }, { name: 'Krenko, Tin Street Kingpin', step: 'combat' }])
})

// ---- The clock ----

test('the clock leaves out paused time', () => {
  let clock = newClock(1_000)
  assert.equal(clockElapsed(clock, 10_000), 9_000)
  clock = pauseClock(clock, 10_000)
  assert.ok(clock.pausedAt !== null)
  assert.equal(clockElapsed(clock, 50_000), 9_000)
  assert.equal(pauseClock(clock, 60_000), clock)
  clock = resumeClock(clock, 70_000)
  assert.equal(clock.pausedAt, null)
  assert.equal(clockElapsed(clock, 80_000), 19_000)
  assert.equal(resumeClock(clock, 90_000), clock)
})

test('clock times read', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(245_000), '4:05')
  assert.equal(formatClock(3_729_000), '1:02:09')
  assert.equal(formatClock(-12_000), '−0:12')
  assert.equal(gameMinutes(10_000), 1)
  assert.equal(gameMinutes(42 * 60_000 + 59_000), 42)
  assert.equal(turnTimerText(87_001), '1:28')
  assert.equal(turnTimerText(-4_000), '+0:04')
})

test('the turn timer counts down on the game clock', () => {
  assert.equal(turnTimeLeft(0, 0, 100_000), null)
  assert.equal(turnTimeLeft(2, 60_000, 90_000), 120_000 - 30_000)
  assert.equal(turnTimeLeft(1, 0, 70_000), -10_000)
})

test('the turn timer setting takes only the app’s choices, off by default; reminders are on', () => {
  assert.equal(DEFAULT_SETTINGS.turnTimerMinutes, 0)
  assert.equal(DEFAULT_SETTINGS.triggerReminders, true)
  assert.equal(normalizeSettings({ turnTimerMinutes: 3 }).turnTimerMinutes, 3)
  assert.equal(normalizeSettings({ turnTimerMinutes: 4 }).turnTimerMinutes, 0)
  assert.equal(normalizeSettings({ triggerReminders: 'yes' }).triggerReminders, true)
})

// ---- On the wire ----

const krenko: SeatDeckInfo = {
  deck: 'Krenko Goblins',
  tokens: [{ id: 'g', name: 'Goblin', pt: '1/1', art: 'https://cards.scryfall.io/x.jpg' }, { id: 't', name: 'Treasure' }],
  triggers: [{ name: 'Krenko, Tin Street Kingpin', step: 'combat' }],
}

test('deckInfo goes there and back, as the Android app writes it', () => {
  const sent = JSON.parse(JSON.stringify(deckInfoAction(krenko)))
  assert.equal(sent.type, 'deckInfo')
  // The same message, key for key, as the phone sends.
  assert.deepEqual(sent, fixture('android-deckinfo.json'))
  // The art stays on the phone.
  const back = parseDeckInfo(fixture('android-deckinfo.json'))
  assert.deepEqual(back, { ...krenko, tokens: [{ id: 'g', name: 'Goblin', pt: '1/1' }, { id: 't', name: 'Treasure', pt: null }] })
})

test('the table trusts a deckInfo only so far', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `id${i + 1}`, name: `Token ${i + 1}` }))
  const info = parseDeckInfo({
    type: 'deckInfo', deck: 'x'.repeat(300), tokens: many,
    triggers: [{ name: 'A', step: 'upkeep' }, { name: 'B', step: 'precombat' }, { step: 'end' }],
  })!
  assert.equal(info.tokens.length, DECK_INFO_MAX_ITEMS)
  assert.equal(info.deck!.length, DECK_INFO_MAX_NAME)
  assert.deepEqual(info.triggers, [{ name: 'A', step: 'upkeep' }])
  assert.equal(parseDeckInfo({ type: 'token' }), null)
  // Missing lists read as none.
  assert.deepEqual(parseDeckInfo({ type: 'deckInfo' }), { deck: null, tokens: [], triggers: [] })
})

test('token and holdOk messages', () => {
  assert.deepEqual(tokenAction('g', -1), { type: 'token', id: 'g', delta: -1 })
  assert.equal(holdAfterOk(2, 3), null)
  assert.equal(holdAfterOk(2, 2), 2)
  assert.equal(holdAfterOk(null, 1), null)
})

test('seat tokens, the clock and the timer read from an Android table', () => {
  const s = parseRemoteState(fixture('android-state-extras.json'))!
  assert.deepEqual(s.players.map((p) => p.tokens ?? null), [
    [{ id: 'g', name: 'Goblin', pt: '1/1', count: 3 }, { id: 't', name: 'Treasure', pt: null, count: 0 }],
    [],
    null,
  ])
  assert.deepEqual(s.clock, { elapsedMs: 754_000, paused: true })
  assert.deepEqual(s.turnTimer, { seconds: 120, leftMs: -4_000 })
})

test('a table from before has none of it', () => {
  const old = fixture('android-state-extras.json')
  delete old.clock
  delete old.turnTimer
  delete old.players[0].tokens
  const s = parseRemoteState(old)!
  assert.equal(s.clock, null)
  assert.equal(s.turnTimer, null)
  assert.equal(s.players[0].tokens, undefined)
  // A timer of no length is no timer; nonsense isn't a state.
  assert.equal(parseRemoteState({ ...old, turnTimer: { seconds: 0, leftMs: 5 } })!.turnTimer, null)
  assert.equal(parseRemoteState({ ...old, v: 2 }), null)
})

// ---- The table playing it ----

const settings = { ...DEFAULT_SETTINGS, turnTracker: true, turnTimerMinutes: 2 }
const play = (g: Game, a: GameAction) => gameReducer(g, a)
const withKrenko = (): Game => play(newGame(settings), { type: 'deckInfo', id: 1, info: parseDeckInfo(fixture('android-deckinfo.json')) })

test('the table writes the same keys as an Android table', () => {
  const g = play(withKrenko(), { type: 'token', id: 1, tokenId: 'g', delta: 3 })
  const sent = JSON.parse(JSON.stringify(buildRemoteState(g, settings)))
  const android = fixture('android-state-extras.json')
  assert.deepEqual(Object.keys(sent).sort(), Object.keys(android).sort())
  assert.deepEqual(Object.keys(sent.players[0]).sort(), Object.keys(android.players[0]).sort())
  assert.deepEqual(sent.players[0].tokens, android.players[0].tokens)
  assert.equal(sent.players[1].tokens, undefined, 'a seat whose deck the table doesn’t know sends no tokens')
  assert.equal(sent.turnTimer.seconds, 120)
  assert.equal(typeof sent.clock.elapsedMs, 'number')
  // Turn timer off: null, as Android sends it.
  assert.equal(buildRemoteState(g, { ...settings, turnTimerMinutes: 0 }).turnTimer, null)
})

test('a remote’s deckInfo, token and holdOk are played at the table', () => {
  let g = newGame(settings)
  const ask = (seat: number, a: unknown) => remoteToGameAction(g, settings, seat, a)
  g = play(g, ask(2, fixture('android-deckinfo.json'))!)
  assert.equal(g.players[1].deckInfo?.tokens.length, 2)
  g = play(g, ask(2, { type: 'token', id: 'g', delta: 2 })!)
  assert.equal(g.players[1].tokenCounts?.g, 2)
  assert.equal(ask(2, { type: 'token', id: 'g', delta: 101 }), null, '|delta| over 100')
  assert.equal(ask(2, { type: 'token', id: 'zombie', delta: 1 }), null, 'not a token their deck makes')
  assert.equal(ask(3, { type: 'token', id: 'g', delta: 1 }), null, 'not their deck')
  // Undo takes a token back.
  g = play(g, { type: 'undo', by: 2 })
  assert.equal(g.players[1].tokenCounts?.g ?? 0, 0)
  // Hold on: anyone else can say OK, go on; the holder lets go the old way.
  g = play(g, ask(1, { type: 'hold', on: true })!)
  assert.equal(ask(1, { type: 'holdOk' }), null)
  g = play(g, ask(3, { type: 'holdOk' })!)
  assert.equal(g.hold, null)
  assert.equal(ask(3, { type: 'holdOk' }), null, 'nothing to let go of')
})

test('a new game keeps the seats’ decks, with their tokens back in the box', () => {
  let g = play(withKrenko(), { type: 'token', id: 1, tokenId: 'g', delta: 4 })
  g = play(g, { type: 'new', settings })
  assert.equal(g.players[0].deckInfo?.deck, 'Krenko Goblins')
  assert.equal(g.players[0].tokenCounts?.g ?? 0, 0)
})

test('the owner’s deck goes on their seat only, and not over a seat someone joined', () => {
  let g = newGame(settings)
  g = play(g, { type: 'link', id: 2, player: { userId: 'u', username: 'ana', displayName: 'Ana', avatarPath: null } })
  g = play(g, { type: 'meDeck', seat: 1, info: krenko })
  assert.equal(g.players[0].deckInfo?.deck, 'Krenko Goblins')
  assert.equal(g.players[1].deckInfo ?? null, null)
  g = play(g, { type: 'meDeck', seat: 3, info: krenko })
  assert.equal(g.players[0].deckInfo, null)
  assert.equal(g.players[2].deckInfo?.deck, 'Krenko Goblins')
  assert.equal(play(g, { type: 'meDeck', seat: 3, info: krenko }), g, 'nothing new, nothing changes')
})

test('pausing the game pauses the clock; a new turn starts the turn timer over', () => {
  let g = newGame(settings)
  g = play(g, { type: 'clock', paused: true })
  assert.ok(g.clock?.pausedAt != null)
  assert.equal(buildRemoteState(g, settings).clock?.paused, true)
  g = play(g, { type: 'clock', paused: false })
  assert.equal(g.clock?.pausedAt, null)
  const before = g.turnStartElapsed
  g = { ...g, clock: { ...g.clock!, startedAt: g.clock!.startedAt - 30_000 } }
  g = play(g, { type: 'nextTurn' })
  assert.ok((g.turnStartElapsed ?? 0) >= 30_000 && before === 0)
  const left = buildRemoteState(g, settings).turnTimer!.leftMs
  assert.ok(left <= 120_000 && left > 119_000)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COALESCE_MS, MAX_ENTRIES, SNAPSHOT_EVERY, capHistory, diffStates, historyFromVersions, historyItems, keepHistoryFromOlderApp,
  linesText, listOf, mergeHistory, recordLine, restoreList, sortedHistory, sourceText, stateAt, statesThrough, versionDiff,
  withHistory, withNamedVersion, withRestore, type DeckHistoryEntry, type HistoryContext,
} from '../../src/decks/deckHistory.ts'
import { mergeDeck } from '../../src/sync/mergeItems.ts'
import type { Deck, DeckCardEntry, GameResult } from '../../src/types/models.ts'

// The deck history (decks/deckHistory.ts). The Android app's DeckHistoryTest.kt runs the same cases.

const entry = (name: string, quantity = 1, id = `id-${name}`) =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null }) as DeckCardEntry
const deck = (cards: DeckCardEntry[], extra: Partial<Deck> = {}): Deck => ({
  id: 'd', name: 'Deck', commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'VIRTUAL', ...extra,
})
const names = (...ns: string[]) => ns.map((n) => entry(n))
let n = 0
const ctx = (now: number, dev = 'phone1', from: 'web' | 'android' = 'android', value?: (d: Deck) => number | null): HistoryContext =>
  ({ now, from, dev, newId: () => `e${++n}`, valueOf: value })
const MIN = 60_000

/** [d] with [cards] as its list, recorded at [now]. */
const edit = (d: Deck, cards: DeckCardEntry[], now: number, dev = 'phone1', from: 'web' | 'android' = 'android') =>
  withHistory(d, { ...d, cards }, ctx(now, dev, from))

test('a list change on a deck from before the history saves the old list first, then the change', () => {
  const d = edit(deck(names('A', 'B')), names('A', 'B', 'C'), 10_000)
  assert.equal(d.history!.length, 2)
  assert.equal(d.history![0].kind, 'start')
  assert.deepEqual(d.history![0].list, { A: 1, B: 1 })
  assert.deepEqual(d.history![1].add, [{ n: 'C', q: 1 }])
  assert.equal(d.history![1].cut, undefined)
  assert.equal(d.history![1].dev, 'phone1')
})

test('a change that leaves the list alone records nothing', () => {
  const before = deck(names('A'))
  const after = { ...before, tags: ['x'], cards: [entry('A', 1, 'other-printing')] }
  assert.equal(withHistory(before, after, ctx(1)), after)
})

test('a whole list into an empty deck is an import; one card is just an edit', () => {
  const d = withHistory(undefined, deck(names('A', 'B', 'C')), ctx(5))
  assert.equal(d.history!.length, 1)
  assert.equal(d.history![0].kind, 'import')
  assert.deepEqual(d.history![0].list, { A: 1, B: 1, C: 1 })
  const one = withHistory(deck([]), deck(names('A')), ctx(5))
  assert.equal(one.history!.length, 1)
  assert.equal(one.history![0].kind, undefined)
  assert.deepEqual(one.history![0].list, { A: 1 })
})

test('edits on one device within ten minutes are one entry; later, or on another device, a new one', () => {
  let d = edit(deck(names('A', 'B')), names('A', 'B', 'C'), 0)
  d = edit(d, names('A', 'C', 'D'), 5 * MIN)
  assert.equal(d.history!.length, 2)
  assert.deepEqual(d.history![1].add, [{ n: 'C', q: 1 }, { n: 'D', q: 1 }])
  assert.deepEqual(d.history![1].cut, [{ n: 'B', q: 1 }])
  assert.equal(d.history![1].at, 5 * MIN)
  // Undone within the sitting: C goes again, so only D in and B out are left.
  d = edit(d, names('A', 'D'), 6 * MIN)
  assert.deepEqual(d.history![1].add, [{ n: 'D', q: 1 }])
  // Another device's edit a minute later is its own entry.
  d = edit(d, names('A', 'D', 'E'), 7 * MIN, 'browser1', 'web')
  assert.equal(d.history!.length, 3)
  // Back on the phone: its last entry isn't the latest, so a new one.
  d = edit(d, names('A', 'D', 'E', 'F'), 8 * MIN)
  assert.equal(d.history!.length, 4)
  d = edit(d, names('A', 'D', 'E', 'F', 'G'), 8 * MIN + COALESCE_MS)
  assert.equal(d.history!.length, 5)
})

test('a game logged since the last entry closes it', () => {
  let d = edit(deck(names('A')), names('A', 'B'), 0)
  const game: GameResult = { id: 'g', result: 'WIN', opponent: null, playedAt: MIN }
  d = { ...d, gameResults: [game] }
  d = edit(d, names('A', 'B', 'C'), 2 * MIN)
  assert.equal(d.history!.length, 3)
})

test('the list at any point is rebuilt from the nearest whole list', () => {
  let d = deck(names('A'))
  for (let i = 0; i < SNAPSHOT_EVERY * 2 + 3; i++) d = edit(d, [...d.cards, entry(`X${i}`)], i * COALESCE_MS * 2)
  const h = sortedHistory(d.history!)
  // The start, then one in every SNAPSHOT_EVERY carry the whole list.
  assert.ok(h.filter((e) => e.list).length >= 3)
  assert.ok(h.filter((e) => e.list).length <= 4)
  const states = statesThrough(h)
  assert.deepEqual(states[states.length - 1], listOf(d))
  const at5 = stateAt(h, h[5].id)!
  assert.deepEqual(Object.keys(at5.cards).sort(), ['A', 'X0', 'X1', 'X2', 'X3', 'X4'])
  assert.equal(stateAt(h, 'nope'), null)
})

test('commander changes are kept and replayed', () => {
  const sol = entry('Meren')
  let d = edit(deck([sol, entry('B')], { commander: sol }), [sol, entry('B'), entry('C')], 0)
  const k = entry('Karador')
  d = withHistory(d, { ...d, cards: [...d.cards, k], commander: k }, ctx(COALESCE_MS * 2))
  const last = sortedHistory(d.history!).at(-1)!
  assert.deepEqual(last.cmd, ['Karador'])
  const items = historyItems(d)
  assert.deepEqual(items[0].commanders, ['Karador'])
  assert.equal(items[1].commanders, null)
})

test('a list changed by an app with no history becomes one synced entry before the next change', () => {
  let d = edit(deck(names('A')), names('A', 'B'), 0)
  // An older app took A out and the save dropped nothing else (the history came back by healing).
  d = { ...d, cards: names('B') }
  d = edit(d, names('B', 'C'), 20 * MIN)
  const h = sortedHistory(d.history!)
  assert.equal(h.at(-2)!.kind, 'synced')
  assert.deepEqual(h.at(-2)!.cut, [{ n: 'A', q: 1 }])
  assert.deepEqual(statesThrough(h).at(-1), listOf(d))
})

test('the value before and after is kept when known', () => {
  const value = (x: Deck) => x.cards.length * 10
  let d = withHistory(deck(names('A')), deck(names('A', 'B')), ctx(0, 'p', 'android', value))
  assert.equal(d.history![1].v0, 10)
  assert.equal(d.history![1].v1, 20)
  d = withHistory(d, { ...d, cards: names('A', 'B', 'C') }, ctx(MIN, 'p', 'android', () => null))
  // Folded, with no price now: the value before stays, the last known after too.
  assert.equal(d.history![1].v0, 10)
  assert.equal(d.history![1].v1, 20)
})

test('diff: in it then, not now; and added since', () => {
  const then = { cards: { A: 2, B: 1, C: 1 }, commanders: [] }
  const now = { cards: { A: 1, C: 1, D: 3 }, commanders: [] }
  assert.deepEqual(versionDiff(then, now), { gone: [{ n: 'A', q: 1 }, { n: 'B', q: 1 }], added: [{ n: 'D', q: 3 }] })
  assert.deepEqual(diffStates(now, now), { add: [], cut: [] })
})

test('merging two devices’ histories keeps every entry once, the newer copy where both have it', () => {
  const base = edit(deck(names('A')), names('A', 'B'), 0)
  const phone = edit(base, names('A', 'B', 'C'), 20 * MIN)
  const web = edit(base, names('A', 'B', 'D'), 21 * MIN, 'b1', 'web')
  const merged = mergeHistory(phone.history, web.history)!
  assert.equal(merged.length, 4)
  assert.equal(new Set(merged.map((e) => e.id)).size, 4)
  // The same both ways round.
  assert.deepEqual(mergeHistory(web.history, phone.history), merged)
  // A folded (newer) copy of the phone's entry wins over the older one.
  const phoneLater = edit(phone, names('A', 'B', 'C', 'E'), 22 * MIN)
  const again = mergeHistory(phoneLater.history, merged)!
  assert.equal(again.length, 4)
  assert.deepEqual(again.find((e) => e.id === phoneLater.history!.at(-1)!.id)!.add, [{ n: 'C', q: 1 }, { n: 'E', q: 1 }])
  assert.equal(mergeHistory(undefined, undefined), undefined)
})

test('a deck merge keeps both histories, and one saved by an older app keeps this device’s', () => {
  const base = edit(deck(names('A')), names('A', 'B'), 0)
  const mine = edit(base, names('A', 'B', 'C'), 20 * MIN)
  const { history: _gone, ...older } = { ...base, cards: names('A', 'B', 'D') }
  const merged = mergeDeck(base, mine, older as Deck, true)
  assert.deepEqual(merged.history, mine.history)
  assert.deepEqual(merged.cards.map((c) => c.name), ['A', 'B', 'C', 'D'])
  assert.equal(keepHistoryFromOlderApp(mine, older as Deck).history, mine.history)
  const knowing = { ...base, history: [] }
  assert.deepEqual(keepHistoryFromOlderApp(mine, knowing).history, [])
})

test('the cap keeps the last entries and every named version, and the list can still be rebuilt', () => {
  let d = deck(names('A'))
  d = withNamedVersion(withHistory(deck([]), d, ctx(0)), 'First', '', ctx(1))
  for (let i = 0; i < MAX_ENTRIES + 30; i++) d = edit(d, [...d.cards, entry(`X${i}`)], (i + 1) * COALESCE_MS * 2)
  const h = d.history!
  assert.equal(h.filter((e) => e.kind !== 'named').length, MAX_ENTRIES)
  assert.equal(h.filter((e) => e.kind === 'named').length, 1)
  assert.deepEqual(statesThrough(sortedHistory(h)).at(-1), listOf(d))
  // The first entry kept after the dropped ones carries the whole list.
  const firstPlain = h.find((e) => e.kind !== 'named')!
  assert.ok(firstPlain.list)
  // Capped again: nothing more goes.
  assert.deepEqual(capHistory(h), h)
})

test('entries over a year older than the newest go', () => {
  const old: DeckHistoryEntry = { id: 'old', at: 0, list: { A: 1 }, cmd: [] }
  const named: DeckHistoryEntry = { id: 'n', at: 1, kind: 'named', name: 'Kept', list: { A: 1 }, cmd: [] }
  const recent: DeckHistoryEntry = { id: 'new', at: 400 * 24 * 3600 * 1000, add: [{ n: 'B', q: 1 }] }
  const out = capHistory([old, named, recent])
  assert.deepEqual(out.map((e) => e.id), ['n', 'new'])
})

test('a deck from before the history shows its saved versions', () => {
  const versions = [
    { id: 'baseline:1', savedAt: 100, cards: { A: 1, B: 1 }, commanders: [] },
    { id: '2', savedAt: 200, cards: { A: 1, C: 1 }, commanders: [] },
  ]
  const h = historyFromVersions(versions)
  assert.equal(h[0].kind, 'start')
  assert.deepEqual(h[1].add, [{ n: 'C', q: 1 }])
  assert.deepEqual(h[1].cut, [{ n: 'B', q: 1 }])
  assert.equal(historyItems(deck(names('A', 'C'), { versions })).length, 2)
  // Recording then carries them on, with the same ids on every device.
  const d = edit(deck(names('A', 'C'), { versions }), names('A', 'C', 'D'), 300)
  assert.deepEqual(d.history!.map((e) => e.id).slice(0, 2), ['v:baseline:1', 'v:2'])
})

test('the History screen: newest first, games counted for the list they were played with', () => {
  let d = edit(deck(names('A')), names('A', 'B'), 0)
  d = withNamedVersion(d, ' Before game night ', 'Tuned', ctx(MIN))
  d = { ...d, gameResults: [
    { id: 'g1', result: 'WIN', opponent: null, playedAt: 2 * MIN },
    { id: 'g2', result: 'LOSS', opponent: null, playedAt: 3 * MIN },
    { id: 'g3', result: 'WIN', opponent: null, playedAt: 4 * MIN },
  ] }
  d = edit(d, names('A', 'B', 'C'), 30 * MIN)
  const items = historyItems(d)
  assert.equal(items.length, 4)
  assert.equal(items[0].latest, true)
  assert.equal(items[1].entry.kind, 'named')
  assert.equal(items[1].entry.name, 'Before game night')
  assert.equal(items[1].entry.note, 'Tuned')
  assert.equal(recordLine(items[1]), 'Went 2–1 with this list.')
  assert.equal(recordLine(items[0]), '')
})

test('card lines: one card by name, more as a count and names', () => {
  assert.deepEqual(linesText('+', [{ n: 'Sheoldred, the Apocalypse', q: 1 }]), { lead: '+ Sheoldred, the Apocalypse', rest: '' })
  assert.deepEqual(linesText('−', [{ n: 'Cultivate', q: 1 }, { n: 'Swamp', q: 2 }]), { lead: '− 3', rest: 'Cultivate, 2 Swamp' })
  const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((x) => ({ n: x, q: 1 }))
  assert.equal(linesText('+', many).rest, 'A, B, C, D, E, …')
})

test('where an entry was made', () => {
  const here = { from: 'android', dev: 'p1' }
  assert.equal(sourceText({ id: '1', at: 0, from: 'android', dev: 'p1' }, here), 'this phone')
  assert.equal(sourceText({ id: '1', at: 0, from: 'android', dev: 'p2' }, here), 'another phone')
  assert.equal(sourceText({ id: '1', at: 0, from: 'web', dev: 'b1' }, here), 'manabind.com')
  assert.equal(sourceText({ id: '1', at: 0, from: 'android', dev: 'p2' }, { from: 'web', dev: 'b1' }), 'phone')
  assert.equal(sourceText({ id: '1', at: 0, kind: 'named', from: 'web', dev: 'b1' }, here), 'named')
  assert.equal(sourceText({ id: '1', at: 0, kind: 'import' }, here), 'imported')
})

test('going back: cards cut, cards back (proxies in a physical deck), and the ones to fetch', () => {
  const now = deck([entry('A', 2), entry('B'), entry('C')], { ownership: 'PHYSICAL' })
  const then = { cards: { A: 1, B: 1, D: 1, E: 2 }, commanders: [] }
  const known = (name: string) => (name === 'D' ? entry('D', 4, 'id-D') : undefined)
  const plan = restoreList(now, then, known)
  assert.deepEqual(plan.deck.cards.map((c) => [c.name, c.quantity, c.proxyQuantity]), [['A', 1, undefined], ['B', 1, undefined], ['D', 1, 1]])
  assert.deepEqual(plan.cuts.map((c) => [c.entry.name, c.newQuantity]), [['A', 1], ['C', 0]])
  assert.equal(plan.incoming, 1)
  assert.deepEqual(plan.missing, [{ n: 'E', q: 2 }])
  // A virtual deck has no proxies to pull.
  const virtual = restoreList({ ...now, ownership: 'VIRTUAL' }, then, known)
  assert.equal(virtual.deck.cards.find((c) => c.name === 'D')!.proxyQuantity, undefined)
})

test('going back sets the commander from then, and is recorded as one entry keeping today’s list', () => {
  const meren = entry('Meren')
  const k = entry('Karador')
  const before = deck([k, meren, entry('B')], { commander: k })
  const plan = restoreList(before, { cards: { Meren: 1, B: 1 }, commanders: ['Meren'] }, () => undefined)
  assert.equal(plan.deck.commander!.name, 'Meren')
  let d = edit(deck([meren, entry('B')], { commander: meren }), [meren, entry('B'), k], 0)
  d = { ...d, commander: k }
  const restored = withRestore(d, { ...plan.deck, history: d.history }, 5, ctx(MIN))
  const last = sortedHistory(restored.history!).at(-1)!
  assert.equal(last.kind, 'restore')
  assert.equal(last.to, 5)
  assert.deepEqual(last.cut, [{ n: 'Karador', q: 1 }])
  // The generic recording sees it's done.
  assert.equal(withHistory(d, restored, ctx(MIN)), restored)
  assert.deepEqual(statesThrough(sortedHistory(restored.history!)).at(-2)!.cards, { Meren: 1, B: 1, Karador: 1 })
})

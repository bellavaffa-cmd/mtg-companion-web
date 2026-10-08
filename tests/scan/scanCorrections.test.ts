import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  capCorrections, correctedLine, correctionsOf, forgetCorrection, keepCorrectionsFromOlderApp, lookupCorrection, markUsed, MAX_CORRECTIONS,
  mergeCorrections, misreadKey, printingKey, readLine, recordCorrection, usedLine, withCorrections,
  type Applied, type CardRef, type ScanCorrection, type ScanReading,
} from '../../src/scan/scanCorrections.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import { resetLibrary } from '../../src/settings/resetCollection.ts'
import { UNSORTED_COLLECTION_ID, type Collection } from '../../src/types/models.ts'

// The scanner learning from corrections. The cases in scanCorrectionVectors.json are run by the Android
// app too (ScanCorrectionsTest.kt), so both apps learn, apply and merge the same way.

type Step =
  | { op: 'lookup'; reading: ScanReading; expect: Applied | null }
  | { op: 'record'; reading: ScanReading; card: CardRef; learned?: string; now: number }
  | { op: 'used'; key: string; now: number }
  | { op: 'forget'; key: string }
  | { op: 'expect'; entries: { key: string; kind: string; scryfallId: string; count: number; used: number }[] }

interface Vectors {
  keys: { reading: ScanReading; misread: string; printing: string }[]
  scenarios: { name: string; steps: Step[] }[]
  merge: { name: string; base: ScanCorrection[] | null; mine: ScanCorrection[] | null; theirs: ScanCorrection[] | null; minePreferred: boolean; expect: [string, string, number][] | null }[]
  cap: { mine: [number, number]; theirs: [number, number]; kept: number; oldestKept: string; newest: string }
  lines: { entry: ScanCorrection; read: string; corrected: string; used: string }[]
}

const V = JSON.parse(readFileSync(new URL('./scanCorrectionVectors.json', import.meta.url), 'utf8')) as Vectors
const orUndefined = <T>(x: T | null): T | undefined => (x === null ? undefined : x)

test('the keys a read makes: the misread and the preferred printing', () => {
  for (const k of V.keys) {
    assert.equal(misreadKey(k.reading), k.misread)
    assert.equal(printingKey(k.reading.recognizedName), k.printing)
  }
})

test('learning, applying, un-correcting and forgetting, step by step', () => {
  for (const s of V.scenarios) {
    let list: ScanCorrection[] = []
    s.steps.forEach((step, i) => {
      const at = `${s.name}, step ${i + 1}`
      switch (step.op) {
        case 'lookup': assert.deepEqual(lookupCorrection(list, step.reading), step.expect, at); break
        case 'record': list = recordCorrection(list, step.reading, step.card, step.now, step.learned ?? null); break
        case 'used': list = markUsed(list, step.key, step.now); break
        case 'forget': list = forgetCorrection(list, step.key); break
        case 'expect':
          assert.deepEqual(list.map((c) => ({ key: c.key, kind: c.kind, scryfallId: c.scryfallId, count: c.count, used: c.used })), step.entries, at)
      }
    })
  }
})

test('two devices’ corrections merge entry by entry, the one used last winning', () => {
  for (const m of V.merge) {
    const got = mergeCorrections(orUndefined(m.base), orUndefined(m.mine), orUndefined(m.theirs), m.minePreferred)
    assert.deepEqual(got?.map((c) => [c.key, c.scryfallId, c.lastUsed]) ?? null, m.expect, m.name)
  }
})

const gen = ([from, to]: [number, number]): ScanCorrection[] => Array.from({ length: to - from }, (_, j) => {
  const i = from + j
  return { key: `k${String(i).padStart(3, '0')}`, kind: 'MISREAD', read: 'r', wrongId: 'w', wrongName: 'W', scryfallId: `s${i}`, name: 'N', set: 's', collectorNumber: '1', count: 1, used: 0, lastUsed: i + 1 }
})

test('at most 500 are kept: the ones used longest ago go', () => {
  const merged = mergeCorrections(undefined, gen(V.cap.mine), gen(V.cap.theirs), true)!
  assert.equal(merged.length, V.cap.kept)
  assert.equal(merged.length, MAX_CORRECTIONS)
  assert.equal(merged[0].key, V.cap.newest)
  assert.equal(merged.at(-1)!.key, V.cap.oldestKept)
  // Learning one more drops the oldest.
  const more = recordCorrection(merged, { read: 'Opt', set: null, number: null, recognizedId: 'o1', recognizedName: 'Opt' }, { id: 'o2', name: 'Opt', set: 'xln', collectorNumber: '65' }, 10_000)
  assert.equal(more.length, MAX_CORRECTIONS)
  assert.equal(more[0].key, '~opt')
  assert.ok(!more.some((c) => c.key === V.cap.oldestKept))
  assert.equal(capCorrections(gen([0, 3])).map((c) => c.key).join(','), 'k002,k001,k000')
})

test('what Settings › Scanner says of each', () => {
  for (const l of V.lines) {
    assert.equal(readLine(l.entry), l.read)
    assert.equal(correctedLine(l.entry), l.corrected)
    assert.equal(usedLine(l.entry), l.used)
  }
})

// ---- On the Unsorted pile, in the sync and in a reset ----

const pile = (extra: Partial<Collection> = {}): Collection => ({ id: UNSORTED_COLLECTION_ID, name: 'Unsorted', entries: [], createdAt: 1, type: 'DEFAULT' as Collection['type'], ...extra })
const one = gen([0, 1])
const two = gen([0, 2])

test('kept on the Unsorted pile, made if it isn’t there', () => {
  const cols = withCorrections([], one)
  assert.equal(cols.length, 1)
  assert.deepEqual(correctionsOf(cols).map((c) => c.key), ['k000'])
})

test('the pile merges them, and a save by an app that doesn’t know about them leaves them as they were', () => {
  const base = pile({ scanCorrections: one })
  const mine = pile({ scanCorrections: two })
  const older = pile()
  const merged = mergeCollection(base, mine, older, false)
  assert.deepEqual(merged.scanCorrections?.map((c) => c.key), ['k001', 'k000'])
  assert.equal(keepCorrectionsFromOlderApp(mine, older).scanCorrections, two)
  assert.equal(keepCorrectionsFromOlderApp(mine, pile({ scanCorrections: [] })).scanCorrections?.length, 0)
  // Neither side has any: still left out.
  assert.equal('scanCorrections' in mergeCollection(pile(), pile(), pile(), true), false)
})

test('Reset collection: Collection and Everything clear them; Cards only keeps them', () => {
  const lib = { decks: [], collections: [pile({ scanCorrections: two })] }
  const after = (scope: 'cards' | 'collection' | 'everything') => resetLibrary(lib as never, scope, 1).collections.find((c) => c.id === UNSORTED_COLLECTION_ID)!.scanCorrections
  assert.equal(after('cards')?.length, 2)
  assert.deepEqual(after('collection'), [])
  assert.deepEqual(after('everything'), [])
  // ...and the emptied list, synced, clears them on the other device too.
  const merged = mergeCollection(pile({ scanCorrections: two }), pile({ scanCorrections: [] }), pile({ scanCorrections: two }), true)
  assert.deepEqual(merged.scanCorrections, [])
})

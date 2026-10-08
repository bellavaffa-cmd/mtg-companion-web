import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKUP_TOO_NEW, BACKUP_VERSION, NOT_A_BACKUP, backupFileName, backupJson, backupSummary, buildBackup, parseBackup, restoreLibrary,
  restoredHistory, restoredMessage, restoredPhotos, summaryLines, type BackupFile,
} from '../../src/sync/backupFile.ts'
import type { Library } from '../../src/sync/cloudSync.ts'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { CopyMove } from '../../src/collection/copyHistory.ts'
import type { CopyPhoto } from '../../src/collection/copyPhotos.ts'
import type { ScanCorrection } from '../../src/scan/scanCorrections.ts'
import { bigCollection, ownedCopies } from '../perf/bigCollection.ts'

// Backup and restore: one file with everything, read back the same; a file from a newer version is
// turned down; restoring merges with the sync's rules or puts the backup back. The Android app has
// the same checks — see BackupTest.kt.

const entry = (id: string, quantity = 1, over: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity: 0, ...over })
const card = (id: string, quantity = 1): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })
const binder = (id: string, entries: CollectionEntry[], over: Partial<Collection> = {}): Collection =>
  ({ id, name: id, entries, createdAt: 1, type: 'OWNED', ...over })
const deck = (id: string, cards: DeckCardEntry[], over: Partial<Deck> = {}): Deck =>
  ({ id, name: id, commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL', ...over })
const move = (at: number, name: string): CopyMove => ({ at, kind: 'ADDED', name, qty: 1, title: `Added ${name}` } as CopyMove)
const photo = (key: string, front?: string): CopyPhoto => ({ key, scryfallId: key, name: key, ...(front ? { front } : {}) })

const backupOf = (library: Library, over: Partial<Parameters<typeof buildBackup>[0]> = {}): BackupFile => buildBackup({
  library, from: 'web', createdAt: 1_790_000_000_000, copyHistory: [], photos: [], photoFiles: {}, settings: {}, ...over,
})
const reread = (b: BackupFile): BackupFile => {
  const parsed = parseBackup(backupJson(b))
  assert.ok(parsed.ok)
  return parsed.backup
}

test('a backup reads back exactly as it was written: library, history, photos and settings', () => {
  const library: Library = {
    decks: [deck('d1', [card('sol', 1)], { history: [{ id: 'h1', at: 5, add: [{ n: 'sol', q: 1 }] }], cameFrom: [] })],
    collections: [binder('unsorted', [entry('bolt', 2, { places: [{ placeId: 'box', qty: 2, section: 'Red' }] })], {
      storagePlaces: [{ id: 'box', name: 'Red box', kind: 'BOX', createdAt: 1 }],
      loans: [{ id: 'L1', to: 'Sam', lentAt: 1, cards: [{ name: 'bolt', scryfallId: 'bolt', qty: 1 }] }],
      sealed: [{ id: 's1', name: 'Box', kind: 'PLAY_BOX', count: 1, createdAt: 1 }],
      graded: [{ id: 'g1', scryfallId: 'bolt', name: 'bolt', company: 'PSA', grade: '10', createdAt: 1 }],
      gear: [{ id: 'k1', kind: 'SLEEVES', name: 'Black', count: 100, createdAt: 1 }],
    })],
  }
  const b = backupOf(library, {
    copyHistory: [move(1, 'bolt')], photos: [photo('bolt|x', 'p1')], photoAskOver: 20, photoFiles: { p1: 'AAEC' },
    settings: { mtgweb_currency: '"EUR"' },
  })
  const back = reread(b)
  assert.deepEqual(back, b)
  assert.equal(back.version, BACKUP_VERSION)
  assert.deepEqual(back.settings, { web: { mtgweb_currency: '"EUR"' } })
})

test('a 25,000-copy collection survives the round trip, and restores into an empty library as it was', () => {
  const lib = bigCollection()
  const b = reread(backupOf(lib))
  assert.deepEqual(b.decks, lib.decks)
  assert.deepEqual(b.collections, lib.collections)
  const summary = backupSummary(b)
  assert.equal(summary.copies, ownedCopies(lib))
  assert.equal(summary.copies, 25_000)
  for (const mode of ['merge', 'replace'] as const) {
    const out = restoreLibrary({ decks: [], collections: [] }, b, mode)
    assert.deepEqual(out.decks, lib.decks)
    assert.deepEqual(out.collections, lib.collections)
  }
  // Merging a library with its own backup changes nothing — not one item, so nothing syncs.
  const same = restoreLibrary(lib, b, 'merge')
  assert.ok(same.decks.every((d, i) => d === lib.decks[i]))
  assert.ok(same.collections.every((c, i) => c === lib.collections[i]))
})

test('a backup from a newer version is turned down, and so is a file that is not a backup', () => {
  const newer = { ...backupOf({ decks: [], collections: [] }), version: BACKUP_VERSION + 1 }
  assert.deepEqual(parseBackup(JSON.stringify(newer)), { ok: false, reason: 'too-new', message: BACKUP_TOO_NEW })
  assert.deepEqual(parseBackup('{"decks": []}'), { ok: false, reason: 'not-backup', message: NOT_A_BACKUP })
  assert.deepEqual(parseBackup('Sol Ring\n1 Lightning Bolt'), { ok: false, reason: 'not-backup', message: NOT_A_BACKUP })
  const cut = backupJson(backupOf({ decks: [deck('d', [card('a')])], collections: [] }))
  const damaged = parseBackup(cut.slice(0, cut.length - 20))
  assert.equal(damaged.ok, false)
  assert.equal(!damaged.ok && damaged.reason, 'damaged')
})

test('merging keeps everything newer here and brings back what is only in the backup', () => {
  const then: Library = {
    decks: [deck('kept', [card('sol'), card('ring')], { name: 'Old name' }), deck('gone', [card('bolt')])],
    collections: [binder('b1', [entry('a', 2), entry('b', 1), entry('c', 1)])],
  }
  const backup = reread(backupOf(then))
  // Since the backup: renamed a deck, added a card to it, deleted a deck, sold a card, bought more of
  // another and made a new binder.
  const now: Library = {
    decks: [deck('kept', [card('sol'), card('ring'), card('opt')], { name: 'New name' })],
    collections: [binder('b1', [entry('a', 5), entry('c', 1), entry('d', 1)]), binder('b2', [entry('x')])],
    deleted: { 'deck:gone': 9 },
  }
  const out = restoreLibrary(now, backup, 'merge')
  const kept = out.decks.find((d) => d.id === 'kept')!
  assert.equal(kept.name, 'New name')
  assert.deepEqual(kept.cards.map((c) => c.scryfallId), ['sol', 'ring', 'opt'])
  assert.ok(out.decks.some((d) => d.id === 'gone'), 'the deleted deck comes back')
  assert.deepEqual(out.deleted, {}, 'and is no longer counted as deleted, so it syncs again')
  const b1 = out.collections.find((c) => c.id === 'b1')!
  // Here's order first, then what only the backup has; the larger count where both have a card.
  assert.deepEqual(b1.entries.map((e) => [e.scryfallId, e.quantity]), [['a', 5], ['c', 1], ['d', 1], ['b', 1]])
  assert.ok(out.collections.some((c) => c.id === 'b2'), 'a binder made since stays')
})

test('merging keeps where copies are here, and adds the backup places and loans that are missing', () => {
  const place = (id: string) => ({ id, name: id, kind: 'BOX' as const, createdAt: 1 })
  const then = { decks: [], collections: [binder('unsorted', [entry('a', 1, { places: [{ placeId: 'old', qty: 1 }] })], {
    storagePlaces: [place('old')], loans: [{ id: 'L1', to: 'Sam', lentAt: 1, cards: [] }],
  })] }
  const now = { decks: [], collections: [binder('unsorted', [entry('a', 1, { places: [{ placeId: 'new', qty: 1 }] })], {
    storagePlaces: [place('old'), place('new')], loans: [{ id: 'L2', to: 'Jo', lentAt: 2, cards: [] }],
  })] }
  const pile = restoreLibrary(now, reread(backupOf(then)), 'merge').collections[0]
  assert.deepEqual(pile.entries[0].places, [{ placeId: 'new', qty: 1 }])
  assert.deepEqual(pile.storagePlaces!.map((p) => p.id).sort(), ['new', 'old'])
  assert.deepEqual(pile.loans!.map((l) => l.id).sort(), ['L1', 'L2'])
})

test("merging keeps what the scanner learned here, and brings back the backup's corrections that are missing", () => {
  const fix = (key: string, lastUsed: number, to = 'bolt-m10'): ScanCorrection => ({
    key, kind: 'MISREAD', read: key, wrongId: 'x', wrongName: 'X', scryfallId: to, name: 'Lightning Bolt',
    set: 'm10', collectorNumber: '146', count: 1, used: 0, lastUsed,
  })
  const then: Library = { decks: [], collections: [binder('unsorted', [], { scanCorrections: [fix('old', 5), fix('both', 1, 'bolt-then')] })] }
  const now: Library = { decks: [], collections: [binder('unsorted', [], { scanCorrections: [fix('new', 9), fix('both', 7, 'bolt-now')] })] }
  const backup = reread(backupOf(then))
  assert.deepEqual(backup.collections[0].scanCorrections, then.collections[0].scanCorrections)
  const pile = restoreLibrary(now, backup, 'merge').collections[0]
  // Here's order first, then what only the backup has; the one used last wins where both have it.
  assert.deepEqual(pile.scanCorrections!.map((c) => c.key), ['new', 'both', 'old'])
  assert.equal(pile.scanCorrections!.find((c) => c.key === 'both')!.scryfallId, 'bolt-now')
  assert.deepEqual(restoreLibrary(now, backup, 'replace').collections[0].scanCorrections, then.collections[0].scanCorrections)
})

test('replacing puts each deck and binder back as it was in the backup, keeping ones made since', () => {
  const backup = reread(backupOf({ decks: [deck('d', [card('sol')], { name: 'Then' })], collections: [binder('b', [entry('a', 1)])] }))
  const now: Library = { decks: [deck('d', [card('opt')], { name: 'Now' }), deck('new', [])], collections: [binder('b', [entry('a', 4)])] }
  const out = restoreLibrary(now, backup, 'replace')
  assert.deepEqual(out.decks.map((d) => [d.id, d.name]), [['d', 'Then'], ['new', 'new']])
  assert.equal(out.collections[0].entries[0].quantity, 1)
})

test('copy history is both logs, each move once; photos merge by copy', () => {
  assert.deepEqual(restoredHistory([move(1, 'a'), move(3, 'c')], [move(2, 'b'), move(1, 'a')], 4).map((m) => m.name), ['a', 'b', 'c'])
  const backup = reread(backupOf({ decks: [], collections: [] }, {
    photos: [photo('k1', 'f1'), photo('k2', 'f2'), photo('k3', 'lost')], photoFiles: { f1: 'AA', f2: 'BB' },
  }))
  const merged = restoredPhotos([photo('k1', 'mine')], backup, 'merge')
  assert.deepEqual(merged.photos.map((p) => [p.key, p.front]), [['k1', 'mine'], ['k2', 'f2'], ['k3', undefined]])
  assert.deepEqual(merged.fromBackup.map((p) => p.key), ['k2', 'k3'])
  const replaced = restoredPhotos([photo('k1', 'mine')], backup, 'replace')
  assert.deepEqual(replaced.photos.map((p) => [p.key, p.front]), [['k1', 'f1'], ['k2', 'f2'], ['k3', undefined]])
})

test('the preview says what the file holds, and the file is named for its day', () => {
  const b = reread(backupOf(bigCollection(), { photoFiles: { p: 'AA' } }))
  assert.deepEqual(summaryLines(backupSummary(b)), [
    '60 decks · 42 binders',
    '25,000 copies in 80 places',
    '25 loans · 60 sealed · 40 graded · 25 pieces of gear',
    '720 deck history entries · 1 photo',
  ])
  assert.equal(restoredMessage(backupSummary(b), 1), 'Restored 60 decks and 42 binders, with 1 photo.')
  assert.match(backupFileName(Date.UTC(2026, 9, 7, 12)), /^manabind-backup-2026-10-0[78]\.json$/)
})

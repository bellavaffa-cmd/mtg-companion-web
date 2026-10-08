// Backup and restore (Settings › Data and speed): everything this browser keeps, in one file you keep —
// decks and binders (with their storage places, loans, sealed product, graded copies, gear and deck
// history, which ride along inside them), the copy history, the photos of your copies and the settings
// worth keeping. The file is JSON, the same in both apps: a backup made on the phone restores here and
// the other way round (each app's own settings only go back into that app). The Android app reads and
// writes it in data/Backup.kt.
//
// Restoring never deletes anything. Two ways:
//  - Merge (the default): the backup's decks and binders are merged into what's here with the same
//    rules the sync uses (mergeItems.ts), as if this device and the backup had each added what they
//    hold: everything here stays, what's only in the backup comes back, a card both have keeps the
//    larger count, and where both changed something (a deck's name) this device's wins. Settings
//    here stay as they are.
//  - Replace: each deck and binder in the backup goes back to how it was in the backup, settings too.
//    Ones made since the backup are kept.
// Either way copy history is put together from both, and photos the backup has that are missing here
// come back (Replace puts the backup's back in place of the ones here). Restoring is a change like any
// other: signed in, it syncs.
//
// The format is versioned: [BACKUP_VERSION] is written into every file, and a file from a newer
// version is turned down with a message rather than half read.

import type { Collection, Deck } from '../types/models'
import { normalizeDeck } from '../types/models'
import type { Library } from './cloudSync'
import { mergeCollection, mergeDeck } from './mergeItems'
import type { CopyMove } from '../collection/copyHistory'
import { pruneMoves } from '../collection/copyHistory'
import type { CopyPhoto } from '../collection/copyPhotos'
import { placesOf, storageSummary } from '../collection/storagePlaces'
import { isEmptyStandingCollection } from './libraryBackup'
import { canonicalJson } from './canonicalJson'

export const BACKUP_FORMAT = 'manabind-backup'
/** The format this app writes, and the newest it reads. */
export const BACKUP_VERSION = 1

export type BackupApp = 'web' | 'android'
export type RestoreMode = 'merge' | 'replace'

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  /** When it was made, in milliseconds. */
  createdAt: number
  /** The app that made it. */
  from: BackupApp
  decks: Deck[]
  collections: Collection[]
  /** The copy history (collection/copyHistory.ts), oldest first. */
  copyHistory: CopyMove[]
  /** Each copy's photos and details (collection/copyPhotos.ts); [photoFiles] holds the pictures. */
  photos: CopyPhoto[]
  /** "Ask for photos when adding a card worth over $X". */
  photoAskOver?: number
  /** The photos themselves: their id in [photos] → the JPEG, base64. */
  photoFiles: Record<string, string>
  /** Each app's settings worth keeping, by app: key → value as that app stores it. */
  settings: Partial<Record<BackupApp, Record<string, string>>>
}

export interface BackupInput {
  library: Library
  from: BackupApp
  createdAt: number
  copyHistory: CopyMove[]
  photos: CopyPhoto[]
  photoAskOver?: number
  photoFiles: Record<string, string>
  settings: Record<string, string>
}

/** The backup of everything in [input]. Samples from the welcome flow aren't the user's, so they're left out. */
export function buildBackup(input: BackupInput): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: input.createdAt,
    from: input.from,
    decks: input.library.decks.filter((d) => !d.sample),
    collections: input.library.collections.filter((c) => !c.sample),
    copyHistory: input.copyHistory,
    photos: input.photos,
    ...(input.photoAskOver !== undefined ? { photoAskOver: input.photoAskOver } : {}),
    photoFiles: input.photoFiles,
    settings: { [input.from]: input.settings },
  }
}

export const backupJson = (backup: BackupFile): string => JSON.stringify(backup)

/** "manabind-backup-2026-10-07.json" for a backup made on [at]'s day. */
export function backupFileName(at: number): string {
  const d = new Date(at)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `manabind-backup-${day}.json`
}

export type ParsedBackup =
  | { ok: true; backup: BackupFile }
  | { ok: false; reason: 'not-backup' | 'too-new' | 'damaged'; message: string }

export const NOT_A_BACKUP = "This file isn't a Manabind backup."
export const BACKUP_TOO_NEW = 'This backup was made by a newer version of Manabind. Update the app, then restore it.'
export const BACKUP_DAMAGED = "This backup couldn't be read — the file may not have saved completely."

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Reads a backup file's text: the backup, or why it can't be restored. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // A file that starts like a backup but doesn't parse was cut short; anything else isn't one.
    return text.trimStart().startsWith('{') && text.includes(`"${BACKUP_FORMAT}"`)
      ? { ok: false, reason: 'damaged', message: BACKUP_DAMAGED }
      : { ok: false, reason: 'not-backup', message: NOT_A_BACKUP }
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT || typeof raw.version !== 'number') {
    return { ok: false, reason: 'not-backup', message: NOT_A_BACKUP }
  }
  if (raw.version > BACKUP_VERSION) return { ok: false, reason: 'too-new', message: BACKUP_TOO_NEW }
  if (!Number.isInteger(raw.version) || raw.version < 1) return { ok: false, reason: 'damaged', message: BACKUP_DAMAGED }
  const decks = list<Deck>(raw.decks).filter((d) => isRecord(d) && typeof d.id === 'string' && typeof d.name === 'string')
  const collections = list<Collection>(raw.collections)
    .filter((c) => isRecord(c) && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.entries))
  const files: Record<string, string> = {}
  if (isRecord(raw.photoFiles)) for (const [id, b64] of Object.entries(raw.photoFiles)) if (typeof b64 === 'string') files[id] = b64
  const settings: BackupFile['settings'] = {}
  if (isRecord(raw.settings)) {
    for (const app of ['web', 'android'] as const) {
      const s = raw.settings[app]
      if (!isRecord(s)) continue
      settings[app] = Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    }
  }
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: raw.version,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      from: raw.from === 'android' ? 'android' : 'web',
      decks: decks.map((d) => normalizeDeck(d)),
      collections: collections.map((c) => ({ ...c, createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0, type: c.type === 'WISHLIST' ? 'WISHLIST' : 'OWNED' })),
      copyHistory: list<CopyMove>(raw.copyHistory).filter((m) => isRecord(m) && typeof m.at === 'number' && typeof m.name === 'string'),
      photos: list<CopyPhoto>(raw.photos).filter((p) => isRecord(p) && typeof p.key === 'string'),
      ...(typeof raw.photoAskOver === 'number' ? { photoAskOver: raw.photoAskOver } : {}),
      photoFiles: files,
      settings,
    },
  }
}

/** What a backup holds, for the preview before restoring. */
export interface BackupSummary {
  createdAt: number
  from: BackupApp
  decks: number
  binders: number
  copies: number
  places: number
  loans: number
  sealed: number
  graded: number
  gear: number
  historyEntries: number
  photos: number
}

export function backupSummary(b: BackupFile): BackupSummary {
  const pile = b.collections.find((c) => c.id === 'unsorted')
  return {
    createdAt: b.createdAt,
    from: b.from,
    decks: b.decks.length,
    binders: b.collections.filter((c) => !isEmptyStandingCollection(c)).length,
    // As the Storage tab counts them: binders and the real cards in decks.
    copies: storageSummary(b.collections, b.decks).total,
    places: placesOf(b.collections).length,
    loans: pile?.loans?.length ?? 0,
    sealed: (pile?.sealed ?? []).reduce((n, s) => n + s.count, 0),
    graded: pile?.graded?.length ?? 0,
    gear: pile?.gear?.length ?? 0,
    historyEntries: b.decks.reduce((n, d) => n + (d.history?.length ?? 0), 0),
    photos: Object.keys(b.photoFiles).length,
  }
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** The preview's lines: "12 decks · 40 binders", "24,810 copies in 80 places", … — lines with nothing in them left out. */
export function summaryLines(s: BackupSummary): string[] {
  const extras = [
    s.loans > 0 ? count(s.loans, 'loan', 'loans') : '',
    s.sealed > 0 ? `${s.sealed.toLocaleString('en-GB')} sealed` : '',
    s.graded > 0 ? `${s.graded.toLocaleString('en-GB')} graded` : '',
    s.gear > 0 ? count(s.gear, 'piece of gear', 'pieces of gear') : '',
  ].filter(Boolean)
  const kept = [
    s.historyEntries > 0 ? count(s.historyEntries, 'deck history entry', 'deck history entries') : '',
    s.photos > 0 ? count(s.photos, 'photo', 'photos') : '',
  ].filter(Boolean)
  return [
    `${count(s.decks, 'deck', 'decks')} · ${count(s.binders, 'binder', 'binders')}`,
    s.places > 0 ? `${count(s.copies, 'copy', 'copies')} in ${count(s.places, 'place', 'places')}` : count(s.copies, 'copy', 'copies'),
    extras.join(' · '),
    kept.join(' · '),
  ].filter(Boolean)
}

/**
 * A deck or binder with nothing in it, as the "base" of a merge: everything on both sides counts as
 * added, and no field matches either side's, so where they differ the merge prefers this device's.
 */
const emptyDeck = (d: Deck): Deck =>
  ({ id: d.id, name: '', commander: null, partnerCommander: null, cards: [], gameMode: '', createdAt: 0, tags: [], gameResults: [], ownership: '' as Deck['ownership'] })
const emptyCollection = (c: Collection): Collection => ({ id: c.id, name: '', entries: [], createdAt: 0, type: '' as Collection['type'] })

/** The same as JSON, so a restore that changes nothing leaves the item as it was (and unsynced). */
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

/**
 * [current] with [backup]'s decks and binders restored, as [mode] says (see the top of this file).
 * Items only here are left alone; items only in the backup come back with their own ids, so another
 * device that still has them agrees on which is which.
 */
export function restoreLibrary(current: Library, backup: BackupFile, mode: RestoreMode): Library {
  // The sync's merge takes the other side's version of what both added, and its fields where both
  // differ (minePreferred false): this device's, here, so what's here wins.
  const decks = restoreItems(current.decks, backup.decks, (here, saved) => {
    if (mode === 'replace') return saved
    const m = mergeDeck(emptyDeck(here), saved, here, false)
    return {
      ...m,
      cards: inOrder(m.cards, here.cards, saved.cards),
      ...(m.sideboard ? { sideboard: inOrder(m.sideboard, here.sideboard ?? [], saved.sideboard ?? []) } : {}),
      ...(m.considering ? { considering: inOrder(m.considering, here.considering ?? [], saved.considering ?? []) } : {}),
    }
  })
  const collections = restoreItems(current.collections, backup.collections, (here, saved) => {
    if (mode === 'replace') return saved
    const m = mergeCollection(emptyCollection(here), saved, here, false)
    const byId = <T extends { id: string }>(merged: T[] | undefined, a: T[] | undefined, b: T[] | undefined) =>
      merged && inOrder(merged, a ?? [], b ?? [], (x) => x.id)
    const { notWanted, ...rest } = m
    return {
      ...rest,
      // Left out when neither side had any, as before.
      ...(notWanted?.length || here.notWanted || saved.notWanted ? { notWanted } : {}),
      entries: inOrder(m.entries, here.entries, saved.entries),
      ...(m.storagePlaces ? { storagePlaces: byId(m.storagePlaces, here.storagePlaces, saved.storagePlaces) } : {}),
      ...(m.loans ? { loans: byId(m.loans, here.loans, saved.loans) } : {}),
      ...(m.sealed ? { sealed: byId(m.sealed, here.sealed, saved.sealed) } : {}),
      ...(m.graded ? { graded: byId(m.graded, here.graded, saved.graded) } : {}),
      ...(m.gear ? { gear: byId(m.gear, here.gear, saved.gear) } : {}),
      ...(m.sortRecipes ? { sortRecipes: byId(m.sortRecipes, here.sortRecipes, saved.sortRecipes) } : {}),
    }
  })
  // Restored, so no longer deleted: the sync sends them again.
  const back = new Set([...backup.decks.map((d) => `deck:${d.id}`), ...backup.collections.map((c) => `collection:${c.id}`)])
  const deleted = current.deleted ? Object.fromEntries(Object.entries(current.deleted).filter(([k]) => !back.has(k))) : undefined
  return { ...current, decks, collections, ...(deleted ? { deleted } : {}) }
}

/**
 * [merged] in the order the cards were in here, then the backup's own: with nothing to agree on, the
 * merge lists everything by id, which would shuffle a binder.
 */
function inOrder<T>(merged: T[], first: T[], then: T[], key: (x: T) => string = (x) => (x as { scryfallId: string }).scryfallId): T[] {
  const rank = new Map<string, number>()
  for (const e of [...first, ...then]) if (!rank.has(key(e))) rank.set(key(e), rank.size)
  return merged.map((e, i) => ({ e, r: rank.get(key(e)) ?? rank.size + i })).sort((a, b) => a.r - b.r).map((x) => x.e)
}

function restoreItems<T extends { id: string }>(current: T[], backup: T[], restore: (mine: T, theirs: T) => T): T[] {
  const fromBackup = new Map(backup.map((b) => [b.id, b]))
  const out = current.map((mine) => {
    const theirs = fromBackup.get(mine.id)
    if (!theirs || same(theirs, mine)) return mine
    const next = restore(mine, theirs)
    return same(next, mine) ? mine : next
  })
  const here = new Set(current.map((c) => c.id))
  for (const b of backup) if (!here.has(b.id)) out.push(b)
  return out
}

/** The copy history after a restore: both logs, each move once, oldest first. */
export function restoredHistory(current: CopyMove[], backup: CopyMove[], now: number): CopyMove[] {
  const seen = new Set<string>()
  const all: CopyMove[] = []
  for (const m of [...current, ...backup]) {
    const k = canonicalJson(m)
    if (seen.has(k)) continue
    seen.add(k)
    all.push(m)
  }
  return pruneMoves(all.map((m, i) => ({ m, i })).sort((a, b) => a.m.at - b.m.at || a.i - b.i).map((x) => x.m), now)
}

/**
 * The photos after a restore: each copy's from here, with the backup's for copies that have none here
 * — or, to [replace], the backup's in place of the ones here. [ids] are the photos the restore keeps
 * from the backup (to be written into the store).
 */
export function restoredPhotos(current: CopyPhoto[], backup: BackupFile, mode: RestoreMode): { photos: CopyPhoto[]; fromBackup: CopyPhoto[] } {
  const usable = (p: CopyPhoto): CopyPhoto => {
    // A photo whose picture isn't in the file comes back without it.
    const { front, back, ...rest } = p
    return { ...rest, ...(front && backup.photoFiles[front] ? { front } : {}), ...(back && backup.photoFiles[back] ? { back } : {}) }
  }
  const here = new Map(current.map((p) => [p.key, p]))
  const fromBackup = backup.photos.filter((p) => mode === 'replace' || !here.has(p.key)).map(usable)
  const taken = new Set(fromBackup.map((p) => p.key))
  return { photos: [...current.filter((p) => !taken.has(p.key)), ...fromBackup], fromBackup }
}

/** "Restored 12 decks and 40 binders." — what a restore says when it's done. */
export function restoredMessage(s: BackupSummary, photos: number): string {
  const what = `${count(s.decks, 'deck', 'decks')} and ${count(s.binders, 'binder', 'binders')}`
  return photos > 0 ? `Restored ${what}, with ${count(photos, 'photo', 'photos')}.` : `Restored ${what}.`
}

// The backup made by itself the first time this version runs (binders as views:
// collection/binderViews.ts): the library as it was before binders showed deck cards, kept in this
// browser — localStorage while it fits, IndexedDB when it doesn't (tags/tagStore.ts) — and offered in
// Settings › Data and speed › Backup › "Restore from before the binders update". Once only: a flag says
// it's done, and one already there is never written over. Decks and binders; photos, history and
// settings stay where they are. Mirrors the Android app's BackupIo.saveBeforeBinders.

import { browserStore, indexedStore, loadText, saveText, type BigStore, type TextStore } from '../tags/tagStore'
import { backupJson, buildBackup, parseBackup, type ParsedBackup } from './backupFile'
import type { Library } from './cloudSync'

export const BEFORE_BINDERS_KEY = 'mtgweb_backup_before_binder_views'
export const BEFORE_BINDERS_DONE = 'mtgweb_backed_up_before_binder_views'

const flagged = (local: TextStore | null): boolean => {
  try { return local?.getItem(BEFORE_BINDERS_DONE) === '1' } catch { return false }
}
const flag = (local: TextStore | null) => {
  try { local?.setItem(BEFORE_BINDERS_DONE, '1') } catch { /* full or blocked: tried again next visit */ }
}

/** Makes the backup if it hasn't been made: whether one was made now. */
export async function saveBeforeBinders(lib: Library, now = Date.now(), local: TextStore | null = browserStore(), big: BigStore | null = indexedStore): Promise<boolean> {
  try {
    if (flagged(local)) return false
    if (lib.decks.length === 0 && !lib.collections.some((c) => c.entries.length > 0)) { flag(local); return false }
    if ((await loadText(BEFORE_BINDERS_KEY, local, big)) != null) { flag(local); return false }
    const backup = buildBackup({ library: lib, from: 'web', createdAt: now, copyHistory: [], photos: [], photoFiles: {}, settings: {} })
    const saved = await saveText(BEFORE_BINDERS_KEY, backupJson(backup), local, big)
    if (saved === 'lost') return false
    flag(local)
    return true
  } catch {
    return false
  }
}

/** The backup from before the binders update, or null when there's none. */
export async function readBeforeBinders(local: TextStore | null = browserStore(), big: BigStore | null = indexedStore): Promise<ParsedBackup | null> {
  try {
    const text = await loadText(BEFORE_BINDERS_KEY, local, big)
    return text == null ? null : parseBackup(text)
  } catch {
    return null
  }
}

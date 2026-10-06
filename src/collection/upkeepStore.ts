// Upkeep's bits kept in this browser (not synced): the last import, for "Most came from last week's
// import" (upkeep.ts). The Android app keeps the same on the phone (data/UpkeepReminder.kt's UpkeepStore).

import type { ImportNote } from './upkeep'

const IMPORT_KEY = 'mtgweb_last_import'

export function lastImport(): ImportNote | null {
  try {
    const raw = localStorage.getItem(IMPORT_KEY)
    const p = raw ? (JSON.parse(raw) as Partial<ImportNote>) : null
    if (!p || typeof p.at !== 'number' || typeof p.copies !== 'number') return null
    return { at: p.at, copies: p.copies, collectionId: typeof p.collectionId === 'string' ? p.collectionId : 'unsorted' }
  } catch {
    return null
  }
}

/** An import of [copies] copies into [collectionId] just now. */
export function noteImport(copies: number, collectionId: string) {
  if (copies <= 0) return
  try { localStorage.setItem(IMPORT_KEY, JSON.stringify({ at: Date.now(), copies, collectionId })) } catch { /* not kept */ }
}

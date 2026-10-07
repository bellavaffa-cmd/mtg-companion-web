// The browser's side of a backup (backupFile.ts holds the rules): gathering this browser's photos,
// copy history and settings into the file and handing it over as a download, and putting a restored
// backup's back. The library itself is restored through the sync (SyncContext.restoreBackup), so it's
// sent to the account like any other change.

import type { Library } from './cloudSync'
import { backupFileName, backupJson, buildBackup, restoredHistory, restoredPhotos, type BackupFile, type RestoreMode } from './backupFile'
import { currentMoves, replaceMoves } from '../collection/copyHistoryStore'
import { loadCopyPhotos, photoBlob, restorePhotos } from '../collection/copyPhotoStore'
import { BACKUP_SETTINGS_KEYS } from '../settings/dataAndSpeed'

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string, type = 'image/jpeg'): Blob | null {
  try {
    const s = atob(b64)
    const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
    return new Blob([bytes], { type })
  } catch {
    return null
  }
}

/** Everything this browser keeps, as a backup file to download. */
export async function makeBackup(library: Library, now = Date.now()): Promise<{ blob: Blob; name: string; backup: BackupFile }> {
  const saved = await loadCopyPhotos()
  const photoFiles: Record<string, string> = {}
  for (const p of saved.photos) {
    for (const id of [p.front, p.back]) {
      if (!id || photoFiles[id]) continue
      const blob = await photoBlob(id)
      if (blob) photoFiles[id] = await toBase64(blob)
    }
  }
  const settings: Record<string, string> = {}
  for (const key of BACKUP_SETTINGS_KEYS) {
    try {
      const v = localStorage.getItem(key)
      if (v !== null) settings[key] = v
    } catch { /* blocked: left out */ }
  }
  const backup = buildBackup({
    library, from: 'web', createdAt: now, copyHistory: currentMoves(), photos: saved.photos,
    ...(saved.askOver !== undefined ? { photoAskOver: saved.askOver } : {}), photoFiles, settings,
  })
  return { blob: new Blob([backupJson(backup)], { type: 'application/json' }), name: backupFileName(now), backup }
}

/** Hands [blob] to the browser as a download called [name]. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Puts back what a backup holds besides the library: its copy history (with this browser's), its photos
 * and — to [replace] — this app's settings. Answers how many photos came back and whether settings did
 * (they show once the page reloads).
 */
export async function restoreExtras(backup: BackupFile, mode: RestoreMode, now = Date.now()): Promise<{ photos: number; settings: boolean }> {
  replaceMoves(restoredHistory(currentMoves(), backup.copyHistory, now))
  const saved = await loadCopyPhotos()
  const { photos, fromBackup } = restoredPhotos(saved.photos, backup, mode)
  const pictures = new Map<string, Blob>()
  for (const p of fromBackup) {
    for (const id of [p.front, p.back]) {
      const blob = id ? fromBase64(backup.photoFiles[id]) : null
      if (id && blob) pictures.set(id, blob)
    }
  }
  // Pictures of copies whose photos the backup's replaced.
  const kept = new Set(photos.flatMap((p) => [p.front, p.back]).filter(Boolean))
  const dropped = saved.photos.flatMap((p) => [p.front, p.back]).filter((id): id is string => !!id && !kept.has(id))
  await restorePhotos(photos, pictures, dropped, mode === 'replace' ? backup.photoAskOver : undefined)
  let settings = false
  const mine = backup.settings.web
  if (mode === 'replace' && mine) {
    for (const key of BACKUP_SETTINGS_KEYS) {
      const v = mine[key]
      if (typeof v !== 'string') continue
      try { localStorage.setItem(key, v); settings = true } catch { /* full or blocked */ }
    }
  }
  return { photos: fromBackup.filter((p) => p.front || p.back).length, settings }
}

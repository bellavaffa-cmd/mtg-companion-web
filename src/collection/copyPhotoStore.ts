// Photos of your copies (copyPhotos.ts), kept in this browser only — in IndexedDB, never synced or
// uploaded. Each photo is a JPEG no bigger than MAX_SIDE on its long side, stored under its own key;
// the details sit beside them under "copy_photos", with the setting "ask for photos when adding a card
// worth over $X". If IndexedDB is missing (a private window) the photos last for this visit only. The
// Android app keeps its own on the phone (CopyPhotoStore.kt).

import { useEffect, useState } from 'react'
import type { CopyPhoto, CopyRef } from './copyPhotos'

const DB = 'manabind'
const STORE = 'kv'
const KEY = 'copy_photos'
const MAX_SIDE = 1600

export interface SavedPhotos { photos: CopyPhoto[]; askOver?: number }

let saved: SavedPhotos | null = null
let loading: Promise<SavedPhotos> | null = null
let writing: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()
/** Photos kept for this visit when IndexedDB can't take them. */
const memory = new Map<string, Blob>()

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('No IndexedDB here')); return }
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}

async function get(key: string): Promise<unknown> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function put(key: string, value: unknown, remove: string[] = []): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      for (const k of remove) tx.objectStore(STORE).delete(k)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** The photos and details, read from the browser the first time they're wanted. */
export function loadCopyPhotos(): Promise<SavedPhotos> {
  if (saved) return Promise.resolve(saved)
  loading ??= get(KEY)
    .then((raw) => {
      const r = raw as Partial<SavedPhotos> | undefined
      return { photos: Array.isArray(r?.photos) ? r.photos : [], ...(typeof r?.askOver === 'number' ? { askOver: r.askOver } : {}) }
    })
    .catch(() => ({ photos: [] }))
    .then((read) => {
      saved ??= read
      listeners.forEach((l) => l())
      return saved
    })
  return loading
}

function write(next: SavedPhotos, remove: string[] = []) {
  saved = next
  listeners.forEach((l) => l())
  writing = writing.then(() => put(KEY, next, remove)).catch(() => { /* blocked or full: kept for this visit */ })
}

/** The photos and details, re-rendering when they change; null until read. */
export function useCopyPhotos(): SavedPhotos | null {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    void loadCopyPhotos()
    return () => { listeners.delete(l) }
  }, [])
  return saved
}

export const photoOf = (key: string): CopyPhoto | undefined => saved?.photos.find((p) => p.key === key)

/** Saves [photo] in place of the one with its key. */
export function saveCopyPhoto(photo: CopyPhoto) {
  const now = saved ?? { photos: [] }
  write({ ...now, photos: [...now.photos.filter((p) => p.key !== photo.key), photo] })
}

/** The setting: ask for photos when adding a card worth over this many dollars; null: never. */
export function setAskOver(usd: number | null) {
  const { askOver: _old, ...rest } = saved ?? { photos: [] }
  write(usd !== null && usd >= 0 ? { ...rest, askOver: usd } : rest)
}

/**
 * A restored backup's photos (sync/backupFile.ts): [photos] in place of the details kept, [pictures]
 * written under their ids, the pictures [dropped] (replaced copies' old ones) taken out. The setting
 * comes back too when [askOver] is given.
 */
export async function restorePhotos(photos: CopyPhoto[], pictures: Map<string, Blob>, dropped: string[], askOver?: number): Promise<void> {
  const now = await loadCopyPhotos()
  for (const [id, blob] of pictures) {
    memory.set(id, blob)
    writing = writing.then(() => put(id, blob)).catch(() => { /* kept for this visit */ })
  }
  for (const id of dropped) memory.delete(id)
  write({ ...now, photos, ...(askOver !== undefined ? { askOver } : {}) }, dropped)
}

/** A picture scaled down to MAX_SIDE on its long side, as a JPEG. */
async function scaled(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/jpeg', 0.85))
}

/**
 * Takes [file] in as [ref]'s front ([front] true) or back, scaled down, and notes when it was
 * photographed. False when it couldn't be read.
 */
export async function setCopyPhoto(ref: CopyRef, front: boolean, file: Blob): Promise<boolean> {
  let blob: Blob
  try { blob = await scaled(file) } catch { return false }
  await loadCopyPhotos()
  const id = `copy_photo:${crypto.randomUUID()}`
  memory.set(id, blob)
  writing = writing.then(() => put(id, blob)).catch(() => { /* kept for this visit */ })
  const had = photoOf(ref.key) ?? { key: ref.key, scryfallId: ref.scryfallId, name: ref.name, ...(ref.foil ? { foil: true } : {}) }
  const old = front ? had.front : had.back
  const now = saved ?? { photos: [] }
  const next: CopyPhoto = { ...had, name: ref.name, photographedAt: Date.now(), ...(front ? { front: id } : { back: id }) }
  write({ ...now, photos: [...now.photos.filter((p) => p.key !== ref.key), next] }, old ? [old] : [])
  if (old) memory.delete(old)
  return true
}

/** A stored photo, or null when it's gone. */
export async function photoBlob(id: string | undefined): Promise<Blob | null> {
  if (!id) return null
  const kept = memory.get(id)
  if (kept) return kept
  try {
    await writing
    const b = await get(id)
    return b instanceof Blob ? b : null
  } catch {
    return null
  }
}

/** A stored photo as a URL for an <img>, while the component is shown. */
export function usePhotoUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let made: string | null = null
    let live = true
    void photoBlob(id).then((b) => {
      if (!live) return
      made = b ? URL.createObjectURL(b) : null
      setUrl(made)
    })
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
      setUrl(null)
    }
  }, [id])
  return url
}

/** A stored photo as a data: URL, for the printed report (which outlives object URLs). */
export async function photoDataUrl(id: string | undefined): Promise<string | null> {
  const b = await photoBlob(id)
  if (!b) return null
  return await new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null)
    r.onerror = () => resolve(null)
    r.readAsDataURL(b)
  })
}

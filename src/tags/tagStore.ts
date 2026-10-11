// Where the card tags cache (roleTags.ts) is kept: localStorage while it fits, IndexedDB once it
// doesn't. A big collection's tags can outgrow localStorage's few megabytes, and a write that failed
// there used to lose the cache at the next visit without a word. Once a key has moved to IndexedDB a
// marker says so, and it's read from there from then on. The Android app keeps its cache in a file,
// so it has no such limit.

/** The bits of localStorage used here (a test hands in its own). */
export interface TextStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A bigger, slower store (IndexedDB; a test hands in its own). */
export interface BigStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/** localStorage's marker: "[key] lives in IndexedDB". */
export const movedKey = (key: string) => `${key}_where`

/** Where a save went: localStorage, IndexedDB, or nowhere (both failed — kept for this visit only). */
export type Saved = 'local' | 'idb' | 'lost'

/**
 * Saves [text] under [key]: in [local] unless it's full (or the key has moved), else in [big] — and
 * then the key stays in [big], its old copy in [local] cleared to make room.
 */
export async function saveText(key: string, text: string, local: TextStore | null, big: BigStore | null): Promise<Saved> {
  const moved = (() => { try { return local?.getItem(movedKey(key)) === 'idb' } catch { return false } })()
  if (local && !moved) {
    try {
      local.setItem(key, text)
      return 'local'
    } catch { /* full: on to IndexedDB */ }
  }
  if (big) {
    try {
      await big.set(key, text)
      try {
        local?.setItem(movedKey(key), 'idb')
        local?.removeItem(key)
      } catch { /* the marker is small; if even that fails, the next load still finds IndexedDB's copy below */ }
      return 'idb'
    } catch { /* no IndexedDB either */ }
  }
  console.warn(`Couldn't save ${key}: storage is full. It's kept for this visit.`)
  return 'lost'
}

/** What's saved under [key] in [local], unless it has moved to IndexedDB (then null: see loadText). */
export function loadTextNow(key: string, local: TextStore | null): string | null {
  try {
    if (!local || local.getItem(movedKey(key)) === 'idb') return null
    return local.getItem(key)
  } catch {
    return null
  }
}

/** What's saved under [key], wherever it is. */
export async function loadText(key: string, local: TextStore | null, big: BigStore | null): Promise<string | null> {
  const now = loadTextNow(key, local)
  if (now != null) return now
  if (!big) return null
  try { return await big.get(key) } catch { return null }
}

const DB = 'mtgweb_tags'
const STORE = 'kv'
let db: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('No IndexedDB here')); return }
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  db.catch(() => { db = null })
  return db
}

/** This browser's IndexedDB, as a BigStore. */
export const indexedStore: BigStore = {
  async get(key) {
    const d = await open()
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  },
  async set(key, value) {
    const d = await open()
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  },
}

/** This browser's localStorage, or null where there's none (tests, some private windows). */
export function browserStore(): TextStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

// Scryfall's data for the cards you own, kept in this browser (IndexedDB) so the next visit — or one
// with no connection — has it straight away instead of asking Scryfall again for every printing: a
// 25,000-card collection is hundreds of requests. A saved card is used as it is for a day, then asked
// for again in the background (prices move). Best effort: with no IndexedDB (a private window) or no
// room, cards are kept for this visit only, as before. Counted by Settings › Data and speed ("Card
// data saved for offline"). The Android app keeps the same on the phone (data/CardDataCache.kt).

import type { ScryfallCard } from '../types/scryfall'

const DB = 'manabind-cards'
const STORE = 'cards'
/** A saved card younger than this is used without asking Scryfall again. */
export const FRESH_MS = 24 * 60 * 60 * 1000

interface Saved { card: ScryfallCard; at: number }

/** When each saved card was fetched, by printing id. Null until read. */
let savedAt: Map<string, number> | null = null
let loading: Promise<Map<string, ScryfallCard>> | null = null
let writing: Promise<void> = Promise.resolve()

/** What isn't worth keeping: links to Scryfall's own pages and shops, ids for other sites. */
const DROPPED = ['purchase_uris', 'related_uris', 'uri', 'scryfall_uri', 'rulings_uri', 'prints_search_uri', 'set_uri', 'set_search_uri',
  'scryfall_set_uri', 'multiverse_ids', 'artist_ids', 'tcgplayer_id', 'tcgplayer_etched_id', 'cardmarket_id', 'mtgo_id', 'mtgo_foil_id', 'arena_id']

/** [card] without the fields not worth keeping. */
export function slimCard(card: ScryfallCard): ScryfallCard {
  const out = { ...card } as Record<string, unknown>
  for (const k of DROPPED) delete out[k]
  return out as unknown as ScryfallCard
}

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

/** Every saved card, read once a visit. */
export function loadSavedCards(): Promise<Map<string, ScryfallCard>> {
  loading ??= (async () => {
    const out = new Map<string, ScryfallCard>()
    const at = new Map<string, number>()
    try {
      const db = await openDb()
      try {
        const all = await new Promise<Saved[]>((resolve, reject) => {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
          req.onsuccess = () => resolve((req.result ?? []) as Saved[])
          req.onerror = () => reject(req.error)
        })
        for (const s of all) {
          if (!s?.card?.id) continue
          out.set(s.card.id, s.card)
          at.set(s.card.id, s.at)
        }
      } finally {
        db.close()
      }
    } catch { /* nothing saved, or no IndexedDB: this visit only */ }
    savedAt = at
    return out
  })()
  return loading
}

/** Keeps [cards], fetched just now. */
export function saveCards(cards: ScryfallCard[], now = Date.now()) {
  if (cards.length === 0) return
  const at = savedAt ?? new Map<string, number>()
  savedAt = at
  for (const c of cards) at.set(c.id, now)
  writing = writing.then(async () => {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        for (const c of cards) store.put({ card: slimCard(c), at: now } satisfies Saved, c.id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }).catch(() => { /* blocked or full: this visit only */ })
}

/** Whether the saved copy of [id] is old enough to ask Scryfall again. False when it isn't saved. */
export function isStale(id: string, now = Date.now()): boolean {
  const at = savedAt?.get(id)
  return at !== undefined && now - at > FRESH_MS
}

/** How many of [ids] are saved in this browser. */
export async function savedCount(ids: Iterable<string>): Promise<number> {
  await loadSavedCards()
  let n = 0
  for (const id of ids) if (savedAt?.has(id)) n++
  return n
}

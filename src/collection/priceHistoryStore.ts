// Where this browser keeps each card's price history (see cardPriceHistory.ts): IndexedDB, not
// localStorage — localStorage is a few megabytes, already holds the library, and a year of prices
// for a large collection would crowd it out. The history is a nice-to-have: if IndexedDB is missing
// (a private window, an old browser) or full, the history lives for this visit only and nothing
// else is affected. Mirrors the Android app's CardPriceHistory object.

import { useEffect, useState } from 'react'
import { epochDay, priceHistoryFromJson, priceHistoryToJson, withPricesNoted, type PriceTrack, type ScryfallPrices } from './cardPriceHistory'

const DB = 'manabind'
const STORE = 'kv'
const KEY = 'card_price_history'

let tracks: Map<string, PriceTrack> | null = null
let loading: Promise<Map<string, PriceTrack>> | null = null
/** Writes go one after another, so an older one can't land after a newer. */
let writing: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()

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

async function readStored(): Promise<unknown> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function writeStored(value: unknown): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Every card's history by scryfallId, read from the browser the first time it's wanted. */
export function loadPriceHistory(): Promise<Map<string, PriceTrack>> {
  if (tracks) return Promise.resolve(tracks)
  loading ??= readStored()
    .then((raw) => priceHistoryFromJson(raw))
    .catch(() => new Map<string, PriceTrack>())
    .then((read) => {
      // A note made while it was being read is kept on top of what was read.
      tracks = tracks ? new Map([...read, ...tracks]) : read
      listeners.forEach((l) => l())
      return tracks
    })
  return loading
}

/** The history as it stands; null until it's been read ([loadPriceHistory]). */
export const priceHistoryNow = () => tracks

/**
 * Notes today's prices of these cards (scryfallId → Scryfall's prices); stored only when something
 * changed. Never throws: a failed write leaves the history in memory for this visit.
 */
export async function recordCardPrices(prices: Map<string, ScryfallPrices | null | undefined>): Promise<void> {
  if (prices.size === 0) return
  try {
    await loadPriceHistory()
    // The history as it is now, not as it was read: two notes can be on their way at once (Home's
    // value and the alert check), and the second mustn't undo the first.
    const had = tracks ?? new Map<string, PriceTrack>()
    const next = withPricesNoted(had, epochDay(), prices)
    if (next === had) return
    tracks = next
    listeners.forEach((l) => l())
    const json = priceHistoryToJson(next)
    writing = writing.then(() => writeStored(json)).catch(() => { /* this visit only */ })
    await writing
  } catch {
    // The history is extra: nothing else waits on it.
  }
}

/** One card's history, re-rendering as notes come in: undefined while it's read, null when there's none. */
export function usePriceTrack(scryfallId: string): PriceTrack | null | undefined {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    void loadPriceHistory()
    return () => { listeners.delete(l) }
  }, [])
  if (!tracks) return undefined
  return tracks.get(scryfallId) ?? null
}

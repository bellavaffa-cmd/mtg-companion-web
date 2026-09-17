// Per-item library sync with Supabase — the same table, rules and bookkeeping as the Android app's
// SupabaseSync.kt, so a deck edited on the phone and one edited here never overwrite each other.
// One row per deck/binder in public.library_items; same-item conflicts resolve last-edit-wins by the
// time of the edit, and the server's push_library_items refuses anything older than what it has.

import type { Collection, Deck } from '../types/models'
import { normalizeDeck } from '../types/models'
import { apiHeaders, AuthError, restUrl } from './supabaseAuth'

const STATE_KEY = 'mtgweb_cloud_state'

export interface Library {
  decks: Deck[]
  collections: Collection[]
}

interface ItemMeta {
  /** Hash of the item's JSON as last agreed with the server; 0 for a deletion. */
  hash: number
  editedMs: number
  deleted?: boolean
}

export interface CloudState {
  userId: string | null
  /** Keys are "deck:<id>" / "collection:<id>". */
  items: Record<string, ItemMeta>
  /** Local edits not yet on the server: key -> edit time (0 = existed before this browser first synced). */
  pending: Record<string, number>
  /** server_updated_at of the newest row already pulled. */
  cursor: string | null
  lastSyncedAt: number
}

export const emptyCloudState = (userId: string | null = null): CloudState =>
  ({ userId, items: {}, pending: {}, cursor: null, lastSyncedAt: 0 })

export function loadCloudState(): CloudState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? { ...emptyCloudState(), ...JSON.parse(raw) } : emptyCloudState()
  } catch {
    return emptyCloudState()
  }
}

export function saveCloudState(state: CloudState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
}

export function clearCloudState() {
  localStorage.removeItem(STATE_KEY)
}

/** 32-bit FNV-1a — only compared with hashes this browser computed itself. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0 || 1
}

/**
 * JSON with object keys sorted. Postgres jsonb doesn't keep key order, so a deck this browser pushed
 * comes back from the server reordered — comparing canonical JSON keeps that from looking like a change.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

export function libraryJson(lib: Library): Map<string, string> {
  const out = new Map<string, string>()
  lib.decks.forEach((d) => out.set(`deck:${d.id}`, canonicalJson(d)))
  lib.collections.forEach((c) => out.set(`collection:${c.id}`, canonicalJson(c)))
  return out
}

interface RemoteRow {
  kind: 'deck' | 'collection'
  id: string
  data: Record<string, unknown> | null
  edited_ms: number
  deleted: boolean
  server_updated_at: string
}

export class SyncError extends Error {}

async function request(path: string, token: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(restUrl(path), { ...init, headers: apiHeaders(token) })
  } catch {
    throw new SyncError("Offline — will sync when you're back online.")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    if (res.status === 401) throw new AuthError('Session expired — sign in again.')
    throw new SyncError(body.message ? `${body.message} (HTTP ${res.status})` : `Server error (HTTP ${res.status})`)
  }
  return res
}

async function pull(token: string, cursor: string | null): Promise<RemoteRow[]> {
  const rows: RemoteRow[] = []
  let after = cursor
  for (;;) {
    const params = new URLSearchParams({
      select: 'kind,id,data,edited_ms,deleted,server_updated_at',
      order: 'server_updated_at.asc',
      limit: '500',
    })
    if (after) params.set('server_updated_at', `gt.${after}`)
    const page = (await (await request(`/rest/v1/library_items?${params}`, token)).json()) as RemoteRow[]
    rows.push(...page)
    if (page.length < 500) return rows
    after = page[page.length - 1].server_updated_at
  }
}

export interface SyncOutcome {
  state: CloudState
  /** Remote changes to apply to the live library: key -> new item, or null to remove it. */
  remoteChanges: Map<string, Deck | Collection | null>
}

/**
 * One sync pass over [snapshot] (the library as it was when the pass started):
 * 1. note local changes since the last agreement with the server,
 * 2. pull rows newer than the cursor, keeping any pending local edit that's newer,
 * 3. push what's still pending.
 */
/** Local changes since the last agreement with the server, each stamped with when it was first noticed. */
function detectPending(local: Map<string, string>, state: CloudState, now: number): Record<string, number> {
  const pending = { ...state.pending }
  local.forEach((json, key) => {
    const meta = state.items[key]
    if (!meta || meta.deleted || meta.hash !== hash(json)) {
      if (!(key in pending)) pending[key] = !meta && state.cursor === null ? 0 : now
    } else {
      delete pending[key]
    }
  })
  Object.entries(state.items).forEach(([key, meta]) => {
    if (!meta.deleted && !local.has(key) && !(key in pending)) pending[key] = now
  })
  return pending
}

/**
 * Notes local edits and when they happened, without touching the network. Called before each sync
 * attempt, so an edit made offline keeps its own time rather than the time the browser next reaches
 * the server — which could otherwise overwrite a newer edit of the same deck made on another device.
 */
export function recordLocalEdits(snapshot: Library, userId: string): void {
  const loaded = loadCloudState()
  const state = loaded.userId === userId ? loaded : emptyCloudState(userId)
  const pending = detectPending(libraryJson(snapshot), state, Date.now())
  if (JSON.stringify(pending) !== JSON.stringify(state.pending)) saveCloudState({ ...state, pending })
}

export async function syncOnce(snapshot: Library, startState: CloudState, userId: string, token: string): Promise<SyncOutcome> {
  let state = startState.userId === userId ? startState : emptyCloudState(userId)
  const local = libraryJson(snapshot)
  const now = Date.now()
  const pending = detectPending(local, state, now)

  const rows = await pull(token, state.cursor)
  const items = { ...state.items }
  const remoteChanges = new Map<string, Deck | Collection | null>()
  let cursor = state.cursor
  for (const row of rows) {
    cursor = row.server_updated_at
    const key = `${row.kind}:${row.id}`
    const localEdit = pending[key]
    if (localEdit !== undefined && localEdit > row.edited_ms) continue // ours is newer; pushed below
    if (row.deleted || !row.data) {
      if (local.has(key)) remoteChanges.set(key, null)
      items[key] = { hash: 0, editedMs: row.edited_ms, deleted: true }
    } else {
      const item = row.kind === 'deck'
        ? normalizeDeck(row.data as unknown as Deck)
        : (row.data as unknown as Collection)
      const json = canonicalJson(item)
      if (local.get(key) !== json) remoteChanges.set(key, item)
      items[key] = { hash: hash(json), editedMs: row.edited_ms }
    }
    delete pending[key]
  }
  state = { ...state, items, pending, cursor }
  saveCloudState(state)

  const keys = Object.keys(pending)
  if (keys.length > 0) {
    const pushed: Record<string, ItemMeta> = {}
    const batch = keys.map((key) => {
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
      const editedMs = pending[key] === 0 ? now : pending[key]
      const json = local.get(key)
      if (json === undefined) {
        pushed[key] = { hash: 0, editedMs, deleted: true }
        return { kind, id, edited_ms: editedMs, deleted: true }
      }
      pushed[key] = { hash: hash(json), editedMs }
      return { kind, id, edited_ms: editedMs, deleted: false, data: JSON.parse(json) }
    })
    await request('/rest/v1/rpc/push_library_items', token, { method: 'POST', body: JSON.stringify({ items: batch }) })
    state = { ...state, items: { ...state.items, ...pushed }, pending: {} }
  }
  state = { ...state, lastSyncedAt: Date.now() }
  saveCloudState(state)
  return { state, remoteChanges }
}

/**
 * Applies [changes] to the live library. Items edited locally while the sync was running (their
 * JSON no longer matches [snapshot]) are left alone — the next pass sees them as pending and pushes
 * the newer edit.
 */
export function applyRemoteChanges(live: Library, snapshot: Library, changes: Map<string, Deck | Collection | null>): Library {
  if (changes.size === 0) return live
  const before = libraryJson(snapshot)
  const now = libraryJson(live)
  const untouched = (key: string) => before.get(key) === now.get(key)

  let decks = live.decks
  let collections = live.collections
  changes.forEach((item, key) => {
    if (!untouched(key)) return
    const id = key.slice(key.indexOf(':') + 1)
    if (key.startsWith('deck:')) {
      const rest = decks.filter((d) => d.id !== id)
      const index = decks.findIndex((d) => d.id === id)
      if (item === null) decks = rest
      else if (index >= 0) decks = decks.map((d) => (d.id === id ? (item as Deck) : d))
      else decks = [...rest, item as Deck]
    } else {
      const index = collections.findIndex((c) => c.id === id)
      if (item === null) collections = collections.filter((c) => c.id !== id)
      else if (index >= 0) collections = collections.map((c) => (c.id === id ? (item as Collection) : c))
      else collections = [...collections, item as Collection]
    }
  })
  return { decks, collections }
}

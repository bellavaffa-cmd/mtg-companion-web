// Per-item library sync with Supabase — the same table, rules and bookkeeping as the Android app's
// SupabaseSync.kt, so a deck edited on the phone and one edited here never overwrite each other.
// One row per deck/binder in public.library_items. When both sides changed the same deck since they
// last agreed, the edits are merged card by card (see mergeItems.ts); otherwise conflicts resolve
// last-edit-wins by the
// time of the edit, and the server's push_library_items refuses anything older than what it has.

import type { Collection, Deck } from '../types/models'
import { mergeCollection, mergeDeck } from './mergeItems'
import { normalizeDeck } from '../types/models'
import { apiHeaders, OfflineError, restUrl } from './supabaseAuth'
import { canonicalJson } from './canonicalJson'

const STATE_KEY = 'mtgweb_cloud_state'

/** A request that hasn't answered by now is treated like being offline, so a sync can't hang forever. */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Each pull reads back this far before the cursor. A row is stamped when it's written but only seen
 * once its push commits, so a slow push can land behind rows another device already pulled past.
 * Reading a row again is harmless: one this device already has counts as agreed and changes nothing.
 */
const PULL_OVERLAP_MS = 60_000

export interface Library {
  decks: Deck[]
  collections: Collection[]
}

interface ItemMeta {
  /** Hash of the item's JSON as last agreed with the server; 0 for a deletion. */
  hash: number
  /** The edit time of the version last agreed on — or of this browser's last push of it. */
  editedMs: number
  deleted?: boolean
  /**
   * The item's JSON as last agreed with the server. When this device and another have both changed
   * the same deck since then, this is what the merge compares them against (see mergeItems.ts).
   * Absent for items last synced by an older version, which fall back to newest-edit-wins.
   */
  base?: string
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
  /**
   * Items from a push the server partly skipped (it held a newer edit of some of them). The next
   * pass reads these rows back even if the cursor is past them, and merges where needed.
   */
  refetch?: string[]
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

export const CLOUD_STATE_KEY = STATE_KEY

/** 32-bit FNV-1a — only compared with hashes this browser computed itself. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0 || 1
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

/** A data request's access token was refused (HTTP 401); the caller refreshes the session and retries once. */
export class UnauthorizedError extends Error {}

async function request(path: string, token: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(restUrl(path), { ...init, headers: apiHeaders(token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    throw new OfflineError("Offline — will sync when you're back online.")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    if (res.status === 401) throw new UnauthorizedError("The server didn't accept this sign-in. Try again, or sign out and back in.")
    throw new SyncError(body.message ? `${body.message} (HTTP ${res.status})` : `Server error (HTTP ${res.status})`)
  }
  return res
}

const ROW_FIELDS = 'kind,id,data,edited_ms,deleted,server_updated_at'

async function pull(token: string, cursor: string | null): Promise<RemoteRow[]> {
  const rows: RemoteRow[] = []
  const cursorMs = cursor ? Date.parse(cursor) : NaN
  let after = Number.isFinite(cursorMs) ? new Date(cursorMs - PULL_OVERLAP_MS).toISOString() : cursor
  for (;;) {
    const params = new URLSearchParams({ select: ROW_FIELDS, order: 'server_updated_at.asc', limit: '500' })
    if (after) params.set('server_updated_at', `gt.${after}`)
    const page = (await (await request(`/rest/v1/library_items?${params}`, token)).json()) as RemoteRow[]
    rows.push(...page)
    if (page.length < 500) return rows
    after = page[page.length - 1].server_updated_at
  }
}

/** The current rows for [keys], wherever they sit relative to the cursor. */
async function fetchRows(token: string, keys: string[]): Promise<RemoteRow[]> {
  const out: RemoteRow[] = []
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100)
    const ids = [...new Set(chunk.map((key) => key.slice(key.indexOf(':') + 1)))]
    const params = new URLSearchParams({ select: ROW_FIELDS, id: `in.(${ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')})` })
    const page = (await (await request(`/rest/v1/library_items?${params}`, token)).json()) as RemoteRow[]
    out.push(...page.filter((row) => chunk.includes(`${row.kind}:${row.id}`)))
  }
  return out
}

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

/** What a pull found. Nothing is saved yet: apply [remoteChanges] locally, then save [state], then push. */
export interface PullOutcome {
  state: CloudState
  /** Remote changes to apply to the live library: key -> new item, or null to remove it. */
  remoteChanges: Map<string, Deck | Collection | null>
  /** Every item as it should be pushed: the snapshot, with merged items in place of the originals. */
  local: Map<string, string>
  startedAt: number
}

/**
 * The first half of a sync pass over [snapshot] (the library as it was when the pass started):
 * note local changes since the last agreement with the server, then pull rows newer than the cursor,
 * merging where both sides changed an item and keeping any pending local edit that's newer.
 */
export async function pullChanges(snapshot: Library, startState: CloudState, userId: string, token: string): Promise<PullOutcome> {
  const state = startState.userId === userId ? startState : emptyCloudState(userId)
  const local = libraryJson(snapshot)
  const now = Date.now()
  const pending = detectPending(local, state, now)

  const rows = await pull(token, state.cursor)
  // Rows a partly skipped push left behind, unless the cursor pull already brought a newer copy.
  const inPull = new Set(rows.map((row) => `${row.kind}:${row.id}`))
  const again = state.refetch?.length
    ? (await fetchRows(token, state.refetch)).filter((row) => !inPull.has(`${row.kind}:${row.id}`))
    : []

  const items = { ...state.items }
  const remoteChanges = new Map<string, Deck | Collection | null>()
  let cursor = state.cursor
  for (const row of [...again, ...rows]) {
    // Never backwards: rows re-read from the overlap come before the cursor.
    if (inPull.has(`${row.kind}:${row.id}`) && (cursor === null || row.server_updated_at > cursor)) cursor = row.server_updated_at
    const key = `${row.kind}:${row.id}`
    const localEdit = pending[key]
    if (row.deleted) {
      // A deck deleted elsewhere goes, unless this device edited it more recently.
      if (localEdit !== undefined && localEdit > row.edited_ms) continue
      if (local.has(key)) remoteChanges.set(key, null)
      items[key] = { hash: 0, editedMs: row.edited_ms, deleted: true }
      delete pending[key]
      continue
    }
    if (!row.data) continue // not readable; a later edit will bring it
    const theirs = row.kind === 'deck'
      ? normalizeDeck(row.data as unknown as Deck)
      : (row.data as unknown as Collection)
    const theirJson = canonicalJson(theirs)
    const mineJson = local.get(key)
    const meta = state.items[key]
    // This browser's own write coming back (or a row it already agreed on): stamped with the edit time
    // it last pushed, and holding what it pushed. That is now the agreed version. The content check
    // matters: another device merging from the same row can land on the very same stamp.
    if (meta && !meta.deleted && meta.editedMs === row.edited_ms && (meta.hash === hash(theirJson) || meta.base === theirJson)) {
      items[key] = { ...meta, base: theirJson }
      if (mineJson !== undefined && hash(mineJson) !== meta.hash) {
        // Edited again since: that edit is simply pushed — nothing from elsewhere to merge in.
        pending[key] = Math.max(pending[key] ?? now, row.edited_ms + 1)
      } else if (mineJson !== undefined) {
        delete pending[key]
      }
      continue
    }
    const baseJson = meta?.base

    // This device has diverged if its copy differs from the version both sides last agreed on —
    // which stays true even when a push was skipped as stale server-side.
    const diverged = mineJson !== undefined && baseJson !== undefined && mineJson !== baseJson
    // This browser has the item but has never agreed a version of it with the server — its first
    // sync, say, with the same deck already in the cloud from somewhere else. With nothing to compare
    // against, keep every card from both rather than letting the cloud copy replace this one. (Not
    // tied to a pending edit: a first push the server skipped leaves none.)
    const firstMeeting = mineJson !== undefined && meta === undefined
    // Both devices changed this one since they last agreed: keep both sets of edits.
    if ((diverged || firstMeeting) && mineJson !== theirJson) {
      const mine = JSON.parse(mineJson!)
      // First meeting: an empty base makes every card an addition from both sides, and the cloud's
      // name and settings win.
      const base = baseJson !== undefined
        ? JSON.parse(baseJson)
        : row.kind === 'deck'
          ? { ...mine, cards: [], considering: [], tags: [], gameResults: [], versions: [] }
          : { ...mine, entries: [] }
      const merged = row.kind === 'deck'
        ? mergeDeck(base as Deck, mine as Deck, JSON.parse(theirJson) as Deck, (localEdit ?? 0) > row.edited_ms)
        : mergeCollection(base as Collection, mine as Collection, JSON.parse(theirJson) as Collection, (localEdit ?? 0) > row.edited_ms)
      const mergedJson = canonicalJson(merged)
      if (mergedJson !== mineJson) remoteChanges.set(key, merged)
      // Push the merged version, stamped past their edit so the server can't reject it as stale,
      // and keep their version as the new base.
      local.set(key, mergedJson)
      pending[key] = Math.max(now, row.edited_ms + 1)
      items[key] = { hash: hash(theirJson), editedMs: row.edited_ms, base: theirJson }
      continue
    }

    if (localEdit !== undefined && localEdit > row.edited_ms) {
      continue // ours is newer; pushed below
    }
    if (mineJson !== theirJson) remoteChanges.set(key, theirs)
    items[key] = { hash: hash(theirJson), editedMs: row.edited_ms, base: theirJson }
    delete pending[key]
  }
  return { state: { ...state, items, pending, cursor, refetch: [] }, remoteChanges, local, startedAt: now }
}

/**
 * The second half of a pass: push what's still pending after [pulled], and return the state to keep.
 * Save [pulled].state before calling this, so a push that fails doesn't lose what was pulled.
 */
export async function pushPending(pulled: PullOutcome, token: string): Promise<{ state: CloudState; pushed: number }> {
  let state = pulled.state
  const keys = Object.keys(state.pending)
  let written = 0
  if (keys.length > 0) {
    const pushedJson: Record<string, string | undefined> = {}
    const batch = keys.map((key) => {
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
      const editedMs = state.pending[key] === 0 ? pulled.startedAt : state.pending[key]
      const json = pulled.local.get(key)
      pushedJson[key] = json
      return json === undefined
        ? { kind, id, edited_ms: editedMs, deleted: true }
        : { kind, id, edited_ms: editedMs, deleted: false, data: JSON.parse(json) }
    })
    const res = await request('/rest/v1/rpc/push_library_items', token, { method: 'POST', body: JSON.stringify({ items: batch }) })
    // The server skips any item older than what it already holds, and answers with how many it wrote.
    const answer = Number((await res.text()).trim())
    written = Number.isFinite(answer) ? answer : batch.length
    // Which items landed. Usually all of them; if the server skipped some (it held a newer edit),
    // read the rows straight back — each one still carrying our stamp is ours. Left to the next pass,
    // another device could build on one of our writes first, and our change would count twice.
    let landed = new Set(answer === batch.length ? keys : [])
    let unsure = answer === batch.length ? [] : keys
    if (unsure.length > 0) {
      try {
        const stamps = new Map(batch.map((item) => [`${item.kind}:${item.id}`, item.edited_ms]))
        const rows = await fetchRows(token, keys)
        landed = new Set(rows.filter((row) => stamps.get(`${row.kind}:${row.id}`) === row.edited_ms).map((row) => `${row.kind}:${row.id}`))
        unsure = keys.filter((key) => !landed.has(key))
      } catch {
        // Couldn't check: treat them all as unsure, and read them back next pass.
      }
    }
    const items = { ...state.items }
    batch.forEach((item) => {
      const key = `${item.kind}:${item.id}`
      const json = pushedJson[key]
      // A first push the server skipped (another device had already put this item in the cloud):
      // still never agreed, so the next pass meets it as a first meeting and merges both copies.
      if (!landed.has(key) && !state.items[key]) return
      items[key] = json === undefined
        ? { hash: 0, editedMs: item.edited_ms, deleted: true }
        // Written: the pushed version is now what both sides agree on. Skipped: the old base stays,
        // and the next pass reads the newer row back and merges.
        : { hash: hash(json), editedMs: item.edited_ms, base: landed.has(key) ? json : state.items[key]?.base }
    })
    state = { ...state, items, pending: {}, refetch: unsure }
  }
  return { state: { ...state, lastSyncedAt: Date.now() }, pushed: written }
}

/**
 * Applies [changes] to the live library. An item edited locally while the sync was running (its
 * JSON no longer matches [snapshot]) gets the remote version merged into it — the next pass then
 * sees it as a local change and pushes the combination.
 */
export function applyRemoteChanges(live: Library, snapshot: Library, changes: Map<string, Deck | Collection | null>): Library {
  if (changes.size === 0) return live
  const before = libraryJson(snapshot)
  const now = libraryJson(live)

  const resolve = <T extends Deck | Collection>(key: string, item: T | null, was: T | undefined, current: T | undefined, merge: (b: T, m: T, t: T) => T): T | null | undefined => {
    if (before.get(key) === now.get(key)) return item // untouched here: take the remote version
    if (item === null || current === undefined || was === undefined) return undefined // keep the local change
    return merge(was, current, item)
  }

  let decks = live.decks
  let collections = live.collections
  changes.forEach((item, key) => {
    const id = key.slice(key.indexOf(':') + 1)
    if (key.startsWith('deck:')) {
      const next = resolve(key, item as Deck | null, snapshot.decks.find((d) => d.id === id), decks.find((d) => d.id === id),
        (b, m, t) => mergeDeck(b, m, t, true))
      if (next === undefined) return
      if (next === null) decks = decks.filter((d) => d.id !== id)
      else if (decks.some((d) => d.id === id)) decks = decks.map((d) => (d.id === id ? next : d))
      else decks = [...decks, next]
    } else {
      const next = resolve(key, item as Collection | null, snapshot.collections.find((c) => c.id === id), collections.find((c) => c.id === id),
        (b, m, t) => mergeCollection(b, m, t, true))
      if (next === undefined) return
      if (next === null) collections = collections.filter((c) => c.id !== id)
      else if (collections.some((c) => c.id === id)) collections = collections.map((c) => (c.id === id ? next : c))
      else collections = [...collections, next]
    }
  })
  return { decks, collections }
}

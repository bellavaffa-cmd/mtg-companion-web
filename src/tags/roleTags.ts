// What a card does in a deck — mana ramp, card draw, removal… — from Scryfall Tagger, where the
// community tags every card by its job (searchable as `otag:ramp`). Far more reliable than reading
// rules text. A few jobs Tagger has no tag for are a rules-text search instead.
//
// Tags are looked up by card name, a few names per search, one search per tag, and remembered in
// this browser for a month — so a deck or collection is tagged once, and opens instantly after.
// The Android app does the same (data/RoleTags.kt) with the same list.

import { useEffect, useMemo, useState } from 'react'
import { searchCards } from '../api/scryfall'

export interface RoleTag {
  id: string
  label: string
  /** The Scryfall search that finds every card with this tag. */
  query: string
}

/** The default tags, most useful first. Changing it re-tags every card (see CACHE_VERSION). */
export const ROLE_TAGS: RoleTag[] = [
  { id: 'ramp', label: 'Mana ramp', query: 'otag:ramp' },
  { id: 'mana-rock', label: 'Mana rock', query: 'otag:mana-rock' },
  { id: 'mana-dork', label: 'Mana dork', query: 'otag:mana-dork' },
  { id: 'land-ramp', label: 'Land ramp', query: 'otag:land-ramp' },
  { id: 'mana-engine', label: 'Mana engine', query: '(otag:mana-doubler or otag:cost-reducer)' },
  { id: 'draw', label: 'Card draw', query: 'otag:draw' },
  { id: 'tutor', label: 'Tutor', query: 'otag:tutor' },
  { id: 'removal', label: 'Removal', query: 'otag:removal' },
  { id: 'board-wipe', label: 'Board wipe', query: 'otag:board-wipe' },
  { id: 'counterspell', label: 'Counterspell', query: 'otag:counterspell' },
  { id: 'protection', label: 'Protection', query: 'otag:protection' },
  { id: 'recursion', label: 'Recursion', query: 'otag:recursion' },
  { id: 'reanimate', label: 'Reanimation', query: 'otag:reanimate' },
  { id: 'sacrifice-outlet', label: 'Sacrifice outlet', query: 'otag:sacrifice-outlet' },
  { id: 'tokens', label: 'Token maker', query: '(o:/create[^.]*creature tokens?/ -o:"would create")' },
  { id: 'treasure', label: 'Treasure', query: 'o:/create[^.]*treasure/' },
  { id: 'tax', label: 'Tax', query: 'otag:tax' },
  { id: 'lifegain', label: 'Lifegain', query: 'otag:lifegain' },
  { id: 'burn', label: 'Burn', query: 'otag:burn' },
  { id: 'graveyard-hate', label: 'Graveyard hate', query: 'otag:graveyard-hate' },
  { id: 'extra-turn', label: 'Extra turn', query: 'otag:extra-turn' },
  { id: 'wheel', label: 'Wheel', query: 'otag:wheel' },
]

const BY_ID = new Map(ROLE_TAGS.map((t) => [t.id, t]))
export const tagById = (id: string) => BY_ID.get(id)
export const tagLabel = (id: string) => BY_ID.get(id)?.label ?? id

/** Commander deck targets for the core jobs — the same as the Android app's deck stats. */
export const COMMANDER_TARGETS: Record<string, [number, number]> = {
  ramp: [10, 12],
  draw: [10, 12],
  removal: [8, 10],
  'board-wipe': [2, 3],
}

const CACHE_KEY = 'mtgweb_role_tags'
const CACHE_VERSION = 2
/** Tags hardly change; a card is looked up again after this long. */
const FRESH_MS = 30 * 24 * 60 * 60 * 1000
/** Names per search: keeps the address well under Scryfall's limit. */
const CHUNK = 40
/** Scryfall asks for 50–100 ms between requests. */
const SPACING_MS = 100

interface Cache { v: number; cards: Record<string, { t: string[]; at: number }> }

const key = (name: string) => name.trim().toLowerCase()

const cache: Cache = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null
    return raw && raw.v === CACHE_VERSION && raw.cards ? raw : { v: CACHE_VERSION, cards: {} }
  } catch {
    return { v: CACHE_VERSION, cards: {} }
  }
})()

function persist() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* full: kept for this visit only */ }
}

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

/** A card's tag ids, if it has been looked up. */
export function cachedTags(name: string): string[] | undefined {
  return cache.cards[key(name)]?.t
}

/** Every name being looked up right now (or waiting to be), so two screens don't ask twice. */
const pending = new Set<string>()
let queue: Promise<void> = Promise.resolve()
const progress = { done: 0, total: 0 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Looks up the tags of whichever [names] aren't known (or are stale), in the background, one
 * request at a time. Cards found by no search get no tags — that's remembered too.
 */
export function requestTags(names: string[]): void {
  const now = Date.now()
  const wanted = [...new Set(names.map(key))].filter((n) => {
    if (!n || n.includes('"') || pending.has(n)) return false
    const hit = cache.cards[n]
    return !hit || now - hit.at > FRESH_MS
  })
  if (wanted.length === 0) return
  wanted.forEach((n) => pending.add(n))
  progress.total += wanted.length
  changed()
  queue = queue.then(async () => {
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const chunk = wanted.slice(i, i + CHUNK)
      const found = new Map<string, Set<string>>(chunk.map((n) => [n, new Set()]))
      let failed = false
      const names = chunk.map((n) => `!"${n}"`).join(' or ')
      for (const tag of ROLE_TAGS) {
        try {
          // A double-faced card answers to its full name; its front face's is enough to match.
          const page = await searchCards(`${tag.query} (${names})`)
          for (const card of page.cards) {
            const full = key(card.name)
            const front = key(card.name.split(' // ')[0])
            found.get(full)?.add(tag.id)
            found.get(front)?.add(tag.id)
          }
        } catch {
          failed = true // offline, or Scryfall busy: try these names again next time
          break
        }
        await sleep(SPACING_MS)
      }
      const at = Date.now()
      for (const n of chunk) {
        pending.delete(n)
        if (!failed) cache.cards[n] = { t: ROLE_TAGS.filter((t) => found.get(n)?.has(t.id)).map((t) => t.id), at }
      }
      progress.done += chunk.length
      if (!failed) persist()
      changed()
      if (failed) break
    }
    // Anything left over from a failed run goes back to being askable.
    for (const n of wanted) pending.delete(n)
    if (pending.size === 0) { progress.done = 0; progress.total = 0 }
    changed()
  })
}

/**
 * The tags of [names] (name → tag ids, for the ones looked up so far), asking for any not known
 * yet. [loading]: how far along the lookup is, while one's running.
 */
export function useRoleTags(names: string[]): { tags: Map<string, string[]>; loading: { done: number; total: number } | null } {
  const [version, setVersion] = useState(0)
  const namesKey = [...new Set(names.map(key))].sort().join('\n')
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  useEffect(() => {
    if (namesKey) requestTags(namesKey.split('\n'))
  }, [namesKey])
  const tags = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const n of namesKey ? namesKey.split('\n') : []) {
      const t = cache.cards[n]?.t
      if (t) m.set(n, t)
    }
    return m
    // version: the cache changed underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, version])
  const loading = progress.total > 0 && namesKey.split('\n').some((n) => pending.has(n)) ? { ...progress } : null
  return { tags, loading }
}

/** A card's tag ids from a map made by useRoleTags. */
export const tagsOf = (tags: Map<string, string[]>, name: string) => tags.get(key(name)) ?? []

/** Whether [query] finds a card by its name or one of its tags' labels. */
export function matchesNameOrTag(name: string, tagIds: string[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q) || tagIds.some((id) => tagLabel(id).toLowerCase().includes(q))
}

/** The tags among [tagIds] that [query] matched, for "tag: Mana ramp" under a search. */
export const matchedTags = (tagIds: string[], query: string) => {
  const q = query.trim().toLowerCase()
  return q ? tagIds.filter((id) => tagLabel(id).toLowerCase().includes(q)) : []
}

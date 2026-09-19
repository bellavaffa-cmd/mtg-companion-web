// What a card does in a deck — mana ramp, card draw, removal… — from Scryfall Tagger, where the
// community tags every card by its job. Far more reliable than reading rules text. A few jobs
// Tagger has no tag for are read from the rules text instead.
//
// Scryfall allows only 2 card searches a second, so nothing here searches per tag. Instead:
//  - Tagger's oracle tags come as one daily file from Scryfall's file host (no rate limit),
//    fetched about weekly; only the cards under the tags below are kept.
//  - Cards are looked up by name, 75 a request, for their Oracle ids (and rules text).
// Each card's tags are then remembered in this browser for a month — so a deck or collection is
// tagged once, and opens instantly after. The Android app does the same (data/RoleTags.kt).

import { useEffect, useMemo, useState } from 'react'
import { getCollection } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'

export interface RoleTag {
  id: string
  label: string
  /** The Tagger oracle tags that mean it — with every tag below them. */
  slugs?: string[]
  /** A rules-text match instead, for jobs Tagger has no tag for. */
  text?: RegExp
  notText?: RegExp
}

/** The default tags, most useful first. Changing it re-tags every card (see the VERSIONs). */
export const ROLE_TAGS: RoleTag[] = [
  { id: 'ramp', label: 'Mana ramp', slugs: ['ramp'] },
  { id: 'mana-rock', label: 'Mana rock', slugs: ['mana-rock'] },
  { id: 'mana-dork', label: 'Mana dork', slugs: ['mana-dork'] },
  { id: 'land-ramp', label: 'Land ramp', slugs: ['land-ramp'] },
  { id: 'mana-engine', label: 'Mana engine', slugs: ['mana-increaser', 'cost-reducer'] },
  { id: 'draw', label: 'Card draw', slugs: ['draw'] },
  { id: 'tutor', label: 'Tutor', slugs: ['tutor'] },
  { id: 'removal', label: 'Removal', slugs: ['removal'] },
  { id: 'board-wipe', label: 'Board wipe', slugs: ['sweeper'] },
  { id: 'counterspell', label: 'Counterspell', slugs: ['counterspell'] },
  { id: 'protection', label: 'Protection', slugs: ['protection'] },
  { id: 'recursion', label: 'Recursion', slugs: ['recursion'] },
  { id: 'reanimate', label: 'Reanimation', slugs: ['reanimate'] },
  { id: 'sacrifice-outlet', label: 'Sacrifice outlet', slugs: ['sacrifice-outlet'] },
  { id: 'tokens', label: 'Token maker', text: /create[^.]*creature tokens?/i, notText: /would create/i },
  { id: 'treasure', label: 'Treasure', text: /create[^.]*treasure/i },
  { id: 'tax', label: 'Tax', slugs: ['tax'] },
  { id: 'lifegain', label: 'Lifegain', slugs: ['lifegain'] },
  { id: 'burn', label: 'Burn', slugs: ['burn'] },
  { id: 'graveyard-hate', label: 'Graveyard hate', slugs: ['hate-graveyard'] },
  { id: 'extra-turn', label: 'Extra turn', slugs: ['extra-turn'] },
  { id: 'wheel', label: 'Wheel', slugs: ['wheel'] },
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
/** Per-card tags (and colour identity). */
const CACHE_VERSION = 4
const SETS_KEY = 'mtgweb_role_tag_sets'
/** The tag → cards lists from Tagger's file. */
const SETS_VERSION = 1
/** Tags hardly change; a card is looked up again after this long. */
const FRESH_MS = 30 * 24 * 60 * 60 * 1000
/** Tagger's file is refreshed daily; fetching it weekly is plenty. */
const SETS_FRESH_MS = 7 * 24 * 60 * 60 * 1000
/** Names per /cards/collection request (Scryfall's maximum). */
const CHUNK = 75
/** Oracle ids are kept by their first 13 characters: unique enough, a third the size. */
const ID_PREFIX = 13
/** Scryfall unreachable: the cards left are tried again this much later. */
const RESUME_MS = 60_000

/** [c]: the card's colour identity ("WU"; "" colourless), when Scryfall knew the card. */
interface Cache { v: number; cards: Record<string, { t: string[]; at: number; c?: string }> }
type TagSets = Map<string, Set<string>>

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

/** A card's colour identity ("WU"; "" for colourless), if it has been looked up. */
export function cachedIdentity(name: string): string | undefined {
  return cache.cards[key(name)]?.c
}

/** Which of ROLE_TAGS a card has, from its Oracle id (against [sets]) and rules text. */
export function tagsFor(oracleId: string | undefined, oracleText: string, sets: TagSets): string[] {
  const prefix = oracleId?.slice(0, ID_PREFIX)
  return ROLE_TAGS.filter((t) =>
    (prefix != null && sets.get(t.id)?.has(prefix)) ||
    (t.text != null && t.text.test(oracleText) && !t.notText?.test(oracleText)),
  ).map((t) => t.id)
}

/**
 * From Tagger's oracle tags file (one JSON tag per line), the Oracle id prefixes of the cards under
 * each of ROLE_TAGS: tagged with it, one of its other names, or any tag below it.
 */
export function parseTagFile(lines: string[]): TagSets {
  interface Line { id: string; slug: string; aliases?: string[]; child_ids?: string[]; taggings?: { oracle_id?: string }[] }
  // First pass: the tree — every tag's name, other names and children.
  const children = new Map<string, string[]>()
  const bySlug = new Map<string, string>()
  const byTagId = new Map<string, number>()
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const o = JSON.parse(line) as Line
    byTagId.set(o.id, i)
    bySlug.set(o.slug, o.id)
    for (const a of o.aliases ?? []) {
      const slug = a.toLowerCase().replace(/ /g, '-')
      if (!bySlug.has(slug)) bySlug.set(slug, o.id)
    }
    children.set(o.id, o.child_ids ?? [])
  })
  // Each of our tags stands for its Tagger tags and everything under them.
  const wanted = new Map<string, Set<string>>() // Tagger tag id -> our tag ids
  for (const tag of ROLE_TAGS) {
    const stack = (tag.slugs ?? []).map((s) => bySlug.get(s)).filter((id): id is string => !!id)
    const seen = new Set<string>()
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      if (!wanted.has(id)) wanted.set(id, new Set())
      wanted.get(id)!.add(tag.id)
      stack.push(...(children.get(id) ?? []))
    }
  }
  // Second pass: the cards under those tags.
  const out: TagSets = new Map(ROLE_TAGS.map((t) => [t.id, new Set<string>()]))
  for (const [tagId, ours] of wanted) {
    const i = byTagId.get(tagId)
    if (i == null) continue
    const o = JSON.parse(lines[i]) as Line
    for (const t of o.taggings ?? []) {
      if (!t.oracle_id) continue
      const prefix = t.oracle_id.slice(0, ID_PREFIX)
      for (const id of ours) out.get(id)!.add(prefix)
    }
  }
  if (![...out.values()].some((s) => s.size > 0)) throw new Error('no tags found')
  return out
}

let sets: TagSets | null = null
let setsAt = 0
let setsLoading: Promise<TagSets | null> | null = null

/** Fetches Tagger's oracle tags file (about 6 MB, from Scryfall's file host) and reads it. */
async function downloadSets(): Promise<TagSets> {
  const meta = await fetch('https://api.scryfall.com/bulk-data/oracle-tags').then((r) => {
    if (!r.ok) throw new Error(`bulk-data ${r.status}`)
    return r.json()
  })
  const uri: string = meta.jsonl_download_uri ?? meta.download_uri
  const res = await fetch(uri)
  if (!res.ok || !res.body) throw new Error(`oracle-tags ${res.status}`)
  // Served as a .gz file (not gzip-encoded), so it's unpacked here.
  const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text()
  return parseTagFile(text.split('\n'))
}

/** Tagger's tag lists: from this browser, or fetched again when a week old (or missing). */
function loadSets(): Promise<TagSets | null> {
  if (!sets) {
    try {
      const raw = JSON.parse(localStorage.getItem(SETS_KEY) ?? 'null') as { v: number; at: number; sets: Record<string, string> } | null
      if (raw && raw.v === SETS_VERSION) {
        sets = new Map(ROLE_TAGS.map((t) => [t.id, new Set(raw.sets[t.id] ? raw.sets[t.id].split(',') : [])]))
        setsAt = raw.at
      }
    } catch { /* fetched below */ }
  }
  if (sets && Date.now() - setsAt < SETS_FRESH_MS) return Promise.resolve(sets)
  setsLoading ??= downloadSets()
    .then((fresh) => {
      sets = fresh
      setsAt = Date.now()
      const stored: Record<string, string> = {}
      for (const [id, s] of fresh) stored[id] = [...s].join(',')
      try { localStorage.setItem(SETS_KEY, JSON.stringify({ v: SETS_VERSION, at: setsAt, sets: stored })) } catch { /* full: fetched again next visit */ }
      return fresh
    })
    // An old list is better than none while offline.
    .catch(() => sets)
    .finally(() => { setsLoading = null })
  return setsLoading
}

const textOf = (card: ScryfallCard) =>
  [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n')

/** Every name being looked up right now (or waiting to be), so two screens don't ask twice. */
const pending = new Set<string>()
let queue: Promise<void> = Promise.resolve()
const progress = { done: 0, total: 0 }

/**
 * Looks up the tags of whichever [names] aren't known (or are stale), in the background. Cards
 * Scryfall doesn't know get no tags — that's remembered too.
 */
export function requestTags(names: string[]): void {
  const now = Date.now()
  const wanted = [...new Set(names.map(key))].filter((n) => {
    if (!n || pending.has(n)) return false
    const hit = cache.cards[n]
    return !hit || now - hit.at > FRESH_MS
  })
  if (wanted.length === 0) return
  wanted.forEach((n) => pending.add(n))
  progress.total += wanted.length
  changed()
  queue = queue.then(async () => {
    let left: string[] = wanted
    const tagSets = await loadSets()
    if (tagSets) {
      for (let i = 0; i < wanted.length; i += CHUNK) {
        const chunk = wanted.slice(i, i + CHUNK)
        let data: ScryfallCard[]
        try {
          // api/scryfall paces these within Scryfall's limits.
          data = (await getCollection(chunk.map((name) => ({ name })))).data
        } catch {
          break // offline: the rest are tried again below
        }
        const found = new Map<string, { t: string[]; c: string }>()
        for (const card of data) {
          const known = { t: tagsFor(card.oracle_id, textOf(card), tagSets), c: (card.color_identity ?? []).join('') }
          // A double-faced card answers to its full name; its front face's is enough too.
          found.set(key(card.name), known)
          found.set(key(card.name.split(' // ')[0]), known)
        }
        const at = Date.now()
        for (const n of chunk) {
          pending.delete(n)
          const known = found.get(n)
          cache.cards[n] = known ? { ...known, at } : { t: [], at }
        }
        progress.done += chunk.length
        persist()
        changed()
        left = wanted.slice(i + CHUNK)
      }
    }
    // Anything left over goes back to being askable — and is asked again in a minute.
    for (const n of left) pending.delete(n)
    if (left.length) setTimeout(() => requestTags(left), RESUME_MS)
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

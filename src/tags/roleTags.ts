// What a card does in a deck — mana ramp, card draw, removal… — from Scryfall Tagger, where the
// community tags every card by its job. Far more reliable than reading rules text. A few jobs
// Tagger has no tag for are read from the rules text and type line instead.
//
// Scryfall allows only 2 card searches a second, so nothing here searches per tag. Instead:
//  - Tagger's oracle tags come as one daily file from Scryfall's file host (no rate limit),
//    fetched about weekly; only the cards under the tags below are kept.
//  - Cards are looked up 75 a request — by the printing's Scryfall id where it's known (so tokens,
//    proxies and renamed cards resolve), by name otherwise — for their Oracle ids and rules text.
//  - The Oracle id is kept with each card, so a new Tagger file re-tags every card in this browser
//    without asking Scryfall again.
// A card's tags are remembered for a month (one with none, a week) — kept by tagStore.ts, which moves
// them to IndexedDB if localStorage fills up. tagPass.ts tags every card the user has in the
// background. The Android app does the same (data/RoleTags.kt, TagPass.kt) with the same list.

import { useEffect, useMemo, useState } from 'react'
import { getCollection, type CardIdentifier } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import { browserStore, indexedStore, loadText, loadTextNow, saveText } from './tagStore'

export interface RoleTag {
  id: string
  label: string
  /** The Tagger oracle tags that mean it — with every tag below them. */
  slugs?: string[]
  /** A rules-text match instead, for jobs Tagger has no tag for. */
  text?: RegExp
  notText?: RegExp
  /** Worked out from the card's type line and rules text by textTags (Land, Fixing, Vanilla). */
  derived?: boolean
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
  // From the type line and rules text (textTags): jobs Tagger doesn't tag a card with.
  { id: 'land', label: 'Land', derived: true },
  { id: 'fixing', label: 'Fixing', derived: true },
  { id: 'vanilla', label: 'Vanilla', derived: true },
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
/** Per-card tags (and colour identity). 5: Oracle id, text tags and Tagger file kept with each. */
const CACHE_VERSION = 5
const SETS_KEY = 'mtgweb_role_tag_sets'
/** The tag → cards lists from Tagger's file. 2: the file's date kept with them. */
const SETS_VERSION = 2
/** Tags hardly change; a card is looked up again after this long. */
export const FRESH_MS = 30 * 24 * 60 * 60 * 1000
/** A card found with no tags (or not found at all) is looked up again sooner. */
export const EMPTY_FRESH_MS = 7 * 24 * 60 * 60 * 1000
/** Tagger's file is refreshed daily; fetching it weekly is plenty. */
const SETS_FRESH_MS = 7 * 24 * 60 * 60 * 1000
/** Identifiers per /cards/collection request (Scryfall's maximum). */
export const CHUNK = 75
/** Oracle ids are kept by their first 13 characters: unique enough, a third the size. */
const ID_PREFIX = 13
/** Scryfall unreachable mid-lookup: waits before trying the same request again. Then it stops. */
export const RETRY_MS = [2_000, 8_000, 30_000]
/** A stopped lookup is resumed this much later, doubling each time it stops again (and at once when back online). */
const RESUME_MS = 30_000
const RESUME_MAX_MS = 15 * 60_000

/** A card to tag: its name (what screens ask by) and, when known, the printing's Scryfall id. */
export interface TagRef { name: string; scryfallId?: string }

/**
 * What a card's rules text and type line say. [always]: true of it whatever Tagger says. [fallback]:
 * Mana ramp / Card draw / Removal from the text — used only when Tagger has nothing for the card.
 */
export interface TextTags { always: string[]; fallback: string[] }

/**
 * One card's lookup, as kept (the same short keys as the Android app's role_tags.json): [t] its tag
 * ids; [at] when; [c] colour identity ("WU"; "" colourless) when known; [o] the (prefix of the)
 * Oracle id, absent when Scryfall didn't know the card; [r]/[x] its text tags (always/fallback);
 * [f] the Tagger file they were worked out against.
 */
export interface TagRecord { t: string[]; at: number; c?: string; o?: string; r?: string[]; x?: string[]; f?: string }

interface Cache { v: number; cards: Record<string, TagRecord> }
type TagSets = Map<string, Set<string>>

export const key = (name: string) => name.trim().toLowerCase()

/** The cards in a saved cache. One saved before Oracle ids were kept (v4) still shows its tags, but every card in it is due again. */
export function readCards(raw: unknown): Record<string, TagRecord> {
  const o = raw as { v?: number; cards?: Record<string, TagRecord> } | null
  if (!o || !o.cards || (o.v !== CACHE_VERSION && o.v !== 4)) return {}
  if (o.v === CACHE_VERSION) return o.cards
  const out: Record<string, TagRecord> = {}
  for (const [k, r] of Object.entries(o.cards)) out[k] = { t: r.t ?? [], at: 0, ...(r.c != null ? { c: r.c } : {}) }
  return out
}

const local = browserStore()

const cache: Cache = (() => {
  try {
    return { v: CACHE_VERSION, cards: readCards(JSON.parse(loadTextNow(CACHE_KEY, local) ?? 'null')) }
  } catch {
    return { v: CACHE_VERSION, cards: {} }
  }
})()

/** Done once a cache kept in IndexedDB (too big for localStorage) has been read in. */
const ready: Promise<void> = (async () => {
  if (Object.keys(cache.cards).length > 0 || !local) return
  try {
    const text = await loadText(CACHE_KEY, local, indexedStore)
    if (!text) return
    const read = readCards(JSON.parse(text))
    // Anything looked up meanwhile is newer.
    cache.cards = { ...read, ...cache.cards }
    changed()
  } catch { /* nothing saved */ }
})()

let saving: Promise<unknown> = Promise.resolve()
function persist() {
  // One write at a time, the latest cache each time; IndexedDB's are slow.
  saving = saving.then(() => saveText(CACHE_KEY, JSON.stringify(cache), local, indexedStore))
}

const listeners = new Set<() => void>()
function changed() { listeners.forEach((l) => l()) }

/** Calls [l] whenever more cards' tags become known (or a lookup moves on); answers how to stop. */
export function onTagsChanged(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** A card's tag ids, if it has been looked up. */
export function cachedTags(name: string): string[] | undefined {
  return cache.cards[key(name)]?.t
}

/** A card's colour identity ("WU"; "" for colourless), if it has been looked up. */
export function cachedIdentity(name: string): string | undefined {
  return cache.cards[key(name)]?.c
}

/** Looked up, and no tag fits it — the Cards filter's "Untagged". A card not looked up yet isn't. */
export const isUntagged = (name: string) => cachedTags(name)?.length === 0

/** Of [names], how many have at least one tag, and how many there are (each name once): Data and speed's "N of M tagged". */
export function tagCoverage(names: string[]): { tagged: number; total: number } {
  const keys = new Set(names.map(key).filter(Boolean))
  let tagged = 0
  for (const k of keys) if ((cache.cards[k]?.t.length ?? 0) > 0) tagged++
  return { tagged, total: keys.size }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A Scryfall printing id (a UUID) — not a sample's or a hand-made card's made-up id. */
export const isScryfallId = (id: string | undefined): id is string => !!id && UUID.test(id)

/** Card name (key) → the Scryfall id of a printing of it, from the cards the user has (tagPass.ts). */
const idHints = new Map<string, string>()

/** Remembers which printing each of [refs] is, so a lookup by name alone can go by id. */
export function hintIds(refs: TagRef[]): void {
  for (const r of refs) {
    const k = key(r.name)
    if (k && isScryfallId(r.scryfallId) && !idHints.has(k)) idHints.set(k, r.scryfallId)
  }
}

// ---- What the rules text and type line say ----

const LAND = /\bLand\b/
const CREATURE = /\bCreature\b/
const ARTIFACT = /\bArtifact\b/
const ANY_COLOR = /add [^.]*mana of any (one )?(color|colour|type)/i
const FETCH = /search your library for an? [^.]*\b(land|plains|island|swamp|mountain|forest)\b[^.]*cards?/i
const MANA_SYMBOL = /\{([WUBRG])\}/g
const RAMP = /\badd \{[WUBRGC]\}|\badd (one|two|three|x) mana\b|search your library for [^.]*land cards?[^.]*onto the battlefield/i
const DRAW = /\bdraws? (a|an|two|three|four|five|seven|x|that many|cards equal)\b[^.]*\bcards?\b/i
const REMOVAL = /\b(destroy|exile) (target|each|all) [^.]*\b(creature|artifact|enchantment|planeswalker|permanent)s?\b|deals? (\d+|x) damage to (any target|target creature)/i
const COLOURS = new Set(['W', 'U', 'B', 'R', 'G'])

/**
 * What a card's rules text ([oracleText], every face) and type line say it does — see TextTags.
 * [producedMana]: Scryfall's produced_mana, the colours it can make (when known).
 */
export function textTags(oracleText: string | undefined | null, typeLine: string | undefined | null, producedMana?: string[] | null): TextTags {
  const text = oracleText ?? ''
  // A modal double-faced spell with a land back is cast as the spell (as the deck stats' isLand).
  const front = (typeLine ?? '').split(' // ')[0]
  const always = new Set<string>()
  for (const t of ROLE_TAGS) if (t.text && t.text.test(text) && !t.notText?.test(text)) always.add(t.id)
  const land = LAND.test(front)
  if (land) always.add('land')
  if (land || ARTIFACT.test(front)) {
    const colours = new Set((producedMana ?? []).filter((c) => COLOURS.has(c)))
    for (const line of text.split('\n')) {
      if (!/add /i.test(line)) continue
      for (const m of line.matchAll(MANA_SYMBOL)) colours.add(m[1])
    }
    if (colours.size >= 2 || ANY_COLOR.test(text) || FETCH.test(text)) always.add('fixing')
  }
  if (CREATURE.test(front) && text.trim() === '') always.add('vanilla')
  const fallback: string[] = []
  if (!land && RAMP.test(text)) fallback.push('ramp')
  if (DRAW.test(text)) fallback.push('draw')
  if (REMOVAL.test(text)) fallback.push('removal')
  return { always: ROLE_TAGS.map((t) => t.id).filter((id) => always.has(id)), fallback }
}

/**
 * A card's tag ids: Tagger's for its Oracle id [oracle] (a prefix is fine) in [sets], what its text
 * always says, and — only when Tagger has none of its tags for it — the text's fallbacks.
 */
export function combine(oracle: string | undefined, text: TextTags, sets: TagSets): string[] {
  const prefix = oracle?.slice(0, ID_PREFIX)
  const tagger = new Set(prefix == null ? [] : ROLE_TAGS.filter((t) => t.slugs?.length && sets.get(t.id)?.has(prefix)).map((t) => t.id))
  const ids = new Set([...tagger, ...text.always, ...(tagger.size === 0 ? text.fallback : [])])
  return ROLE_TAGS.map((t) => t.id).filter((id) => ids.has(id))
}

/** Which of ROLE_TAGS a card has, from its Oracle id (against [sets]), rules text and type line. */
export function tagsFor(oracleId: string | undefined, oracleText: string, sets: TagSets, typeLine?: string, producedMana?: string[]): string[] {
  return combine(oracleId, textTags(oracleText, typeLine, producedMana), sets)
}

/**
 * Whether [r] is due to be looked up (again): never looked up; a month old; a week old with no tags;
 * or not found by Scryfall under an older Tagger file than [file].
 */
export function isDue(r: TagRecord | undefined, now: number, file: string | undefined | null): boolean {
  if (!r) return true
  const age = now - r.at
  if (age < 0 || age > FRESH_MS) return true
  if (r.t.length === 0 && age > EMPTY_FRESH_MS) return true
  if (r.o == null && file != null && r.f !== file) return true
  return false
}

/**
 * [records] worked out again against Tagger's file [file] ([sets]): every card whose Oracle id is
 * known gets its tags from the new file, without asking Scryfall. Null when none needed it.
 */
export function retagged(records: Record<string, TagRecord>, sets: TagSets, file: string): Record<string, TagRecord> | null {
  let changedAny = false
  const out: Record<string, TagRecord> = {}
  for (const [k, r] of Object.entries(records)) {
    if (r.o != null && r.f !== file) {
      changedAny = true
      out[k] = { ...r, t: combine(r.o, { always: r.r ?? [], fallback: r.x ?? [] }, sets), f: file }
    } else out[k] = r
  }
  return changedAny ? out : null
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
/** Which Tagger file [sets] came from (its date, from Scryfall). */
let setsFile: string | null = null
let setsLoading: Promise<TagSets | null> | null = null

/** Fetches Tagger's oracle tags file (about 6 MB, from Scryfall's file host) and reads it, with the file's date. */
async function downloadSets(): Promise<{ sets: TagSets; file: string }> {
  const meta = await fetch('https://api.scryfall.com/bulk-data/oracle-tags').then((r) => {
    if (!r.ok) throw new Error(`bulk-data ${r.status}`)
    return r.json()
  })
  const uri: string = meta.jsonl_download_uri ?? meta.download_uri
  const res = await fetch(uri)
  if (!res.ok || !res.body) throw new Error(`oracle-tags ${res.status}`)
  // Served as a .gz file (not gzip-encoded), so it's unpacked here.
  const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text()
  return { sets: parseTagFile(text.split('\n')), file: String(meta.updated_at ?? uri) }
}

/**
 * Tagger's tag lists: from this browser, or fetched again when a week old (or missing). A new file
 * re-tags every card already looked up (see retagged).
 */
async function loadSets(): Promise<TagSets | null> {
  if (!sets) {
    try {
      const raw = JSON.parse((await loadText(SETS_KEY, local, indexedStore)) ?? 'null') as { v: number; at: number; file?: string; sets: Record<string, string> } | null
      if (raw && raw.v === SETS_VERSION) {
        sets = new Map(ROLE_TAGS.map((t) => [t.id, new Set(raw.sets[t.id] ? raw.sets[t.id].split(',') : [])]))
        setsAt = raw.at
        setsFile = raw.file ?? String(raw.at)
      }
    } catch { /* fetched below */ }
  }
  if (!sets || Date.now() - setsAt >= SETS_FRESH_MS) {
    setsLoading ??= downloadSets()
      .then((fresh) => {
        sets = fresh.sets
        setsAt = Date.now()
        setsFile = fresh.file
        const stored: Record<string, string> = {}
        for (const [id, s] of fresh.sets) stored[id] = [...s].join(',')
        void saveText(SETS_KEY, JSON.stringify({ v: SETS_VERSION, at: setsAt, file: fresh.file, sets: stored }), local, indexedStore)
        return fresh.sets
      })
      // An old list is better than none while offline.
      .catch(() => sets)
      .finally(() => { setsLoading = null })
    await setsLoading
  }
  // Cards tagged under an older file (or none) are worked out again from their Oracle ids.
  if (sets && setsFile) {
    const again = retagged(cache.cards, sets, setsFile)
    if (again) {
      cache.cards = again
      persist()
      changed()
    }
  }
  return sets
}

/** [block]'s answer, trying again after each of [retries] when it fails; null if it never worked. */
export async function withRetries<T>(retries: number[], sleep: (ms: number) => Promise<void>, block: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt <= retries.length; attempt++) {
    try {
      return await block()
    } catch {
      if (attempt < retries.length) await sleep(retries[attempt])
    }
  }
  return null
}

const textOf = (card: ScryfallCard) =>
  [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n')

/** What [card]'s lookup found, against [sets] from Tagger's file [file]. */
export function recordOf(card: ScryfallCard, sets: TagSets, file: string | null | undefined, at: number): TagRecord {
  const oracle = (card.oracle_id ?? card.card_faces?.find((f) => f.oracle_id)?.oracle_id)?.slice(0, ID_PREFIX)
  const typeLine = card.type_line ?? card.card_faces?.map((f) => f.type_line).filter(Boolean).join(' // ')
  const text = textTags(textOf(card), typeLine, card.produced_mana)
  const r: TagRecord = { t: combine(oracle, text, sets), at, c: (card.color_identity ?? []).join('') }
  if (oracle) r.o = oracle
  if (text.always.length) r.r = text.always
  if (text.fallback.length) r.x = text.fallback
  if (file) r.f = file
  return r
}

type Fetch = (ids: CardIdentifier[]) => Promise<{ data: ScryfallCard[] }>

export interface LookUpOptions {
  retries?: number[]
  /** A wait between requests, for the background pass to go gently. */
  pauseMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Each request's cards (name key → record) as they come, with how many refs are done. */
  onFound: (found: Map<string, TagRecord>, done: number) => void
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Looks [refs] up through [fetch] (Scryfall's /cards/collection), 75 a request: by id where the ref
 * has a Scryfall id, by name otherwise — and by name after all for an id Scryfall doesn't know.
 * Every ref is answered: one Scryfall doesn't know gets an empty record. A failed request is tried
 * again after each of the retries; then this stops, answering false.
 */
export async function lookUp(refs: TagRef[], fetchCards: Fetch, tagSets: TagSets, file: string | null | undefined, opts: LookUpOptions): Promise<boolean> {
  const { retries = RETRY_MS, pauseMs = 0, now = Date.now, sleep = wait, onFound } = opts
  const queue: TagRef[] = refs.map((r) => ({ name: r.name, scryfallId: isScryfallId(r.scryfallId) ? r.scryfallId : undefined }))
  let done = 0
  let first = true
  while (queue.length) {
    const chunk = queue.splice(0, CHUNK)
    if (!first && pauseMs > 0) await sleep(pauseMs)
    first = false
    const ids: CardIdentifier[] = chunk.map((r) => (r.scryfallId ? { id: r.scryfallId } : { name: r.name.trim() }))
    // Stopped: what's left is looked up next time, from here.
    const response = await withRetries(retries, sleep, () => fetchCards(ids))
    if (!response) return false
    const byId = new Map<string, ScryfallCard>()
    const byName = new Map<string, ScryfallCard>()
    for (const card of response.data) {
      byId.set(card.id, card)
      for (const n of [key(card.name), key(card.name.split(' // ')[0])]) if (!byName.has(n)) byName.set(n, card)
    }
    const at = now()
    const found = new Map<string, TagRecord>()
    for (const r of chunk) {
      const k = key(r.name)
      const card = r.scryfallId ? byId.get(r.scryfallId) : byName.get(k)
      if (!card && r.scryfallId) {
        // Not a printing Scryfall knows (any more): try the name.
        queue.push({ name: r.name })
        continue
      }
      done++
      const rec: TagRecord = card ? recordOf(card, tagSets, file, at) : { t: [], at, ...(file ? { f: file } : {}) }
      found.set(k, rec)
      // Its own name too, for screens asking by it (a renamed card, a double-faced card's front).
      if (card) for (const n of [key(card.name), key(card.name.split(' // ')[0])]) if (!found.has(n)) found.set(n, rec)
    }
    if (found.size) onFound(found, done)
  }
  return true
}

/** Every name being looked up right now (or waiting to be), so two screens don't ask twice. */
const pending = new Set<string>()
let queue: Promise<void> = Promise.resolve()
const progress = { done: 0, total: 0 }
let resumeMs = RESUME_MS
let resumeTimer: ReturnType<typeof setTimeout> | null = null
/** What a stopped lookup still had to do, for when it's resumed. */
const left = new Map<string, TagRef>()

function resumeLater() {
  if (resumeTimer) return
  resumeTimer = setTimeout(resumeNow, resumeMs)
  resumeMs = Math.min(resumeMs * 2, RESUME_MAX_MS)
}

function resumeNow() {
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null }
  const refs = [...left.values()]
  left.clear()
  if (refs.length) requestRefs(refs)
}

// Back online: carry on at once.
if (typeof window !== 'undefined') window.addEventListener('online', () => { resumeMs = RESUME_MS; resumeNow() })

/** Whether a lookup is running (or waiting), and how far along: Data and speed's "· tagging…". */
export const tagProgress = (): { done: number; total: number } | null => (progress.total > 0 ? { ...progress } : null)

/**
 * Looks up the tags of whichever [refs] aren't known (or are due again), in the background — by the
 * printing's id where there is one. Each 75 found are saved at once; a lookup Scryfall couldn't
 * finish carries on where it stopped, later (sooner each time it's back online).
 */
export function requestRefs(refs: TagRef[], opts: { pauseMs?: number } = {}): void {
  queue = queue.then(async () => {
    await ready
    const now = Date.now()
    const wanted = new Map<string, TagRef>()
    for (const r of refs) {
      const k = key(r.name)
      if (!k || pending.has(k)) continue
      const had = wanted.get(k)
      if (had) { if (!had.scryfallId && r.scryfallId) wanted.set(k, r); continue }
      if (isDue(cache.cards[k], now, setsFile)) wanted.set(k, { name: r.name, scryfallId: r.scryfallId ?? idHints.get(k) })
    }
    if (wanted.size === 0) return
    for (const k of wanted.keys()) pending.add(k)
    progress.total += wanted.size
    changed()
    // Without Tagger's file the cards still get their text tags; they're re-tagged when it comes.
    const tagSets = (await loadSets()) ?? new Map<string, Set<string>>()
    const file = setsFile
    const answered = new Set<string>()
    // Something unexpected (not a network failure, which lookUp handles) counts as stopped, so the
    // queue goes on and these are asked again later.
    const ok = await lookUp([...wanted.values()], getCollection, tagSets, file, {
      pauseMs: opts.pauseMs,
      onFound: (found) => {
        for (const [k, r] of found) {
          // A card's other name doesn't replace a fresh lookup of its own.
          if (wanted.has(k) || isDue(cache.cards[k], now, file)) cache.cards[k] = r
          if (wanted.has(k) && !answered.has(k)) { answered.add(k); pending.delete(k); progress.done++ }
        }
        persist()
        changed()
      },
    }).catch(() => false)
    // Anything left over goes back to being askable — and is asked again later.
    for (const [k, r] of wanted) {
      if (answered.has(k)) continue
      pending.delete(k)
      left.set(k, r)
    }
    if (ok) resumeMs = RESUME_MS
    else resumeLater()
    if (pending.size === 0) { progress.done = 0; progress.total = 0 }
    changed()
  })
}

/** Looks up the tags of whichever [names] aren't known (or are due again), by the printing's id where one is known (hintIds). */
export function requestTags(names: string[]): void {
  requestRefs(names.map((name) => ({ name, scryfallId: idHints.get(key(name)) })))
}

/** Settings › Data and speed's "Retag now": [names] are due again (their tags still show meanwhile). */
export function retagNames(names: string[]): void {
  for (const n of names) {
    const r = cache.cards[key(n)]
    if (r) cache.cards[key(n)] = { ...r, at: 0 }
  }
  persist()
  changed()
}

/** Whether any of [refs] is due to be looked up. */
export const anyDue = (refs: TagRef[], now = Date.now()) => refs.some((r) => key(r.name) && isDue(cache.cards[key(r.name)], now, setsFile))

/** Re-renders whenever more cards' tags become known; answers a number that changes each time. */
export function useTagsVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => onTagsChanged(() => setVersion((v) => v + 1)), [])
  return version
}

/**
 * The tags of [names] (name → tag ids, for the ones looked up so far), asking for any not known
 * yet. [loading]: how far along the lookup is, while one's running.
 */
export function useRoleTags(names: string[]): { tags: Map<string, string[]>; loading: { done: number; total: number } | null } {
  const version = useTagsVersion()
  // Worked out again only when the names change: a big collection has thousands.
  const namesKey = useMemo(() => [...new Set(names.map(key))].sort().join('\n'), [names])
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

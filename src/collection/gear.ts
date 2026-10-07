// Gear: what the cards are kept and played with — sleeves (and inner sleeves for double-sleeving),
// deck boxes, tokens, dice, playmats and anything else. Storage › Gear lists it; a deck's "This deck
// needs" says whether there are sleeves, a deck box and the deck's tokens for it; packing for an event
// (eventBag.ts) puts the tokens, dice and playmat in the bag.
//
// Where it's kept: the Unsorted pile's "gear" (Collection.gear, JSON below), so it syncs with the
// library like the storage places and loans do — library_items only holds decks and binders, and the
// pile is always there with the same id on every device. Two devices' gear merges item by item
// (mergeGear): an item added on either is kept, one deleted on either stays deleted, each field goes
// to whoever changed it, and the decks using a pack of sleeves merge like a deck's tags. A pile saved
// by an app from before gear comes without the key and keeps this device's (keepGearFromOlderApp).
//
//   "gear": [{ "id": "…", "kind": "SLEEVES", "name": "Black matte sleeves", "count": 38, "usedBy": ["<deck id>"], "createdAt": 1790000000000 },
//            { "id": "…", "kind": "DECK_BOX", "name": "Red", "count": 1, "holds": "<deck id>", "createdAt": … },
//            { "id": "…", "kind": "TOKENS", "name": "Goblin", "count": 24, "placeId": "<place id>", "createdAt": … }]
// "usedBy", "holds", "placeId" and "note" are left out when not said.
//
// Pure, so it can be tested. Mirrors the Android app's data/Gear.kt rule for rule, with the same tests
// (tests/collection/gear.test.ts ↔ GearTest.kt).

import { isUnsorted, type Collection, type Deck, type GearItem, type GearKind } from '../types/models'
import { sameJson } from '../sync/canonicalJson'
import { withUnsortedPile } from './unsorted'
import { placesOf } from './storagePlaces'

export const GEAR_KINDS: GearKind[] = ['SLEEVES', 'INNER_SLEEVES', 'DECK_BOX', 'TOKENS', 'DICE', 'PLAYMAT', 'OTHER']
export const GEAR_KIND_LABELS: Record<GearKind, string> = {
  SLEEVES: 'Sleeves', INNER_SLEEVES: 'Inner sleeves', DECK_BOX: 'Deck box', TOKENS: 'Tokens', DICE: 'Dice', PLAYMAT: 'Playmat', OTHER: 'Other',
}

/** The user's gear, kept on the Unsorted pile. */
export const gearOf = (collections: Collection[]): GearItem[] => collections.find(isUnsorted)?.gear ?? []

/** [collections] with the gear set to [gear] (on the Unsorted pile, made if it isn't there). */
export function withGear(collections: Collection[], gear: GearItem[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, gear } : c))
}

/** An item written as both apps write it: optional fields left out when not set. */
export function gearItem(g: GearItem): GearItem {
  const usedBy = [...new Set(g.usedBy ?? [])].filter(Boolean)
  return {
    id: g.id,
    kind: GEAR_KINDS.includes(g.kind) ? g.kind : 'OTHER',
    name: g.name.trim(),
    count: Math.max(0, Math.round(g.count || 0)),
    ...(usedBy.length > 0 ? { usedBy } : {}),
    ...(g.holds ? { holds: g.holds } : {}),
    ...(g.placeId ? { placeId: g.placeId } : {}),
    ...(g.note?.trim() ? { note: g.note.trim() } : {}),
    createdAt: g.createdAt,
  }
}

/** [collections] with [item] added, or put in place of the one with its id. */
export function saveGear(collections: Collection[], item: GearItem): Collection[] {
  const list = gearOf(collections)
  const clean = gearItem(item)
  return withGear(collections, list.some((g) => g.id === item.id) ? list.map((g) => (g.id === item.id ? clean : g)) : [...list, clean])
}

/** [collections] without the gear item [id]. */
export function deleteGear(collections: Collection[], id: string): Collection[] {
  const list = gearOf(collections)
  return list.some((g) => g.id === id) ? withGear(collections, list.filter((g) => g.id !== id)) : collections
}

// ---- Names ----

/** What a deck is called in a short line: its commander's first name ("Krenko"), or the deck's name. */
export function shortDeckName(deck: Deck): string {
  const commander = deck.commander?.name?.trim()
  if (!commander) return deck.name
  return commander.split(',')[0].trim() || deck.name
}

/** "Krenko", "Krenko and Atraxa", "Krenko, Atraxa and Rares binder". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What a deck, binder or place id is called, short; null when it's gone. */
export function usedByName(id: string, decks: Deck[], collections: Collection[]): string | null {
  const deck = decks.find((d) => d.id === id)
  if (deck) return shortDeckName(deck)
  const binder = collections.find((c) => c.id === id)
  if (binder) return binder.name
  return placesOf(collections).find((p) => p.id === id)?.name ?? null
}

// ---- Sleeves ----

/** How many sleeves [deck] takes: its commanders, its cards and its sideboard. */
export function sleevesFor(deck: Deck): number {
  const n = (list: { quantity: number }[] | undefined) => (list ?? []).reduce((s, c) => s + Math.max(0, c.quantity), 0)
  return (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0) + n(deck.cards) + n(deck.sideboard)
}

/** The most sleeves one of the decks using [item] takes — 0 when no deck uses them. */
export function deckNeedsOf(item: GearItem, decks: Deck[]): number {
  return Math.max(0, ...(item.usedBy ?? []).map((id) => decks.find((d) => d.id === id)).filter((d): d is Deck => !!d).map(sleevesFor))
}

/** Sleeves running low: fewer left than one of the decks using them takes. */
export const runningLow = (item: GearItem, decks: Deck[]): boolean => {
  if (item.kind !== 'SLEEVES' && item.kind !== 'INNER_SLEEVES') return false
  const need = deckNeedsOf(item, decks)
  return need > 0 && item.count < need
}

// ---- The Gear list ----

/** One row of the Gear list: a title, what it says on the right, the line under it, and whether to warn. */
export interface GearRow { key: string; title: string; value: string; line: string; warn: boolean; items: GearItem[] }

const byAge = (a: GearItem, b: GearItem) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The Gear list as the page shows it: each pack of sleeves and inner sleeves on its own, the deck
 * boxes as one row, the tokens as one row, then dice, playmats and the rest, each on its own.
 */
export function gearRows(gear: GearItem[], decks: Deck[], collections: Collection[]): GearRow[] {
  const names = (ids: string[] | undefined) => (ids ?? []).map((id) => usedByName(id, decks, collections)).filter((n): n is string => !!n)
  const sorted = [...gear].sort(byAge)
  const rows: GearRow[] = []
  for (const g of sorted.filter((x) => x.kind === 'SLEEVES')) {
    const parts: string[] = []
    const on = names(g.usedBy)
    if (on.length > 0) parts.push(`On ${andList(on)}`)
    const low = runningLow(g, decks)
    if (low) parts.push(`a deck needs ${deckNeedsOf(g, decks)}`, 'running low')
    rows.push({ key: g.id, title: g.name, value: `${g.count} left`, line: parts.join(' · ') || 'Not on a deck yet', warn: low, items: [g] })
  }
  for (const g of sorted.filter((x) => x.kind === 'INNER_SLEEVES')) {
    const on = names(g.usedBy)
    const low = runningLow(g, decks)
    const parts = [on.length > 0 ? `Double-sleeving: ${on.join(', ')}` : 'Not double-sleeving anything yet']
    if (low) parts.push(`a deck needs ${deckNeedsOf(g, decks)}`, 'running low')
    rows.push({ key: g.id, title: g.name, value: `${g.count} left`, line: parts.join(' · '), warn: low, items: [g] })
  }
  const boxes = sorted.filter((x) => x.kind === 'DECK_BOX')
  if (boxes.length > 0) {
    const empty = boxes.filter((b) => !b.holds || !usedByName(b.holds, decks, collections)).length
    rows.push({
      key: 'DECK_BOX', title: 'Deck boxes', value: `${boxes.length}${empty > 0 ? ` · ${empty} empty` : ''}`,
      line: boxes.map((b) => `${b.name} (${(b.holds && usedByName(b.holds, decks, collections)) || 'empty'})`).join(', '),
      warn: false, items: boxes,
    })
  }
  const tokens = sorted.filter((x) => x.kind === 'TOKENS')
  if (tokens.length > 0) rows.push({ key: 'TOKENS', title: 'Tokens', value: String(tokens.reduce((n, t) => n + t.count, 0)), line: tokensLine(tokens, collections), warn: false, items: tokens })
  for (const kind of ['DICE', 'PLAYMAT', 'OTHER'] as GearKind[]) {
    for (const g of sorted.filter((x) => x.kind === kind)) {
      const where = g.placeId ? placesOf(collections).find((p) => p.id === g.placeId)?.name : undefined
      rows.push({ key: g.id, title: g.name, value: String(g.count), line: [GEAR_KIND_LABELS[kind], where, g.note].filter(Boolean).join(' · '), warn: false, items: [g] })
    }
  }
  return rows
}

/** "Goblin ×24, Treasure ×18, Soldier ×12 and more · Token box". */
export function tokensLine(tokens: GearItem[], collections: Collection[]): string {
  const sorted = [...tokens].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const shown = sorted.slice(0, 3).map((t) => `${t.name} ×${t.count}`).join(', ')
  const places = placesOf(collections)
  const where = [...new Set(sorted.map((t) => places.find((p) => p.id === t.placeId)?.name).filter((n): n is string => !!n))]
  return `${shown}${sorted.length > 3 ? ' and more' : ''}${where.length > 0 ? ` · ${where.join(', ')}` : ''}`
}

// ---- This deck needs ----

/** Two token names are the same token: "Goblin" and "goblin", "Goblin token" and "Goblin". */
export const sameToken = (a: string, b: string) => {
  const clean = (s: string) => s.trim().toLowerCase().replace(/\s+tokens?$/, '')
  return clean(a) === clean(b)
}

export interface DeckNeeds {
  sleeves: number
  /** Sleeved already (a pack says it's on the deck), or a pack with enough left. */
  hasSleeves: boolean
  /** A deck box holds it. */
  hasBox: boolean
  /** An empty deck box it could go in. */
  emptyBox: string | null
  tokens: string[]
  missingTokens: string[]
}

/** What [deck] needs from the gear: sleeves, a deck box and [tokens] (the names of the tokens its cards make). */
export function deckNeeds(deck: Deck, gear: GearItem[], tokens: string[], decks: Deck[], collections: Collection[]): DeckNeeds {
  const sleeves = sleevesFor(deck)
  const packs = gear.filter((g) => g.kind === 'SLEEVES')
  const hasSleeves = packs.some((g) => (g.usedBy ?? []).includes(deck.id)) || packs.some((g) => g.count >= sleeves)
  const boxes = gear.filter((g) => g.kind === 'DECK_BOX')
  const hasBox = boxes.some((b) => b.holds === deck.id)
  const empty = boxes.find((b) => !b.holds || !usedByName(b.holds, decks, collections))
  const have = gear.filter((g) => g.kind === 'TOKENS' && g.count > 0)
  const unique = tokens.filter((t, i) => tokens.findIndex((x) => sameToken(x, t)) === i)
  return {
    sleeves, hasSleeves, hasBox, emptyBox: hasBox ? null : empty?.name ?? null,
    tokens: unique, missingTokens: unique.filter((t) => !have.some((g) => sameToken(g.name, t))),
  }
}

/** "Goblin tokens", "Goblin and Treasure tokens", "Goblin, Treasure and 2 more tokens". */
export function tokenNames(names: string[]): string {
  if (names.length <= 3) return `${andList(names)} tokens`
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more tokens`
}

/**
 * "Krenko goblins: 100 sleeves, a deck box and Goblin tokens. You have them all." — or what's missing:
 * "… Missing: 100 sleeves and Goblin tokens. Blue is an empty deck box."
 */
export function deckNeedsLine(deck: Deck, needs: DeckNeeds): string {
  const all = [`${needs.sleeves} sleeves`, 'a deck box', ...(needs.tokens.length > 0 ? [tokenNames(needs.tokens)] : [])]
  const missing = [
    ...(needs.hasSleeves ? [] : [`${needs.sleeves} sleeves`]),
    ...(needs.hasBox ? [] : ['a deck box']),
    ...(needs.missingTokens.length > 0 ? [tokenNames(needs.missingTokens)] : []),
  ]
  const head = `${deck.name}: ${andList(all)}.`
  if (missing.length === 0) return `${head} You have them all.`
  return `${head} Missing: ${andList(missing)}.${needs.emptyBox ? ` ${needs.emptyBox} is an empty deck box.` : ''}`
}

// ---- Two devices ----

const same = sameJson
function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}
function mergeSet(base: string[], mine: string[], theirs: string[]): string[] {
  const out: string[] = []
  for (const id of [...theirs, ...mine]) {
    if (out.includes(id)) continue
    if (base.includes(id) && (!mine.includes(id) || !theirs.includes(id))) continue
    out.push(id)
  }
  return out
}

/**
 * Merges two devices' gear: one added on either side is kept, one deleted on either side stays
 * deleted, each field goes to whoever changed it (the more recent edit when both did), and the decks
 * using a pack merge both sides' additions minus what either took off. Undefined when no side has it.
 */
export function mergeGear(base: GearItem[] | undefined, mine: GearItem[] | undefined, theirs: GearItem[] | undefined, minePreferred: boolean): GearItem[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((g) => [g.id, g]))
  const m = new Map((mine ?? []).map((g) => [g.id, g]))
  const t = new Map((theirs ?? []).map((g) => [g.id, g]))
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((id) => !b.has(id)).sort()
  const out: GearItem[] = []
  for (const id of [...b.keys(), ...added]) {
    const bg = b.get(id)
    const mg = m.get(id)
    const tg = t.get(id)
    if (bg && (!mg || !tg)) continue
    if (!bg) { out.push((tg ?? mg)!); continue }
    out.push(gearItem({
      id,
      kind: pick(bg.kind, mg!.kind, tg!.kind, minePreferred),
      name: pick(bg.name, mg!.name, tg!.name, minePreferred),
      count: pick(bg.count, mg!.count, tg!.count, minePreferred),
      usedBy: mergeSet(bg.usedBy ?? [], mg!.usedBy ?? [], tg!.usedBy ?? []),
      holds: pick(bg.holds, mg!.holds, tg!.holds, minePreferred),
      placeId: pick(bg.placeId, mg!.placeId, tg!.placeId, minePreferred),
      note: pick(bg.note, mg!.note, tg!.note, minePreferred),
      createdAt: Math.min(mg!.createdAt, tg!.createdAt),
    }))
  }
  return out
}

/**
 * [theirs] with [source]'s gear, when [theirs] was saved by an app that doesn't know about gear (no
 * "gear" key) — the same object otherwise.
 */
export function keepGearFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (theirs.gear !== undefined || source.gear === undefined || !isUnsorted(theirs)) return theirs
  return { ...theirs, gear: source.gear }
}

/** Under Gear on the Storage tab: what's running low, or what there is ("Sleeves, deck boxes and tokens"). */
export function gearSummary(gear: GearItem[], decks: Deck[]): string {
  const low = gear.filter((g) => runningLow(g, decks)).length
  if (low > 0) return `${low} ${low === 1 ? 'pack' : 'packs'} of sleeves running low`
  const labels: Record<GearKind, string> = {
    SLEEVES: 'sleeves', INNER_SLEEVES: 'inner sleeves', DECK_BOX: 'deck boxes', TOKENS: 'tokens', DICE: 'dice', PLAYMAT: 'playmats', OTHER: 'more',
  }
  const kinds = GEAR_KINDS.filter((k) => gear.some((g) => g.kind === k)).map((k) => labels[k])
  const line = andList(kinds.length > 0 ? kinds : ['sleeves', 'deck boxes', 'tokens', 'dice'])
  return line.charAt(0).toUpperCase() + line.slice(1)
}

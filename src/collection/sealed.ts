// Sealed product: booster boxes, collector boxes, bundles, precons — still in their wrapping. Each
// product is a line with how many, where it's kept (a storage place), what the user paid each and what
// it's worth now each, with the change between them.
//
// No app has prices for sealed product (Scryfall prices single cards; the MTGJSON data the apps read
// is decklists), so the value is what the user entered and says so ("value you entered") — never a
// guessed price. Adding one searches Scryfall's sets (for the boxes and bundles) and MTGJSON's precons;
// anything else is a product by name with a value typed in.
//
// "Open" takes one off the list: a box or bundle starts a sort of a new pile (sortPiles.ts) so every
// card lands in the right place; a precon becomes a deck with its list filled in (the precon import).
//
// Where they're kept: the Unsorted pile's "sealed" (Collection.sealed, JSON in types/models.ts), so
// they sync with the library like the loans do. Two devices' lists merge product by product
// (mergeSealed): one added on either side is kept, one deleted on either side stays deleted, counts
// add up the way a card's do, every other field goes to whoever changed it. A pile saved by an app
// from before sealed product comes without the key and keeps this device's (keepSealedFromOlderApp).
//
// Pure, so it can be tested. Mirrors the Android app's data/Sealed.kt rule for rule, with the same tests
// (tests/collection/sealed.test.ts ↔ SealedTest.kt).

import { isUnsorted, type Collection, type SealedKind, type SealedProduct } from '../types/models'
import { withUnsortedPile } from './unsorted'
import { placePath, placesOf } from './storagePlaces'
import type { PileRule, SortSession } from './sortPiles'

export const SEALED_KINDS: SealedKind[] = ['PLAY_BOX', 'COLLECTOR_BOX', 'SET_BOX', 'DRAFT_BOX', 'BUNDLE', 'PRECON', 'OTHER']
export const SEALED_KIND_LABELS: Record<SealedKind, string> = {
  PLAY_BOX: 'Play Booster Box', COLLECTOR_BOX: 'Collector Box', SET_BOX: 'Set Booster Box', DRAFT_BOX: 'Draft Booster Box',
  BUNDLE: 'Bundle', PRECON: 'Precon', OTHER: 'Other',
}
/** The kinds a set is sold as, in the order they're offered. */
export const SET_PRODUCT_KINDS: SealedKind[] = ['PLAY_BOX', 'COLLECTOR_BOX', 'BUNDLE', 'SET_BOX', 'DRAFT_BOX']

const kindOf = (k: string | undefined): SealedKind => (SEALED_KINDS as string[]).includes(k ?? '') ? (k as SealedKind) : 'OTHER'

/** A product as both apps write it: optional fields left out when not said, money to the cent. */
export function sealedProduct(p: SealedProduct): SealedProduct {
  const cents = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined)
  const paid = cents(p.paidUsd)
  const value = cents(p.valueUsd)
  return {
    id: p.id,
    name: p.name.trim(),
    kind: kindOf(p.kind),
    ...(p.setCode ? { setCode: p.setCode.toLowerCase() } : {}),
    ...(p.preconFile ? { preconFile: p.preconFile } : {}),
    count: Math.max(0, Math.floor(p.count)),
    ...(p.placeId ? { placeId: p.placeId } : {}),
    ...(paid !== undefined ? { paidUsd: paid } : {}),
    ...(value !== undefined ? { valueUsd: value } : {}),
    ...(value !== undefined && p.valueAt ? { valueAt: p.valueAt } : {}),
    createdAt: p.createdAt,
  }
}

/** The user's sealed product, kept on the Unsorted pile. */
export function sealedOf(collections: Collection[]): SealedProduct[] {
  return collections.find(isUnsorted)?.sealed ?? []
}

/** [collections] with the sealed list set to [list] (on the Unsorted pile, made if it isn't there). */
export function withSealed(collections: Collection[], list: SealedProduct[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, sealed: list.map(sealedProduct) } : c))
}

/** [collections] with [p] added, or changed when one with its id is there. */
export function saveSealed(collections: Collection[], p: SealedProduct): Collection[] {
  const list = sealedOf(collections)
  return withSealed(collections, list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p])
}

/** [collections] without the product [id]. */
export function removeSealed(collections: Collection[], id: string): Collection[] {
  return withSealed(collections, sealedOf(collections).filter((p) => p.id !== id))
}

export const isPrecon = (p: SealedProduct): boolean => p.kind === 'PRECON'

/** The change from what was paid to what it's worth now, in whole percent; null without both. */
export function sealedChange(p: Pick<SealedProduct, 'paidUsd' | 'valueUsd'>): number | null {
  if (p.paidUsd === undefined || p.valueUsd === undefined || !(p.paidUsd > 0)) return null
  return Math.round(((p.valueUsd - p.paidUsd) / p.paidUsd) * 100)
}

/** A change as a line says it: "+13%", "−9%" (a minus sign), "0%". */
export const changeLabel = (pct: number): string => (pct > 0 ? `+${pct}%` : pct < 0 ? `−${-pct}%` : '0%')

/** What the whole list is worth: each product's value × its count. Products with no value add nothing. */
export const sealedTotalUsd = (list: SealedProduct[]): number =>
  list.reduce((n, p) => n + (p.valueUsd ?? 0) * p.count, 0)

/** What was paid for the whole list (products with a price paid). */
export const sealedPaidUsd = (list: SealedProduct[]): number =>
  list.reduce((n, p) => n + (p.paidUsd ?? 0) * p.count, 0)

/** A product's line under its name: "×2 · Cupboard, hall · paid $210 each", "×1 · No place yet". */
export function sealedLine(p: SealedProduct, collections: Collection[], money: (usd: number) => string): string {
  const places = placesOf(collections)
  const where = p.placeId && places.some((x) => x.id === p.placeId) ? placePath(places, p.placeId) : 'No place yet'
  const paid = p.paidUsd !== undefined ? `paid ${money(p.paidUsd)}${p.count > 1 ? ' each' : ''}` : ''
  return [`×${p.count}`, where, paid].filter(Boolean).join(' · ')
}

// ---- Adding one ----

/** One thing "+ Add sealed product" can add, from the search. */
export interface SealedOption {
  key: string
  name: string
  kind: SealedKind
  setCode?: string
  preconFile?: string
  /** A line about it: the set's code and year, "Commander precon", "Your own product". */
  detail: string
}

/** A set, as Scryfall lists it (setCompletion.ts's SetInfo, the fields this needs). */
export interface SealedSet { code: string; name: string; releasedAt?: string | null; cardCount?: number }
/** A precon, as MTGJSON lists it (api/mtgjson.ts's PreconInfo). */
export interface SealedPrecon { fileName: string; name: string; setCode: string; releaseDate: string | null }

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const matches = (query: string, ...texts: string[]) => {
  const q = words(query)
  if (q.length === 0) return false
  const hay = texts.flatMap(words)
  return q.every((w) => hay.some((h) => h.startsWith(w)))
}

/**
 * What a search for [query] offers: each set whose name or code fits as each product it's sold as
 * ("Duskmourn Play Booster Box"…), newest first, then each precon that fits ("Precon: Blame Game"),
 * then the words typed as a product of the user's own. At most [limit] sets and precons each.
 */
export function sealedOptions(query: string, sets: SealedSet[], precons: SealedPrecon[], limit = 6): SealedOption[] {
  const q = query.trim()
  if (!q) return []
  const out: SealedOption[] = []
  const fitSets = sets
    .filter((s) => (s.cardCount ?? 1) > 0 && (matches(q, s.name) || s.code.toLowerCase() === q.toLowerCase()))
    .sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') || a.name.localeCompare(b.name))
    .slice(0, limit)
  for (const s of fitSets) {
    for (const kind of SET_PRODUCT_KINDS) {
      out.push({
        key: `${s.code}|${kind}`, name: `${s.name} ${SEALED_KIND_LABELS[kind]}`, kind, setCode: s.code.toLowerCase(),
        detail: [s.code.toUpperCase(), s.releasedAt?.slice(0, 4) ?? ''].filter(Boolean).join(' · '),
      })
    }
  }
  const fitPrecons = precons
    .filter((p) => matches(q, p.name) || p.setCode.toLowerCase() === q.toLowerCase())
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.name.localeCompare(b.name))
    .slice(0, limit)
  for (const p of fitPrecons) {
    out.push({
      key: `precon|${p.fileName}`, name: `Precon: ${p.name}`, kind: 'PRECON', setCode: p.setCode.toLowerCase(), preconFile: p.fileName,
      detail: ['Commander precon', p.setCode.toUpperCase(), p.releaseDate?.slice(0, 4) ?? ''].filter(Boolean).join(' · '),
    })
  }
  out.push({ key: `own|${q}`, name: q, kind: 'OTHER', detail: 'Your own product — you enter its value' })
  return out
}

/** A new product from [option]: one of it, no place, paid and value not said yet. */
export function newSealed(option: SealedOption, id: string, now: number): SealedProduct {
  return sealedProduct({
    id, name: option.name, kind: option.kind, setCode: option.setCode, preconFile: option.preconFile, count: 1, createdAt: now,
  })
}

// ---- Opening one ----

/**
 * One [id] taken off the list — the product goes once none are left. [opened]: the product as it was
 * (null when it isn't there or there are none to open).
 */
export function openSealed(collections: Collection[], id: string): { collections: Collection[]; opened: SealedProduct | null } {
  const p = sealedOf(collections).find((x) => x.id === id)
  if (!p || p.count <= 0) return { collections, opened: null }
  const next = p.count > 1
    ? withSealed(collections, sealedOf(collections).map((x) => (x.id === id ? { ...x, count: x.count - 1 } : x)))
    : removeSealed(collections, id)
  return { collections: next, opened: p }
}

/** The pile an opened box's cards go in — "Booster box, Duskmourn"'s place in the sort: its name. */
export const openedSource = (p: SealedProduct): string => p.name

/**
 * The sort to start when [p] is opened: the sort under way when it's of new cards and has scans (the
 * box's cards join it), or a new sort of new cards from [p], with the piles last used ([rules]).
 */
export function sortForOpened(existing: SortSession | null, p: SealedProduct, rules: PileRule[]): SortSession {
  if (existing && existing.newCards && existing.scans.length > 0) return existing
  return { source: openedSource(p), rules, newCards: true, scans: [] }
}

/** The precons a list holds that can be opened as a deck (they name their MTGJSON decklist). */
export const openablePrecons = (list: SealedProduct[]): SealedProduct[] => list.filter((p) => isPrecon(p) && !!p.preconFile && p.count > 0)

/** The products that open into a pile to sort: everything but precons with a decklist. */
export const openableBoxes = (list: SealedProduct[]): SealedProduct[] => list.filter((p) => !(isPrecon(p) && p.preconFile) && p.count > 0)

/** The deck's name when a precon is opened: the precon's own, without "Precon: ". */
export const preconDeckName = (p: SealedProduct): string => p.name.replace(/^precon:\s*/i, '').trim() || p.name

// ---- Sync: merging two devices' lists ----

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/**
 * Merges two devices' sealed lists: one added on either side is kept (the larger count if both added
 * it), one deleted on either stays deleted, counts add up (one opened here and one there is two
 * opened) and a product left with none goes; every other field goes to whoever changed it. The order
 * both last agreed on, then additions by id. Left out (undefined) when no side has the key.
 */
export function mergeSealed(base: SealedProduct[] | undefined, mine: SealedProduct[] | undefined, theirs: SealedProduct[] | undefined, minePreferred: boolean): SealedProduct[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((p) => [p.id, p]))
  const m = new Map((mine ?? []).map((p) => [p.id, p]))
  const t = new Map((theirs ?? []).map((p) => [p.id, p]))
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((id) => !b.has(id)).sort()
  const out: SealedProduct[] = []
  for (const id of [...b.keys(), ...added]) {
    const bp = b.get(id)
    const mp = m.get(id)
    const tp = t.get(id)
    if (bp && (!mp || !tp)) continue
    if (!bp) {
      out.push(mp && tp ? { ...tp, count: Math.max(mp.count, tp.count) } : (tp ?? mp)!)
      continue
    }
    const count = tp!.count + (mp!.count - bp.count)
    if (count <= 0) continue
    const value = pick({ v: bp.valueUsd, at: bp.valueAt }, { v: mp!.valueUsd, at: mp!.valueAt }, { v: tp!.valueUsd, at: tp!.valueAt }, minePreferred)
    out.push(sealedProduct({
      id,
      name: pick(bp.name, mp!.name, tp!.name, minePreferred),
      kind: pick(bp.kind, mp!.kind, tp!.kind, minePreferred),
      setCode: pick(bp.setCode, mp!.setCode, tp!.setCode, minePreferred),
      preconFile: pick(bp.preconFile, mp!.preconFile, tp!.preconFile, minePreferred),
      count,
      placeId: pick(bp.placeId, mp!.placeId, tp!.placeId, minePreferred),
      paidUsd: pick(bp.paidUsd, mp!.paidUsd, tp!.paidUsd, minePreferred),
      valueUsd: value.v,
      valueAt: value.at,
      createdAt: Math.min(mp!.createdAt, tp!.createdAt),
    }))
  }
  return out
}

/**
 * [theirs] with [source]'s sealed list, when [theirs] is the Unsorted pile saved by an app that
 * doesn't know about sealed product (no "sealed" key) — the same object otherwise.
 */
export function keepSealedFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (theirs.sealed !== undefined || source.sealed === undefined || !isUnsorted(theirs)) return theirs
  return { ...theirs, sealed: source.sealed }
}

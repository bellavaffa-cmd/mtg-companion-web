// Selling: the To sell list. A binder entry says how many of its copies are to sell (its "forSale",
// synced like "forTrade"); the list shows each with where those copies are — their place and pocket
// or section — and what they're worth, with the total. Two quick rules fill it: "Spares over 4" (the
// copies beyond four of a card, counting the decks' too) and "Not in any deck, over $5". It exports as
// TCGplayer's mass entry text and as a Cardmarket CSV, makes a pull list to fetch them (sellPullList in
// collection/pullList.ts), and ticking cards off and "Mark N sold" takes those copies out of the
// collection — their pockets show empty.
//
// Which copies are to sell: the entry's plain ones before its foils; of those, the ones with no place
// first, then the last lines' — the way copies leave a binder (splitPlaces in storagePlaces.ts).
//
// Pure, so it can be tested. Mirrors the Android app's data/Selling.kt rule for rule, with the same
// tests (tests/collection/selling.test.ts ↔ SellingTest.kt).

import { isUnsorted, type Collection, type CollectionEntry, type CopyPlace, type Deck, type StoragePlace } from '../types/models'
import { isBasicLand } from '../decks/missing'
import { languageName } from './copyDetails'
import { namesDecksUse } from './spares'
import { realCopiesOf } from './unsorted'
import { unitPrice } from './valueByPlace'
import { lentTag, placesOf, splitPlaces, withPlaces } from './storagePlaces'

/** A printing's facts for selling: set, number and prices (US dollars, and Cardmarket's euros; null: none). */
export interface SellPrinting { set: string; number: string; usd: number | null; usdFoil: number | null; eur?: number | null }

const copiesOf = (e: CollectionEntry) => Math.max(0, e.quantity + (e.foilQuantity ?? 0))

/** How many of the entry's copies are to sell: never more than it has. */
export const forSaleOf = (entry: CollectionEntry): number => Math.min(Math.max(0, entry.forSale ?? 0), copiesOf(entry))

/** [entry] with [n] copies to sell (no more than it has). Once set the key stays, as 0 when none are. */
export function withForSale(entry: CollectionEntry, n: number): CollectionEntry {
  const v = Math.min(Math.max(0, n), copiesOf(entry))
  if (v === 0 && entry.forSale === undefined) return entry
  return { ...entry, forSale: v }
}

/** The copies to sell, plain and foil: plain ones first. */
export function sellSplit(entry: CollectionEntry): { plain: number; foil: number } {
  const n = forSaleOf(entry)
  const plain = Math.min(n, Math.max(0, entry.quantity))
  return { plain, foil: n - plain }
}

/**
 * One line of the To sell list: an entry's copies to sell ([plain] and [foil]), the place lines they
 * come off ([lines]) and how many have no place ([loose]). [where]: "Rares binder · p2 s1 · NM".
 */
export interface SellRow {
  key: string
  collectionId: string
  scryfallId: string
  name: string
  plain: number
  foil: number
  lines: CopyPlace[]
  loose: number
  condition: string | null
  where: string
  /** The copies' language code ("ja"); null: not said. */
  language: string | null
}

export const sellQty = (row: SellRow): number => row.plain + row.foil

/** "p2 s1" in a binder, "› Red" in a box. */
function spotShort(place: StoragePlace, line: CopyPlace): string {
  if (line.page && line.slot) return `${place.name} · p${line.page} s${line.slot}`
  if (line.section) return `${place.name} › ${line.section}`
  return place.name
}

const owned = (collections: Collection[]) => collections.filter((c) => c.type !== 'WISHLIST')
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Every entry with copies to sell, A–Z: the Unsorted pile's and the binders'. */
export function sellRows(collections: Collection[]): SellRow[] {
  const places = new Map(placesOf(collections).map((p) => [p.id, p]))
  const out: SellRow[] = []
  for (const c of owned(collections)) {
    for (const e of c.entries) {
      const { plain, foil } = sellSplit(e)
      if (plain + foil <= 0) continue
      const going = splitPlaces(e, plain, foil).going.filter((l) => places.has(l.placeId))
      const loose = plain + foil - going.reduce((n, l) => n + l.qty, 0)
      const spots = [...new Set(going.map((l) => spotShort(places.get(l.placeId)!, l)))]
      if (loose > 0) spots.push('No place yet')
      const where = [...spots, ...(e.condition ? [e.condition] : [])].join(' · ')
      out.push({ key: `${c.id}|${e.scryfallId}`, collectionId: c.id, scryfallId: e.scryfallId, name: e.name, plain, foil, lines: going, loose, condition: e.condition ?? null, where, language: e.language ?? null })
    }
  }
  return out.sort((a, b) => byText(a.name.toLowerCase(), b.name.toLowerCase()) || byText(a.where.toLowerCase(), b.where.toLowerCase()))
}

/** "Fact or Fiction ×3". */
export const sellRowTitle = (row: SellRow): string => row.name + (sellQty(row) > 1 ? ` ×${sellQty(row)}` : '')

/** What a row's copies are worth, in US dollars (unitPrice, valueByPlace.ts); null when there's no price. */
export function sellRowUsd(row: SellRow, facts: (id: string) => SellPrinting | undefined): number | null {
  const p = facts(row.scryfallId)
  if (!p) return null
  const printing = { set: p.set, number: p.number, usd: p.usd, usdFoil: p.usdFoil }
  let total = 0
  if (row.plain > 0) {
    const u = unitPrice(printing, false)
    if (u === null) return null
    total += u * row.plain
  }
  if (row.foil > 0) {
    const u = unitPrice(printing, true)
    if (u === null) return null
    total += u * row.foil
  }
  return total
}

/** The list's worth: every row with a price. */
export const sellTotalUsd = (rows: SellRow[], facts: (id: string) => SellPrinting | undefined): number =>
  rows.reduce((n, r) => n + (sellRowUsd(r, facts) ?? 0), 0)

// ---- Quick rules ----

const nameKey = (name: string) => name.trim().toLowerCase().split(' // ')[0].trim()

/** The entries the rules may mark: owned, not tagged as lent out — the Unsorted pile's first. */
function sellable(collections: Collection[]): { c: Collection; e: CollectionEntry }[] {
  const mine = owned(collections)
  return [...mine.filter(isUnsorted), ...mine.filter((c) => !isUnsorted(c))]
    .flatMap((c) => c.entries.filter((e) => copiesOf(e) > 0 && !lentTag(e)).map((e) => ({ c, e })))
}

function withMarks(collections: Collection[], marks: Map<string, number>): Collection[] {
  if (marks.size === 0) return collections
  return collections.map((c) => {
    if (!c.entries.some((e) => marks.has(`${c.id}|${e.scryfallId}`))) return c
    return { ...c, entries: c.entries.map((e) => (marks.has(`${c.id}|${e.scryfallId}`) ? withForSale(e, marks.get(`${c.id}|${e.scryfallId}`)!) : e)) }
  })
}

/** Copies of each card owned, by name: the binders', the Unsorted pile's and physical decks' real ones (sortPiles.ts ownedCounts). */
function ownedByName(collections: Collection[], decks: Deck[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of owned(collections)) for (const e of c.entries) out.set(nameKey(e.name), (out.get(nameKey(e.name)) ?? 0) + e.quantity + (e.foilQuantity ?? 0))
  for (const d of decks) for (const e of realCopiesOf(d)) out.set(nameKey(e.name), (out.get(nameKey(e.name)) ?? 0) + e.quantity)
  return out
}

/**
 * "Spares over 4": every card owned more than [keep] times — the binders', the Unsorted pile's and the
 * physical decks' copies together — has the copies beyond [keep] marked to sell, from the binders only
 * (the Unsorted pile's first). Copies already to sell count. Basic lands are left out. Also how many
 * copies were newly marked.
 */
export function markSparesToSell(collections: Collection[], decks: Deck[], keep = 4): { collections: Collection[]; added: number } {
  const entries = sellable(collections)
  const marks = new Map<string, number>()
  let added = 0
  for (const [name, have] of ownedByName(collections, decks)) {
    if (have <= keep || isBasicLand(name)) continue
    const mine = entries.filter(({ e }) => nameKey(e.name) === name)
    let need = have - keep - mine.reduce((n, { e }) => n + forSaleOf(e), 0)
    for (const { c, e } of mine) {
      if (need <= 0) break
      const take = Math.min(need, copiesOf(e) - forSaleOf(e))
      if (take <= 0) continue
      marks.set(`${c.id}|${e.scryfallId}`, forSaleOf(e) + take)
      need -= take
      added += take
    }
  }
  return { collections: withMarks(collections, marks), added }
}

/**
 * "Not in any deck, over $5": every copy of a card no deck plays, is short of or is considering
 * (namesDecksUse, spares.ts) whose price is over [over] dollars — a foil's foil price. Also how many
 * copies were newly marked.
 */
export function markUnusedToSell(collections: Collection[], decks: Deck[], over: number, facts: (id: string) => SellPrinting | undefined): { collections: Collection[]; added: number } {
  const used = namesDecksUse(decks)
  const marks = new Map<string, number>()
  let added = 0
  for (const { c, e } of sellable(collections)) {
    if (used.has(e.name.trim().toLowerCase()) || isBasicLand(e.name)) continue
    const p = facts(e.scryfallId)
    if (!p) continue
    const printing = { set: p.set, number: p.number, usd: p.usd, usdFoil: p.usdFoil }
    const worth = e.quantity > 0 ? unitPrice(printing, false) : unitPrice(printing, true)
    if (worth === null || worth <= over) continue
    const all = copiesOf(e)
    if (forSaleOf(e) >= all) continue
    added += all - forSaleOf(e)
    marks.set(`${c.id}|${e.scryfallId}`, all)
  }
  return { collections: withMarks(collections, marks), added }
}

/** [collections] with [row]'s copies no longer to sell. */
export const unmarkToSell = (collections: Collection[], row: SellRow): Collection[] =>
  collections.map((c) => (c.id !== row.collectionId ? c : { ...c, entries: c.entries.map((e) => (e.scryfallId === row.scryfallId ? withForSale(e, 0) : e)) }))

// ---- Sold ----

/** What "Mark N sold" did: the collection after, and the rows sold. */
export interface SoldResult { collections: Collection[]; sold: SellRow[]; copies: number }

/**
 * "Mark N sold": the copies to sell of each row in [keys] leave the collection — off their places too,
 * so their pockets show empty. An entry with no copies left goes. What it's for trade comes down to
 * what's left.
 */
export function markSold(collections: Collection[], keys: ReadonlySet<string>): SoldResult {
  const rows = sellRows(collections).filter((r) => keys.has(r.key))
  if (rows.length === 0) return { collections, sold: [], copies: 0 }
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const next = collections.map((c) => {
    if (!c.entries.some((e) => byKey.has(`${c.id}|${e.scryfallId}`))) return c
    const entries: CollectionEntry[] = []
    for (const e of c.entries) {
      const row = byKey.get(`${c.id}|${e.scryfallId}`)
      if (!row) { entries.push(e); continue }
      const { staying } = splitPlaces(e, row.plain, row.foil)
      const plain = Math.max(0, e.quantity - row.plain)
      const foil = Math.max(0, (e.foilQuantity ?? 0) - row.foil)
      if (plain + foil <= 0) continue
      const { forTrade: _trade, ...rest } = e
      const trade = e.forTrade !== undefined ? Math.min(e.forTrade, plain + foil) : 0
      const left: CollectionEntry = { ...rest, quantity: plain, foilQuantity: foil, forSale: 0, ...(trade > 0 ? { forTrade: trade } : {}) }
      entries.push(e.places !== undefined ? withPlaces(left, staying) : left)
    }
    return { ...c, entries }
  })
  return { collections: next, sold: rows, copies: rows.reduce((n, r) => n + sellQty(r), 0) }
}

// ---- Exports ----

/** TCGplayer's mass entry: "3 Fact or Fiction [MH2]" a line, by name. */
export const tcgplayerMassEntry = (rows: SellRow[], facts: (id: string) => SellPrinting | undefined): string =>
  rows.map((r) => {
    const set = facts(r.scryfallId)?.set?.toUpperCase()
    return `${sellQty(r)} ${r.name}${set ? ` [${set}]` : ''}`
  }).join('\n')

/** Cardmarket's words for a condition: NM, EX, GD, PL, PO for this app's NM, LP, MP, HP, DMG. */
export function cardmarketCondition(code: string | null | undefined): string {
  switch (code) {
    case 'NM': return 'NM'
    case 'LP': return 'EX'
    case 'MP': return 'GD'
    case 'HP': return 'PL'
    case 'DMG': return 'PO'
    default: return ''
  }
}

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/**
 * A Cardmarket CSV: count, name, set, number, condition (Cardmarket's grades), language, foil and
 * Cardmarket's price in euros when Scryfall has one (plain copies only). Plain and foil copies are lines
 * of their own.
 */
export function cardmarketCsv(rows: SellRow[], facts: (id: string) => SellPrinting | undefined): string {
  const out = ['Count,Name,Expansion,Number,Condition,Language,Foil,Price (EUR)']
  for (const r of rows) {
    const p = facts(r.scryfallId)
    const language = r.language ? languageName(r.language) : 'English'
    for (const [foil, n] of [[false, r.plain], [true, r.foil]] as [boolean, number][]) {
      if (n <= 0) continue
      const eur = !foil && p?.eur != null ? p.eur.toFixed(2) : ''
      out.push([String(n), r.name, p?.set?.toUpperCase() ?? '', p?.number ?? '', cardmarketCondition(r.condition), language, foil ? 'Foil' : '', eur].map(csvCell).join(','))
    }
  }
  return out.join('\n')
}

// ---- Sync ----

/**
 * [theirs] with each entry's "forSale" put back where [source] (the same binder, as this device has it)
 * has one and [theirs] doesn't say — an entry saved by an app that doesn't know about selling comes
 * without it. One no longer to sell is kept as 0, so it isn't put back. The same object when nothing
 * changes.
 */
export function keepForSaleFromOlderApp(source: Collection, theirs: Collection): Collection {
  const mine = new Map(source.entries.filter((e) => e.forSale !== undefined).map((e) => [e.scryfallId, e.forSale!]))
  if (mine.size === 0 || !theirs.entries.some((e) => e.forSale === undefined && mine.has(e.scryfallId))) return theirs
  return {
    ...theirs,
    entries: theirs.entries.map((e) => (e.forSale !== undefined || !mine.has(e.scryfallId) ? e : { ...e, forSale: Math.min(Math.max(0, mine.get(e.scryfallId)!), copiesOf(e)) })),
  }
}

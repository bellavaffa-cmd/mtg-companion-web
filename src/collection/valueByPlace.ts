// Value by place: what the collection is worth, in total and place by place — each binder and box,
// the deck boxes, the copies lent out and the ones with no place yet — with every copy as a row for a
// spreadsheet (CSV) or a printed report, for insurance or a move.
//
// Prices are Scryfall's, in US dollars; the CSV converts them to the user's currency (money/currency.ts).
//
// Pure, so it can be tested. Mirrors the Android app's data/ValueByPlace.kt rule for rule, with the same
// tests (tests/collection/valueByPlace.test.ts ↔ ValueByPlaceTest.kt).

import type { Collection, Deck } from '../types/models'
import { realCopiesOf } from './unsorted'
import { conditionName, languageName } from './copyDetails'
import {
  lentByEntry, lentCopies, lentFromDeck, lentOf, lentTag, parentsOf, placedCopies, placePath, placesOf, pocketLabel, withPlaces, unplacedCopies,
} from './storagePlaces'

/** A printing's set, collector number and prices (US dollars; null: none). */
export interface PrintingFacts { set: string; number: string; usd: number | null; usdFoil: number | null }

export type ValueKind = 'place' | 'decks' | 'lent' | 'none'

/** Copies of one printing in one spot, with their price. */
export interface ValueRow {
  name: string
  scryfallId: string
  set: string
  number: string
  foil: boolean
  condition: string
  language: string
  qty: number
  kind: ValueKind
  /** The place's id, or "decks", "lent", "none". */
  group: string
  /** "Shelf › Red box", "Deck boxes › Atraxa", "Lent out › Sam", "No place yet". */
  where: string
  /** "Red", "Page 3, slot 5", or "". */
  spot: string
  /** One copy's price in US dollars; null when there's none. */
  unitUsd: number | null
}

/** One copy's price: a foil's foil price (or else the plain one), a plain copy's plain price (or else the foil one). */
export const unitPrice = (p: PrintingFacts | undefined, foil: boolean): number | null =>
  !p ? null : foil ? p.usdFoil ?? p.usd : p.usd ?? p.usdFoil

/** Every copy owned as rows: in places, in deck boxes, lent out, and with no place yet. */
export function valueRows(collections: Collection[], decks: Deck[], facts: (scryfallId: string) => PrintingFacts | undefined): ValueRow[] {
  const places = placesOf(collections)
  const known = new Set(places.map((p) => p.id))
  const lent = lentCopies(collections, decks)
  const byEntry = lentByEntry(lent)
  const rows: ValueRow[] = []
  const row = (r: Omit<ValueRow, 'set' | 'number' | 'unitUsd'>) => {
    const p = facts(r.scryfallId)
    rows.push({ ...r, set: p?.set.toUpperCase() ?? '', number: p?.number ?? '', unitUsd: unitPrice(p, r.foil) })
  }
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      if (e.quantity + (e.foilQuantity ?? 0) <= 0) continue
      const condition = e.condition ? conditionName(e.condition) : ''
      const language = e.language ? languageName(e.language) : ''
      const base = { name: e.name, scryfallId: e.scryfallId, condition, language }
      for (const line of placedCopies(e)) {
        if (!known.has(line.placeId)) continue
        row({
          ...base, foil: !!line.foil, qty: line.qty, kind: 'place', group: line.placeId, where: placePath(places, line.placeId),
          spot: line.section ?? (line.page && line.slot ? pocketLabel(line.page, line.slot) : ''),
        })
      }
      const clean = placedCopies(e).every((p) => known.has(p.placeId)) ? e : withPlaces(e, placedCopies(e).filter((p) => known.has(p.placeId)))
      const free = unplacedCopies(clean)
      const away = lentOf(byEntry, c.id, e)
      const tagged = !!lentTag(e)
      for (const foil of [false, true]) {
        const n = (foil ? free.foil - away.foil : free.plain - away.plain)
        if (n <= 0) continue
        row({ ...base, foil, qty: n, kind: tagged ? 'lent' : 'none', group: tagged ? 'lent' : 'none', where: tagged ? 'Lent out' : 'No place yet', spot: '' })
      }
    }
  }
  for (const d of decks) {
    // Copies lent from the deck come off its printings in order.
    const out = new Map<string, number>()
    for (const e of realCopiesOf(d)) {
      const key = e.name.trim().toLowerCase()
      if (!out.has(key)) out.set(key, lentFromDeck(lent, d.id, e.name))
      const away = Math.min(out.get(key)!, e.quantity)
      out.set(key, out.get(key)! - away)
      const n = e.quantity - away
      if (n > 0) row({ name: e.name, scryfallId: e.scryfallId, condition: '', language: '', foil: false, qty: n, kind: 'decks', group: 'decks', where: `Deck boxes › ${d.name}`, spot: '' })
    }
  }
  for (const l of lent) {
    const entry = l.collectionId ? collections.find((c) => c.id === l.collectionId)?.entries.find((e) => e.scryfallId === l.card.scryfallId) : undefined
    row({
      name: l.card.name, scryfallId: l.card.scryfallId, foil: !!l.card.foil, qty: l.qty,
      condition: entry?.condition ? conditionName(entry.condition) : '', language: entry?.language ? languageName(entry.language) : '',
      kind: 'lent', group: 'lent', where: `Lent out › ${l.loan.to}`, spot: '',
    })
  }
  return rows
}

/** One bar on the page: a place (its name, and the places it's in), the deck boxes, lent out or no place. */
export interface ValueGroup { key: string; kind: ValueKind; label: string; detail: string; usd: number; copies: number }

/**
 * The rows added up: the total, and a group per place holding copies, the deck boxes, lent out and no
 * place yet — the most valuable first, no place yet last.
 */
export function valueGroups(rows: ValueRow[], collections: Collection[]): { groups: ValueGroup[]; usd: number; copies: number } {
  const places = placesOf(collections)
  const groups = new Map<string, ValueGroup>()
  for (const r of rows) {
    let g = groups.get(r.group)
    if (!g) {
      const place = r.kind === 'place' ? places.find((p) => p.id === r.group) : undefined
      g = {
        key: r.group, kind: r.kind,
        label: place?.name ?? (r.kind === 'decks' ? 'Deck boxes' : r.kind === 'lent' ? 'Lent out' : 'No place yet'),
        detail: place ? parentsOf(places, place.id).map((p) => p.name).join(' › ') : '',
        usd: 0, copies: 0,
      }
      groups.set(r.group, g)
    }
    g.usd += (r.unitUsd ?? 0) * r.qty
    g.copies += r.qty
  }
  const all = [...groups.values()]
  const order = (a: ValueGroup, b: ValueGroup) => b.usd - a.usd || b.copies - a.copies || a.label.localeCompare(b.label)
  return {
    groups: [...all.filter((g) => g.kind !== 'none').sort(order), ...all.filter((g) => g.kind === 'none')],
    usd: all.reduce((n, g) => n + g.usd, 0),
    copies: all.reduce((n, g) => n + g.copies, 0),
  }
}

/** A CSV cell, quoted when it has to be. */
const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/** How the CSV writes money: in the currency [code], at [rate] to the dollar, to [decimals] places. */
export interface CsvMoney { code: string; rate: number; decimals: number }

/**
 * The rows as a spreadsheet: name, set, number, finish, condition, language, quantity, place, spot,
 * unit price and total in the user's currency — by place, then name. A copy with no price leaves both
 * prices empty.
 */
export function valueCsv(rows: ValueRow[], money: CsvMoney): string {
  const amount = (usd: number) => (usd * money.rate).toFixed(money.decimals)
  const out = [`Name,Set,Number,Finish,Condition,Language,Quantity,Place,Spot,Unit price (${money.code}),Total (${money.code})`]
  const sorted = [...rows].sort((a, b) => cmp(a.where, b.where) || cmp(a.spot, b.spot) || cmp(a.name, b.name) || Number(a.foil) - Number(b.foil))
  for (const r of sorted) {
    out.push([
      r.name, r.set, r.number, r.foil ? 'Foil' : 'Normal', r.condition, r.language, String(r.qty), r.where, r.spot,
      r.unitUsd === null ? '' : amount(r.unitUsd), r.unitUsd === null ? '' : amount(r.unitUsd * r.qty),
    ].map(cell).join(','))
  }
  return out.join('\n')
}

const cmp = (a: string, b: string) => { const x = a.toLowerCase(); const y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0 }

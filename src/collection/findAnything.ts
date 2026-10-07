// Find anything: one search over the user's own cards — each with its copies and every place they
// are ("Red box › Colourless ×1", "Atraxa deck ×1", "Lent to Sam ×1", "Graded PSA 9 ×1", for trade,
// to sell) — their places ("Shelf, study · 3 places inside") and their decks (the ones using a card
// found, "Commander · proxy"), falling through to Search for cards they don't have.
//
// Fast on big collections: the library is indexed once (buildFindIndex — one walk over the binders,
// decks, loans and graded copies), and typing on (a query that starts with the last one) only looks
// again at what the last one found (finder). Pure, so it can be tested. Mirrors the Android app's
// data/FindAnything.kt (tests: tests/collection/findAnything.test.ts ↔ FindAnythingTest.kt).

import type { Collection, Deck } from '../types/models'
import { GAME_MODE_LABELS, type GameMode } from '../types/models'
import { proxyCopies } from '../decks/proxies'
import { forTradeOf } from '../social/moreLogic'
import { gradedOf, gradeLabel } from './graded'
import { forSaleOf } from './selling'
import { realCopiesOf } from './unsorted'
import { deckTitle } from './upkeep'
import {
  lentByEntry, lentCopies, lentOf, lentTag, PLACE_KIND_LABELS, parentsOf, placeAndInside, placedCopies, placesOf, storageSummary,
} from './storagePlaces'

/** Where some of a card's copies are, as a chip says it: "Red box › Colourless" ×1. */
export type FindChipKind = 'place' | 'deck' | 'lent' | 'graded' | 'none' | 'trade' | 'sell'
export interface FindChip { kind: FindChipKind; label: string; qty: number; placeId?: string; deckId?: string }

/** One of the user's cards (any printing), its copies and where they all are. */
export interface FoundCard {
  name: string
  imageUrl: string | null
  /** Copies the user has: in places, binders, decks (real ones), lent out and graded. */
  copies: number
  chips: FindChip[]
}

export interface FoundPlace { id: string; name: string; line: string }
export interface FoundDeck { id: string; name: string; line: string }

/** Lower case, accents off, anything but letters and digits a space: "Æther Vial" → "aether vial". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface Indexed { text: string; words: string[] }
const indexed = (name: string): Indexed => { const text = normalize(name); return { text, words: text.split(' ').filter(Boolean) } }

/**
 * How well [name] matches the query [q] (normalized): 0 not at all; the whole name 4; the name
 * starting with it 3; every word of the query starting a word of the name ("sol ri" → Sol Ring) 2;
 * the query inside the name 1. Anything matching a query matches every query it started as.
 */
export function matchScore(name: Indexed, q: string): number {
  if (!q) return 0
  if (name.text === q) return 4
  if (name.text.startsWith(q)) return 3
  const tokens = q.split(' ')
  if (tokens.every((t) => name.words.some((w) => w.startsWith(t)))) return 2
  return name.text.includes(q) ? 1 : 0
}

interface CardRow extends Indexed { card: FoundCard; key: string }
interface PlaceRow extends Indexed { place: FoundPlace }
interface DeckRow extends Indexed { deck: Deck; format: string; cards: Map<string, boolean> }

/** The library, indexed once for finding. */
export interface FindIndex { cards: CardRow[]; places: PlaceRow[]; decks: DeckRow[] }

const cardKey = (name: string) => name.trim().toLowerCase()
const count = (n: number) => n.toLocaleString('en-GB')
const CHIP_ORDER: FindChipKind[] = ['place', 'deck', 'lent', 'graded', 'none', 'trade', 'sell']

/** Every card, place and deck of the user's, ready to be found. */
export function buildFindIndex(collections: Collection[], decks: Deck[]): FindIndex {
  const places = placesOf(collections)
  const byId = new Map(places.map((p) => [p.id, p]))
  const lent = lentCopies(collections, decks)
  const byEntry = lentByEntry(lent)
  const cards = new Map<string, { card: FoundCard; chips: Map<string, FindChip> }>()
  const cardOf = (name: string, imageUrl: string | null) => {
    const key = cardKey(name)
    let row = cards.get(key)
    if (!row) {
      row = { card: { name: name.trim(), imageUrl, copies: 0, chips: [] }, chips: new Map() }
      cards.set(key, row)
    }
    if (!row.card.imageUrl && imageUrl) row.card.imageUrl = imageUrl
    return row
  }
  const chip = (name: string, imageUrl: string | null, c: FindChip) => {
    if (c.qty <= 0) return
    const row = cardOf(name, imageUrl)
    const id = `${c.kind}|${c.label}|${c.placeId ?? ''}|${c.deckId ?? ''}`
    const had = row.chips.get(id)
    if (had) had.qty += c.qty
    else row.chips.set(id, { ...c })
    if (c.kind !== 'trade' && c.kind !== 'sell') row.card.copies += c.qty
  }

  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      const copies = Math.max(0, e.quantity) + Math.max(0, e.foilQuantity ?? 0)
      if (copies <= 0) continue
      let here = 0
      for (const line of placedCopies(e)) {
        const place = byId.get(line.placeId)
        if (!place) continue
        here += line.qty
        chip(e.name, e.imageUrl, { kind: 'place', label: line.section ? `${place.name} › ${line.section}` : place.name, qty: line.qty, placeId: place.id })
      }
      const out = lentOf(byEntry, c.id, e)
      const left = copies - here - out.plain - out.foil
      if (left > 0) chip(e.name, e.imageUrl, lentTag(e) ? { kind: 'lent', label: 'Lent out', qty: left } : { kind: 'none', label: 'No place', qty: left })
      chip(e.name, e.imageUrl, { kind: 'trade', label: 'For trade', qty: forTradeOf(e) })
      chip(e.name, e.imageUrl, { kind: 'sell', label: 'To sell', qty: forSaleOf(e) })
    }
  }
  for (const l of lent) chip(l.card.name, null, { kind: 'lent', label: `Lent to ${l.loan.to}`, qty: l.qty })
  const lentFrom = new Map<string, number>()
  for (const l of lent) if (l.card.deckId) lentFrom.set(`${l.card.deckId}|${cardKey(l.card.name)}`, (lentFrom.get(`${l.card.deckId}|${cardKey(l.card.name)}`) ?? 0) + l.qty)
  const deckRows: DeckRow[] = []
  for (const d of decks) {
    for (const e of realCopiesOf(d)) {
      chip(e.name, e.imageUrl, { kind: 'deck', label: deckTitle(d.name), qty: e.quantity - (lentFrom.get(`${d.id}|${cardKey(e.name)}`) ?? 0), deckId: d.id })
      lentFrom.delete(`${d.id}|${cardKey(e.name)}`)
    }
    const used = new Map<string, boolean>()
    for (const e of d.cards) {
      if (e.quantity <= 0) continue
      // Known as a card of the deck's even when every copy is a proxy.
      cardOf(e.name, e.imageUrl)
      const key = cardKey(e.name)
      used.set(key, (used.get(key) ?? false) || proxyCopies(d, e) > 0)
    }
    deckRows.push({ ...indexed(d.name), deck: d, format: GAME_MODE_LABELS[d.gameMode as GameMode] ?? d.gameMode, cards: used })
  }
  for (const g of gradedOf(collections)) chip(g.name, g.imageUrl ?? null, { kind: 'graded', label: `Graded ${gradeLabel(g)}`, qty: 1 })

  const cardRows: CardRow[] = [...cards].map(([key, { card, chips }]) => {
    card.chips = [...chips.values()].sort((a, b) => CHIP_ORDER.indexOf(a.kind) - CHIP_ORDER.indexOf(b.kind))
    return { ...indexed(card.name), card, key }
  })

  const summary = storageSummary(collections, decks)
  const placeRows: PlaceRow[] = places.map((p) => {
    const inside = placeAndInside(places, p.id)
    const copies = [...inside].reduce((n, id) => n + (summary.own[id] ?? 0), 0)
    const path = parentsOf(places, p.id).map((x) => x.name).join(' › ')
    const line = inside.size > 1
      ? `${inside.size - 1} ${inside.size === 2 ? 'place' : 'places'} inside`
      : `${PLACE_KIND_LABELS[p.kind] ?? 'Place'} · ${count(copies)} ${copies === 1 ? 'copy' : 'copies'}`
    return { ...indexed(p.name), place: { id: p.id, name: p.name, line: path ? `${line} · in ${path}` : line } }
  })

  return { cards: cardRows, places: placeRows, decks: deckRows }
}

/** What a query finds. [decksUsing]: decks with a card found in them; [decks]: decks by their name. */
export interface FindResult {
  query: string
  cards: FoundCard[]
  places: FoundPlace[]
  decksUsing: FoundDeck[]
  decks: FoundDeck[]
  /** More cards matched than are shown. */
  moreCards: number
}

export const FIND_LIMITS = { cards: 20, places: 8, decks: 8, usingCards: 3 }

const EMPTY: FindResult = { query: '', cards: [], places: [], decksUsing: [], decks: [], moreCards: 0 }

interface Pool { q: string; cards: CardRow[]; places: PlaceRow[]; decks: DeckRow[] }

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The rows matching [q], best first, then A to Z (by their plain words, the same on the phone). */
function ranked<T extends Indexed>(rows: T[], q: string): { row: T; score: number }[] {
  const out: { row: T; score: number }[] = []
  for (const row of rows) {
    const score = matchScore(row, q)
    if (score > 0) out.push({ row, score })
  }
  return out.sort((a, b) => b.score - a.score || byText(a.row.text, b.row.text))
}

/**
 * Finding in [index] as the user types: a query that carries on from the last one only looks again at
 * what that one matched. Returns the function to call with each query.
 */
export function finder(index: FindIndex): (query: string) => FindResult {
  let last: Pool | null = null
  return (query: string) => {
    const q = normalize(query)
    if (!q) { last = null; return { ...EMPTY, query } }
    const from: Pool = last && q.startsWith(last.q) ? last : { q: '', cards: index.cards, places: index.places, decks: index.decks }
    const cards = ranked(from.cards, q)
    const places = ranked(from.places, q)
    const decks = ranked(from.decks, q)
    last = { q, cards: cards.map((x) => x.row), places: places.map((x) => x.row), decks: decks.map((x) => x.row) }

    const top = cards.slice(0, FIND_LIMITS.usingCards).map((x) => x.row.key)
    const decksUsing: (FoundDeck & { text: string })[] = []
    for (const d of index.decks) {
      const hits = top.filter((k) => d.cards.has(k))
      if (hits.length === 0) continue
      const proxy = hits.some((k) => d.cards.get(k))
      decksUsing.push({ id: d.deck.id, name: d.deck.name, line: d.format + (proxy ? ' · proxy' : ''), text: d.text })
    }
    decksUsing.sort((a, b) => byText(a.text, b.text))
    const usingIds = new Set(decksUsing.map((d) => d.id))
    return {
      query,
      cards: cards.slice(0, FIND_LIMITS.cards).map((x) => x.row.card),
      places: places.slice(0, FIND_LIMITS.places).map((x) => x.row.place),
      decksUsing: decksUsing.slice(0, FIND_LIMITS.decks).map(({ id, name, line }) => ({ id, name, line })),
      decks: decks.filter((x) => !usingIds.has(x.row.deck.id)).slice(0, FIND_LIMITS.decks).map((x) => ({ id: x.row.deck.id, name: x.row.deck.name, line: x.row.format })),
      moreCards: Math.max(0, cards.length - FIND_LIMITS.cards),
    }
  }
}

/** One query over [index], from scratch. */
export const findIn = (index: FindIndex, query: string): FindResult => finder(index)(query)

/** "4 copies"; a card only in decks as proxies has "Proxy only". */
export const copiesLine = (card: FoundCard): string =>
  card.copies === 0 ? 'Proxy only' : `${count(card.copies)} ${card.copies === 1 ? 'copy' : 'copies'}`

/** A chip's words: "Red box › Colourless ×1". */
export const chipLabel = (chip: FindChip): string => `${chip.label} ×${count(chip.qty)}`

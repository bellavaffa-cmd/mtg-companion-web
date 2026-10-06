// Pull lists and put-back lists: building a deck out of storage, and taking it apart again.
//
// The pull list is every copy a deck still needs from storage, grouped as you'd walk round to fetch
// them: place by place in the order of the Storage tree; within a box, section by section and then
// by where the box's sorting rule files a card; within a binder, page by page and pocket by pocket.
// Then the copies with no place yet, the ones only another deck holds (asked about each time), basic
// lands, and the cards not owned at all.
//
// What a deck still needs: a deck you hold (Physical, or Proxy with real cards swapped in) is short
// only of its proxies; any other deck is short of every copy except the ones marked as proxies.
// "Move pulled into deck box" takes the pulled copies out of their binders (and off their places) —
// they're the deck's real copies now, the way a physical deck's are (collection/unsorted.ts
// realCopiesOf) — notes on the deck where each came from (Deck.cameFrom), and turns a deck that held
// nothing into a physical one, the copies not pulled yet becoming its proxies.
//
// The put-back list is the reverse: every real copy in the deck, each with where it goes — where it
// came from, or the first box whose sorting rule fits it — and "Done" puts them all in the Unsorted
// pile at those places, leaving the deck as a virtual list.
//
// Pure, so it can be tested. Mirrors the Android app's data/PullList.kt rule for rule, with the same
// tests (tests/collection/pullList.test.ts ↔ PullListTest.kt).

import {
  isUnsorted,
  type CameFrom, type Collection, type CollectionEntry, type CopyPlace, type Deck, type DeckCardEntry, type StoragePlace,
} from '../types/models'
import { proxyCopies } from '../decks/proxies'
import { isBasicLand } from '../decks/missing'
import { buildCardListText } from './cardListText'
import { intoPile, pileEntryOf, withUnsortedPile } from './unsorted'
import { sellRows } from './selling'
import {
  copyKey, copyPlace, lentByEntry, lentCopies, lentFromDeck, lentOf, lentTag, mergeCopyPlaces, moveCopies, parentsOf, placeAndInside, placeCopies, placedCopies, placesOf,
  placeTree, pocketLabel, positionHint, ruleSection, sameCardName, suggestSpot, tidied, unplacedCopies, withPlaces,
  type CardFacts, type Spot,
} from './storagePlaces'

const nameKey = (name: string) => name.trim().toLowerCase()
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Whether a deck holds real copies of its cards: Physical, or Proxy with real cards swapped in. */
export const holdsCards = (deck: Deck): boolean => deck.ownership === 'PHYSICAL' || deck.ownership === 'PROXY'

/** The deck's cards, its commanders among them (once). */
function deckEntries(deck: Deck): DeckCardEntry[] {
  const out = [...deck.cards]
  for (const c of [deck.commander, deck.partnerCommander]) if (c && !out.some((e) => e.scryfallId === c.scryfallId)) out.push(c)
  return out
}

/**
 * How many copies of [entry] the deck still needs from storage: a deck you hold, its proxies; any
 * other deck, every copy except the ones marked as proxies.
 */
export function stillToPull(deck: Deck, entry: DeckCardEntry): number {
  if (holdsCards(deck)) return proxyCopies(deck, entry)
  return Math.max(0, entry.quantity - Math.max(0, entry.proxyQuantity ?? 0))
}

/** A card the deck needs, by name: the copies of all its printings together. */
export interface PullNeed { name: string; scryfallId: string; qty: number }

/** What the deck still needs from storage, a line per card name, A–Z. */
export function pullNeeds(deck: Deck): PullNeed[] {
  const byName = new Map<string, PullNeed>()
  for (const e of deckEntries(deck)) {
    const n = stillToPull(deck, e)
    if (n <= 0) continue
    const had = byName.get(nameKey(e.name))
    if (had) had.qty += n
    else byName.set(nameKey(e.name), { name: e.name, scryfallId: e.scryfallId, qty: n })
  }
  return [...byName.entries()].sort(([a], [b]) => byText(a, b)).map(([, n]) => n)
}

// ---- Walking order ----

/** Each place's position in the Storage tree. */
const treeOrder = (places: StoragePlace[]) => new Map(placeTree(places).map((n, i) => [n.place.id, i]))

/** Where a section comes in its box: its own sections in order, then any others, then none. */
function sectionRank(place: StoragePlace | undefined, section: string | undefined): number {
  if (!section) return 2000
  const i = (place?.sections ?? []).findIndex((s) => s.toLowerCase() === section.toLowerCase())
  return i >= 0 ? i : 1000
}

/** Where a card is in its spot of a place: by page and pocket in a binder, by name in a box. */
function compareInPlace(a: { name: string; page?: number; slot?: number }, b: { name: string; page?: number; slot?: number }): number {
  return (a.page ?? 1e9) - (b.page ?? 1e9) || (a.slot ?? 1e9) - (b.slot ?? 1e9) || byText(nameKey(a.name), nameKey(b.name))
}

/** The words for one spot of a place: "Page 2, slot 4" in a binder, "around “G”" in a sorted box. */
export function spotHint(place: StoragePlace | undefined, spot: { page?: number; slot?: number }, facts: CardFacts): string | null {
  if (!place) return null
  if (place.kind === 'BINDER' && spot.page && spot.slot) return pocketLabel(spot.page, spot.slot)
  if (place.sortRule) return positionHint(place.sortRule, facts)
  return null
}

/** A group of rows that sits in one place (and section): its key, heading and the line under it. */
function placeGroup(places: StoragePlace[], placeId: string, section: string | undefined) {
  const place = places.find((p) => p.id === placeId)
  return {
    key: `place:${placeId}:${section ?? ''}`,
    title: section ? `${place?.name ?? ''} › ${section}` : place?.name ?? '',
    detail: parentsOf(places, placeId).map((p) => p.name).join(' › '),
  }
}

/** Groups of place rows in walking order: places in tree order, then section by section. */
function sortPlaceGroups<G extends { placeId: string | null; section?: string }>(groups: G[], places: StoragePlace[]): G[] {
  const order = treeOrder(places)
  const byId = new Map(places.map((p) => [p.id, p]))
  return [...groups].sort((a, b) =>
    (order.get(a.placeId ?? '') ?? 1e9) - (order.get(b.placeId ?? '') ?? 1e9)
    || sectionRank(byId.get(a.placeId ?? ''), a.section) - sectionRank(byId.get(b.placeId ?? ''), b.section)
    || byText((a.section ?? '').toLowerCase(), (b.section ?? '').toLowerCase()))
}

// ---- The pull list ----

export type PullSource =
  /** Copies kept at one spot of a place: [line] as it is in the binder entry. */
  | { kind: 'place'; collectionId: string; scryfallId: string; line: CopyPlace }
  /** Copies owned with no place yet, in a binder or the Unsorted pile. */
  | { kind: 'loose'; collectionId: string; scryfallId: string; foil: boolean }
  /** Real copies in another deck you hold: taken only if you say so. */
  | { kind: 'deck'; deckId: string }
  /** Basic lands you don't keep track of: there's always a pile of them. */
  | { kind: 'basic' }
  | { kind: 'missing' }

export type PullGroupKind = 'place' | 'loose' | 'deck' | 'basic' | 'missing'

export interface PullRow {
  /** Stays the same while the collection does, so a tick can be remembered. */
  key: string
  /** The card's name, as the deck has it. */
  name: string
  /** The deck's printing of it. */
  scryfallId: string
  qty: number
  source: PullSource
  /** Where to look: "around “G”", "Page 2, slot 4", "In Unsorted", "in Atraxa — take it?". */
  hint: string | null
  /** The same with its place, for the A–Z list: "Red box › Red · around “G”". */
  where: string
}

export interface PullGroup {
  key: string
  kind: PullGroupKind
  /** "Red box › Red", "Rares binder", "No place yet", "In another deck", "Basic lands", "Not owned". */
  title: string
  /** For a place, the places it sits in: "Shelf, study". */
  detail: string
  placeId: string | null
  section?: string
  rows: PullRow[]
}

export interface PullList {
  groups: PullGroup[]
  /** Copies to fetch: everything but the cards not owned. */
  total: number
  /** Copies not owned. */
  toBuy: number
  /** How many places the copies are in. */
  places: number
}

interface Source { key: string; name: string; qty: number; source: PullSource; rank: number[] }

/**
 * Every copy [deck] still needs (see pullNeeds), with where to fetch it from, grouped in walking
 * order. Each copy is found once: in a place first (in tree order), then with no place (the Unsorted
 * pile's before the binders'), then in another deck you hold; what's left is a basic land or a card
 * not owned. Wishlists, copies out on loan and copies tagged as lent out aren't fetched from.
 */
export function pullList(deck: Deck, collections: Collection[], decks: Deck[]): PullList {
  const places = placesOf(collections)
  const byId = new Map(places.map((p) => [p.id, p]))
  const order = treeOrder(places)
  const owned = collections.filter((c) => c.type !== 'WISHLIST')
  const piles = [...owned.filter(isUnsorted), ...owned.filter((c) => !isUnsorted(c))]
  const sources: Source[] = []
  // Copies out on loan (collection/loans.ts) aren't here to fetch.
  const lent = lentCopies(collections, decks)
  const lentHere = lentByEntry(lent)
  for (const c of piles) {
    for (const e of c.entries) {
      if (e.quantity + (e.foilQuantity ?? 0) <= 0 || lentTag(e)) continue
      const lines = placedCopies(e)
      for (const line of lines) {
        if (!byId.has(line.placeId)) continue
        sources.push({
          key: `p:${c.id}:${e.scryfallId}:${copyKey(line)}`, name: e.name, qty: line.qty,
          source: { kind: 'place', collectionId: c.id, scryfallId: e.scryfallId, line },
          rank: [0, order.get(line.placeId) ?? 0, sectionRank(byId.get(line.placeId), line.section), line.page ?? 0, line.slot ?? 0, line.foil ? 1 : 0],
        })
      }
      // Copies in a place that's gone have no place any more.
      const unplaced = unplacedCopies(knownOnly(e, byId))
      const away = lentOf(lentHere, c.id, e)
      const free = { plain: unplaced.plain - away.plain, foil: unplaced.foil - away.foil }
      const at = piles.indexOf(c)
      if (free.plain > 0) sources.push({ key: `l:${c.id}:${e.scryfallId}:`, name: e.name, qty: free.plain, source: { kind: 'loose', collectionId: c.id, scryfallId: e.scryfallId, foil: false }, rank: [1, 0, at] })
      if (free.foil > 0) sources.push({ key: `l:${c.id}:${e.scryfallId}:foil`, name: e.name, qty: free.foil, source: { kind: 'loose', collectionId: c.id, scryfallId: e.scryfallId, foil: true }, rank: [1, 1, at] })
    }
  }
  decks.forEach((d, i) => {
    if (d.id === deck.id || !holdsCards(d)) return
    const held = new Map<string, { name: string; qty: number }>()
    for (const e of d.cards) {
      const real = e.quantity - proxyCopies(d, e)
      if (real <= 0) continue
      const had = held.get(nameKey(e.name))
      if (had) had.qty += real
      else held.set(nameKey(e.name), { name: e.name, qty: real })
    }
    for (const [key, h] of held) {
      const qty = h.qty - lentFromDeck(lent, d.id, h.name)
      if (qty > 0) sources.push({ key: `d:${d.id}:${key}`, name: h.name, qty, source: { kind: 'deck', deckId: d.id }, rank: [2, i] })
    }
  })
  const rankOrder = (a: Source, b: Source) => {
    for (let i = 0; i < Math.max(a.rank.length, b.rank.length); i++) {
      const d = (a.rank[i] ?? 0) - (b.rank[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  sources.sort(rankOrder)
  const left = new Map(sources.map((s) => [s.key, s.qty]))

  const groups = new Map<string, PullGroup>()
  const groupFor = (kind: PullGroupKind, key: string, make: () => Omit<PullGroup, 'rows' | 'kind' | 'key'>): PullGroup => {
    let g = groups.get(key)
    if (!g) { g = { key, kind, rows: [], ...make() }; groups.set(key, g) }
    return g
  }
  const deckName = (id: string) => decks.find((d) => d.id === id)?.name ?? 'another deck'
  const collectionName = (id: string) => collections.find((c) => c.id === id)?.name ?? 'a binder'

  for (const need of pullNeeds(deck)) {
    let wanted = need.qty
    const facts: CardFacts = { name: need.name }
    for (const s of sources) {
      if (wanted <= 0) break
      const have = left.get(s.key) ?? 0
      if (have <= 0 || !sameCardName(s.name, need.name)) continue
      const take = Math.min(have, wanted)
      left.set(s.key, have - take)
      wanted -= take
      const row = { key: `${nameKey(need.name)}|${s.key}`, name: need.name, scryfallId: need.scryfallId, qty: take, source: s.source }
      const src = s.source
      if (src.kind === 'place') {
        const g = groupFor('place', `place:${src.line.placeId}:${src.line.section ?? ''}`, () => ({
          ...placeGroup(places, src.line.placeId, src.line.section), placeId: src.line.placeId, ...(src.line.section ? { section: src.line.section } : {}),
        }))
        const spot = spotHint(byId.get(src.line.placeId), src.line, facts)
        const hint = [spot, src.line.foil ? 'foil' : null].filter(Boolean).join(' · ') || null
        g.rows.push({ ...row, hint, where: [g.title, hint].filter(Boolean).join(' · ') })
      } else if (src.kind === 'loose') {
        const g = groupFor('loose', 'loose', () => ({ title: 'No place yet', detail: 'Owned, not put away', placeId: null }))
        const hint = `In ${collectionName(src.collectionId)}${src.foil ? ' · foil' : ''}`
        g.rows.push({ ...row, hint, where: hint })
      } else if (src.kind === 'deck') {
        const g = groupFor('deck', 'deck', () => ({ title: 'In another deck', detail: 'Only another deck has it', placeId: null }))
        const hint = `in ${deckName(src.deckId)} — take it?`
        g.rows.push({ ...row, hint, where: `In ${deckName(src.deckId)}` })
      }
    }
    if (wanted <= 0) continue
    if (isBasicLand(need.name)) {
      const g = groupFor('basic', 'basic', () => ({ title: 'Basic lands', detail: 'From your basics', placeId: null }))
      g.rows.push({ key: `${nameKey(need.name)}|b`, name: need.name, scryfallId: need.scryfallId, qty: wanted, source: { kind: 'basic' }, hint: null, where: 'Basic lands' })
    } else {
      const g = groupFor('missing', 'missing', () => ({ title: 'Not owned', detail: '', placeId: null }))
      g.rows.push({ key: `${nameKey(need.name)}|m`, name: need.name, scryfallId: need.scryfallId, qty: wanted, source: { kind: 'missing' }, hint: null, where: 'Not owned' })
    }
  }

  const all = [...groups.values()]
  for (const g of all) {
    if (g.kind === 'place') {
      g.rows.sort((a, b) => {
        const la = a.source.kind === 'place' ? a.source.line : null
        const lb = b.source.kind === 'place' ? b.source.line : null
        return compareInPlace({ name: a.name, page: la?.page, slot: la?.slot }, { name: b.name, page: lb?.page, slot: lb?.slot })
      })
    } else {
      g.rows.sort((a, b) => byText(nameKey(a.name), nameKey(b.name)))
    }
  }
  const inPlaces = sortPlaceGroups(all.filter((g) => g.kind === 'place'), places)
  const rest = (['loose', 'deck', 'basic', 'missing'] as PullGroupKind[]).flatMap((k) => all.filter((g) => g.kind === k))
  const rows = all.flatMap((g) => g.rows)
  return {
    groups: [...inPlaces, ...rest],
    total: rows.filter((r) => r.source.kind !== 'missing').reduce((n, r) => n + r.qty, 0),
    toBuy: rows.filter((r) => r.source.kind === 'missing').reduce((n, r) => n + r.qty, 0),
    places: new Set(inPlaces.map((g) => g.placeId)).size,
  }
}

/** [e] without the lines in places that are gone (the same object when there are none). */
function knownOnly(e: CollectionEntry, known: Map<string, StoragePlace>): CollectionEntry {
  const lines = placedCopies(e)
  return lines.every((l) => known.has(l.placeId)) ? e : withPlaces(e, lines.filter((l) => known.has(l.placeId)))
}

/**
 * The To sell list (collection/selling.ts) as a pull list: each row's copies at the spot they're kept,
 * grouped in walking order as a deck's are, then the ones with no place yet. Ticked off the same way;
 * the row keys stay the same while the list does.
 */
export function sellPullList(collections: Collection[]): PullList {
  const places = placesOf(collections)
  const byId = new Map(places.map((p) => [p.id, p]))
  const groups = new Map<string, PullGroup>()
  const collectionName = (id: string) => collections.find((c) => c.id === id)?.name ?? 'a binder'
  for (const row of sellRows(collections)) {
    const facts: CardFacts = { name: row.name }
    for (const line of row.lines) {
      const head = placeGroup(places, line.placeId, line.section)
      let g = groups.get(head.key)
      if (!g) {
        g = { ...head, kind: 'place', placeId: line.placeId, ...(line.section ? { section: line.section } : {}), rows: [] }
        groups.set(head.key, g)
      }
      const spot = spotHint(byId.get(line.placeId), line, facts)
      const hint = [spot, line.foil ? 'foil' : null].filter(Boolean).join(' · ') || null
      g.rows.push({
        key: `sell:${row.key}:${copyKey(line)}`, name: row.name, scryfallId: row.scryfallId, qty: line.qty,
        source: { kind: 'place', collectionId: row.collectionId, scryfallId: row.scryfallId, line }, hint, where: [g.title, hint].filter(Boolean).join(' · '),
      })
    }
    if (row.loose > 0) {
      let g = groups.get('loose')
      if (!g) {
        g = { key: 'loose', kind: 'loose', title: 'No place yet', detail: 'Owned, not put away', placeId: null, rows: [] }
        groups.set('loose', g)
      }
      const hint = `In ${collectionName(row.collectionId)}`
      g.rows.push({ key: `sell:${row.key}:loose`, name: row.name, scryfallId: row.scryfallId, qty: row.loose, source: { kind: 'loose', collectionId: row.collectionId, scryfallId: row.scryfallId, foil: false }, hint, where: hint })
    }
  }
  const all = [...groups.values()]
  for (const g of all) {
    if (g.kind === 'place') {
      g.rows.sort((a, b) => {
        const la = a.source.kind === 'place' ? a.source.line : null
        const lb = b.source.kind === 'place' ? b.source.line : null
        return compareInPlace({ name: a.name, page: la?.page, slot: la?.slot }, { name: b.name, page: lb?.page, slot: lb?.slot })
      })
    } else {
      g.rows.sort((a, b) => byText(nameKey(a.name), nameKey(b.name)))
    }
  }
  const inPlaces = sortPlaceGroups(all.filter((g) => g.kind === 'place'), places)
  return {
    groups: [...inPlaces, ...all.filter((g) => g.kind === 'loose')],
    total: all.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.qty, 0), 0),
    toBuy: 0,
    places: new Set(inPlaces.map((g) => g.placeId)).size,
  }
}

/** Every row of the list that can be pulled (not the cards not owned), A–Z. */
export function pullRowsAZ(list: PullList): PullRow[] {
  return list.groups.filter((g) => g.kind !== 'missing').flatMap((g) => g.rows)
    .sort((a, b) => byText(nameKey(a.name), nameKey(b.name)) || byText(a.where, b.where))
}

/** The groups of the list kept in [placeId] or a place inside it — "Pull from here" on a box's label. */
export function pullGroupsIn(list: PullList, collections: Collection[], placeId: string): PullGroup[] {
  const inside = placeAndInside(placesOf(collections), placeId)
  return list.groups.filter((g) => g.kind === 'place' && g.placeId !== null && inside.has(g.placeId))
}

/** Copies ticked off, of the rows that can be pulled. */
export function pulledCopies(rows: PullRow[], ticked: ReadonlySet<string>): number {
  return rows.filter((r) => r.source.kind !== 'missing' && ticked.has(r.key)).reduce((n, r) => n + r.qty, 0)
}

/**
 * The row a scanned card called [name] ticks: the first not ticked yet — not a card not owned, and
 * not one in another deck unless that's all there is (the list asks before taking one).
 */
export function rowToTick<R extends { key: string; name: string; source?: { kind: string } }>(rows: R[], ticked: ReadonlySet<string>, name: string): R | null {
  const open = rows.filter((r) => !ticked.has(r.key) && r.source?.kind !== 'missing' && sameCardName(r.name, name))
  return open.find((r) => r.source?.kind !== 'deck') ?? open[0] ?? null
}

/** The cards not owned as a buy list, "2 Sol Ring" a line — the text "Copy buy list" copies everywhere. */
export function pullBuyList(list: PullList): string {
  return buildCardListText(list.groups.filter((g) => g.kind === 'missing').flatMap((g) => g.rows)
    .map((r) => ({ scryfallId: r.scryfallId, name: r.name, quantity: r.qty, foilQuantity: 0 })))
}

/**
 * "Mark as proxies": the cards not owned become proxies in a deck being built, so the list stops
 * asking for them. Only for a deck that doesn't hold its cards yet — in one that does, a card not
 * owned is a proxy already. The same deck when nothing changes.
 */
export function markMissingAsProxies(deck: Deck, list: PullList): Deck {
  if (holdsCards(deck)) return deck
  const missing = new Map<string, number>()
  for (const r of list.groups.filter((g) => g.kind === 'missing').flatMap((g) => g.rows)) missing.set(nameKey(r.name), (missing.get(nameKey(r.name)) ?? 0) + r.qty)
  if (missing.size === 0) return deck
  const cards = deck.cards.map((e) => {
    const want = missing.get(nameKey(e.name)) ?? 0
    const room = e.quantity - Math.max(0, e.proxyQuantity ?? 0)
    const take = Math.min(want, room)
    if (take <= 0) return e
    missing.set(nameKey(e.name), want - take)
    return { ...e, proxyQuantity: Math.max(0, e.proxyQuantity ?? 0) + take }
  })
  return withCommandersFrom({ ...deck, cards })
}

/** The deck's commanders as its cards now have them. */
function withCommandersFrom(deck: Deck): Deck {
  const fresh = (c: DeckCardEntry | null) => (c ? deck.cards.find((e) => e.scryfallId === c.scryfallId) ?? c : c)
  return { ...deck, commander: fresh(deck.commander), partnerCommander: fresh(deck.partnerCommander) }
}

/** One card taken from another deck by "Move pulled into deck box". */
export interface TakenFromDeck { deckId: string; deck: string; name: string; qty: number }

export interface MovePulledResult {
  collections: Collection[]
  decks: Deck[]
  /** Copies now in the deck. */
  moved: number
  /** Cards taken out of other decks: each is a proxy there now, until a copy goes back. */
  taken: TakenFromDeck[]
  /** The deck held no cards before, and is a physical deck now. */
  nowPhysical: boolean
  /** Proxies the deck has after: the copies still to pull. */
  proxies: number
}

/**
 * "Move pulled into deck box": the copies of the [ticked] rows go into the deck. Copies from a place
 * or with no place leave their binder (and their place — where each came from is noted on the deck,
 * see Deck.cameFrom); one taken from another deck becomes a proxy there, so that deck's list is
 * still whole and says it's a card short; a basic land just counts. The deck counts the copies as
 * real — a deck that held nothing becomes a physical one, its copies not pulled yet its proxies.
 * Copies that have gone since the list was made are skipped. Unchanged when nothing moves.
 */
export function movePulled(deck: Deck, list: PullList, ticked: ReadonlySet<string>, collections: Collection[], decks: Deck[]): MovePulledResult {
  let cols = collections
  let others = decks
  const pulled = new Map<string, number>()
  const came: CameFrom[] = []
  const taken: TakenFromDeck[] = []
  const note = (name: string, n: number) => pulled.set(nameKey(name), (pulled.get(nameKey(name)) ?? 0) + n)
  const known = new Map(placesOf(collections).map((p) => [p.id, p]))
  const editEntry = (collectionId: string, scryfallId: string, fn: (e: CollectionEntry) => CollectionEntry | null) => {
    cols = cols.map((c) => {
      if (c.id !== collectionId) return c
      return { ...c, entries: c.entries.flatMap((e) => { if (e.scryfallId !== scryfallId) return [e]; const out = fn(e); return out ? [out] : [] }) }
    })
  }
  const fewer = (e: CollectionEntry, n: number, foil: boolean): CollectionEntry | null => {
    const out = tidied(foil ? { ...e, foilQuantity: (e.foilQuantity ?? 0) - n } : { ...e, quantity: e.quantity - n })
    return out.quantity + (out.foilQuantity ?? 0) > 0 ? out : null
  }

  for (const row of list.groups.flatMap((g) => g.rows)) {
    if (!ticked.has(row.key)) continue
    const src = row.source
    if (src.kind === 'place') {
      const e = cols.find((c) => c.id === src.collectionId)?.entries.find((x) => x.scryfallId === src.scryfallId)
      if (!e) continue
      const { entry, moved } = moveCopies(e, src.line, null, row.qty)
      if (moved <= 0) continue
      const after = fewer(entry, moved, !!src.line.foil)
      editEntry(src.collectionId, src.scryfallId, () => after)
      note(row.name, moved)
      came.push({ name: row.name, ...copyPlace(src.line, moved, !!src.line.foil) })
    } else if (src.kind === 'loose') {
      const e = cols.find((c) => c.id === src.collectionId)?.entries.find((x) => x.scryfallId === src.scryfallId)
      if (!e) continue
      const clean = knownOnly(e, known)
      const free = unplacedCopies(clean)
      const n = Math.min(row.qty, src.foil ? free.foil : free.plain)
      if (n <= 0) continue
      const after = fewer(clean, n, src.foil)
      editEntry(src.collectionId, src.scryfallId, () => after)
      note(row.name, n)
    } else if (src.kind === 'deck') {
      const other = others.find((d) => d.id === src.deckId)
      if (!other) continue
      let want = row.qty
      const cards = other.cards.map((e) => {
        if (want <= 0 || !sameCardName(e.name, row.name)) return e
        const proxies = proxyCopies(other, e)
        const take = Math.min(want, e.quantity - proxies)
        if (take <= 0) return e
        want -= take
        return { ...e, proxyQuantity: proxies + take }
      })
      const n = row.qty - want
      if (n <= 0) continue
      others = others.map((d) => (d.id === other.id ? withCommandersFrom({ ...other, cards }) : d))
      taken.push({ deckId: other.id, deck: other.name, name: row.name, qty: n })
      note(row.name, n)
    } else if (src.kind === 'basic') {
      note(row.name, row.qty)
    }
  }
  const moved = [...pulled.values()].reduce((n, v) => n + v, 0)
  if (moved === 0) return { collections, decks, moved: 0, taken: [], nowPhysical: false, proxies: proxiesOf(deck) }

  const wasHeld = holdsCards(deck)
  const cards = deck.cards.map((e) => {
    const left = pulled.get(nameKey(e.name)) ?? 0
    if (wasHeld) {
      const proxies = proxyCopies(deck, e)
      const take = Math.min(left, proxies)
      if (take <= 0) return e
      pulled.set(nameKey(e.name), left - take)
      return withProxies(e, proxies - take, deck.ownership === 'PROXY')
    }
    const marked = Math.max(0, e.proxyQuantity ?? 0)
    const take = Math.min(left, Math.max(0, e.quantity - marked))
    pulled.set(nameKey(e.name), left - take)
    return withProxies(e, e.quantity - take, false)
  })
  const cameFrom = came.length > 0 || deck.cameFrom !== undefined ? tidyCameFrom([...(deck.cameFrom ?? []), ...came]) : undefined
  const next = withCommandersFrom({
    ...deck,
    cards,
    ownership: wasHeld ? deck.ownership : 'PHYSICAL',
    ...(cameFrom !== undefined ? { cameFrom } : {}),
  })
  return {
    collections: cols,
    decks: others.map((d) => (d.id === deck.id ? next : d)),
    moved,
    taken,
    nowPhysical: !wasHeld,
    proxies: proxiesOf(next),
  }
}

/** [e] with [n] proxies; in a Physical deck none is no key at all, in a Proxy deck it has to say 0. */
function withProxies(e: DeckCardEntry, n: number, explicit: boolean): DeckCardEntry {
  if (n > 0 || explicit) return { ...e, proxyQuantity: Math.max(0, n) }
  const { proxyQuantity: _gone, ...rest } = e
  return rest
}

const proxiesOf = (deck: Deck) => deck.cards.reduce((n, e) => n + proxyCopies(deck, e), 0)

// ---- Where a deck's copies came from ----

/** A cameFrom line as both apps write it: optional fields left out when not said. */
export const cameFromLine = (name: string, line: CopyPlace): CameFrom => ({ name, ...copyPlace(line, line.qty, !!line.foil) })

/** [lines] as kept: one line per card, spot and finish, none at zero. */
export function tidyCameFrom(lines: CameFrom[]): CameFrom[] {
  const out: CameFrom[] = []
  for (const l of lines) {
    if (!(l.qty > 0)) continue
    const i = out.findIndex((o) => nameKey(o.name) === nameKey(l.name) && copyKey(o) === copyKey(l))
    if (i >= 0) out[i] = { ...out[i], qty: out[i].qty + l.qty }
    else out.push(cameFromLine(l.name, l))
  }
  return out
}

/**
 * Merges two devices' cameFrom card by card, each card's lines as a binder entry's places merge (see
 * mergeCopyPlaces). Left out (undefined) when no side has the key.
 */
export function mergeCameFrom(base: CameFrom[] | undefined, mine: CameFrom[] | undefined, theirs: CameFrom[] | undefined): CameFrom[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const split = (list: CameFrom[] | undefined) => {
    const m = new Map<string, { name: string; lines: CopyPlace[] }>()
    for (const l of list ?? []) {
      const { name, ...line } = l
      const had = m.get(nameKey(name))
      if (had) had.lines.push(line)
      else m.set(nameKey(name), { name, lines: [line] })
    }
    return m
  }
  const [b, m, t] = [split(base), split(mine), split(theirs)]
  const keys = [...new Set([...b.keys(), ...m.keys(), ...t.keys()])].sort(byText)
  const out: CameFrom[] = []
  for (const key of keys) {
    const name = (t.get(key) ?? m.get(key) ?? b.get(key))!.name
    const lines = mergeCopyPlaces(b.get(key)?.lines ?? [], m.get(key)?.lines ?? [], t.get(key)?.lines ?? []) ?? []
    for (const line of lines) out.push(cameFromLine(name, line))
  }
  return out
}

/**
 * [theirs] with [source]'s cameFrom put back when [theirs] was written by an app that doesn't know
 * about it (no "cameFrom" key) — the same object otherwise. See Deck.cameFrom.
 */
export function keepCameFromFromOlderApp(source: Deck, theirs: Deck): Deck {
  if (theirs.cameFrom !== undefined || source.cameFrom === undefined) return theirs
  return { ...theirs, cameFrom: source.cameFrom }
}

// ---- The put-back list ----

/** Where the cards go: where each came from, or the best place by the boxes' sorting rules. */
export type PutBackMode = 'ORIGIN' | 'RULE'

export interface PutBackRow {
  /** The deck's card and which of its rows: stays the same while the deck does. */
  key: string
  name: string
  scryfallId: string
  qty: number
  /** It came out of a binder as a foil copy, so it goes back as one. */
  foil: boolean
  /** Where it goes; null: no place yet. */
  dest: Spot | null
  /** "around “G”", "Page 2, slot 4"; for a basic land, where they go. */
  hint: string | null
  /** The place it came from (not a rule's suggestion). */
  fromOrigin: boolean
}

export interface PutBackGroup {
  key: string
  kind: 'place' | 'none' | 'basic'
  title: string
  detail: string
  placeId: string | null
  section?: string
  rows: PutBackRow[]
}

export interface PutBackList { groups: PutBackGroup[]; total: number }

/**
 * The best place by rule for a card: the first box (in tree order) with a sorting rule it fits —
 * one with no sections takes any card, one with sections only cards its rule files in one of them.
 * Binders aren't sorted by rule. Null when none fits.
 */
export function bestPlaceByRule(places: StoragePlace[], facts: CardFacts, collections: Collection[]): { spot: Spot; place: StoragePlace } | null {
  for (const { place } of placeTree(places)) {
    if (!place.sortRule || place.kind === 'BINDER') continue
    const sections = place.sections ?? []
    const section = ruleSection(place.sortRule, facts, sections)
    if (sections.length > 0 && !(section && sections.some((s) => s.toLowerCase() === section.toLowerCase()))) continue
    return { spot: suggestSpot(place, facts, collections).spot, place }
  }
  return null
}

/** "Mountains", "Plains", "Snow-Covered Islands". */
export const basicsTitle = (name: string) => (/s$/i.test(name.trim()) ? name.trim() : `${name.trim()}s`)

/**
 * Every real copy in [deck], each with where it goes: in ORIGIN mode, where it came from when it was
 * pulled (Deck.cameFrom) while that place is still there; otherwise, and in RULE mode, the best place
 * by rule (bestPlaceByRule), or no place when none fits. [facts] gives what a rule needs to know of
 * a card (its colours, its type); its name alone otherwise. Grouped in walking order, then the copies
 * with no place, then the basic lands, a group for each.
 */
export function putBackList(deck: Deck, collections: Collection[], mode: PutBackMode, facts?: (entry: DeckCardEntry) => CardFacts | null): PutBackList {
  const places = placesOf(collections)
  const byId = new Map(places.map((p) => [p.id, p]))
  const origins = mode === 'ORIGIN' ? (deck.cameFrom ?? []).filter((l) => byId.has(l.placeId)).map((l) => ({ ...l })) : []
  const groups = new Map<string, PutBackGroup>()
  const rows: { row: PutBackRow; basic: boolean }[] = []
  if (holdsCards(deck)) {
    for (const e of deck.cards) {
      let left = e.quantity - proxyCopies(deck, e)
      if (left <= 0) continue
      const f: CardFacts = facts?.(e) ?? { name: e.name, typeLine: e.typeLine }
      let n = 0
      const add = (qty: number, foil: boolean, dest: Spot | null, fromOrigin: boolean) => {
        const place = dest ? byId.get(dest.placeId) : undefined
        rows.push({
          row: { key: `${e.scryfallId}|${n++}`, name: e.name, scryfallId: e.scryfallId, qty, foil, dest, hint: dest ? spotHint(place, dest, f) : null, fromOrigin },
          basic: isBasicLand(e.name),
        })
      }
      for (const o of origins) {
        if (left <= 0) break
        if (o.qty <= 0 || !sameCardName(o.name, e.name)) continue
        const take = Math.min(o.qty, left)
        o.qty -= take
        left -= take
        add(take, !!o.foil, { placeId: o.placeId, ...(o.section ? { section: o.section } : {}), ...(o.page ? { page: o.page } : {}), ...(o.slot ? { slot: o.slot } : {}) }, true)
      }
      if (left > 0) add(left, false, bestPlaceByRule(places, f, collections)?.spot ?? null, false)
    }
  }
  const destTitle = (dest: Spot | null) => (dest ? placeGroup(places, dest.placeId, dest.section).title : 'No place yet')
  for (const { row, basic } of rows) {
    if (basic) {
      const key = `basic:${nameKey(row.name)}`
      let g = groups.get(key)
      if (!g) { g = { key, kind: 'basic', title: basicsTitle(row.name), detail: '', placeId: null, rows: [] }; groups.set(key, g) }
      g.rows.push({ ...row, hint: destTitle(row.dest) })
    } else if (row.dest) {
      const pg = placeGroup(places, row.dest.placeId, row.dest.section)
      let g = groups.get(pg.key)
      if (!g) { g = { ...pg, kind: 'place', placeId: row.dest.placeId, ...(row.dest.section ? { section: row.dest.section } : {}), rows: [] }; groups.set(pg.key, g) }
      g.rows.push(row)
    } else {
      let g = groups.get('none')
      if (!g) { g = { key: 'none', kind: 'none', title: 'No place yet', detail: 'No box rule fits these', placeId: null, rows: [] }; groups.set('none', g) }
      g.rows.push(row)
    }
  }
  const all = [...groups.values()]
  for (const g of all) {
    if (g.kind === 'place') g.rows.sort((a, b) => compareInPlace({ name: a.name, ...a.dest }, { name: b.name, ...b.dest }))
    else if (g.kind === 'none') g.rows.sort((a, b) => byText(nameKey(a.name), nameKey(b.name)))
    if (g.kind === 'basic') {
      const where = [...new Set(g.rows.map((r) => r.hint))].join(', ')
      g.detail = `${where} · or keep with the deck box`
    }
  }
  return {
    groups: [
      ...sortPlaceGroups(all.filter((g) => g.kind === 'place'), places),
      ...all.filter((g) => g.kind === 'none'),
      ...all.filter((g) => g.kind === 'basic').sort((a, b) => byText(a.key, b.key)),
    ],
    total: rows.reduce((n, r) => n + r.row.qty, 0),
  }
}

export interface TakeApartResult {
  collections: Collection[]
  deck: Deck
  /** Copies put in a place, and copies with none. */
  placed: number
  unplaced: number
}

/**
 * "Done: deck taken apart": every copy on [list] goes back into the collection as the Unsorted pile's
 * — as a deck's cards do when it's deleted with its cards kept (intoPile) — each given its place.
 * The deck stays, as a virtual list: its proxies and where its cards came from are cleared, so
 * building it again starts afresh.
 */
export function takeApart(deck: Deck, list: PutBackList, collections: Collection[]): TakeApartResult {
  let pile = withUnsortedPile(collections).find(isUnsorted)!.entries
  let placed = 0
  let unplaced = 0
  for (const row of list.groups.flatMap((g) => g.rows)) {
    const e = deck.cards.find((c) => c.scryfallId === row.scryfallId)
    if (!e || row.qty <= 0) continue
    const adding = { ...pileEntryOf(e, row.foil ? 0 : row.qty), foilQuantity: row.foil ? row.qty : 0 }
    pile = intoPile(pile, [adding])
    if (row.dest) {
      const dest = row.dest
      const at = pile.findIndex((x) => x.scryfallId === row.scryfallId)
      const { entry, moved } = placeCopies(pile[at], dest, row.qty, row.foil)
      pile = pile.map((x, i) => (i === at ? entry : x))
      placed += moved
      unplaced += row.qty - moved
    } else {
      unplaced += row.qty
    }
  }
  const collectionsOut = withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, entries: pile } : c))
  const strip = (e: DeckCardEntry): DeckCardEntry => { const { proxyQuantity: _p, ...rest } = e; return rest }
  const next: Deck = {
    ...deck,
    ownership: 'VIRTUAL',
    cards: deck.cards.map(strip),
    commander: deck.commander ? strip(deck.commander) : null,
    partnerCommander: deck.partnerCommander ? strip(deck.partnerCommander) : null,
    ...(deck.cameFrom !== undefined ? { cameFrom: [] } : {}),
  }
  return { collections: collectionsOut, deck: next, placed, unplaced }
}

/**
 * A group's "Office shelf · 0 of 2" for the pull and put-back lists: each part kept whole, so a
 * narrow screen breaks the line only after a "·", never inside "0 of 2".
 */
export function metaLine(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).map((p) => p.replace(/ /g, ' ')).join(' · ')
}

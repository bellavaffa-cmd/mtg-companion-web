// Filtering what's in storage: a place's page and the Storage tab search and filter the copies kept
// there with the Cards tab's own filters — the search, the filter panel (cardFilter.ts), the Advanced
// filters (advancedFilter.ts, saved filters too) and Spares only — judged copy by copy: a copy's own
// finish, condition, language and binder, and the card's Scryfall data. Then what the results say:
// "14 of 312 cards · $118", the chips with one Clear, the binder pockets to pick out, and the Storage
// tab's heading. Pure, so it can be tested. Mirrors the Android app's ui/collection/PlaceFilter.kt,
// with the same tests (tests/collection/placeFilter.test.ts ↔ PlaceFilterTest.kt).

import { filterActive, filterCount, filterMatches, NO_COLLECTION_FILTER, type CardFacts, type CollectionFilter } from './cardFilter'
import {
  advancedActive, advancedCount, advancedMatches, filterChips, NO_ADVANCED_FILTER, removeChip,
  type AdvancedFacts, type AdvancedFilter, type ChipContext, type CopyFacts, type FilterChip,
} from './advancedFilter'
import { binderPockets, pocketAt } from './binderPages'
import { pocketsOf, type PlacedCard } from './storagePlaces'
import type { LocationChip } from './collectionLayout'
import type { StoragePlace } from '../types/models'

/** A place's (or the Storage tab's) search and filters: the Cards tab's, kept together. */
export interface CardsFilter {
  query: string
  basic: CollectionFilter
  advanced: AdvancedFilter
  /** Only copies of cards no deck of yours plays (spares.ts). */
  sparesOnly: boolean
}

export const NO_CARDS_FILTER: CardsFilter = { query: '', basic: NO_COLLECTION_FILTER, advanced: NO_ADVANCED_FILTER, sparesOnly: false }

/** Whether anything narrows the copies: the search or a filter. */
export const cardsFilterActive = (f: CardsFilter): boolean =>
  f.query.trim() !== '' || filterActive(f.basic) || advancedActive(f.advanced) || f.sparesOnly

/** The filters on, for the filter button's badge (the search is in its own field). */
export const cardsFilterCount = (f: CardsFilter): number =>
  filterCount(f.basic) + advancedCount(f.advanced) + (f.sparesOnly ? 1 : 0)

/** What judging copies needs besides the copies: the cards' data, the collection's, and the search's tags. */
export interface FilterFacts {
  /** By scryfallId; a card whose data hasn't loaded is left out while a filter is on, as on Cards. */
  card: (scryfallId: string) => CardFacts | undefined
  advanced: (scryfallId: string) => AdvancedFacts | undefined
  /** copyFactsOf: every copy of each printing, for In a deck and Copies. */
  copies: Map<string, CopyFacts>
  /** Every place's id with the places it sits in (placeChains). */
  chains: Map<string, string[]>
  /** The card names your decks use (namesDecksUse), for Spares only: a copy of any other card is a spare. */
  usedNames?: ReadonlySet<string>
  /** An amount typed in the chosen currency, in US dollars. */
  toUsd?: (local: number) => number
  /** Whether the search finds a copy — its name and tags, as Cards searches. Plain name by default. */
  searchMatches?: (copy: PlacedCard, query: string) => boolean
}

const nameMatches = (copy: PlacedCard, query: string) => copy.entry.name.toLowerCase().includes(query.trim().toLowerCase())

/**
 * The Your copies facts of one line of copies: its own finish, condition, language, binder and
 * place (with the places it sits in) — so "Foil" finds the foil copies here, not every copy of a card
 * that has a foil somewhere. In a deck and Copies are the card's, from [all] (copyFactsOf).
 */
export function copyFactsOfCopy(copy: PlacedCard, all: CopyFacts | undefined, chains: Map<string, string[]>): CopyFacts {
  const foil = !!copy.line.foil
  return {
    nonfoil: foil ? 0 : copy.line.qty,
    foil: foil ? copy.line.qty : 0,
    conditions: copy.entry.condition ? [copy.entry.condition] : [],
    languages: [copy.entry.language || 'en'],
    binders: [copy.collectionId],
    places: chains.get(copy.line.placeId) ?? [copy.line.placeId],
    unplaced: 0,
    inDeck: all?.inDeck ?? false,
    copies: all?.copies ?? copy.line.qty,
  }
}

/** Whether one line of copies passes the search, the filter panel, the Advanced filters and Spares only. */
export function copyMatches(f: CardsFilter, copy: PlacedCard, facts: FilterFacts): boolean {
  const id = copy.entry.scryfallId
  const q = f.query.trim()
  if (q && !(facts.searchMatches ?? nameMatches)(copy, q)) return false
  if (f.sparesOnly && facts.usedNames?.has(copy.entry.name.trim().toLowerCase()) !== false) return false
  if (!filterMatches(f.basic, facts.card(id))) return false
  if (advancedActive(f.advanced)) {
    const mine = copyFactsOfCopy(copy, facts.copies.get(id), facts.chains)
    if (!advancedMatches(f.advanced, facts.advanced(id), mine, facts.toUsd)) return false
  }
  return true
}

/** The copies that pass [f]; all of them when nothing is on. */
export const filterCopies = (copies: PlacedCard[], f: CardsFilter, facts: FilterFacts): PlacedCard[] =>
  cardsFilterActive(f) ? copies.filter((c) => copyMatches(f, c, facts)) : copies

// ---- What the results say ----

/** A line of copies' price each in US dollars: the foil price for foil copies, else the plain one (either when the other's missing). */
export const placedCopyUsd = (copy: PlacedCard, usd: number | null | undefined, usdFoil: number | null | undefined): number | null =>
  (copy.line.foil ? usdFoil ?? usd : usd ?? usdFoil) ?? null

export interface FilterTotals {
  /** Copies that pass. */
  matching: number
  /** Copies here at all. */
  total: number
  /** What the copies that pass are worth (US dollars); null until prices have loaded. */
  usd: number | null
}

/**
 * The totals of a filtered place: copies matching of copies here, and what the matching copies are
 * worth. Copies in places are binder copies, so every one is a real one (decks' proxies are never
 * in a place); a copy with no price counts as nothing. [priceOf] null: prices not loaded yet.
 */
export function filterTotals(all: PlacedCard[], matching: PlacedCard[], priceOf: ((copy: PlacedCard) => number | null) | null): FilterTotals {
  const qty = (list: PlacedCard[]) => list.reduce((n, c) => n + c.line.qty, 0)
  return {
    matching: qty(matching),
    total: qty(all),
    usd: priceOf ? matching.reduce((n, c) => n + (priceOf(c) ?? 0) * c.line.qty, 0) : null,
  }
}

/** "14 of 312 cards · $118" ([format] shows dollars in the chosen currency); without the value until prices load. */
export function totalsLine(t: FilterTotals, format: (usd: number) => string): string {
  const head = `${t.matching.toLocaleString('en-GB')} of ${t.total.toLocaleString('en-GB')} ${t.total === 1 ? 'card' : 'cards'}`
  return t.usd === null ? head : `${head} · ${format(t.usd)}`
}

/**
 * The chips for what's on: the search, the panel's and Advanced filters' own chips, Spares only —
 * each taken off by its tap, and one Clear for the lot.
 */
export function cardsFilterChips(f: CardsFilter, ctx: ChipContext): FilterChip[] {
  const q = f.query.trim()
  return [
    ...(q ? [{ key: 'search', label: `“${q}”`, symbols: [] }] : []),
    ...filterChips(f.basic, f.advanced, ctx),
    ...(f.sparesOnly ? [{ key: 'spares', label: 'Spares only', symbols: [] }] : []),
  ]
}

/** [f] with the chip [key] taken off. */
export function removeCardsFilterChip(f: CardsFilter, key: string): CardsFilter {
  if (key === 'search') return { ...f, query: '' }
  if (key === 'spares') return { ...f, sparesOnly: false }
  const next = removeChip(f.basic, f.advanced, key)
  return { ...f, basic: next.basic, advanced: next.advanced }
}

/** The binder's pockets (pocketIndex) holding a matching copy — picked out on its pages, the rest dimmed. */
export function matchingPockets(place: StoragePlace, all: PlacedCard[], matching: PlacedCard[]): Set<number> {
  const hits = new Set(matching)
  return new Set(binderPockets(place, all).filter((p) => p.cards.some((c) => hits.has(c))).map((p) => p.index))
}

/** The pages with a matching copy, in order: "Matches on pages 2, 5". */
export function matchingPages(place: StoragePlace, all: PlacedCard[], matching: PlacedCard[]): number[] {
  const pockets = pocketsOf(place)
  return [...new Set([...matchingPockets(place, all, matching)].map((i) => pocketAt(i, pockets).page))].sort((a, b) => a - b)
}

/** The Storage tab's heading over its results: "Cards in storage matching “ramp”" (+ "· 2 filters"). */
export function storageMatchingTitle(f: CardsFilter): string {
  const q = f.query.trim()
  const n = cardsFilterCount(f)
  const filters = `${n} ${n === 1 ? 'filter' : 'filters'}`
  if (q && n > 0) return `Cards in storage matching “${q}” · ${filters}`
  if (q) return `Cards in storage matching “${q}”`
  return `Cards in storage matching your ${n === 1 ? 'filter' : 'filters'}`
}

/** A result row's place chip: "Red box › Red ×2", opening the place at that section or page (LocationChips). */
export function copyChip(copy: PlacedCard, place: StoragePlace | undefined): LocationChip {
  return {
    kind: 'place', qty: copy.line.qty, place: place?.name ?? '', placeId: copy.line.placeId,
    ...(copy.line.section ? { section: copy.line.section } : {}), ...(copy.line.page ? { page: copy.line.page } : {}),
  }
}

// ---- Kept per place while the app runs ----

/** The Storage tab's own filters, kept beside the places'. */
export const STORAGE_FILTER_KEY = 'storage'

/** Each place's filters (and the Storage tab's), by key; not kept across a restart. */
export type FilterMemory = ReadonlyMap<string, CardsFilter>

export const filterIn = (memory: FilterMemory, key: string): CardsFilter => memory.get(key) ?? NO_CARDS_FILTER

/** [memory] with [key]'s filters set — dropped when nothing's on, so Clear forgets them. */
export function withFilter(memory: FilterMemory, key: string, f: CardsFilter): FilterMemory {
  const next = new Map(memory)
  if (cardsFilterActive(f)) next.set(key, f)
  else next.delete(key)
  return next
}

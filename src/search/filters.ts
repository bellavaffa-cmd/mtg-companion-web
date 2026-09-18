// Structured search filters compiled into a Scryfall query — the same fields and the same query
// syntax as the Android app's SearchFilters / buildScryfallQuery (ui/search/SearchViewModel.kt).

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G'

/** Canonical colour order, for the pickers and for stable query strings. */
export const WUBRG: ManaColor[] = ['W', 'U', 'B', 'R', 'G']

export const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const
export const FINISHES = ['nonfoil', 'foil', 'etched'] as const

export interface SearchFilters {
  typeLine: string
  oracle: string
  /** The card's own colours: it must have at least these. */
  colors: ManaColor[]
  /** A commander's colour identity the card must fit within. */
  colorIdentity: ManaColor[]
  sets: string
  rarities: string[]
  priceMin: string
  priceMax: string
  powerMin: string
  powerMax: string
  toughnessMin: string
  toughnessMax: string
  finishes: string[]
  artist: string
}

export const NO_FILTERS: SearchFilters = {
  typeLine: '', oracle: '', colors: [], colorIdentity: [], sets: '', rarities: [],
  priceMin: '', priceMax: '', powerMin: '', powerMax: '', toughnessMin: '', toughnessMax: '',
  finishes: [], artist: '',
}

/** Result order; [order] is Scryfall's `order` parameter (relevance has none, and no direction). */
export const SORT_OPTIONS = [
  { label: 'Relevance', order: null },
  { label: 'Name', order: 'name' },
  { label: 'Mana value', order: 'cmc' },
  { label: 'Power', order: 'power' },
  { label: 'Toughness', order: 'toughness' },
  { label: 'Price', order: 'usd' },
  { label: 'Newest', order: 'released' },
] as const

export interface SearchSort {
  order: string | null
  dir: 'asc' | 'desc'
}

export const DEFAULT_SORT: SearchSort = { order: null, dir: 'asc' }

/** How many filters are set, for the badge on the Filters button. */
export function activeFilterCount(f: SearchFilters): number {
  return [
    f.typeLine.trim(), f.oracle.trim(), f.colors.length, f.colorIdentity.length, f.sets.trim(), f.rarities.length,
    f.priceMin.trim() || f.priceMax.trim(), f.powerMin.trim() || f.powerMax.trim(),
    f.toughnessMin.trim() || f.toughnessMax.trim(), f.finishes.length, f.artist.trim(),
  ].filter(Boolean).length
}

const colorCode = (colors: ManaColor[]) =>
  [...colors].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('').toLowerCase()

const quoteIfNeeded = (value: string) => (/\s/.test(value) ? `"${value}"` : value)

const asNumber = (value: string) => {
  const v = value.trim()
  return v !== '' && Number.isFinite(Number(v)) ? v : null
}

/** The free-text query and [filters] as one Scryfall search query. */
export function buildScryfallQuery(text: string, filters: SearchFilters): string {
  const parts: string[] = []
  if (text.trim()) parts.push(text.trim())

  // Each word of the type line is its own constraint ("legendary creature").
  filters.typeLine.trim().split(/\s+/).filter(Boolean).forEach((word) => parts.push(`type:${word.toLowerCase()}`))

  if (filters.oracle.trim()) parts.push(`oracle:${quoteIfNeeded(filters.oracle.trim())}`)
  if (filters.colors.length) parts.push(`c>=${colorCode(filters.colors)}`)
  if (filters.colorIdentity.length) parts.push(`id<=${colorCode(filters.colorIdentity)}`)

  const sets = filters.sets.split(/[,\s]+/).filter(Boolean).map((s) => s.toLowerCase())
  if (sets.length === 1) parts.push(`set:${sets[0]}`)
  else if (sets.length > 1) parts.push(`(${sets.map((s) => `set:${s}`).join(' or ')})`)

  if (filters.rarities.length) parts.push(`(${filters.rarities.map((r) => `rarity:${r}`).join(' or ')})`)

  const range = (key: string, min: string, max: string) => {
    const lo = asNumber(min)
    const hi = asNumber(max)
    if (lo !== null) parts.push(`${key}>=${lo}`)
    if (hi !== null) parts.push(`${key}<=${hi}`)
  }
  range('usd', filters.priceMin, filters.priceMax)
  range('pow', filters.powerMin, filters.powerMax)
  range('tou', filters.toughnessMin, filters.toughnessMax)

  if (filters.finishes.length) parts.push(`(${filters.finishes.map((f) => `is:${f}`).join(' or ')})`)
  if (filters.artist.trim()) parts.push(`artist:${quoteIfNeeded(filters.artist.trim())}`)

  return parts.join(' ')
}

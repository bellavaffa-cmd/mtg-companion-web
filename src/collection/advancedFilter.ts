// The All cards Advanced filters: Scryfall-style fields (colours, mana, stats, format, sets, what
// the card is, price, art and words) judged against the Scryfall data already fetched for the cards
// owned, plus "Your copies" fields judged against the collection itself. Also the same filters as a
// Scryfall query (read-only, to copy or open on Scryfall), the removable chips the results show, and
// saved filters as JSON. Pure, so it can be tested.
// Mirrors the Android app's AdvancedFilter.kt (ui/collection/AdvancedFilter.kt) — same fields, same
// matching rules, same query, same chip wording, and byte-for-byte the same saved-filter JSON.

import { canBeCommander, hasFlipSides, type ScryfallCard } from '../types/scryfall'
import { GAME_MODE_LABELS, GAME_MODES, type Collection, type Deck } from '../types/models'
import { CARD_CONDITIONS, languageName } from './copyDetails'
import { COLLECTION_FILTER_RARITIES, NO_COLLECTION_FILTER, type CollectionFilter, type FilterColor } from './cardFilter'
import { NO_PLACE, placeFactsOf, placesOf } from './storagePlaces'

/** How a number is compared: stored as these, shown as ≤ ≥ ≠. */
export type CompareOp = '=' | '<' | '<=' | '>' | '>=' | '!='
export const COMPARE_OPS: CompareOp[] = ['=', '<', '<=', '>', '>=', '!=']
export const OP_SYMBOLS: Record<CompareOp, string> = { '=': '=', '<': '<', '<=': '≤', '>': '>', '>=': '≥', '!=': '≠' }

export type ColorTarget = 'color' | 'identity'
export type ColorMode = 'exactly' | 'including' | 'atMost'
/** W U B R G, and C for colourless (picked on its own). */
export const ADVANCED_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const
export const COLOR_MODE_LABELS: Record<ColorMode, string> = { exactly: 'Exactly', including: 'Including', atMost: 'At most' }
const COLOR_MODE_SYMBOLS: Record<ColorMode, string> = { exactly: '=', including: '≥', atMost: '≤' }
const COLOR_MODE_OPS: Record<ColorMode, string> = { exactly: '=', including: '>=', atMost: '<=' }

/** The app's formats that Scryfall knows (Limited has no Scryfall format), by Scryfall's key. */
export const FILTER_FORMATS: { key: string; label: string }[] = GAME_MODES.filter((m) => m !== 'LIMITED')
  .map((m) => ({ key: m.toLowerCase(), label: GAME_MODE_LABELS[m] }))
export type Legality = 'legal' | 'banned' | 'restricted'
export const LEGALITIES: Legality[] = ['legal', 'banned', 'restricted']
export const LEGALITY_LABELS: Record<Legality, string> = { legal: 'Legal', banned: 'Banned', restricted: 'Restricted' }

export const CARD_IS = ['commander', 'gamechanger', 'reserved', 'dfc', 'fullart', 'token'] as const
export type CardIs = (typeof CARD_IS)[number]
export const CARD_IS_LABELS: Record<CardIs, string> = {
  commander: 'Can be a commander',
  gamechanger: 'Game Changer',
  reserved: 'Reserved List',
  dfc: 'Double-faced',
  fullart: 'Full art',
  token: 'Token',
}
const CARD_IS_QUERY: Record<CardIs, string> = {
  commander: 'is:commander', gamechanger: 'is:gamechanger', reserved: 'is:reserved', dfc: 'is:dfc', fullart: 'is:fullart', token: 't:token',
}

export const FINISHES = ['nonfoil', 'foil', 'etched'] as const
export type Finish = (typeof FINISHES)[number]
export const FINISH_LABELS: Record<Finish, string> = { nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' }
/** The collection's condition codes, as the chips name them. */
export const CONDITION_LABELS: Record<string, string> = { NM: 'NM', LP: 'LP', MP: 'MP', HP: 'HP', DMG: 'Damaged' }

export type InDeck = 'any' | 'yes' | 'no'
export const IN_DECK_LABELS: Record<InDeck, string> = { any: 'Any', yes: 'In a deck', no: 'Not in any' }

export interface AdvancedFilter {
  colorTarget: ColorTarget
  colorMode: ColorMode
  /** WUBRG letters, or just C for colourless. */
  colors: string[]
  multicolor: boolean
  mvOp: CompareOp
  mv: string
  /** Symbols the mana cost must hold at least, e.g. "{2}{U}{U}". */
  manaCost: string
  powerOp: CompareOp
  power: string
  toughnessOp: CompareOp
  toughness: string
  loyaltyOp: CompareOp
  loyalty: string
  /** Scryfall's key ("commander"), or '' for any format. */
  format: string
  legality: Legality
  /** Set codes, lower case. */
  sets: string[]
  cardIs: string[]
  /** Comma-separated; the card must have every one. */
  keywords: string
  /** In the chosen currency, per copy. */
  priceMin: string
  priceMax: string
  artist: string
  flavor: string
  // Your copies — the collection, not Scryfall.
  finishes: string[]
  conditions: string[]
  /** A language code ("ja"), or '' for any. */
  language: string
  /** A binder's id, or '' for any. */
  binder: string
  /** A storage place's id (copies in it or in a place inside it), NO_PLACE for copies with no place yet, or '' for any. */
  place: string
  inDeck: InDeck
  copiesOp: CompareOp
  copies: string
}

export const NO_ADVANCED_FILTER: AdvancedFilter = {
  colorTarget: 'identity', colorMode: 'atMost', colors: [], multicolor: false,
  mvOp: '<=', mv: '', manaCost: '',
  powerOp: '>=', power: '', toughnessOp: '>=', toughness: '', loyaltyOp: '>=', loyalty: '',
  format: '', legality: 'legal', sets: [], cardIs: [], keywords: '',
  priceMin: '', priceMax: '', artist: '', flavor: '',
  finishes: [], conditions: [], language: '', binder: '', place: '', inDeck: 'any', copiesOp: '>=', copies: '',
}

/** A typed number, or null for anything else (blank, "*", "abc"). */
export function numberOf(value: string | null | undefined): number | null {
  const v = (value ?? '').trim()
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(v)) return null
  return Number(v)
}

export function compare(value: number, op: CompareOp, target: number): boolean {
  switch (op) {
    case '=': return value === target
    case '<': return value < target
    case '<=': return value <= target
    case '>': return value > target
    case '>=': return value >= target
    case '!=': return value !== target
  }
}

/** "{2}{U}{U}" (or "2uu") as its symbols: ["2", "U", "U"]. Hybrid and the like stay whole: "W/U". */
export function manaSymbols(cost: string | null | undefined): string[] {
  const raw = (cost ?? '').trim().toUpperCase()
  if (!raw) return []
  if (raw.includes('{')) return [...raw.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].trim()).filter(Boolean)
  return raw.match(/\d+|[A-Z]/g) ?? []
}

const isGeneric = (s: string) => /^\d+$/.test(s)

/** Whether [have] holds at least the symbols [want]: as many generic mana, and each other symbol as often. */
export function costContains(have: string[], want: string[]): boolean {
  const generic = (list: string[]) => list.filter(isGeneric).reduce((n, s) => n + Number(s), 0)
  if (generic(have) < generic(want)) return false
  const counts = new Map<string, number>()
  for (const s of have) if (!isGeneric(s)) counts.set(s, (counts.get(s) ?? 0) + 1)
  for (const s of want) {
    if (isGeneric(s)) continue
    const n = counts.get(s) ?? 0
    if (n === 0) return false
    counts.set(s, n - 1)
  }
  return true
}

const keywordList = (keywords: string) => keywords.split(',').map((k) => k.trim()).filter(Boolean)
const colorsOf = (a: AdvancedFilter) => a.colors.filter((c) => c !== 'C')
const colorless = (a: AdvancedFilter) => a.colors.includes('C') && colorsOf(a).length === 0
const colorsOn = (a: AdvancedFilter) => colorsOf(a).length > 0 || a.colors.includes('C')
const wubrgOrder = (list: string[]) => [...list].sort((x, y) => ADVANCED_COLORS.indexOf(x as never) - ADVANCED_COLORS.indexOf(y as never))

/** Whether any advanced field is set (a number field only once it's a number). */
export function advancedActive(a: AdvancedFilter): boolean {
  return advancedCount(a) > 0
}

/** How many advanced filters are on — one per chip they show as. */
export function advancedCount(a: AdvancedFilter): number {
  return [
    colorsOn(a), a.multicolor, numberOf(a.mv) !== null, manaSymbols(a.manaCost).length > 0,
    numberOf(a.power) !== null, numberOf(a.toughness) !== null, numberOf(a.loyalty) !== null,
    a.format !== '', keywordList(a.keywords).length > 0,
    numberOf(a.priceMin) !== null || numberOf(a.priceMax) !== null, a.artist.trim() !== '', a.flavor.trim() !== '',
    a.language !== '', a.binder !== '', a.place !== '', a.inDeck !== 'any', numberOf(a.copies) !== null,
  ].filter(Boolean).length + a.sets.length + a.cardIs.length + a.finishes.length + a.conditions.length
}

/** What the Advanced filters need to know about a card, from its Scryfall data. */
export interface AdvancedFacts {
  /** The card's own colours (every face of a double-faced card). */
  colors: string[]
  identity: string[]
  cmc: number | null
  /** Every face's mana cost, as symbols. */
  manaCost: string[]
  /** Power, toughness and loyalty, of the card and of each face, as printed. */
  stats: { power?: string; toughness?: string; loyalty?: string }[]
  legalities: Record<string, string>
  set: string
  canBeCommander: boolean
  gameChanger: boolean
  reserved: boolean
  dfc: boolean
  fullArt: boolean
  token: boolean
  keywords: string[]
  /** US dollars; null with no price. */
  usd: number | null
  usdFoil: number | null
  artist: string
  flavor: string
  /** The printing only comes as etched foil: its foil copies are etched. */
  etchedOnly: boolean
}

const price = (v: string | null | undefined) => {
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export function advancedFactsOf(card: ScryfallCard): AdvancedFacts {
  const faces = card.card_faces ?? []
  const colors = card.colors ?? [...new Set(faces.flatMap((f) => f.colors ?? []))]
  const costs = card.mana_cost ? [card.mana_cost] : faces.map((f) => f.mana_cost ?? '')
  const typeLine = card.type_line ?? faces.map((f) => f.type_line ?? '').join(' // ')
  const finishes = card.finishes ?? []
  return {
    colors: colors.map((c) => c.toUpperCase()),
    identity: (card.color_identity ?? []).map((c) => c.toUpperCase()),
    cmc: typeof card.cmc === 'number' ? card.cmc : null,
    manaCost: costs.flatMap(manaSymbols),
    stats: [card, ...faces].map((f) => ({ power: f.power, toughness: f.toughness, loyalty: f.loyalty })),
    legalities: card.legalities ?? {},
    set: (card.set ?? '').toLowerCase(),
    canBeCommander: canBeCommander(card),
    gameChanger: card.game_changer === true,
    reserved: card.reserved === true,
    dfc: hasFlipSides(card),
    fullArt: card.full_art === true,
    token: /\btoken\b/i.test(typeLine) || card.layout === 'token' || card.layout === 'double_faced_token',
    keywords: card.keywords ?? [],
    usd: price(card.prices?.usd),
    usdFoil: price(card.prices?.usd_foil),
    artist: [card.artist, ...faces.map((f) => f.artist)].filter(Boolean).join('\n'),
    flavor: [card.flavor_text, ...faces.map((f) => f.flavor_text)].filter(Boolean).join('\n'),
    etchedOnly: finishes.includes('etched') && !finishes.includes('foil'),
  }
}

/** What the Your copies filters need to know about a card: the copies owned, from the collection. */
export interface CopyFacts {
  nonfoil: number
  /** Foil copies (etched ones too: the collection keeps them as foil). */
  foil: number
  /** Conditions said for the binder copies (NM, LP…). */
  conditions: string[]
  /** Languages of the binder copies; a copy with none said is English. */
  languages: string[]
  /** The owned binders holding it. */
  binders: string[]
  /** The storage places holding binder copies, each with the places it sits in. */
  places: string[]
  /** Binder copies with no place yet (not counting ones lent out). */
  unplaced: number
  inDeck: boolean
  /** All copies, in binders and decks — as All cards counts them. */
  copies: number
}

/**
 * By scryfallId, the copies in the owned binders (not wishlists) and in decks — the places All cards
 * lists and cardSources names. A deck keeps no finish, so its copies count as non-foil.
 */
export function copyFactsOf(collections: Collection[], decks: Deck[]): Map<string, CopyFacts> {
  const out = new Map<string, CopyFacts>()
  const of = (id: string) => {
    let f = out.get(id)
    if (!f) {
      f = { nonfoil: 0, foil: 0, conditions: [], languages: [], binders: [], places: [], unplaced: 0, inDeck: false, copies: 0 }
      out.set(id, f)
    }
    return f
  }
  const addOnce = (list: string[], v: string) => { if (!list.includes(v)) list.push(v) }
  const places = placesOf(collections)
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      const n = e.quantity + e.foilQuantity
      if (n <= 0) continue
      const f = of(e.scryfallId)
      f.nonfoil += e.quantity
      f.foil += e.foilQuantity
      f.copies += n
      if (e.condition) addOnce(f.conditions, e.condition)
      addOnce(f.languages, e.language || 'en')
      addOnce(f.binders, c.id)
      const where = placeFactsOf(e, places)
      where.places.forEach((p) => addOnce(f.places, p))
      f.unplaced += where.unplaced
    }
  }
  for (const d of decks) {
    for (const e of d.cards) {
      if (e.quantity <= 0) continue
      const f = of(e.scryfallId)
      f.nonfoil += e.quantity
      f.copies += e.quantity
      f.inDeck = true
    }
  }
  return out
}

/** The price a copy is judged by (US dollars): non-foil, unless every copy is foil — as the price alerts do. */
export function copyPrice(facts: AdvancedFacts, copies: CopyFacts | undefined): number | null {
  if (copies && copies.nonfoil <= 0 && copies.foil > 0) return facts.usdFoil ?? facts.usd
  return facts.usd ?? facts.usdFoil
}

const statMatches = (stats: AdvancedFacts['stats'], key: 'power' | 'toughness' | 'loyalty', op: CompareOp, target: string) => {
  const t = numberOf(target)
  if (t === null) return true
  return stats.some((s) => {
    const v = numberOf(s[key])
    return v !== null && compare(v, op, t)
  })
}

/**
 * Whether a card passes every advanced filter. [facts] undefined: its data hasn't loaded, so it can't
 * be judged and is left out while a filter is on; the same for [copies] while a Your copies filter
 * is on. Prices are typed in the chosen currency: [toUsd] turns them into dollars.
 */
export function advancedMatches(
  a: AdvancedFilter, facts: AdvancedFacts | undefined | null, copies: CopyFacts | undefined | null,
  toUsd: (local: number) => number = (n) => n,
): boolean {
  if (!advancedActive(a)) return true
  if (!facts) return false

  const have = a.colorTarget === 'identity' ? facts.identity : facts.colors
  if (colorless(a)) {
    if (have.length > 0) return false
  } else if (colorsOf(a).length > 0) {
    const want = colorsOf(a)
    const inside = have.every((c) => want.includes(c))
    const covers = want.every((c) => have.includes(c))
    if (a.colorMode === 'exactly' && !(inside && covers)) return false
    if (a.colorMode === 'including' && !covers) return false
    if (a.colorMode === 'atMost' && !inside) return false
  }
  if (a.multicolor && have.length < 2) return false

  const mv = numberOf(a.mv)
  if (mv !== null && (facts.cmc === null || !compare(facts.cmc, a.mvOp, mv))) return false
  const cost = manaSymbols(a.manaCost)
  if (cost.length > 0 && !costContains(facts.manaCost, cost)) return false

  if (!statMatches(facts.stats, 'power', a.powerOp, a.power)) return false
  if (!statMatches(facts.stats, 'toughness', a.toughnessOp, a.toughness)) return false
  if (!statMatches(facts.stats, 'loyalty', a.loyaltyOp, a.loyalty)) return false

  if (a.format && facts.legalities[a.format] !== a.legality) return false
  if (a.sets.length > 0 && !a.sets.includes(facts.set)) return false

  for (const is of a.cardIs) {
    const ok = is === 'commander' ? facts.canBeCommander : is === 'gamechanger' ? facts.gameChanger : is === 'reserved' ? facts.reserved
      : is === 'dfc' ? facts.dfc : is === 'fullart' ? facts.fullArt : is === 'token' ? facts.token : true
    if (!ok) return false
  }
  const cardKeywords = facts.keywords.map((k) => k.toLowerCase())
  if (!keywordList(a.keywords).every((k) => cardKeywords.includes(k.toLowerCase()))) return false

  const lo = numberOf(a.priceMin)
  const hi = numberOf(a.priceMax)
  if (lo !== null || hi !== null) {
    const usd = copyPrice(facts, copies ?? undefined)
    if (usd === null) return false
    // A cent's grace, so a price typed as shown isn't missed by rounding.
    if (lo !== null && usd < toUsd(lo) - 0.005) return false
    if (hi !== null && usd > toUsd(hi) + 0.005) return false
  }
  if (a.artist.trim() && !facts.artist.toLowerCase().includes(a.artist.trim().toLowerCase())) return false
  if (a.flavor.trim() && !facts.flavor.toLowerCase().includes(a.flavor.trim().toLowerCase())) return false

  const copiesOn = a.finishes.length > 0 || a.conditions.length > 0 || a.language !== '' || a.binder !== '' || a.place !== '' || a.inDeck !== 'any' || numberOf(a.copies) !== null
  if (!copiesOn) return true
  if (!copies) return false
  if (a.finishes.length > 0) {
    const foilKind = facts.etchedOnly ? 'etched' : 'foil'
    const ok = (a.finishes.includes('nonfoil') && copies.nonfoil > 0) || (a.finishes.includes(foilKind) && copies.foil > 0)
    if (!ok) return false
  }
  if (a.conditions.length > 0 && !a.conditions.some((c) => copies.conditions.includes(c))) return false
  if (a.language && !copies.languages.includes(a.language)) return false
  if (a.binder && !copies.binders.includes(a.binder)) return false
  if (a.place === NO_PLACE ? copies.unplaced <= 0 : a.place && !copies.places.includes(a.place)) return false
  if (a.inDeck === 'yes' && !copies.inDeck) return false
  if (a.inDeck === 'no' && copies.inDeck) return false
  const n = numberOf(a.copies)
  if (n !== null && !compare(copies.copies, a.copiesOp, n)) return false
  return true
}

// ---- The same filters as a Scryfall query ----

/** A number as a query writes it: at most two decimals, none when whole ("1", "1.5", "0.33"). */
export function queryNumber(n: number): string {
  return String(Number(n.toFixed(2)))
}

const quoteIfNeeded = (value: string) => {
  const v = value.replace(/"/g, '').trim()
  return /\s/.test(v) ? `"${v}"` : v
}

const anyOf = (parts: string[]) => (parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`)

/**
 * The basic and advanced filters in Scryfall's search syntax — what Scryfall would find, across every
 * card. Your copies filters aren't in it: Scryfall doesn't know the collection. Prices are typed in
 * the chosen currency and searched in US dollars ([toUsd]).
 */
export function scryfallQuery(basic: CollectionFilter, a: AdvancedFilter, toUsd: (local: number) => number = (n) => n): string {
  const parts: string[] = []
  basic.type.trim().split(/\s+/).filter(Boolean).forEach((w) => parts.push(`t:${w.toLowerCase().replace(/"/g, '')}`))
  if (basic.text.trim()) parts.push(`o:${quoteIfNeeded(basic.text.toLowerCase())}`)
  // The basic panel's colours are judged by colour identity.
  if (basic.colors.length) parts.push(`id>=${wubrgOrder(basic.colors).join('').toLowerCase()}`)
  const rarities = COLLECTION_FILTER_RARITIES.filter((r) => basic.rarities.includes(r))
  if (rarities.length) parts.push(anyOf(rarities.map((r) => `r:${r}`)))

  const key = a.colorTarget === 'identity' ? 'id' : 'c'
  if (colorless(a)) parts.push(`${key}=c`)
  else if (colorsOf(a).length) parts.push(`${key}${COLOR_MODE_OPS[a.colorMode]}${wubrgOrder(colorsOf(a)).join('').toLowerCase()}`)
  if (a.multicolor) parts.push(`${key}:m`)

  const mv = numberOf(a.mv)
  if (mv !== null) parts.push(`mv${a.mvOp}${queryNumber(mv)}`)
  const cost = manaSymbols(a.manaCost)
  if (cost.length) parts.push(`m:${cost.map((s) => `{${s}}`).join('')}`)
  const stat = (k: string, op: CompareOp, v: string) => {
    const n = numberOf(v)
    if (n !== null) parts.push(`${k}${op}${queryNumber(n)}`)
  }
  stat('pow', a.powerOp, a.power)
  stat('tou', a.toughnessOp, a.toughness)
  stat('loy', a.loyaltyOp, a.loyalty)

  if (a.format) parts.push(`${a.legality === 'legal' ? 'f' : a.legality}:${a.format}`)
  if (a.sets.length) parts.push(anyOf(a.sets.map((s) => `e:${s}`)))
  CARD_IS.filter((is) => a.cardIs.includes(is)).forEach((is) => parts.push(CARD_IS_QUERY[is]))
  keywordList(a.keywords).forEach((k) => parts.push(`kw:${quoteIfNeeded(k.toLowerCase())}`))

  const lo = numberOf(a.priceMin)
  const hi = numberOf(a.priceMax)
  if (lo !== null) parts.push(`usd>=${queryNumber(toUsd(lo))}`)
  if (hi !== null) parts.push(`usd<=${queryNumber(toUsd(hi))}`)
  if (a.artist.trim()) parts.push(`a:${quoteIfNeeded(a.artist)}`)
  if (a.flavor.trim()) parts.push(`ft:${quoteIfNeeded(a.flavor)}`)
  return parts.join(' ')
}

/** Scryfall's search page for [query]. */
export const scryfallSearchUrl = (query: string) => `https://scryfall.com/search?q=${encodeURIComponent(query)}`

// ---- Chips: one per filter on, each removable ----

export interface FilterChip {
  key: string
  label: string
  /** Mana symbols shown after the label ("Identity ≤" then U, B). */
  symbols: string[]
}

/** A chip as words, for a screen reader and the tests: "Identity ≤ UB". */
export const chipText = (c: FilterChip) => [c.label, c.symbols.join('')].filter(Boolean).join(' ')

export interface ChipContext {
  /** A binder's name by id. */
  binderName: (id: string) => string | undefined
  /** A storage place's name by id. */
  placeName?: (id: string) => string | undefined
  /** An amount typed in the chosen currency, as shown: "$1.50". */
  formatLocal: (amount: number) => string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The chips for the basic and advanced filters on, in the order the panel and the page show them. */
export function filterChips(basic: CollectionFilter, a: AdvancedFilter, ctx: ChipContext): FilterChip[] {
  const chips: FilterChip[] = []
  const add = (key: string, label: string, symbols: string[] = []) => chips.push({ key, label, symbols })
  const words = basic.type.trim().split(/\s+/).filter(Boolean).join(' ')
  if (words) add('type', cap(words))
  if (basic.text.trim()) add('text', `Text: ${basic.text.trim()}`)
  wubrgOrder(basic.colors).forEach((c) => add(`color:${c}`, 'Colour', [c]))
  COLLECTION_FILTER_RARITIES.filter((r) => basic.rarities.includes(r)).forEach((r) => add(`rarity:${r}`, cap(r)))

  const target = a.colorTarget === 'identity' ? 'Identity' : 'Colour'
  if (colorless(a)) add('colors', target, ['C'])
  else if (colorsOf(a).length) add('colors', `${target} ${COLOR_MODE_SYMBOLS[a.colorMode]}`, wubrgOrder(colorsOf(a)))
  if (a.multicolor) add('multicolor', 'Multicolour')
  const num = (key: string, label: string, op: CompareOp, v: string) => {
    const n = numberOf(v)
    if (n !== null) add(key, `${label} ${OP_SYMBOLS[op]} ${queryNumber(n)}`)
  }
  num('mv', 'MV', a.mvOp, a.mv)
  const cost = manaSymbols(a.manaCost)
  if (cost.length) add('manaCost', 'Cost', cost)
  num('power', 'Power', a.powerOp, a.power)
  num('toughness', 'Toughness', a.toughnessOp, a.toughness)
  num('loyalty', 'Loyalty', a.loyaltyOp, a.loyalty)
  if (a.format) {
    const name = FILTER_FORMATS.find((f) => f.key === a.format)?.label ?? a.format
    add('format', `${LEGALITY_LABELS[a.legality]} in ${name}`)
  }
  a.sets.forEach((s) => add(`set:${s}`, s.toUpperCase()))
  CARD_IS.filter((is) => a.cardIs.includes(is)).forEach((is) => add(`is:${is}`, CARD_IS_LABELS[is]))
  const kws = keywordList(a.keywords)
  if (kws.length) add('keywords', `Keywords: ${kws.join(', ')}`)
  const lo = numberOf(a.priceMin)
  const hi = numberOf(a.priceMax)
  if (lo !== null && hi !== null) add('price', `Price ${ctx.formatLocal(lo)}–${ctx.formatLocal(hi)}`)
  else if (lo !== null) add('price', `Price ≥ ${ctx.formatLocal(lo)}`)
  else if (hi !== null) add('price', `Price ≤ ${ctx.formatLocal(hi)}`)
  if (a.artist.trim()) add('artist', `Artist: ${a.artist.trim()}`)
  if (a.flavor.trim()) add('flavor', `Flavour: ${a.flavor.trim()}`)

  FINISHES.filter((f) => a.finishes.includes(f)).forEach((f) => add(`finish:${f}`, FINISH_LABELS[f]))
  CARD_CONDITIONS.filter((c) => a.conditions.includes(c)).forEach((c) => add(`condition:${c}`, CONDITION_LABELS[c] ?? c))
  if (a.language) add('language', languageName(a.language))
  if (a.binder) add('binder', ctx.binderName(a.binder) ?? 'Binder')
  if (a.place) add('place', a.place === NO_PLACE ? 'No place yet' : ctx.placeName?.(a.place) ?? 'Place')
  if (a.inDeck === 'yes') add('inDeck', 'In a deck')
  if (a.inDeck === 'no') add('inDeck', 'Not in a deck')
  num('copies', 'Copies', a.copiesOp, a.copies)
  return chips
}

/** The filters with the chip [key] taken off. */
export function removeChip(basic: CollectionFilter, a: AdvancedFilter, key: string): { basic: CollectionFilter; advanced: AdvancedFilter } {
  const [kind, value] = key.includes(':') ? [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] : [key, '']
  let b = basic
  let adv = a
  switch (kind) {
    case 'type': b = { ...b, type: '' }; break
    case 'text': b = { ...b, text: '' }; break
    case 'color': b = { ...b, colors: b.colors.filter((c) => c !== value) }; break
    case 'rarity': b = { ...b, rarities: b.rarities.filter((r) => r !== value) }; break
    case 'colors': adv = { ...adv, colors: [] }; break
    case 'multicolor': adv = { ...adv, multicolor: false }; break
    case 'mv': adv = { ...adv, mv: '' }; break
    case 'manaCost': adv = { ...adv, manaCost: '' }; break
    case 'power': adv = { ...adv, power: '' }; break
    case 'toughness': adv = { ...adv, toughness: '' }; break
    case 'loyalty': adv = { ...adv, loyalty: '' }; break
    case 'format': adv = { ...adv, format: '' }; break
    case 'set': adv = { ...adv, sets: adv.sets.filter((s) => s !== value) }; break
    case 'is': adv = { ...adv, cardIs: adv.cardIs.filter((s) => s !== value) }; break
    case 'keywords': adv = { ...adv, keywords: '' }; break
    case 'price': adv = { ...adv, priceMin: '', priceMax: '' }; break
    case 'artist': adv = { ...adv, artist: '' }; break
    case 'flavor': adv = { ...adv, flavor: '' }; break
    case 'finish': adv = { ...adv, finishes: adv.finishes.filter((s) => s !== value) }; break
    case 'condition': adv = { ...adv, conditions: adv.conditions.filter((s) => s !== value) }; break
    case 'language': adv = { ...adv, language: '' }; break
    case 'binder': adv = { ...adv, binder: '' }; break
    case 'place': adv = { ...adv, place: '' }; break
    case 'inDeck': adv = { ...adv, inDeck: 'any' }; break
    case 'copies': adv = { ...adv, copies: '' }; break
  }
  return { basic: b, advanced: adv }
}

// ---- Saved filters ----

export interface SavedFilter {
  id: string
  name: string
  basic: CollectionFilter
  advanced: AdvancedFilter
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)

function basicJson(b: CollectionFilter) {
  return {
    type: b.type,
    text: b.text,
    colors: wubrgOrder(b.colors),
    rarities: COLLECTION_FILTER_RARITIES.filter((r) => b.rarities.includes(r)),
  }
}

// Keys in this order on both apps, so the JSON is the same text.
function advancedJson(a: AdvancedFilter) {
  return {
    colorTarget: a.colorTarget, colorMode: a.colorMode, colors: wubrgOrder(a.colors), multicolor: a.multicolor,
    mvOp: a.mvOp, mv: a.mv, manaCost: a.manaCost,
    powerOp: a.powerOp, power: a.power, toughnessOp: a.toughnessOp, toughness: a.toughness, loyaltyOp: a.loyaltyOp, loyalty: a.loyalty,
    format: a.format, legality: a.legality, sets: a.sets,
    cardIs: CARD_IS.filter((is) => a.cardIs.includes(is)), keywords: a.keywords,
    priceMin: a.priceMin, priceMax: a.priceMax, artist: a.artist, flavor: a.flavor,
    finishes: FINISHES.filter((f) => a.finishes.includes(f)), conditions: CARD_CONDITIONS.filter((c) => a.conditions.includes(c)),
    language: a.language, binder: a.binder, place: a.place, inDeck: a.inDeck, copiesOp: a.copiesOp, copies: a.copies,
  }
}

/** Saved filters as JSON — the same text the Android app writes. */
export function savedFiltersToJson(list: SavedFilter[]): string {
  return JSON.stringify(list.map((s) => ({ id: s.id, name: s.name, basic: basicJson(s.basic), advanced: advancedJson(s.advanced) })))
}

function basicFrom(raw: Record<string, unknown>): CollectionFilter {
  return {
    type: str(raw.type, ''),
    text: str(raw.text, ''),
    colors: strList(raw.colors).filter((c): c is FilterColor => ['W', 'U', 'B', 'R', 'G'].includes(c)),
    rarities: strList(raw.rarities).filter((r) => COLLECTION_FILTER_RARITIES.includes(r)),
  }
}

function advancedFrom(raw: Record<string, unknown>): AdvancedFilter {
  const d = NO_ADVANCED_FILTER
  return {
    colorTarget: oneOf(raw.colorTarget, ['color', 'identity'] as const, d.colorTarget),
    colorMode: oneOf(raw.colorMode, ['exactly', 'including', 'atMost'] as const, d.colorMode),
    colors: strList(raw.colors).filter((c) => (ADVANCED_COLORS as readonly string[]).includes(c)),
    multicolor: raw.multicolor === true,
    mvOp: oneOf(raw.mvOp, COMPARE_OPS, d.mvOp),
    mv: str(raw.mv, ''),
    manaCost: str(raw.manaCost, ''),
    powerOp: oneOf(raw.powerOp, COMPARE_OPS, d.powerOp),
    power: str(raw.power, ''),
    toughnessOp: oneOf(raw.toughnessOp, COMPARE_OPS, d.toughnessOp),
    toughness: str(raw.toughness, ''),
    loyaltyOp: oneOf(raw.loyaltyOp, COMPARE_OPS, d.loyaltyOp),
    loyalty: str(raw.loyalty, ''),
    format: str(raw.format, ''),
    legality: oneOf(raw.legality, LEGALITIES, d.legality),
    sets: strList(raw.sets).map((s) => s.toLowerCase()),
    cardIs: strList(raw.cardIs).filter((s) => (CARD_IS as readonly string[]).includes(s)),
    keywords: str(raw.keywords, ''),
    priceMin: str(raw.priceMin, ''),
    priceMax: str(raw.priceMax, ''),
    artist: str(raw.artist, ''),
    flavor: str(raw.flavor, ''),
    finishes: strList(raw.finishes).filter((s) => (FINISHES as readonly string[]).includes(s)),
    conditions: strList(raw.conditions).filter((s) => (CARD_CONDITIONS as readonly string[]).includes(s)),
    language: str(raw.language, ''),
    binder: str(raw.binder, ''),
    place: str(raw.place, ''),
    inDeck: oneOf(raw.inDeck, ['any', 'yes', 'no'] as const, d.inDeck),
    copiesOp: oneOf(raw.copiesOp, COMPARE_OPS, d.copiesOp),
    copies: str(raw.copies, ''),
  }
}

/** Saved filters read back; anything unreadable is skipped, a missing field takes its default. */
export function savedFiltersFromJson(json: string | null | undefined): SavedFilter[] {
  if (!json) return []
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return [] }
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): SavedFilter[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string') return []
    const basic = o.basic && typeof o.basic === 'object' ? basicFrom(o.basic as Record<string, unknown>) : NO_COLLECTION_FILTER
    const advanced = o.advanced && typeof o.advanced === 'object' ? advancedFrom(o.advanced as Record<string, unknown>) : NO_ADVANCED_FILTER
    return [{ id: o.id, name: o.name, basic, advanced }]
  })
}

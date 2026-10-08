// Sorting recipes: how a pile of cards splits, saved and reused. A recipe is a name, the smart piles
// to "first, pull out" (cards a deck needs, cards a friend wants, cards new for a binder, copies past
// a playset to trade), up to three levels that split the rest (value bands, colour, colour identity,
// set, mana value, rarity, card type, A–Z ranges, collector number) and what to "also keep apart"
// (foils, not English, played). The piles follow from the recipe, always the same way: the smart
// piles first, then the keep-apart piles, then every combination of the levels — at most
// MAX_RECIPE_PILES, the rest sharing an "Everything else" pile. Each card scanned goes in one pile:
// a smart pile when one applies (decks before friends before binders before trade), else a
// keep-apart pile, else the levels' pile.
//
// Where recipes are kept: the Unsorted pile's "sortRecipes" (Collection.sortRecipes), so they sync
// like the storage places and gear. Two devices' recipes merge recipe by recipe (mergeRecipes): one
// added on either is kept, one deleted on either stays deleted, each field goes to whoever changed it.
// A pile saved by an app from before recipes comes without the key and keeps this device's
// (keepRecipesFromOlderApp).
//
//   "sortRecipes": [{ "id": "…", "name": "My bulk boxes", "pullOut": ["DECKS", "FRIENDS", "BINDER"],
//                     "levels": [{ "by": "VALUE", "cuts": [2], "restOn": true }, { "by": "COLOUR" }],
//                     "apart": ["FOIL"], "goTo": [{ "pile": "L:W", "to": "RULE" }], "createdAt": 1790000000000 }]
// A level's "cuts", "letters", "sets", "lands" and "restOn", and a recipe's "goTo", are left out when not said.
//
// Pure, so it can be tested. Mirrors the Android app's data/SortRecipes.kt rule for rule; both run the
// same test vectors (tests/collection/sortRecipeVectors.json ↔ app/src/test/resources/sortRecipeVectors.json).

import { isUnsorted, type Collection, type CollectionEntry, type Deck, type SortRule } from '../types/models'
import { sameJson } from '../sync/canonicalJson'
import { withUnsortedPile } from './unsorted'
import { cardsIn, colourSection, letterOf, placesOf, pocketsOf, typeSection, TYPE_SECTIONS, type CardFacts } from './storagePlaces'
import { binderPockets, planFit, pocketAt } from './binderPages'
import { isBasicLand, missingCards } from '../decks/missing'
import { BY_RULE, fileEveryPile, ownedCounts, type FiledPiles, type PileRule, type SortScan } from './sortPiles'

// ---- What a recipe is ----

export type SmartKind = 'DECKS' | 'FRIENDS' | 'BINDER' | 'TRADE'
export const SMART_KINDS: SmartKind[] = ['DECKS', 'FRIENDS', 'BINDER', 'TRADE']
/** The switches under "First, pull out". */
export const SMART_LABELS: Record<SmartKind, string> = {
  DECKS: 'Cards my decks need',
  FRIENDS: 'Cards friends want',
  BINDER: 'New for a binder (fills a gap)',
  TRADE: 'More than a playset · to trade',
}
/** The smart piles' names on the table. */
export const SMART_PILE_NAMES: Record<SmartKind, string> = { DECKS: 'Decks need', FRIENDS: 'Friends want', BINDER: 'Binder gaps', TRADE: 'To trade' }

export type ApartKind = 'FOIL' | 'FOREIGN' | 'PLAYED'
export const APART_KINDS: ApartKind[] = ['FOIL', 'FOREIGN', 'PLAYED']
export const APART_LABELS: Record<ApartKind, string> = { FOIL: 'Foils', FOREIGN: 'Not English', PLAYED: 'Played' }

export type LevelBy = 'VALUE' | 'COLOUR' | 'IDENTITY' | 'SET' | 'MANA_VALUE' | 'RARITY' | 'TYPE' | 'NAME' | 'NUMBER'
export const LEVEL_BYS: LevelBy[] = ['VALUE', 'COLOUR', 'IDENTITY', 'SET', 'MANA_VALUE', 'RARITY', 'TYPE', 'NAME', 'NUMBER']
export const LEVEL_LABELS: Record<LevelBy, string> = {
  VALUE: 'Value', COLOUR: 'Colour', IDENTITY: 'Colour identity', SET: 'Set', MANA_VALUE: 'Mana value',
  RARITY: 'Rarity', TYPE: 'Card type', NAME: 'A–Z', NUMBER: 'Collector number',
}

/**
 * One way of splitting. [cuts]: VALUE — the band edges in the user's currency, highest first ("$20+",
 * "$5–20"…); MANA_VALUE and NUMBER — where each bucket starts, lowest first. [letters]: NAME — where each
 * A–Z range starts. [sets]: SET — the sets with a pile each (lowercase codes), the rest "Other sets".
 * [lands]: COLOUR — lands get a pile of their own (else they go with colourless). [restOn]: VALUE — only
 * the top bands are piles of their own; the cheapest band goes on to the next level ("$2 and up apart,
 * rest continue").
 */
export interface SplitLevel {
  by: LevelBy
  cuts?: number[]
  letters?: string[]
  sets?: string[]
  lands?: boolean
  restOn?: boolean
}

/** Where one pile is filed: a place's id, BY_RULE ("the box whose rule fits"), or "" — no place (Unsorted). */
export interface PileGoTo { pile: string; to: string }

export interface SortRecipe {
  id: string
  name: string
  pullOut: SmartKind[]
  levels: SplitLevel[]
  apart: ApartKind[]
  goTo?: PileGoTo[]
  createdAt: number
}

export const MAX_LEVELS = 3
export const MAX_RECIPE_PILES = 24
/** Copies a playset has: the copy after it is one to trade. */
export const PLAYSET = 4

const DEFAULT_CUTS: Partial<Record<LevelBy, number[]>> = { VALUE: [2], MANA_VALUE: [0, 2, 3, 4, 5], NUMBER: [1, 100, 200, 300] }
const DEFAULT_LETTERS = ['A', 'F', 'L', 'R']

const uniq = <T>(list: T[]): T[] => list.filter((x, i) => list.indexOf(x) === i)

/** A level as both apps keep it: only the fields its kind uses, tidied (sorted, no repeats). */
export function splitLevel(l: SplitLevel): SplitLevel {
  const by: LevelBy = LEVEL_BYS.includes(l.by) ? l.by : 'COLOUR'
  if (by === 'VALUE') {
    const cuts = uniq((l.cuts ?? []).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n * 100) / 100)).sort((a, b) => b - a)
    return { by, cuts: cuts.length > 0 ? cuts : DEFAULT_CUTS.VALUE!, ...(l.restOn ? { restOn: true } : {}) }
  }
  if (by === 'MANA_VALUE' || by === 'NUMBER') {
    const low = by === 'MANA_VALUE' ? 0 : 1
    const given = (l.cuts ?? []).filter((n) => Number.isFinite(n) && n >= low).map((n) => Math.floor(n))
    const cuts = uniq([low, ...(given.length > 0 ? given : DEFAULT_CUTS[by]!)]).sort((a, b) => a - b)
    return { by, cuts }
  }
  if (by === 'NAME') {
    const given = (l.letters ?? []).map((s) => s.trim().charAt(0).toUpperCase()).filter((c) => c >= 'A' && c <= 'Z')
    return { by, letters: uniq(['A', ...(given.length > 0 ? given : DEFAULT_LETTERS)]).sort() }
  }
  if (by === 'SET') return { by, sets: uniq((l.sets ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)) }
  if (by === 'COLOUR') return { by, ...(l.lands ? { lands: true } : {}) }
  return { by }
}

/** A recipe as both apps write it: known kinds only, in their fixed order, at most MAX_LEVELS levels. */
export function sortRecipe(r: SortRecipe): SortRecipe {
  // One line per pile, the last said winning.
  const goTo: PileGoTo[] = []
  for (const g of r.goTo ?? []) {
    if (!g.pile) continue
    const line = { pile: g.pile, to: g.to ?? '' }
    const at = goTo.findIndex((x) => x.pile === g.pile)
    if (at >= 0) goTo[at] = line
    else goTo.push(line)
  }
  return {
    id: r.id,
    name: r.name.trim() || 'My recipe',
    pullOut: SMART_KINDS.filter((k) => (r.pullOut ?? []).includes(k)),
    levels: (r.levels ?? []).slice(0, MAX_LEVELS).map(splitLevel),
    apart: APART_KINDS.filter((k) => (r.apart ?? []).includes(k)),
    ...(goTo.length > 0 ? { goTo } : {}),
    createdAt: r.createdAt,
  }
}

// ---- Templates ----

/** "Start from": the ready-made recipes. [sets]: the sets the user's binders sorted by set hold, for Binder by set. */
export function recipeTemplates(sets: string[] = []): SortRecipe[] {
  const smart: SmartKind[] = ['DECKS', 'FRIENDS', 'BINDER']
  return [
    { id: 'tpl-colour', name: 'Commander by colour', pullOut: smart, levels: [{ by: 'COLOUR', lands: true }], apart: [], createdAt: 0 },
    { id: 'tpl-set', name: 'Binder by set', pullOut: smart, levels: [splitLevel({ by: 'SET', sets: sets.slice(0, 5) }), splitLevel({ by: 'NUMBER' })], apart: [], createdAt: 0 },
    { id: 'tpl-value', name: 'Rares by value', pullOut: smart, levels: [{ by: 'VALUE', cuts: [20, 5, 1] }], apart: [], createdAt: 0 },
    { id: 'tpl-needs', name: 'What my collection needs', pullOut: ['DECKS', 'FRIENDS', 'BINDER', 'TRADE'], levels: [], apart: [], createdAt: 0 },
  ]
}

/** What "Make your own recipe" starts with. */
export const newRecipe = (id: string, now: number): SortRecipe => ({
  id, name: 'My recipe', pullOut: ['DECKS', 'FRIENDS', 'BINDER'], levels: [{ by: 'VALUE', cuts: [2], restOn: true }, { by: 'COLOUR' }], apart: ['FOIL'], createdAt: now,
})

export const isTemplate = (r: SortRecipe): boolean => r.id.startsWith('tpl-')

// ---- The piles ----

/** One bucket of a level: its key in a pile's key, its words, and a colour for its band (null: none of its own). */
export interface RecipeBucket { key: string; label: string; band: string | null }

/** Writes an amount in the user's currency: "$2", "€5". */
export type Fmt = (amount: number) => string

const COLOUR_BUCKETS: [string, string, string][] = [
  ['W', 'White', '#f3efe0'], ['U', 'Blue', '#4d8fe0'], ['B', 'Black', '#6f6a78'], ['R', 'Red', '#e0674d'],
  ['G', 'Green', '#5fbf7a'], ['M', 'Multicolour', '#d8b56a'], ['C', 'Colourless', '#a7a8b3'], ['L', 'Lands', '#b08b5a'],
]
const RARITY_BUCKETS: [string, string, string][] = [
  ['mythic', 'Mythic', '#e2694a'], ['rare', 'Rare', '#e6b45e'], ['uncommon', 'Uncommon', '#c0c6d0'], ['common', 'Common', '#6f6a78'],
]
const VALUE_BAND = '#b98cf0'
/** The smart piles' band: gold, as the app's accent. */
export const SMART_BAND = '#e6b45e'
export const APART_BANDS: Record<ApartKind, string> = { FOIL: '#9fd6ff', FOREIGN: '#f07fa8', PLAYED: '#c9a27a' }
/** Bands for piles with no colour of their own, by pile number. */
export const RECIPE_PILE_COLOURS = ['#e6b45e', '#e2694a', '#5bcb8f', '#6aa8f0', '#c58af0', '#f07fa8']

const letterBefore = (c: string) => String.fromCharCode(c.charCodeAt(0) - 1)

/** A level's buckets, in order. */
export function levelBuckets(level: SplitLevel, fmt: Fmt): RecipeBucket[] {
  const l = splitLevel(level)
  switch (l.by) {
    case 'VALUE': {
      const cuts = l.cuts!
      const top = (i: number) => (i === 0 ? (l.restOn ? `${fmt(cuts[0])} and up` : `${fmt(cuts[0])}+`) : `${fmt(cuts[i])}–${fmt(cuts[i - 1])}`)
      return [...cuts.map((_, i) => ({ key: `v${i}`, label: top(i), band: VALUE_BAND })), { key: `v${cuts.length}`, label: `under ${fmt(cuts[cuts.length - 1])}`, band: VALUE_BAND }]
    }
    case 'COLOUR':
      return COLOUR_BUCKETS.filter(([k]) => k !== 'L' || l.lands).map(([key, label, band]) => ({ key, label: key === 'C' && !l.lands ? 'Colourless and lands' : label, band }))
    case 'IDENTITY':
      return COLOUR_BUCKETS.filter(([k]) => k !== 'L').map(([key, label, band]) => ({ key, label, band }))
    case 'SET':
      return [...l.sets!.map((s) => ({ key: s, label: s.toUpperCase(), band: null })), { key: 'other', label: 'Other sets', band: null }]
    case 'MANA_VALUE':
    case 'NUMBER': {
      const cuts = l.cuts!
      const p = l.by === 'MANA_VALUE' ? 'MV ' : '#'
      const k = l.by === 'MANA_VALUE' ? 'm' : 'c'
      return cuts.map((c, i) => {
        const next = cuts[i + 1]
        const label = next === undefined ? `${p}${c}+` : next - 1 === c ? `${p}${c}` : `${p}${c}–${next - 1}`
        return { key: `${k}${i}`, label, band: null }
      })
    }
    case 'RARITY':
      return RARITY_BUCKETS.map(([key, label, band]) => ({ key, label, band }))
    case 'TYPE':
      return TYPE_SECTIONS.map((s) => ({ key: s.toLowerCase(), label: s, band: null }))
    case 'NAME': {
      const letters = l.letters!
      return letters.map((c, i) => {
        const end = i + 1 < letters.length ? letterBefore(letters[i + 1]) : 'Z'
        return { key: `n${i}`, label: end === c ? c : `${c}–${end}`, band: null }
      })
    }
  }
}

export type PileKind = 'SMART' | 'APART' | 'LEVEL'

/** A pile on the table: its number (from 1, left to right), its key, its name and its band's colour. */
export interface RecipePile { number: number; key: string; name: string; kind: PileKind; band: string }

/** The piles a recipe makes; [wanted]: how many it would make uncapped ([capped]: more than MAX_RECIPE_PILES). */
export interface DerivedPiles { piles: RecipePile[]; wanted: number; capped: boolean }

/** The pile the levels lead to when a recipe has none. */
export const ALL_KEY = 'L:all'
/** The pile the levels' piles past the cap share. */
export const REST_KEY = 'L:rest'

interface Combo { keys: string[]; labels: string[]; band: string | null }

function combos(levels: SplitLevel[], fmt: Fmt): Combo[] {
  if (levels.length === 0) return [{ keys: [], labels: [], band: null }]
  const [first, ...rest] = levels
  const buckets = levelBuckets(first, fmt)
  const after = combos(rest, fmt)
  const out: Combo[] = []
  buckets.forEach((b, i) => {
    if (first.by === 'VALUE' && first.restOn && i < buckets.length - 1) {
      out.push({ keys: [b.key], labels: [b.label], band: b.band })
      return
    }
    // The cheap band going on to the next level is just that level's piles ("White", not "under $2 · White").
    const quiet = first.by === 'VALUE' && first.restOn && rest.length > 0
    for (const c of after) out.push({ keys: [b.key, ...c.keys], labels: quiet ? c.labels : [b.label, ...c.labels], band: quiet ? c.band ?? b.band : b.band ?? c.band })
  })
  return out
}

/** The piles [recipe] makes, in table order. [fmt] writes an amount in the user's currency. */
export function derivePiles(recipe: SortRecipe, fmt: Fmt): DerivedPiles {
  const r = sortRecipe(recipe)
  const out: Omit<RecipePile, 'number'>[] = []
  for (const k of r.pullOut) out.push({ key: `S:${k}`, name: SMART_PILE_NAMES[k], kind: 'SMART', band: SMART_BAND })
  for (const a of r.apart) out.push({ key: `A:${a}`, name: APART_LABELS[a], kind: 'APART', band: APART_BANDS[a] })
  const levelPiles: Omit<RecipePile, 'number'>[] = r.levels.length === 0
    ? [{ key: ALL_KEY, name: 'Bulk', kind: 'LEVEL', band: '' }]
    : combos(r.levels, fmt).map((c) => ({ key: `L:${c.keys.join('/')}`, name: c.labels.join(' · '), kind: 'LEVEL' as const, band: c.band ?? '' }))
  const wanted = out.length + levelPiles.length
  const capped = wanted > MAX_RECIPE_PILES
  const kept = capped ? [...levelPiles.slice(0, Math.max(0, MAX_RECIPE_PILES - out.length - 1)), { key: REST_KEY, name: 'Everything else', kind: 'LEVEL' as const, band: '' }] : levelPiles
  const piles = [...out, ...kept].map((p, i) => ({ ...p, number: i + 1, band: p.band || RECIPE_PILE_COLOURS[i % RECIPE_PILE_COLOURS.length] }))
  return { piles, wanted, capped }
}

/** The warning when a recipe makes more piles than fit: null when they fit. */
export function capWarning(d: DerivedPiles): string | null {
  return d.capped ? `That makes ${d.wanted} piles — only ${MAX_RECIPE_PILES} fit, so the last ones share pile ${MAX_RECIPE_PILES}, “Everything else”.` : null
}

/** A level in a few words, under its name in the recipe: "$2 and up apart, rest continue", "W · U · B · R · G · Multi · Colourless/lands". */
export function levelLine(level: SplitLevel, fmt: Fmt): string {
  const l = splitLevel(level)
  if (l.by === 'COLOUR') return l.lands ? 'W · U · B · R · G · Multi · Colourless · Lands' : 'W · U · B · R · G · Multi · Colourless/lands'
  if (l.by === 'IDENTITY') return 'W · U · B · R · G · Multi · Colourless'
  const buckets = levelBuckets(l, fmt)
  if (l.by === 'VALUE' && l.restOn) return `${buckets.slice(0, -1).map((b) => b.label).join(' · ')} apart, rest continue`
  if (l.by === 'SET' && l.sets!.length === 0) return 'One pile per set you name'
  return buckets.map((b) => b.label).join(' · ')
}

/** A recipe in a line, under its name: "Value $2+ apart · then colour · 12 piles". */
export function recipeLine(recipe: SortRecipe, fmt: Fmt): string {
  const r = sortRecipe(recipe)
  const parts = r.levels.map((l, i) => {
    const words = l.by === 'VALUE' && l.restOn ? `Value ${fmt(l.cuts![0])}+ apart` : LEVEL_LABELS[l.by]
    return i === 0 ? words : `then ${lowerWord(words)}`
  })
  if (parts.length === 0) parts.push(r.pullOut.length > 0 ? r.pullOut.map((k) => SMART_PILE_NAMES[k]).join(' · ') : 'One pile')
  const n = derivePiles(r, fmt).piles.length
  return [...parts, `${n} ${n === 1 ? 'pile' : 'piles'}`].join(' · ')
}

/** A word's first letter lowercased, unless it's an abbreviation ("MV", "DSK", "A–Z"): "Blue" → "blue". */
export function lowerWord(s: string): string {
  return /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

// ---- Which pile a card goes in ----

/** What a recipe needs to know of a scanned card. Prices are in US dollars. */
export interface RecipeCard {
  name: string
  colors?: string[] | null
  colorIdentity?: string[] | null
  typeLine?: string | null
  set?: string | null
  collectorNumber?: string | null
  cmc?: number | null
  rarity?: string | null
  usd?: number | null
  usdFoil?: number | null
  foil?: boolean
  /** The language it's printed in, as Scryfall codes it ("en", "ja"…). */
  lang?: string | null
  played?: boolean
}

/** The card's price in US dollars for its finish, or null when not known. */
export const cardPrice = (c: RecipeCard): number | null => (c.foil ? c.usdFoil ?? c.usd ?? null : c.usd ?? c.usdFoil ?? null)

const factsOf = (c: RecipeCard): CardFacts => ({ name: c.name, colors: c.colors ?? [], typeLine: c.typeLine ?? null, set: c.set ?? null, collectorNumber: c.collectorNumber ?? null })
const leadingNumber = (s: string | null | undefined): number => { const m = /^\d+/.exec((s ?? '').trim()); return m ? Number(m[0]) : 0 }
const lastAtOrBelow = (starts: (number | string)[], v: number | string): number => { let at = 0; starts.forEach((s, i) => { if (s <= v) at = i }); return at }

/** The bucket [card] falls in, for [level]. [rate]: the user's currency per US dollar. */
export function bucketOf(level: SplitLevel, card: RecipeCard, rate: number): string {
  const l = splitLevel(level)
  switch (l.by) {
    case 'VALUE': {
      const usd = cardPrice(card)
      const cuts = l.cuts!
      if (usd === null) return `v${cuts.length}`
      const local = usd * rate
      const i = cuts.findIndex((c) => local >= c)
      return `v${i < 0 ? cuts.length : i}`
    }
    case 'COLOUR': {
      const s = colourSection(factsOf(card))
      const k = COLOUR_BUCKETS.find(([, label]) => label === s)?.[0] ?? 'C'
      return k === 'L' && !l.lands ? 'C' : k
    }
    case 'IDENTITY': {
      const id = (card.colorIdentity ?? []).filter((c) => 'WUBRG'.includes(c) && c.length === 1)
      return id.length > 1 ? 'M' : id.length === 1 ? id[0] : 'C'
    }
    case 'SET': {
      const s = (card.set ?? '').toLowerCase()
      return l.sets!.includes(s) ? s : 'other'
    }
    case 'MANA_VALUE': return `m${lastAtOrBelow(l.cuts!, Math.floor(card.cmc ?? 0))}`
    case 'NUMBER': return `c${lastAtOrBelow(l.cuts!, leadingNumber(card.collectorNumber))}`
    case 'RARITY': return ['mythic', 'rare', 'uncommon'].includes(card.rarity ?? '') ? card.rarity! : 'common'
    case 'TYPE': return typeSection(factsOf(card)).toLowerCase()
    case 'NAME': {
      const letter = letterOf(card.name)
      return `n${letter === '#' ? 0 : lastAtOrBelow(l.letters!, letter)}`
    }
  }
}

/** Why a card goes in a smart pile. */
export type SortReason =
  | { kind: 'DECKS'; deckId: string; deck: string }
  | { kind: 'FRIENDS'; friend: string; friendId: string }
  | { kind: 'BINDER'; placeId: string; binder: string; page: number; slot: number }
  | { kind: 'TRADE'; copy: number }

/** The pile a card goes in, why (a smart pile's reason), and the other smart reasons that applied. */
export interface RecipeChoice { pile: number; key: string; reason: SortReason | null; also: SortReason[] }

/** The key of the levels' pile [card] goes in (before the cap). */
export function levelKey(recipe: SortRecipe, card: RecipeCard, rate: number): string {
  const r = sortRecipe(recipe)
  if (r.levels.length === 0) return ALL_KEY
  const keys: string[] = []
  for (const l of r.levels) {
    const k = bucketOf(l, card, rate)
    keys.push(k)
    if (l.by === 'VALUE' && l.restOn && k !== `v${l.cuts!.length}`) break
  }
  return `L:${keys.join('/')}`
}

/** The keep-apart kinds [card] is: foil, not English, played. */
export const apartOf = (card: RecipeCard): ApartKind[] => [
  ...(card.foil ? ['FOIL' as const] : []),
  ...(card.lang && card.lang.toLowerCase() !== 'en' ? ['FOREIGN' as const] : []),
  ...(card.played ? ['PLAYED' as const] : []),
]

/**
 * The pile [card] goes in: the first smart pile the recipe pulls out that one of [reasons] (as
 * reasonsFor finds them, in priority order) is for; else the first keep-apart pile it is; else its
 * levels' pile ("Everything else" past the cap). [rate]: the user's currency per US dollar.
 */
export function pileFor(recipe: SortRecipe, derived: DerivedPiles, card: RecipeCard, reasons: SortReason[], rate: number): RecipeChoice {
  const r = sortRecipe(recipe)
  const byKey = (key: string) => derived.piles.find((p) => p.key === key)
  const reason = reasons.find((x) => r.pullOut.includes(x.kind)) ?? null
  if (reason) {
    const p = byKey(`S:${reason.kind}`)!
    return { pile: p.number, key: p.key, reason, also: reasons.filter((x) => x !== reason) }
  }
  const apart = apartOf(card).find((a) => r.apart.includes(a))
  if (apart) {
    const p = byKey(`A:${apart}`)!
    return { pile: p.number, key: p.key, reason: null, also: reasons }
  }
  const p = byKey(levelKey(r, card, rate)) ?? byKey(REST_KEY) ?? derived.piles[derived.piles.length - 1]
  return { pile: p.number, key: p.key, reason: null, also: reasons }
}

// ---- What the collection wants ----

/** A deck that needs a card, and how many copies. */
export interface DeckNeed { deckId: string; deck: string; qty: number }

/** A friend who wants a card: their user id and the name they go by. */
export interface FriendWant { id: string; name: string }

/**
 * A binder kept in order: its pockets in use with their cards' facts, the names in it (lowercase, its
 * loose copies too) and the sets it collects — a card of one of those sets not in it yet fills a gap.
 */
export interface OrderedBinder {
  placeId: string
  name: string
  rule: SortRule | null
  pockets: number
  occupied: { index: number; facts: CardFacts }[]
  names: string[]
  sets: string[]
}

/** What the smart piles go by: deck needs and friends' wants by card name (recipeNameKey), the binders in order, copies owned by name. */
export interface SmartContext {
  deckNeeds: Record<string, DeckNeed[]>
  friendWants: Record<string, FriendWant[]>
  binders: OrderedBinder[]
  owned: Record<string, number>
}

/** A card's name as the lookups key it: lowercase, its front face. */
export const recipeNameKey = (name: string): string => name.trim().toLowerCase().split(' // ')[0].trim()

/** Each card the decks need, by name: missing from a deck (copies short), or on its Considering list (one). */
export function deckNeedsOf(collections: Collection[], decks: Deck[]): Record<string, DeckNeed[]> {
  const out: Record<string, DeckNeed[]> = {}
  const want = (name: string, d: Deck, qty: number) => {
    const list = out[recipeNameKey(name)] ?? (out[recipeNameKey(name)] = [])
    const had = list.find((n) => n.deckId === d.id)
    if (had) had.qty += qty
    else list.push({ deckId: d.id, deck: d.name, qty })
  }
  for (const d of decks) {
    if (d.archived || d.sample) continue
    for (const e of missingCards(d, collections, decks)) want(e.name, d, e.quantity)
    for (const e of d.considering ?? []) want(e.name, d, 1)
  }
  return out
}

/**
 * The friends wanting each card, by name, from the trade matches (what their wishlists want of yours).
 * [nameOf]: a friend's name by their user id — null for someone who isn't a friend now, left out.
 */
export function friendWantsOf(matches: { friend: string; they_want: { name: string }[] }[], nameOf: (id: string) => string | null): Record<string, FriendWant[]> {
  const out: Record<string, FriendWant[]> = {}
  for (const m of matches) {
    const name = nameOf(m.friend)
    if (!name) continue
    for (const w of m.they_want) {
      const list = out[recipeNameKey(w.name)] ?? (out[recipeNameKey(w.name)] = [])
      if (!list.some((f) => f.id === m.friend)) list.push({ id: m.friend, name })
    }
  }
  return out
}

/**
 * The binders kept in order (with a sorting rule), each with its pockets in use, the names in it and
 * the sets it collects. [factsOf]: a printing's facts when its card data is here (null: not yet).
 */
export function orderedBinders(collections: Collection[], factsOf: (scryfallId: string) => CardFacts | null): OrderedBinder[] {
  const out: OrderedBinder[] = []
  for (const place of placesOf(collections)) {
    if (place.kind !== 'BINDER' || !place.sortRule) continue
    const cards = cardsIn(collections, place.id)
    const facts = (id: string, name: string) => factsOf(id) ?? { name }
    const sets = uniq(cards.map((c) => (factsOf(c.entry.scryfallId)?.set ?? '').toLowerCase()).filter(Boolean)).sort()
    out.push({
      placeId: place.id,
      name: place.name,
      rule: place.sortRule,
      pockets: pocketsOf(place),
      occupied: binderPockets(place, cards).map((p) => ({ index: p.index, facts: facts(p.cards[0].entry.scryfallId, p.cards[0].entry.name) })),
      names: uniq(cards.map((c) => recipeNameKey(c.entry.name))),
      sets,
    })
  }
  return out
}

/** Copies owned of each card, by name (sortPiles.ts's ownedCounts). */
export function ownedOf(collections: Collection[], decks: Deck[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, n] of ownedCounts(collections, decks)) out[k] = n
  return out
}

/** One card sorted this session. [entry]: the card as a new binder entry with no copies yet. */
export interface RecipeScan {
  id: number
  scryfallId: string
  name: string
  /** The set's name ("Dominaria Remastered"), for the card's line. */
  setName?: string | null
  card: RecipeCard
  facts: CardFacts
  entry: CollectionEntry
  pile: number
  key: string
  reason?: SortReason | null
  also?: SortReason[]
  /** Put away already ("Put in deck now"): filing leaves it. */
  filed?: boolean
  /** When it was scanned (milliseconds). */
  at?: number
}

/**
 * The smart reasons that apply to one more [card], in priority order — a deck needs it, a friend
 * wants it, it's new for a binder, it's past a playset — given what this session has already pulled
 * out ([scans]): a deck's need goes down with each copy pulled for it, a friend wants one copy, a
 * binder's gap is filled once, and every copy scanned counts as owned.
 */
export function reasonsFor(ctx: SmartContext, card: RecipeCard, scans: RecipeScan[]): SortReason[] {
  const k = recipeNameKey(card.name)
  const same = scans.filter((s) => recipeNameKey(s.name) === k)
  const out: SortReason[] = []
  for (const need of ctx.deckNeeds[k] ?? []) {
    const taken = same.filter((s) => s.reason?.kind === 'DECKS' && s.reason.deckId === need.deckId).length
    if (need.qty > taken) out.push({ kind: 'DECKS', deckId: need.deckId, deck: need.deck })
  }
  for (const f of ctx.friendWants[k] ?? []) {
    if (!same.some((s) => s.reason?.kind === 'FRIENDS' && s.reason.friendId === f.id)) out.push({ kind: 'FRIENDS', friend: f.name, friendId: f.id })
  }
  const set = (card.set ?? '').toLowerCase()
  for (const b of ctx.binders) {
    if (!set || !b.sets.includes(set) || b.names.includes(k)) continue
    if (same.some((s) => s.reason?.kind === 'BINDER' && s.reason.placeId === b.placeId)) continue
    const adds = scans.filter((s) => s.reason?.kind === 'BINDER' && s.reason.placeId === b.placeId).map((s) => s.facts)
    const plan = planFit(b.rule, b.occupied, [...adds, factsOf(card)], 'KEEP')
    const put = plan.puts.find((p) => p.item === adds.length)
    if (!put) continue
    const { page, slot } = pocketAt(put.to, b.pockets)
    out.push({ kind: 'BINDER', placeId: b.placeId, binder: b.name, page, slot })
    break
  }
  if (!isBasicLand(card.name)) {
    const copy = (ctx.owned[k] ?? 0) + same.length + 1
    if (copy > PLAYSET) out.push({ kind: 'TRADE', copy })
  }
  return out
}

/** The pile for one more card of a session, and why: reasonsFor, then pileFor. */
export function sortCard(recipe: SortRecipe, derived: DerivedPiles, ctx: SmartContext, card: RecipeCard, scans: RecipeScan[], rate: number): RecipeChoice {
  return pileFor(recipe, derived, card, reasonsFor(ctx, card, scans), rate)
}

/**
 * "Send to pile N instead": the next smart pile that wants the card (another of the reasons it had, of
 * a different kind) — or, when none, the pile it would go in without a smart pile. Null when that's
 * the pile it's in already.
 */
export function otherPile(recipe: SortRecipe, derived: DerivedPiles, scan: Pick<RecipeScan, 'card' | 'pile' | 'reason' | 'also'>, rate: number): RecipeChoice | null {
  const r = sortRecipe(recipe)
  const reasons = [...(scan.reason ? [scan.reason] : []), ...(scan.also ?? [])]
  const next = reasons.find((x) => x.kind !== scan.reason?.kind && r.pullOut.includes(x.kind) && (!scan.reason || SMART_KINDS.indexOf(x.kind) > SMART_KINDS.indexOf(scan.reason.kind)))
  const choice = next
    ? { ...pileFor(r, derived, scan.card, [next], rate), also: reasons.filter((x) => x !== next) }
    : { ...pileFor({ ...r, pullOut: [] }, derived, scan.card, [], rate), also: reasons }
  return choice.pile === scan.pile ? null : choice
}

// ---- In words ----

/** A name's first word without the punctuation after it: "Krenko, Mob Boss" → "Krenko". */
export function firstWord(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').replace(/[,.:;!?]+$/, '')
}

/** "Duskmourn binder" — a binder's name as the reason says it. */
export const binderName = (name: string): string => (/binder$/i.test(name.trim()) ? name.trim() : `${name.trim()} binder`)

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

/** The big line on a smart pile's card: "KRENKO NEEDS IT", "PRIYA WANTS IT", "NEW FOR DUSKMOURN BINDER · p12 s3", "5th COPY · TRADE". */
export function reasonLine(r: SortReason): string {
  switch (r.kind) {
    case 'DECKS': return `${firstWord(r.deck).toUpperCase()} NEEDS IT`
    case 'FRIENDS': return `${firstWord(r.friend).toUpperCase()} WANTS IT`
    case 'BINDER': return `NEW FOR ${binderName(r.binder).toUpperCase()} · p${r.page} s${r.slot}`
    case 'TRADE': return `${ordinal(r.copy)} COPY · TRADE`
  }
}

/** A line under "Also wanted:": "Priya wants one", "Krenko goblins needs it", "New for Duskmourn binder · p12 s3", "5th copy · trade". */
export function alsoLine(r: SortReason): string {
  switch (r.kind) {
    case 'DECKS': return `${r.deck} needs it`
    case 'FRIENDS': return `${r.friend} wants one`
    case 'BINDER': return `New for ${binderName(r.binder)} · p${r.page} s${r.slot}`
    case 'TRADE': return `${ordinal(r.copy)} copy · trade`
  }
}

/** "You own 3 already" — copies owned before this one, the session's included; null for none. */
export function ownedLine(ctx: SmartContext, name: string, scans: RecipeScan[]): string | null {
  const n = (ctx.owned[recipeNameKey(name)] ?? 0) + scans.filter((s) => recipeNameKey(s.name) === recipeNameKey(name)).length
  return n > 0 ? `You own ${n} already` : null
}

const RARITY_WORDS: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic', special: 'Special', bonus: 'Bonus' }

/** The card's line under its name: "Uncommon · $1.20 · Dominaria Remastered", or "… · missing from Krenko goblins" for a deck. */
export function cardLine(scan: Pick<RecipeScan, 'card' | 'setName' | 'reason'>, price: (usd: number) => string): string {
  const usd = cardPrice(scan.card)
  const where = scan.reason?.kind === 'DECKS' ? `missing from ${scan.reason.deck}` : scan.setName || (scan.card.set ?? '').toUpperCase()
  return [RARITY_WORDS[scan.card.rarity ?? ''] ?? '', usd !== null ? price(usd) : 'No price', where].filter(Boolean).join(' · ')
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four']

/** What the phone says for a card: "Seven, blue", "One, Krenko needs it". */
export function spokenPile(pile: RecipePile, reason: SortReason | null): string {
  const n = NUMBER_WORDS[pile.number] ?? String(pile.number)
  const what = reason
    ? reason.kind === 'DECKS' ? `${firstWord(reason.deck)} needs it`
      : reason.kind === 'FRIENDS' ? `${firstWord(reason.friend)} wants it`
        : reason.kind === 'BINDER' ? `new for ${binderName(reason.binder)}`
          : 'trade'
    : pile.name.split(' · ').map(lowerWord).join(', ')
  return `${n.charAt(0).toUpperCase()}${n.slice(1)}, ${what}`
}

// ---- Capture without tapping ----

/**
 * When to take a card without a tap: once the camera has read the same title [steadyFrames] frames in
 * a row — and never the same physical card twice. After a card is taken it's "held": reads of it are
 * ignored until it has left the frame ([gapFrames] frames in a row with no title) or another card has
 * read steadily in its place. A read whose lookup came to nothing (missed: half a name, or no such
 * card) counts as nothing in view from then on — so it isn't tried over and over, and more of the card
 * coming into the frame reads differently and is taken. Rescan lets the card in view be taken again
 * ("Wrong card?").
 * The same as the Android app's HandsFreeCapture, frame for frame.
 */
export class HandsFreeCapture {
  private readonly steadyFrames: number
  private readonly gapFrames: number
  private lastRead: string | null = null
  private steady = 0
  private blank = 0
  private held: string | null = null
  private rejected: string | null = null

  constructor(steadyFrames = 3, gapFrames = 4) {
    this.steadyFrames = steadyFrames
    this.gapFrames = gapFrames
  }

  /** One frame: the title read, or null. True when this is the moment to take the card. */
  onRead(read: string | null): boolean {
    const letters = read === null ? '' : titleLetters(read)
    const title = this.rejected !== null && letters === this.rejected ? '' : letters
    if (title === '') {
      this.blank++
      this.steady = 0
      this.lastRead = null
      if (this.blank >= this.gapFrames) this.held = null
      return false
    }
    this.blank = 0
    this.steady = this.lastRead === title ? this.steady + 1 : 1
    this.lastRead = title
    if (this.held !== null && sameTitle(title, this.held)) return false
    if (this.steady < this.steadyFrames) return false
    this.held = title
    this.steady = 0
    return true
  }

  /** The card taken was found: [name] is what's held until it leaves. */
  captured(name: string) {
    this.held = titleLetters(name)
    this.rejected = null
  }

  /** The card taken came to nothing: its read is nothing in view from now on. */
  missed() {
    this.rejected = this.held
    this.held = null
  }

  /** Whether a card is held (taken, and not yet gone from the frame). */
  get holding(): boolean { return this.held !== null }

  /** Forget the card in view: it can be taken again. */
  rescan() {
    this.held = null
    this.steady = 0
  }
}

const titleLetters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Whether two titles are the same card for holding: one inside the other, or the first four letters alike. */
function sameTitle(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true
  let common = 0
  while (common < a.length && common < b.length && a[common] === b[common]) common++
  return common >= 4
}

// ---- When it's done ----

/** A line of the summary: piles [from]–[to] (one pile when equal), their cards, value (US dollars) and who or what they're for. */
export interface SummaryRow { from: number; to: number; name: string; cards: number; usd: number; detail: string | null }

export interface RecipeSummary { rows: SummaryRow[]; cards: number; usd: number }

function counted(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([n, c]) => `${n} ${c}`).join(', ')
}

/**
 * "Sorted 212 cards": each smart and keep-apart pile with cards, with who it's for ("Krenko 4,
 * Atraxa 2", "Priya 3, Jo 2", the binders); the levels' piles one by one — or, when there are more
 * than six, as one line ("6–11 · Bulk by colour").
 */
export function summarize(recipe: SortRecipe, derived: DerivedPiles, scans: RecipeScan[]): RecipeSummary {
  const r = sortRecipe(recipe)
  const rows: SummaryRow[] = []
  const valueOf = (list: RecipeScan[]) => Math.round(list.reduce((n, s) => n + (cardPrice(s.card) ?? 0), 0) * 100) / 100
  // A value level's own bands ("$2 and up") stay lines of their own; the piles after it — or all the
  // levels' piles — are one line when there are more than six.
  const restOn = r.levels[0]?.by === 'VALUE' && !!r.levels[0].restOn && r.levels.length > 1
  const levels = derived.piles.filter((p) => p.kind === 'LEVEL' && !(restOn && p.key !== REST_KEY && !p.key.includes('/')))
  const grouped = levels.length > 6
  for (const p of derived.piles) {
    if (grouped && levels.includes(p)) continue
    const here = scans.filter((s) => s.pile === p.number)
    if (here.length === 0) continue
    const detail = p.key === 'S:DECKS'
      ? counted(here.map((s) => (s.reason?.kind === 'DECKS' ? firstWord(s.reason.deck) : '')).filter(Boolean))
      : p.key === 'S:FRIENDS'
        ? counted(here.map((s) => (s.reason?.kind === 'FRIENDS' ? firstWord(s.reason.friend) : '')).filter(Boolean))
        : p.key === 'S:BINDER'
          ? uniq(here.map((s) => (s.reason?.kind === 'BINDER' ? s.reason.binder : '')).filter(Boolean)).join(', ')
          : null
    rows.push({ from: p.number, to: p.number, name: p.name, cards: here.length, usd: valueOf(here), detail: detail || null })
  }
  if (grouped) {
    const here = scans.filter((s) => levels.some((p) => p.number === s.pile))
    const level = r.levels[restOn ? 1 : 0]
    if (here.length > 0) rows.push({ from: levels[0].number, to: levels[levels.length - 1].number, name: `Bulk by ${lowerWord(LEVEL_LABELS[level.by])}`, cards: here.length, usd: valueOf(here), detail: null })
  }
  return { rows, cards: scans.length, usd: valueOf(scans) }
}

/** What checking one card of a pile found: it belongs, or the pile it should be in (null: not sorted this time). */
export interface PileCheck { belongs: boolean; line: string; goes: number | null }

/**
 * "Check a pile": one card scanned from pile [pile] — it belongs while the pile holds more copies of it
 * than have been checked already ([checked]: the names checked so far that belonged).
 */
export function checkPileCard(derived: DerivedPiles, scans: RecipeScan[], pile: number, checked: string[], name: string): PileCheck {
  const k = recipeNameKey(name)
  const inPile = scans.filter((s) => s.pile === pile && recipeNameKey(s.name) === k).length
  const done = checked.filter((n) => recipeNameKey(n) === k).length
  if (inPile > done) return { belongs: true, line: `Belongs in pile ${pile}`, goes: pile }
  const other = scans.find((s) => s.pile !== pile && recipeNameKey(s.name) === k)
  if (!other) return { belongs: false, line: "Doesn't belong — not sorted this time", goes: null }
  const p = derived.piles.find((x) => x.number === other.pile)
  return { belongs: false, line: `Doesn't belong — pile ${other.pile}${p ? ` · ${p.name}` : ''}`, goes: other.pile }
}

/** Where a pile is filed: what the recipe says for it, else the box whose rule fits — or no place for decks, friends and trades. */
export function pileGoesTo(recipe: SortRecipe, pile: RecipePile): string {
  const set = (recipe.goTo ?? []).find((g) => g.pile === pile.key)
  if (set) return set.to
  return pile.key === 'S:DECKS' || pile.key === 'S:FRIENDS' || pile.key === 'S:TRADE' ? '' : BY_RULE
}

/** [recipe] with pile [key] filed at [to] (a place's id, BY_RULE or "": no place). */
export const withGoTo = (recipe: SortRecipe, key: string, to: string): SortRecipe =>
  sortRecipe({ ...recipe, goTo: [...(recipe.goTo ?? []).filter((g) => g.pile !== key), { pile: key, to }] })

/**
 * "File everything": every card not filed yet goes into the collection at its pile's place, as the
 * old sorter files (fileEveryPile): a binder gap into its binder (waiting beside it to be fitted in
 * order), the deck-need cards with no place, for their decks' pull lists to find, the rest where the
 * recipe files their pile.
 */
export function fileRecipe(collections: Collection[], recipe: SortRecipe, derived: DerivedPiles, scans: RecipeScan[]): FiledPiles {
  const rules: PileRule[] = derived.piles.map((p) => ({ kind: 'BULK', ...(pileGoesTo(recipe, p) ? { to: pileGoesTo(recipe, p) } : {}) }))
  const binderRule = new Map<string, number>()
  const out: SortScan[] = []
  for (const s of scans) {
    if (s.filed) continue
    let pile = s.pile - 1
    if (s.reason?.kind === 'BINDER') {
      const id = s.reason.placeId
      if (!binderRule.has(id)) { binderRule.set(id, rules.length); rules.push({ kind: 'BULK', to: id }) }
      pile = binderRule.get(id)!
    }
    out.push({
      id: s.id, scryfallId: s.scryfallId, name: s.name, rarity: s.card.rarity ?? null, usd: cardPrice(s.card), facts: s.facts, entry: s.entry, pile, why: '',
    })
  }
  return fileEveryPile(collections, { source: '', rules, newCards: true, scans: out })
}

// ---- Kept and synced ----

/** The user's own recipes, kept on the Unsorted pile. */
export const recipesOf = (collections: Collection[]): SortRecipe[] => collections.find(isUnsorted)?.sortRecipes ?? []

/** [collections] with the recipes set to [recipes] (on the Unsorted pile, made if it isn't there). */
export function withRecipes(collections: Collection[], recipes: SortRecipe[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, sortRecipes: recipes.map(sortRecipe) } : c))
}

/** [collections] with [recipe] added, or put in place of the one with its id. */
export function saveRecipe(collections: Collection[], recipe: SortRecipe): Collection[] {
  const list = recipesOf(collections)
  return withRecipes(collections, list.some((r) => r.id === recipe.id) ? list.map((r) => (r.id === recipe.id ? recipe : r)) : [...list, recipe])
}

export const deleteRecipe = (collections: Collection[], id: string): Collection[] => withRecipes(collections, recipesOf(collections).filter((r) => r.id !== id))

function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (sameJson(mine, theirs)) return mine
  if (sameJson(mine, base)) return theirs
  if (sameJson(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/**
 * Merges two devices' recipes: one added on either side is kept, one deleted on either side stays
 * deleted, and each field (name, smart piles, levels, keep apart, where piles go) goes to whoever
 * changed it — the more recent edit when both did. Undefined when no side has any.
 */
export function mergeRecipes(base: SortRecipe[] | undefined, mine: SortRecipe[] | undefined, theirs: SortRecipe[] | undefined, minePreferred: boolean): SortRecipe[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((r) => [r.id, r]))
  const m = new Map((mine ?? []).map((r) => [r.id, r]))
  const t = new Map((theirs ?? []).map((r) => [r.id, r]))
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((id) => !b.has(id)).sort()
  const out: SortRecipe[] = []
  for (const id of [...b.keys(), ...added]) {
    const br = b.get(id)
    const mr = m.get(id)
    const tr = t.get(id)
    if (br && (!mr || !tr)) continue
    if (!br) { out.push(sortRecipe((tr ?? mr)!)); continue }
    out.push(sortRecipe({
      id,
      name: pick(br.name, mr!.name, tr!.name, minePreferred),
      pullOut: pick(br.pullOut, mr!.pullOut, tr!.pullOut, minePreferred),
      levels: pick(br.levels, mr!.levels, tr!.levels, minePreferred),
      apart: pick(br.apart, mr!.apart, tr!.apart, minePreferred),
      goTo: pick(br.goTo, mr!.goTo, tr!.goTo, minePreferred),
      createdAt: Math.min(mr!.createdAt, tr!.createdAt),
    }))
  }
  return out
}

/**
 * [theirs] with [source]'s recipes, when [theirs] was saved by an app that doesn't know about recipes
 * (no "sortRecipes" key) — the same object otherwise.
 */
export function keepRecipesFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (theirs.sortRecipes !== undefined || source.sortRecipes === undefined || !isUnsorted(theirs)) return theirs
  return { ...theirs, sortRecipes: source.sortRecipes }
}

// ---- Pile signs ----

export type Paper = 'A4' | 'LETTER'
/** A paper's height in millimetres. */
const PAPER_HEIGHT: Record<Paper, number> = { A4: 297, LETTER: 279.4 }

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The pile signs as a page to print: two to a sheet of [paper], each the pile's number big, its name
 * under it and its colour across the top — to stand by each pile on the table. Both apps print this
 * same page (the web app from a frame, the Android app through its print framework, as box labels).
 */
export function pileSignsHtml(piles: RecipePile[], paper: Paper, title = 'Pile signs'): string {
  const sign = Math.floor(((PAPER_HEIGHT[paper] - 24) / 2 - 2) * 10) / 10
  const signs = piles.map((p) => `<div class="sign" style="border-top-color:${escapeHtml(p.band)}"><div class="num">${p.number}</div><div class="name">${escapeHtml(p.name)}</div></div>`).join('')
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><style>' +
    `@page{size:${paper === 'A4' ? 'A4' : 'letter'} portrait;margin:12mm}` +
    'body{margin:0;font-family:Manrope,Arial,sans-serif;color:#14161c;background:#fff}' +
    `.sign{height:${sign}mm;box-sizing:border-box;margin-bottom:4mm;border:0.4mm dashed #999;border-top:10mm solid #e6b45e;display:flex;flex-direction:column;align-items:center;justify-content:center;break-inside:avoid;page-break-inside:avoid}` +
    '.sign:nth-child(2n){break-after:page;page-break-after:always}' +
    '.num{font-size:170pt;font-weight:800;line-height:1}' +
    '.name{font-size:30pt;font-weight:700;text-align:center;padding:0 10mm}' +
    '</style></head><body>' + signs + '</body></html>'
}

// A storage place's rules: what it holds, how its sections go and the order inside a section — "a box
// holds the blue cards, in sections by card type, A–Z inside each". And, when a card fits more than one
// place, the order the user chose ("Rule order"): the first place that fits gets it.
//
//  - Holds: a Cards filter (the filter panel's and Advanced filters', tags and Untagged too), kept on
//    the place as a saved filter's JSON (StoragePlace.holds). None: the place holds everything.
//  - Sections by: one level of the sorting recipes (sortRecipes.ts's SplitLevel: colour, card type,
//    set, value bands…); the place's sections are that level's piles, their names still the user's to
//    change.
//  - Then sorted by: up to two of SORT_BYS — A–Z, collector number, mana value, price (dearest first),
//    set. Put away says where in the section a card goes: "between Counterspell and Cryptic Command".
//  - Rule order: the Unsorted pile's "placeOrder" (Collection.placeOrder), the places' ids. Places not
//    in it follow, those that hold something particular before those that hold everything.
//
// Older apps know only a place's "sortRule" (COLOUR, SET, TYPE, NAME). A place with only that reads as
// the rules it meant (placeRules: COLOUR → sections by colour, A–Z; SET → by set, by number; TYPE → by
// card type, A–Z; NAME → no sections, A–Z), and saving rules writes the nearest "sortRule" too
// (sortRuleFor) — so an older app still sees roughly what the place does. An older app drops the rule
// fields when it saves; keepPlaceRules puts them back.
//
// Pure, so it can be tested. Mirrors the Android app's data/StorageRules.kt rule for rule; both run the
// same test vectors (tests/collection/storageRulesVectors.json ↔ app/src/test/resources/storageRulesVectors.json).

import { isUnsorted, type Collection, type CollectionEntry, type PlaceHolds, type SortRule, type StoragePlace } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import {
  ADVANCED_COLORS, NO_ADVANCED_FILTER, advancedActive, advancedFactsOf, advancedFrom, advancedJson, advancedMatches, basicFrom, basicJson, filterChips,
  type AdvancedFacts, type AdvancedFilter, type CopyFacts,
} from './advancedFilter'
import {
  COLLECTION_FILTER_RARITIES, NO_COLLECTION_FILTER, UNTAGGED, cardFactsOf as filterFactsOf, filterActive, filterMatches, filterMatchesTags,
  type CardFacts as FilterFacts, type CollectionFilter,
} from './cardFilter'
import { LEVEL_BYS, LEVEL_LABELS, bucketOf, levelBuckets, lowerWord, splitLevel, type RecipeCard, type SplitLevel } from './sortRecipes'
import {
  SORT_RULE_SHORT, cardFactsOf, cardsIn, letterOf, moveCopies, placeTree, placesOf, sameCardName,
  type CardFacts, type PlacedCard, type Spot,
} from './storagePlaces'
import { spaceOf } from './boxSpace'
import { withUnsortedPile } from './unsorted'

// ---- What the rules are ----

/** The ways a section can be sorted. Stored by name. */
export const SORT_BYS = ['NAME', 'NUMBER', 'MANA_VALUE', 'VALUE', 'SET']

/** "Then sorted by": the choices offered, as the stored list joined by commas, and their words. */
export const SORT_BY_CHOICES: { key: string; label: string }[] = [
  { key: 'NAME', label: 'A–Z' },
  { key: 'NUMBER', label: 'Collector number' },
  { key: 'MANA_VALUE,NAME', label: 'Mana value, then A–Z' },
  { key: 'VALUE', label: 'Price, high to low' },
  { key: 'SET,NUMBER', label: 'Set, then number' },
]

/** How a sort shows on a place's line: "A–Z", "by mana value". */
const SORT_BY_SHORT: Record<string, string> = {
  NAME: 'A–Z', NUMBER: 'by number', MANA_VALUE: 'by mana value', VALUE: 'price high to low', SET: 'by set',
}

export interface Holds { basic: CollectionFilter; advanced: AdvancedFilter }

/** A place's rules as they're used: what it holds (null: everything), its sections' level and its order inside a section. */
export interface PlaceRules {
  holds: Holds | null
  sectionsBy: SplitLevel | null
  sortBy: string[]
}

const anyRule = (r: PlaceRules) => r.holds !== null || r.sectionsBy !== null || r.sortBy.length > 0

/** A sort as both apps keep it: known ways only, each once, at most two. */
export function cleanSortBy(list: string[]): string[] {
  return list.filter((s, i) => SORT_BYS.includes(s) && list.indexOf(s) === i).slice(0, 2)
}

/** A section level as both apps keep it (splitLevel); "PLACE" isn't one. */
export function cleanSectionsBy(level: SplitLevel): SplitLevel | null {
  return LEVEL_BYS.includes(level.by) ? splitLevel(level) : null
}

/** "Holds" read from a kept filter: the filter, or null for everything (none set, unreadable, or nothing on). */
export function holdsFromMap(map: PlaceHolds | null | undefined): Holds | null {
  if (!map || typeof map !== 'object') return null
  const basic = map.basic && typeof map.basic === 'object' ? basicFrom(map.basic) : NO_COLLECTION_FILTER
  const advanced = map.advanced && typeof map.advanced === 'object' ? advancedFrom(map.advanced) : NO_ADVANCED_FILTER
  return filterActive(basic) || advancedActive(advanced) ? { basic, advanced } : null
}

/** "Holds" read from the place. */
export const holdsOf = (place: StoragePlace): Holds | null => holdsFromMap(place.holds)

/**
 * A "Holds" filter as the place keeps it: the saved filter's "basic", and its "advanced" when one is on
 * — the same JSON both apps write. Null when nothing's on (the place holds everything).
 */
export function holdsMap(basic: CollectionFilter, advanced: AdvancedFilter): PlaceHolds | null {
  if (!filterActive(basic) && !advancedActive(advanced)) return null
  return { basic: basicJson(basic), ...(advancedActive(advanced) ? { advanced: advancedJson(advanced) } : {}) } as PlaceHolds
}

/** The holds written afresh (null when it holds everything), so two apps' copies are equal. */
export function cleanHolds(map: PlaceHolds | null | undefined): PlaceHolds | null {
  const h = holdsFromMap(map)
  return h ? holdsMap(h.basic, h.advanced) : null
}

/**
 * The rules a place goes by. A binder's order is its "sortRule" (binderPages.ts), so a binder has only
 * what it holds. Anything else with new rules goes by them; one with only an older app's "sortRule"
 * goes by what that meant: COLOUR → sections by colour (lands apart), A–Z; SET → by set, by number;
 * TYPE → by card type, A–Z; NAME → no sections, A–Z.
 */
export function placeRules(place: StoragePlace): PlaceRules {
  const holds = holdsOf(place)
  if (place.kind === 'BINDER') return { holds, sectionsBy: null, sortBy: [] }
  if (place.sortBy !== undefined || place.sectionsBy !== undefined) {
    return { holds, sectionsBy: place.sectionsBy ? cleanSectionsBy(place.sectionsBy) : null, sortBy: cleanSortBy(place.sortBy ?? []) }
  }
  switch (place.sortRule) {
    case 'COLOUR': return { holds, sectionsBy: { by: 'COLOUR', lands: true }, sortBy: ['NAME'] }
    case 'SET': return { holds, sectionsBy: { by: 'SET', sets: [] }, sortBy: ['NUMBER'] }
    case 'TYPE': return { holds, sectionsBy: { by: 'TYPE' }, sortBy: ['NAME'] }
    case 'NAME': return { holds, sectionsBy: null, sortBy: ['NAME'] }
    default: return { holds, sectionsBy: null, sortBy: [] }
  }
}

/** The old rule nearest new rules, for apps that only know "sortRule": null when none is near. */
export function sortRuleFor(sectionsBy: SplitLevel | null, sortBy: string[]): SortRule | null {
  switch (sectionsBy?.by) {
    case 'COLOUR': return 'COLOUR'
    case 'TYPE': return 'TYPE'
    case 'SET': return 'SET'
    case undefined: return sortBy[0] === 'NAME' ? 'NAME' : sortBy[0] === 'SET' || sortBy[0] === 'NUMBER' ? 'SET' : null
    default: return null
  }
}

/** [place] without the given keys (left out, as both apps write it). */
function without(place: StoragePlace, ...keys: (keyof StoragePlace)[]): StoragePlace {
  const out = { ...place }
  for (const k of keys) delete out[k]
  return out
}

/**
 * [place] with these rules, as the editor saves them: what it holds, and — anything but a binder — its
 * sections' level, its order inside a section and the nearest old "sortRule". [sortBy] is always
 * written once a place has rules ([] for none), to tell this app's save from an older one's.
 */
export function withRules(place: StoragePlace, holds: PlaceHolds | null, sectionsBy: SplitLevel | null, sortBy: string[]): StoragePlace {
  const h = cleanHolds(holds)
  if (place.kind === 'BINDER') {
    const had = place.sortBy !== undefined || place.holds !== undefined
    const out = without(place, 'holds', 'sectionsBy', 'sortBy')
    return { ...out, ...(h ? { holds: h } : {}), ...(h || had ? { sortBy: [] } : {}) }
  }
  const level = sectionsBy ? cleanSectionsBy(sectionsBy) : null
  const order = cleanSortBy(sortBy)
  const had = place.sortBy !== undefined || place.sectionsBy !== undefined || place.holds !== undefined
  const any = h !== null || level !== null || order.length > 0
  const rule = sortRuleFor(level, order)
  const out = without(place, 'holds', 'sectionsBy', 'sortBy', 'sortRule')
  return {
    ...out,
    ...(rule ? { sortRule: rule } : {}),
    ...(h ? { holds: h } : {}),
    ...(level ? { sectionsBy: level } : {}),
    ...(any || had ? { sortBy: order } : {}),
  }
}

/** Whether a place has a rule to put cards away by: it holds something particular, or it has sections or an order. */
export function hasRule(place: StoragePlace): boolean {
  const r = placeRules(place)
  return place.kind === 'BINDER' ? r.holds !== null : anyRule(r)
}

// ---- Rule order ----

/** The user's rule order (Collection.placeOrder), kept on the Unsorted pile. */
export const placeOrderOf = (collections: Collection[]): string[] => collections.find(isUnsorted)?.placeOrder ?? []

/** [collections] with the rule order set to [order] (on the Unsorted pile, made if it isn't there). */
export function withPlaceOrder(collections: Collection[], order: string[]): Collection[] {
  const ids = order.filter((id, i) => order.indexOf(id) === i)
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, placeOrder: ids } : c))
}

/**
 * The places with a rule, in the order they're tried: as the user ordered them, then the rest in tree
 * order — those holding something particular before those holding everything.
 */
export function rulePlaces(places: StoragePlace[], order: string[]): StoragePlace[] {
  const ruled = placeTree(places).map((n) => n.place).filter(hasRule)
  const byId = new Map(ruled.map((p) => [p.id, p]))
  const listed = order.filter((id, i) => order.indexOf(id) === i).map((id) => byId.get(id)).filter((p): p is StoragePlace => !!p)
  const rest = ruled.filter((p) => !order.includes(p.id))
  return [...listed, ...rest.filter((p) => holdsOf(p) !== null), ...rest.filter((p) => holdsOf(p) === null)]
}

/** [order] with [id] moved to [to] (an index into rulePlaces), written out in full. */
export function movedInOrder(places: StoragePlace[], order: string[], id: string, to: number): string[] {
  const ids = rulePlaces(places, order).map((p) => p.id)
  const at = ids.indexOf(id)
  if (at < 0) return ids
  ids.splice(at, 1)
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id)
  return ids
}

// ---- What a card is, for the rules ----

/**
 * A card as the rules judge it: the sorting facts (name, colours, type, set, number, mana value, prices
 * — [facts]), and for "Holds" the Cards filter's facts ([basic], [advanced]: null when the card's data
 * isn't here, so a place that holds something particular can't take it), the copy's own ([copy]: its
 * finish, condition…), its role tags (undefined: not looked up) and the user's own tags.
 */
export interface RuleCard {
  facts: CardFacts
  basic?: FilterFacts | null
  advanced?: AdvancedFacts | null
  copy?: CopyFacts | null
  roleTags?: string[]
  userTags?: string[]
}

/** A Scryfall card as the rules judge it. */
export function ruleCardOf(card: ScryfallCard, foil = false, roleTags?: string[], userTags: string[] = [], copy?: CopyFacts): RuleCard {
  return { facts: { ...cardFactsOf(card), foil }, basic: filterFactsOf(card), advanced: advancedFactsOf(card), copy: copy ?? null, roleTags, userTags }
}

/**
 * A card as the rules judge it from its sorting facts alone, when its Scryfall data isn't at hand (a
 * deck's card being put back, a sorted pile being filed): enough for colours, type, rarity, set, mana
 * value and price — not rules text or keywords. Without a type line there's nothing to judge by.
 */
export function ruleCardOfFacts(f: CardFacts): RuleCard {
  if (!f.typeLine) return { facts: f }
  const identity = (f.colorIdentity ?? f.colors ?? []).map((c) => c.toUpperCase())
  return {
    facts: f,
    basic: { colors: new Set(identity.map((c) => c.charAt(0))), typeLine: f.typeLine, rarity: (f.rarity ?? '').toLowerCase(), text: '' },
    advanced: {
      colors: (f.colors ?? []).map((c) => c.toUpperCase()), identity, cmc: f.cmc ?? null, manaCost: [], stats: [], legalities: {}, set: (f.set ?? '').toLowerCase(),
      canBeCommander: false, gameChanger: false, reserved: false, dfc: false, fullArt: false, token: false, keywords: [],
      usd: f.usd ?? null, usdFoil: f.usdFoil ?? null, artist: '', flavor: '', etchedOnly: false,
    },
  }
}

const defaultCopy = (foil: boolean): CopyFacts => ({
  nonfoil: foil ? 0 : 1, foil: foil ? 1 : 0, conditions: [], languages: ['en'], binders: [], inDeck: false, copies: 1, places: [], unplaced: 0,
})

/** Whether [card] is one [holds] takes — everything when null. Prices typed in the chosen currency go through [toUsd]. */
export function holdsMatch(holds: Holds | null, card: RuleCard, toUsd: (n: number) => number = (n) => n): boolean {
  if (!holds) return true
  if (!filterMatches(holds.basic, card.basic)) return false
  if (!filterMatchesTags(holds.basic, card.roleTags, card.userTags ?? [])) return false
  return advancedMatches(holds.advanced, card.advanced, card.copy ?? defaultCopy(!!card.facts.foil), toUsd)
}

// ---- Sections ----

/** Dollars as the value sections are named when no currency is given: "$5", "$0.50". */
export const plainDollars = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

type Fmt = (n: number) => string

const recipeCardOf = (f: CardFacts): RecipeCard => ({
  name: f.name, colors: f.colors ?? null, colorIdentity: f.colorIdentity ?? null, typeLine: f.typeLine ?? null, set: f.set ?? null,
  collectorNumber: f.collectorNumber ?? null, cmc: f.cmc ?? null, rarity: f.rarity ?? null, usd: f.usd ?? null, usdFoil: f.usdFoil ?? null, foil: !!f.foil,
})

/**
 * The sections a level makes, in order — what a place's sections start as when its rule is picked.
 * A set level naming no sets makes a section per set as cards come, so none to start with.
 */
export function ruleSections(level: SplitLevel | null | undefined, fmt: Fmt = plainDollars): string[] {
  const l = level ? cleanSectionsBy(level) : null
  if (!l) return []
  if (l.by === 'SET' && !(l.sets ?? []).length) return []
  return levelBuckets(l, fmt).map((b) => b.label)
}

/** The section [level] gives a card, by its own name ("Blue", "Creatures", "MH3", "$5–20"). [rate]: the user's currency per US dollar. */
export function sectionLabel(level: SplitLevel, f: CardFacts, fmt: Fmt = plainDollars, rate = 1): string | null {
  const l = cleanSectionsBy(level)
  if (!l) return null
  if (l.by === 'SET' && !(l.sets ?? []).length) return (f.set ?? '').toUpperCase() || null
  const key = bucketOf(l, recipeCardOf(f), rate)
  return levelBuckets(l, fmt).find((b) => b.key === key)?.label ?? null
}

function holdsLetter(section: string, letter: string): boolean {
  const range = /^([A-Z])\s*[–-]\s*([A-Z])$/i.exec(section.trim())
  if (range) return letter >= range[1].toUpperCase() && letter <= range[2].toUpperCase()
  return section.trim().toUpperCase() === letter
}

/**
 * The section of [place] a card goes in, spelled as the place spells it when it has one by that name;
 * null when the place has no sections. A place sorted A–Z with no level but sections like "A–F" files
 * by the name's first letter, as before.
 */
export function ruleSectionFor(place: StoragePlace, f: CardFacts, fmt: Fmt = plainDollars, rate = 1): string | null {
  const r = placeRules(place)
  const sections = place.sections ?? []
  if (!r.sectionsBy) {
    if (r.sortBy[0] === 'NAME' && sections.length > 0) return sections.find((s) => holdsLetter(s, letterOf(f.name))) ?? null
    return null
  }
  const label = sectionLabel(r.sectionsBy, f, fmt, rate)
  if (!label) return null
  return sections.find((s) => s.toLowerCase() === label.toLowerCase()) ?? label
}

/**
 * Whether a card fits [place]'s rules: the place holds it, and — when its sections are set — the
 * section the rule gives it is one of them (a box of only Red and Green takes no blue card).
 */
export function fitsPlace(place: StoragePlace, card: RuleCard, toUsd: (n: number) => number = (n) => n, fmt: Fmt = plainDollars, rate = 1): boolean {
  const r = placeRules(place)
  if (!holdsMatch(r.holds, card, toUsd)) return false
  const sections = place.sections ?? []
  if (sections.length === 0 || place.kind === 'BINDER') return true
  if (!r.sectionsBy && r.sortBy[0] !== 'NAME') return true
  const s = ruleSectionFor(place, card.facts, fmt, rate)
  if (!s) return false
  return sections.some((x) => x.toLowerCase() === s.toLowerCase())
}

/**
 * The place a card goes to: the first in rule order whose rules it fits and that has room
 * ([room]: false for a place that's full). Null when none fits.
 */
export function placeFor(
  places: StoragePlace[], order: string[], card: RuleCard, room: (p: StoragePlace) => boolean = () => true,
  toUsd: (n: number) => number = (n) => n, fmt: Fmt = plainDollars, rate = 1,
): StoragePlace | null {
  return rulePlaces(places, order).find((p) => fitsPlace(p, card, toUsd, fmt, rate) && room(p)) ?? null
}

/** Whether [place] has room for one more card: true when it has no size. */
export function hasRoom(place: StoragePlace, collections: Collection[]): boolean {
  const space = spaceOf(place, collections)
  return !space || space.used < space.size
}

// ---- Order inside a section ----

const leadingNumber = (s: string | null | undefined): number => {
  const m = /^\d+/.exec((s ?? '').trim())
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER
}
const priceOf = (f: CardFacts): number | null => (f.foil ? f.usdFoil ?? f.usd ?? null : f.usd ?? f.usdFoil ?? null)
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const nameOrder = (a: CardFacts, b: CardFacts) => cmpStr(a.name.trim().toLowerCase(), b.name.trim().toLowerCase())
const cmpNum = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0)

function compareBy(by: string, a: CardFacts, b: CardFacts): number {
  switch (by) {
    case 'NAME': return nameOrder(a, b)
    case 'NUMBER': return cmpNum(leadingNumber(a.collectorNumber), leadingNumber(b.collectorNumber)) || cmpStr(a.collectorNumber ?? '', b.collectorNumber ?? '')
    case 'MANA_VALUE': return cmpNum(a.cmc ?? Number.MAX_VALUE, b.cmc ?? Number.MAX_VALUE)
    // Dearest first; no price last.
    case 'VALUE': return cmpNum(priceOf(b) ?? -1, priceOf(a) ?? -1)
    case 'SET': return cmpStr((a.set ?? '').toLowerCase(), (b.set ?? '').toLowerCase())
    default: return 0
  }
}

/** How two cards go in a section sorted by [sortBy]: each way in turn, then A–Z. */
export function compareForSort(sortBy: string[], a: CardFacts, b: CardFacts): number {
  for (const by of sortBy) {
    const c = compareBy(by, a, b)
    if (c !== 0) return c
  }
  return nameOrder(a, b)
}

/** [items] in [sortBy]'s order (stable: equal ones keep theirs). */
export function sortedForRule<T>(sortBy: string[], items: T[], facts: (item: T) => CardFacts): T[] {
  return sortBy.length === 0 ? items : [...items].sort((x, y) => compareForSort(sortBy, facts(x), facts(y)))
}

/** Whether a sort needs more than a card's name (its number, mana value, price or set). */
export const needsCardData = (sortBy: string[]): boolean => sortBy.some((s) => s !== 'NAME')

/**
 * Where in a section a card goes among [others] (the cards there), in words: "between Counterspell and
 * Cryptic Command", "before Brainstorm", "after Ponder", "next to Opt" (another copy). With none there:
 * "around “L”" A–Z, "around #117" by number, else null.
 */
export function sortHint(sortBy: string[], card: CardFacts, others: CardFacts[]): string | null {
  if (sortBy.length === 0) return null
  const seen = new Set<string>()
  const names = others.filter((o) => {
    const k = o.name.trim().toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (names.length === 0) {
    if (sortBy[0] === 'NAME') return `around “${letterOf(card.name)}”`
    if (sortBy[0] === 'NUMBER' || (sortBy[0] === 'SET' && sortBy[1] === 'NUMBER')) return card.collectorNumber ? `around #${card.collectorNumber}` : null
    return null
  }
  const same = names.find((o) => sameCardName(o.name, card.name))
  if (same) return `next to ${same.name}`
  const sorted = [...names].sort((a, b) => compareForSort(sortBy, a, b))
  let at = sorted.findIndex((o) => compareForSort(sortBy, card, o) < 0)
  if (at < 0) at = sorted.length
  if (at === 0) return `before ${sorted[0].name}`
  if (at === sorted.length) return `after ${sorted[sorted.length - 1].name}`
  return `between ${sorted[at - 1].name} and ${sorted[at].name}`
}

/**
 * Where a card goes in a place that isn't a binder: its section by the rules, and where in it among
 * the cards there ([cards]: the place's, cardsIn; [factsOf]: a copy's facts when its card data is
 * here, else only its name counts — and then only for A–Z). The section and the hint as words:
 * "Blue › between Counterspell and Cryptic Command".
 */
export function ruleSpot(
  place: StoragePlace, f: CardFacts, cards: PlacedCard[], factsOf: (e: CollectionEntry) => CardFacts | null = () => null,
  fmt: Fmt = plainDollars, rate = 1,
): { spot: Spot; hint: string | null } {
  const r = placeRules(place)
  const section = ruleSectionFor(place, f, fmt, rate)
  const inSection = cards.filter((c) => (c.line.section ?? '').toLowerCase() === (section ?? '').toLowerCase())
  const known = needsCardData(r.sortBy)
    ? inSection.map((c) => factsOf(c.entry)).filter((x): x is CardFacts => !!x)
    : inSection.map((c) => factsOf(c.entry) ?? { name: c.entry.name })
  const hint = sortHint(r.sortBy, f, known)
  const words = [section, hint].filter(Boolean).join(' › ')
  return { spot: section ? { placeId: place.id, section } : { placeId: place.id }, hint: words || null }
}

// ---- What doesn't belong ----

/** One line of copies in a place that its rules say goes elsewhere: another place ([to], null when none fits), or another [section] here. */
export interface Misfit { card: PlacedCard; wrongPlace: boolean; to: StoragePlace | null; section: string | null; line: string }

/**
 * The copies in [place] its rules say don't belong: one it doesn't hold ("Doesn't belong here — belongs
 * in Blue box", or "— no place fits"), or one in the wrong section ("In Red — belongs in Blue"). A copy
 * whose card data isn't here ([cardOf] null) isn't judged.
 */
export function misfits(
  place: StoragePlace, collections: Collection[], cardOf: (c: PlacedCard) => RuleCard | null,
  toUsd: (n: number) => number = (n) => n, fmt: Fmt = plainDollars, rate = 1,
): Misfit[] {
  const places = placesOf(collections)
  const order = placeOrderOf(collections)
  const r = placeRules(place)
  const out: Misfit[] = []
  for (const c of cardsIn(collections, place.id)) {
    const card = cardOf(c)
    if (!card) continue
    if (!fitsPlace(place, card, toUsd, fmt, rate)) {
      const to = placeFor(places.filter((p) => p.id !== place.id), order, card, () => true, toUsd, fmt, rate)
      out.push({ card: c, wrongPlace: true, to, section: null, line: to ? `Doesn't belong here — belongs in ${to.name}` : 'Doesn\'t belong here — no place fits' })
      continue
    }
    if (place.kind === 'BINDER' || !r.sectionsBy) continue
    const want = ruleSectionFor(place, card.facts, fmt, rate)
    if (!want) continue
    const now = c.line.section
    if (now && now.toLowerCase() === want.toLowerCase()) continue
    out.push({ card: c, wrongPlace: false, to: null, section: want, line: now ? `In ${now} — belongs in ${want}` : `No section — belongs in ${want}` })
  }
  return out
}

/** [collections] with a misfit's copies moved where they belong: [spot] (in its place, from ruleSpot), or the right section here. */
export function moveMisfit(collections: Collection[], m: Misfit, spot: Spot | null): Collection[] {
  const to = spot ?? (m.section ? { placeId: m.card.line.placeId, section: m.section } : null)
  if (!to) return collections
  return collections.map((c) => (c.id !== m.card.collectionId ? c : {
    ...c,
    entries: c.entries.map((e) => (e.scryfallId === m.card.entry.scryfallId ? moveCopies(e, m.card.line, to, m.card.line.qty).entry : e)),
  }))
}

/**
 * Whether a line of copies fits its place's rules: the place holds it, and (with sections by a level)
 * it's in the section they give it. True in a place with no rules; null when the card's data isn't
 * here — the Storage filters' "Doesn't fit its place".
 */
export function copyFitsItsPlace(places: Map<string, StoragePlace>, copy: PlacedCard, card: RuleCard | null, toUsd: (n: number) => number = (n) => n): boolean | null {
  const place = places.get(copy.line.placeId)
  if (!place || !hasRule(place)) return true
  if (!card) return null
  if (!fitsPlace(place, card, toUsd)) return false
  if (place.kind === 'BINDER' || !placeRules(place).sectionsBy) return true
  const want = ruleSectionFor(place, card.facts)
  if (!want) return true
  return want.toLowerCase() === (copy.line.section ?? '').toLowerCase()
}

// ---- Places whose rules overlap ----

/** Another place that also takes cards [draft] holds: how many of the cards looked at fit both, and whether it comes first. */
export interface Overlap { place: StoragePlace; cards: number; comesFirst: boolean }

/** "Also fits Red box (Red box comes first)". */
export const overlapLine = (o: Overlap): string =>
  `Also fits ${o.place.name} (${o.comesFirst ? `${o.place.name} comes first` : 'this place comes first'})`

/**
 * The places with rules that also take cards [draft] would hold, judged on [cards] (the collection's,
 * as far as their data is here): each with how many fit both and which comes first in rule order. A
 * place holding everything only counts when it comes first — then it takes them all.
 */
export function overlaps(draft: StoragePlace, places: StoragePlace[], order: string[], cards: RuleCard[], toUsd: (n: number) => number = (n) => n): Overlap[] {
  const h = holdsOf(draft)
  if (!h) return []
  const ranked = rulePlaces([...places.filter((p) => p.id !== draft.id), draft], order)
  const mine = cards.filter((c) => holdsMatch(h, c, toUsd))
  if (mine.length === 0) return []
  const at = ranked.findIndex((p) => p.id === draft.id)
  const out: Overlap[] = []
  ranked.forEach((p, i) => {
    if (p.id === draft.id) return
    const first = at < 0 || i < at
    const ph = holdsOf(p)
    if (!ph && !first) return
    const n = mine.filter((c) => holdsMatch(ph, c, toUsd)).length
    if (n > 0) out.push({ place: p, cards: n, comesFirst: first })
  })
  return out
}

// ---- In words ----

const COLOUR_WORDS: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' }

function andList(words: string[], join = 'and'): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} ${join} ${words[words.length - 1]}`
}

const colourWords = (letters: string[]) => ADVANCED_COLORS.filter((c) => letters.includes(c)).map((c) => COLOUR_WORDS[c])

/**
 * What a "Holds" filter takes, in a few words: "blue cards", "blue, mono-colour", "creatures, rare or
 * mythic", "tagged “trade”". [binderName] and [placeName] name the Your copies filters' binder and place.
 */
export function holdsSummary(
  basic: CollectionFilter, a: AdvancedFilter,
  binderName: (id: string) => string | undefined = () => undefined, placeName: (id: string) => string | undefined = () => undefined,
  fmt: Fmt = plainDollars,
): string {
  const parts: string[] = []
  let colourOnly = true
  const type = basic.type.trim().split(/\s+/).filter(Boolean).join(' ').toLowerCase()
  if (type) { parts.push(type.endsWith('s') ? type : `${type}s`); colourOnly = false }
  if (basic.colors.length > 0) parts.unshift(andList(colourWords(basic.colors)))
  const picked = a.colors.filter((c) => c !== 'C')
  if (picked.length > 0 || a.colors.includes('C')) {
    const words = colourWords(picked)
    let phrase: string
    if (a.colors.includes('C') && picked.length === 0) phrase = 'colourless'
    else if (a.colorMode === 'exactly' && words.length === 1) { colourOnly = false; phrase = `${words[0]}, mono-colour` }
    else if (a.colorMode === 'exactly') { colourOnly = false; phrase = `exactly ${andList(words)}` }
    else if (a.colorMode === 'atMost' && words.length === 1) phrase = `${words[0]} or colourless`
    else if (a.colorMode === 'atMost') { colourOnly = false; phrase = `within ${andList(words)}` }
    else phrase = andList(words)
    parts.unshift(phrase)
  }
  if (a.multicolor) { parts.push('multicolour'); colourOnly = false }
  if (basic.text.trim()) { parts.push(`with “${basic.text.trim()}”`); colourOnly = false }
  const rarities = COLLECTION_FILTER_RARITIES.filter((r) => basic.rarities.includes(r))
  if (rarities.length > 0) { parts.push(andList(rarities, 'or')); colourOnly = false }
  if (basic.untagged) { parts.push(UNTAGGED.toLowerCase()); colourOnly = false }
  if (basic.userTags?.length) { parts.push(`tagged ${andList([...basic.userTags].sort().map((t) => `“${t}”`))}`); colourOnly = false }
  // The rest as their chips say them.
  const skip = new Set(['type', 'text', 'color', 'rarity', 'untagged', 'usertag', 'colors', 'multicolor'])
  for (const chip of filterChips(NO_COLLECTION_FILTER, a, { binderName, placeName, formatLocal: fmt })) {
    if (skip.has(chip.key.split(':')[0])) continue
    parts.push(chip.label + (chip.symbols.length ? ` ${chip.symbols.map((s) => `{${s}}`).join('')}` : ''))
    colourOnly = false
  }
  if (parts.length === 0) return 'everything'
  const line = parts.join(', ')
  return colourOnly && !type ? `${line} cards` : line
}

/** A level as a place's line says it: "by colour", "by card type", "by letter". */
export const sectionsWords = (level: SplitLevel): string => (level.by === 'NAME' ? 'by letter' : `by ${lowerWord(LEVEL_LABELS[level.by] ?? level.by)}`)

/** An order as a place's line says it: "A–Z", "by mana value, then A–Z". */
export function sortWords(sortBy: string[]): string | null {
  if (sortBy.length === 0) return null
  if (sortBy.length === 2 && sortBy[0] === 'SET' && sortBy[1] === 'NUMBER') return 'by set, then number'
  return sortBy.map((s) => SORT_BY_SHORT[s] ?? s).join(', then ')
}

/**
 * A place's rules in a line: "Holds blue cards · by card type · A–Z". A binder's says its order
 * ("in order by set, then number"). Empty when it has none.
 */
export function rulesLine(
  place: StoragePlace,
  binderName: (id: string) => string | undefined = () => undefined, placeName: (id: string) => string | undefined = () => undefined,
  fmt: Fmt = plainDollars,
): string {
  const r = placeRules(place)
  const parts: string[] = []
  if (r.holds) parts.push(`Holds ${holdsSummary(r.holds.basic, r.holds.advanced, binderName, placeName, fmt)}`)
  if (place.kind === 'BINDER') {
    if (place.sortRule) parts.push(`in order ${SORT_RULE_SHORT[place.sortRule]}`)
  } else {
    if (r.sectionsBy) parts.push(sectionsWords(r.sectionsBy))
    const w = sortWords(r.sortBy)
    if (w) parts.push(w)
  }
  return parts.join(' · ')
}

// ---- Sync: an older app's save ----

/**
 * [theirs] with the rules [source] has put back where [theirs] was saved by an app that doesn't know
 * about rules: its places with no "sortBy" while [source]'s had one get their "holds" back, and their
 * sections' level and order too unless that app changed the place's "sortRule" (then the old rule it
 * picked is what counts); and the pile's rule order when it has none. The same object when nothing changes.
 */
export function keepPlaceRules(source: Collection, theirs: Collection): Collection {
  let out = theirs
  if (source.storagePlaces && theirs.storagePlaces) {
    const mine = new Map(source.storagePlaces.map((p) => [p.id, p]))
    const lost = (p: StoragePlace) => {
      const m = mine.get(p.id)
      return !!m && p.sortBy === undefined && p.sectionsBy === undefined && p.holds === undefined &&
        (m.sortBy !== undefined || m.sectionsBy !== undefined || m.holds !== undefined)
    }
    if (theirs.storagePlaces.some(lost)) {
      out = {
        ...out,
        storagePlaces: theirs.storagePlaces.map((p) => {
          if (!lost(p)) return p
          const m = mine.get(p.id)!
          const back = (p.sortRule ?? '') === (m.sortRule ?? '')
            ? { ...(m.holds ? { holds: m.holds } : {}), ...(m.sectionsBy ? { sectionsBy: m.sectionsBy } : {}), ...(m.sortBy ? { sortBy: m.sortBy } : {}) }
            // That app picked another old rule: it's what the place goes by now (placeRules reads it), with what it holds kept.
            : { ...(m.holds ? { holds: m.holds } : {}) }
          return { ...p, ...back }
        }),
      }
    }
  }
  if (isUnsorted(theirs) && theirs.placeOrder === undefined && source.placeOrder !== undefined) out = { ...out, placeOrder: source.placeOrder }
  return out
}

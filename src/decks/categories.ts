// A deck's own categories: the user's groups for its cards — "Ramp", "Removal", "Win cons" — each
// card in as many as it fits (DeckCardEntry.categories), with an optional target per category
// ("Ramp 10/12", Deck.categoryTargets). Also the other ways the Cards list can be grouped — by
// mana value, colour or role tag — and "Suggest categories", which fills them in from the cards'
// Scryfall Tagger role tags (tags/roleTags.ts). Pure, so it can be tested; the Android app's
// data/DeckCategories.kt works the same way.

import type { Deck, DeckCardEntry } from '../types/models'

/** The longest category name kept. */
export const MAX_CATEGORY = 40

/** Offered when picking a card's categories, beside the deck's own. */
export const COMMON_CATEGORIES = ['Ramp', 'Draw', 'Removal', 'Board wipes', 'Counterspells', 'Tutors', 'Protection', 'Recursion', 'Win cons']

/** What the Cards list can be grouped by. */
export const DECK_GROUPINGS = ['TYPE', 'CATEGORY', 'MANA_VALUE', 'COLOUR', 'ROLE'] as const
export type DeckGrouping = (typeof DECK_GROUPINGS)[number]
export const DECK_GROUPING_LABELS: Record<DeckGrouping, string> = {
  TYPE: 'Type',
  CATEGORY: 'Category',
  MANA_VALUE: 'Mana value',
  COLOUR: 'Colour',
  ROLE: 'Role tag',
}

/** The category a role tag suggests, by the tag's id (tags/roleTags.ts). */
export const ROLE_CATEGORY: Record<string, string> = {
  ramp: 'Ramp',
  'mana-rock': 'Ramp',
  'mana-dork': 'Ramp',
  'land-ramp': 'Ramp',
  'mana-engine': 'Ramp',
  treasure: 'Ramp',
  draw: 'Draw',
  wheel: 'Draw',
  removal: 'Removal',
  'board-wipe': 'Board wipes',
  counterspell: 'Counterspells',
  tutor: 'Tutors',
  protection: 'Protection',
  recursion: 'Recursion',
  reanimate: 'Recursion',
  'sacrifice-outlet': 'Sacrifice outlets',
  tokens: 'Tokens',
  tax: 'Tax',
  lifegain: 'Lifegain',
  burn: 'Burn',
  'graveyard-hate': 'Graveyard hate',
  'extra-turn': 'Extra turns',
}

const key = (name: string) => name.toLowerCase()
const byName = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)

/** A category name as it's kept: spaces tidied, at most MAX_CATEGORY characters. */
export function tidyCategory(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY).trim()
}

/** [names] tidied, blanks dropped, each once (the first spelling kept). */
function tidyAll(names: string[]): string[] {
  const out: string[] = []
  for (const n of names.map(tidyCategory)) if (n && !out.some((o) => key(o) === key(n))) out.push(n)
  return out
}

/** The deck with its categories marked as known (see Deck.categoryTargets). */
const known = (deck: Deck): Deck => (deck.categoryTargets ? deck : { ...deck, categoryTargets: {} })

/** [entry] with [categories]; none leaves the key out. */
function withEntryCategories(entry: DeckCardEntry, categories: string[]): DeckCardEntry {
  if (categories.length > 0) return { ...entry, categories }
  const { categories: _gone, ...rest } = entry
  return rest
}

/** This deck with the main-deck card [scryfallId] in exactly [categories]. */
export function withCardCategories(deck: Deck, scryfallId: string, categories: string[]): Deck {
  const tidy = tidyAll(categories)
  return known({ ...deck, cards: deck.cards.map((c) => (c.scryfallId === scryfallId ? withEntryCategories(c, tidy) : c)) })
}

/** Every category the deck uses or has a target for, A–Z. */
export function deckCategoryNames(deck: Deck): string[] {
  return tidyAll([...deck.cards.flatMap((c) => c.categories ?? []), ...Object.keys(deck.categoryTargets ?? {})]).sort(byName)
}

/** How many of the main deck's cards (copies) are in each category, by its name as the deck spells it. */
export function categoryCounts(deck: Deck): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const name of deckCategoryNames(deck)) counts[name] = 0
  const names = Object.keys(counts)
  for (const c of deck.cards) {
    for (const cat of tidyAll(c.categories ?? [])) {
      const name = names.find((n) => key(n) === key(cat))
      if (name) counts[name] += c.quantity
    }
  }
  return counts
}

/** A category's target, looked up whatever its case. */
export function targetOf(deck: Deck, category: string): number | null {
  const found = Object.entries(deck.categoryTargets ?? {}).find(([k]) => key(k) === key(category))
  return found ? found[1] : null
}

/** This deck with [category]'s target set to [target] (a whole number, 1 or more); null takes it off. */
export function withCategoryTarget(deck: Deck, category: string, target: number | null): Deck {
  const name = tidyCategory(category)
  if (!name) return deck
  const targets = Object.fromEntries(Object.entries(deck.categoryTargets ?? {}).filter(([k]) => key(k) !== key(name)))
  const n = target == null ? 0 : Math.floor(target)
  if (n >= 1) targets[name] = n
  return { ...deck, categoryTargets: targets }
}

/** The line for a category: "Ramp 10/12" with a target, "Ramp 10" without. */
export function categoryLine(name: string, count: number, target: number | null): string {
  return target != null ? `${name} ${count}/${target}` : `${name} ${count}`
}

/** This deck with category [from] called [to] on every card and in the targets (merging into [to] if it's there). */
export function renamedCategory(deck: Deck, from: string, to: string): Deck {
  const next = tidyCategory(to)
  if (!next) return removedCategory(deck, from)
  const rename = (list: string[]) => tidyAll(list.map((c) => (key(c) === key(from) ? next : c)))
  const target = targetOf(deck, from)
  let out: Deck = known({ ...deck, cards: deck.cards.map((c) => (c.categories ? withEntryCategories(c, rename(c.categories)) : c)) })
  if (target != null) out = withCategoryTarget(withCategoryTarget(out, from, null), next, targetOf(out, next) ?? target)
  return out
}

/** This deck with category [name] taken off every card, and its target gone. */
export function removedCategory(deck: Deck, name: string): Deck {
  const cards = deck.cards.map((c) => (c.categories ? withEntryCategories(c, c.categories.filter((x) => key(x) !== key(name))) : c))
  return withCategoryTarget(known({ ...deck, cards }), name, null)
}

/**
 * The categories "Suggest categories" gives each main-deck card that has none yet, from its role tags
 * ([roleTagsOf]: a card's name → its tag ids), by scryfallId. Cards with no matching tag are left out.
 */
export function suggestedCategories(deck: Deck, roleTagsOf: (name: string) => string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const c of deck.cards) {
    if ((c.categories ?? []).length > 0) continue
    const cats = tidyAll(roleTagsOf(c.name).map((id) => ROLE_CATEGORY[id]).filter((x): x is string => !!x))
    if (cats.length > 0) out.set(c.scryfallId, cats)
  }
  return out
}

/** This deck with the suggested categories filled in, and how many cards got some. */
export function withSuggestedCategories(deck: Deck, roleTagsOf: (name: string) => string[]): { deck: Deck; filled: number } {
  const suggested = suggestedCategories(deck, roleTagsOf)
  if (suggested.size === 0) return { deck, filled: 0 }
  return {
    deck: known({ ...deck, cards: deck.cards.map((c) => (suggested.has(c.scryfallId) ? withEntryCategories(c, suggested.get(c.scryfallId)!) : c)) }),
    filled: suggested.size,
  }
}

// ---- Grouping the Cards list ----

/** What grouping needs to know of a card: its mana value, colours, whether it's a land, its role tags' labels. */
export interface CardFacts {
  cmc: number | null
  colors: string[] | null
  land: boolean
  roles: string[]
}

export interface CardGroup {
  key: string
  label: string
  cards: DeckCardEntry[]
  /** Copies in the group. */
  count: number
  /** A category's target, when it has one. */
  target: number | null
}

const COLOUR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const COLOUR_ORDER = ['W', 'U', 'B', 'R', 'G', 'multi', 'colourless', 'land', 'unknown']

const sortedCards = (cards: DeckCardEntry[]) => [...cards].sort((a, b) => byName(a.name, b.name))
const group = (key: string, label: string, cards: DeckCardEntry[], target: number | null = null): CardGroup =>
  ({ key, label, cards: sortedCards(cards), count: cards.reduce((n, c) => n + c.quantity, 0), target })

/**
 * [cards] grouped [by] anything but type (the type groups are the list's own): by the deck's
 * categories (A–Z, each card in every one it's in, "No category" last, a category with a target shown
 * even when empty), by mana value ("0"…"7+", lands apart), by colour (White…Green, Multicolour,
 * Colourless, lands apart) or by role tag (most cards first, "No role tag" last). [facts] is what's
 * known of each card; one not known yet goes in "Not known yet".
 */
export function groupCards(
  cards: DeckCardEntry[],
  by: Exclude<DeckGrouping, 'TYPE'>,
  facts: (entry: DeckCardEntry) => CardFacts | undefined,
  targets: Record<string, number> = {},
): CardGroup[] {
  switch (by) {
    case 'CATEGORY': {
      const names = tidyAll([...cards.flatMap((c) => c.categories ?? []), ...Object.keys(targets)]).sort(byName)
      const groups = names.map((name) => {
        const target = Object.entries(targets).find(([k]) => key(k) === key(name))?.[1] ?? null
        return group(`cat:${key(name)}`, name, cards.filter((c) => (c.categories ?? []).some((x) => key(tidyCategory(x)) === key(name))), target)
      }).filter((g) => g.cards.length > 0 || g.target != null)
      const none = cards.filter((c) => tidyAll(c.categories ?? []).length === 0)
      return none.length > 0 ? [...groups, group('cat:', 'No category', none)] : groups
    }
    case 'MANA_VALUE': {
      const buckets = new Map<string, DeckCardEntry[]>()
      for (const c of cards) {
        const f = facts(c)
        const k = !f ? 'unknown' : f.land ? 'land' : `mv${Math.min(7, Math.max(0, Math.floor(f.cmc ?? 0)))}`
        buckets.set(k, [...(buckets.get(k) ?? []), c])
      }
      const order = ['mv0', 'mv1', 'mv2', 'mv3', 'mv4', 'mv5', 'mv6', 'mv7', 'land', 'unknown']
      const label = (k: string) => (k === 'land' ? 'Lands' : k === 'unknown' ? 'Not known yet' : k === 'mv7' ? '7+ mana' : `${k.slice(2)} mana`)
      return order.filter((k) => buckets.has(k)).map((k) => group(k, label(k), buckets.get(k)!))
    }
    case 'COLOUR': {
      const buckets = new Map<string, DeckCardEntry[]>()
      for (const c of cards) {
        const f = facts(c)
        const colours = (f?.colors ?? []).filter((x) => COLOUR_NAMES[x])
        const k = !f ? 'unknown' : f.land ? 'land' : colours.length === 0 ? 'colourless' : colours.length > 1 ? 'multi' : colours[0]
        buckets.set(k, [...(buckets.get(k) ?? []), c])
      }
      const label = (k: string) => COLOUR_NAMES[k] ?? ({ multi: 'Multicolour', colourless: 'Colourless', land: 'Lands', unknown: 'Not known yet' } as Record<string, string>)[k]
      return COLOUR_ORDER.filter((k) => buckets.has(k)).map((k) => group(k, label(k), buckets.get(k)!))
    }
    case 'ROLE': {
      const buckets = new Map<string, DeckCardEntry[]>()
      const none: DeckCardEntry[] = []
      for (const c of cards) {
        const roles = [...new Set(facts(c)?.roles ?? [])]
        if (roles.length === 0) none.push(c)
        for (const r of roles) buckets.set(r, [...(buckets.get(r) ?? []), c])
      }
      const groups = [...buckets.entries()].map(([r, list]) => group(`role:${key(r)}`, r, list))
        .sort((a, b) => b.count - a.count || byName(a.label, b.label))
      return none.length > 0 ? [...groups, group('role:', 'No role tag', none)] : groups
    }
  }
}

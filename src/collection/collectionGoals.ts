// Collection goals: targets the user sets and works towards — complete a set (or only its uncommons,
// or in foil), a playset of each card on a list, every card of a deck in foil, or any list of cards
// in any quantities. Each goal says how many of the copies it needs the user has, what's missing and
// what that would cost, and once everything is there it's complete (and moves to Completed).
//
// What counts as having a card: copies in owned binders, boxes and the Unsorted pile (wishlists
// never), and — when the goal says so ("count cards in decks") — the real copies in decks the user
// holds (proxies left out). A foil goal counts foil copies only; in a deck those are the foil copies
// its pull list brought in (Deck.cameFrom), as decks don't otherwise know a copy's finish. A set goal
// matches printings (Lightning Bolt from that set, as Set completion does); the others match the card
// by name, any printing. One copy can count towards several goals.
//
// Where goals are kept: the Unsorted pile's "collectionGoals" (Collection.collectionGoals), so they
// sync like the sorting recipes. Two devices' goals merge goal by goal (mergeGoals): one added on
// either is kept, one deleted on either stays deleted, and where both changed one the more recently
// changed (updatedAt) wins whole — a completion is never lost. A pile saved by an app from before
// goals comes without the key and keeps this device's (keepGoalsFromOlderApp).
//
// Pure, so it can be tested. The Android app's data/CollectionGoals.kt, rule for rule; both run the
// same test vectors (tests/collection/collectionGoalVectors.json ↔ app/src/test/resources/collectionGoalVectors.json).

import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../types/models'
import { isUnsorted } from '../types/models'
import { sameJson } from '../sync/canonicalJson'
import { withUnsortedPile } from './unsorted'
import { proxyCopies } from '../decks/proxies'
import { isBasicLand } from '../decks/missing'

// ---- What a goal is ----

export type GoalKind = 'SET' | 'PLAYSET' | 'DECK' | 'CUSTOM'
export const GOAL_KINDS: GoalKind[] = ['SET', 'PLAYSET', 'DECK', 'CUSTOM']
export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  SET: 'Complete a set',
  PLAYSET: 'Playsets of a list',
  DECK: 'Foil a deck',
  CUSTOM: 'Custom list',
}
export const GOAL_KIND_DETAILS: Record<GoalKind, string> = {
  SET: 'Every card of a set — or only its uncommons, rares… — optionally in foil.',
  PLAYSET: 'A playset of each card on a list: "a playset of each shock land".',
  DECK: 'Every card in one of your decks, in foil.',
  CUSTOM: 'Any cards, any quantities.',
}

/** Rarities a set goal can keep to, in this order. */
export const GOAL_RARITIES = ['common', 'uncommon', 'rare', 'mythic']

/** Copies a playset has, and the most a goal asks of one card. */
export const GOAL_PLAYSET = 4
export const GOAL_MAX_QTY = 99

/**
 * One card a goal wants: [qty] copies of it. [scryfallId] is the printing (what a set goal matches);
 * [imageUrl], [usd] and [usdFoil] are as Scryfall had them when the goal was made, for the list and
 * the value of what's missing.
 */
export interface GoalCard {
  name: string
  scryfallId?: string
  qty: number
  imageUrl?: string
  usd?: number
  usdFoil?: number
  /** A set goal's cards: the printing's rarity and collector number, as Scryfall says. */
  rarity?: string
  number?: string
}

/**
 * A goal. [setCode] and [rarities] (none: every rarity): SET only; [deckId]: DECK only — its cards
 * are the deck's as it is now, [cards] what it was when the goal was made (used once the deck is
 * gone). [foil]: only foil copies count. [countDecks]: copies in decks count too. [completedAt]: when
 * it was first complete; it stays complete after.
 */
export interface CollectionGoal {
  id: string
  name: string
  kind: GoalKind
  setCode?: string
  rarities?: string[]
  foil?: boolean
  deckId?: string
  cards: GoalCard[]
  countDecks?: boolean
  createdAt: number
  updatedAt: number
  completedAt?: number
}

/** A card's name as goals key it: trimmed, lowercase (a double-faced card by its whole name, as decks do). */
export const goalNameKey = (name: string) => name.trim().toLowerCase()

/** How [goal] keys a card: by printing for a set goal, else by name. */
export function goalCardKey(goal: Pick<CollectionGoal, 'kind'>, card: { name: string; scryfallId?: string | null }): string {
  return goal.kind === 'SET' && card.scryfallId ? `id:${card.scryfallId}` : `n:${goalNameKey(card.name)}`
}

const clampQty = (n: number) => Math.max(1, Math.min(GOAL_MAX_QTY, Number.isFinite(n) ? Math.floor(n) : 1))

function goalCard(c: GoalCard): GoalCard {
  return {
    name: c.name.trim(),
    ...(c.scryfallId ? { scryfallId: c.scryfallId } : {}),
    qty: clampQty(c.qty),
    ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
    ...(c.usd != null && Number.isFinite(c.usd) ? { usd: c.usd } : {}),
    ...(c.usdFoil != null && Number.isFinite(c.usdFoil) ? { usdFoil: c.usdFoil } : {}),
    ...(c.rarity ? { rarity: c.rarity.toLowerCase() } : {}),
    ...(c.number ? { number: c.number } : {}),
  }
}

/**
 * A goal as both apps write it: a known kind, only the fields its kind uses, each card once (the
 * copies of a card listed twice added up, the first line's details kept), quantities 1–99, and the
 * flags left out unless on.
 */
export function collectionGoal(g: CollectionGoal): CollectionGoal {
  const kind: GoalKind = GOAL_KINDS.includes(g.kind) ? g.kind : 'CUSTOM'
  const cards: GoalCard[] = []
  const at = new Map<string, number>()
  for (const raw of g.cards ?? []) {
    if (!raw.name || !raw.name.trim()) continue
    const c = goalCard(raw)
    const k = goalCardKey({ kind }, c)
    const i = at.get(k)
    if (i === undefined) { at.set(k, cards.length); cards.push(c) } else cards[i] = { ...cards[i], qty: clampQty(cards[i].qty + c.qty) }
  }
  const rarities = kind === 'SET' ? GOAL_RARITIES.filter((r) => (g.rarities ?? []).map((x) => x.toLowerCase()).includes(r)) : []
  return {
    id: g.id,
    name: g.name.trim() || GOAL_KIND_LABELS[kind],
    kind,
    ...(kind === 'SET' && g.setCode ? { setCode: g.setCode.trim().toLowerCase() } : {}),
    ...(rarities.length > 0 ? { rarities } : {}),
    ...(g.foil === true ? { foil: true } : {}),
    ...(kind === 'DECK' && g.deckId ? { deckId: g.deckId } : {}),
    cards,
    ...(g.countDecks === true ? { countDecks: true } : {}),
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    ...(g.completedAt != null ? { completedAt: g.completedAt } : {}),
  }
}

// ---- Making goals ----

/** A set's printing, as a set goal is made from it. */
export interface GoalSetCard { id: string; name: string; rarity?: string | null; number?: string | null; imageUrl?: string | null; usd?: number | null; usdFoil?: number | null }

const RARITY_PLURALS: Record<string, string> = { common: 'commons', uncommon: 'uncommons', rare: 'rares', mythic: 'mythics' }

function andList(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "Complete Duskmourn", "Duskmourn uncommons", "Duskmourn foil rares and mythics", "Complete Duskmourn in foil". */
export function setGoalName(setName: string, rarities: string[], foil: boolean): string {
  const picked = GOAL_RARITIES.filter((r) => rarities.includes(r))
  if (picked.length === 0 || picked.length === GOAL_RARITIES.length) return `Complete ${setName}${foil ? ' in foil' : ''}`
  return `${setName}${foil ? ' foil' : ''} ${andList(picked.map((r) => RARITY_PLURALS[r]))}`
}

/** A set goal: [cards] (the set's printings) kept to [rarities] (none: all), one of each. */
export function newSetGoal(id: string, set: { code: string; name: string }, cards: GoalSetCard[], rarities: string[], foil: boolean, now: number): CollectionGoal {
  const picked = GOAL_RARITIES.filter((r) => rarities.includes(r))
  const keep = picked.length === 0 || picked.length === GOAL_RARITIES.length ? null : new Set(picked)
  return collectionGoal({
    id, name: setGoalName(set.name, picked, foil), kind: 'SET', setCode: set.code, rarities: keep ? picked : [], foil,
    cards: cards
      .filter((c) => !keep || keep.has((c.rarity ?? '').toLowerCase()))
      .map((c) => ({
        name: c.name, scryfallId: c.id, qty: 1, imageUrl: c.imageUrl ?? undefined, usd: c.usd ?? undefined, usdFoil: c.usdFoil ?? undefined,
        rarity: c.rarity ?? undefined, number: c.number ?? undefined,
      })),
    createdAt: now, updatedAt: now,
  })
}

/** A deck's cards as a goal wants them: one line per card (a commander once), basic lands left out. */
export function deckGoalCards(deck: Deck): GoalCard[] {
  const byName = new Map<string, DeckCardEntry[]>()
  for (const e of [deck.commander, deck.partnerCommander, ...deck.cards]) {
    if (!e || isBasicLand(e.name)) continue
    const k = goalNameKey(e.name)
    byName.set(k, [...(byName.get(k) ?? []), e])
  }
  return [...byName.values()].map((printings) => {
    const unique = [...new Map(printings.map((e) => [e.scryfallId, e])).values()]
    const first = unique[0]
    return { name: first.name, scryfallId: first.scryfallId, qty: unique.reduce((n, e) => n + e.quantity, 0), ...(first.imageUrl ? { imageUrl: first.imageUrl } : {}) }
  })
}

/** "Foil Krenko's Goblins" — every card of the deck in foil (or "Own all of …" when not foil). */
export const deckGoalName = (deckName: string, foil: boolean) => (foil ? `Foil ${deckName}` : `Own all of ${deckName}`)

/** A deck goal: every card of [deck] (in foil when [foil]); copies in decks count, so the deck's own do. */
export function newDeckGoal(id: string, deck: Deck, foil: boolean, now: number): CollectionGoal {
  return collectionGoal({
    id, name: deckGoalName(deck.name, foil), kind: 'DECK', deckId: deck.id, foil, cards: deckGoalCards(deck), countDecks: true,
    createdAt: now, updatedAt: now,
  })
}

/** A list goal: a playset ([qty] each, default 4) of each card, or a custom list with each card's own count. */
export function newListGoal(id: string, kind: 'PLAYSET' | 'CUSTOM', name: string, cards: GoalCard[], qty: number | null, now: number): CollectionGoal {
  return collectionGoal({
    id, name, kind, cards: kind === 'PLAYSET' ? cards.map((c) => ({ ...c, qty: qty ?? GOAL_PLAYSET })) : cards,
    createdAt: now, updatedAt: now,
  })
}

// ---- Progress ----

/** One card of a goal: [need] copies, [have] of them there (at most [need]; [owned]: all counted). */
export interface GoalLine {
  key: string
  name: string
  scryfallId?: string
  imageUrl?: string
  rarity?: string
  number?: string
  need: number
  owned: number
  have: number
  missing: number
  /** One copy's price in US dollars for the goal's finish, when known. */
  usd: number | null
}

export interface GoalProgress {
  have: number
  need: number
  /** Whole percent, rounded down so a goal shows 100% only when it's complete. */
  percent: number
  /** What the missing copies would cost in US dollars, as far as their prices are known. */
  missingUsd: number
  /** Missing copies with no known price (left out of [missingUsd]). */
  unpriced: number
  complete: boolean
  lines: GoalLine[]
}

/** Prices known now, by printing — fresher than a goal's own; either may be missing. */
export type GoalPrices = Record<string, { usd?: number | null; usdFoil?: number | null }>

/** What [goal] wants now: a deck goal follows its deck (its old list once the deck's gone). */
export function goalTargets(goal: CollectionGoal, decks: Deck[]): GoalCard[] {
  if (goal.kind !== 'DECK') return goal.cards
  const deck = decks.find((d) => d.id === goal.deckId)
  if (!deck) return goal.cards
  const before = new Map(goal.cards.map((c) => [goalNameKey(c.name), c]))
  return deckGoalCards(deck).map((c) => {
    const was = before.get(goalNameKey(c.name))
    return { ...was, ...c, imageUrl: c.imageUrl ?? was?.imageUrl }
  })
}

/** Real copies each deck holds, by printing and name — a deck you hold (or a proxy deck's real ones). */
const holdsCards = (d: Deck) => !d.sample && (d.ownership === 'PHYSICAL' || d.ownership === 'PROXY')

/**
 * The copies [goal] counts of each card it could want, by its card key: owned binders, boxes and
 * the Unsorted pile (wishlists never), and with [countDecks] the real copies in decks held. A foil
 * goal counts foil copies only — in a deck, those its pull list brought in foil.
 */
export function goalCounts(goal: CollectionGoal, collections: Collection[], decks: Deck[]): Map<string, number> {
  const foil = goal.foil === true
  const out = new Map<string, number>()
  const add = (k: string, n: number) => { if (n > 0) out.set(k, (out.get(k) ?? 0) + n) }
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) add(goalCardKey(goal, e), foil ? e.foilQuantity : e.quantity + e.foilQuantity)
  }
  if (goal.countDecks === true) {
    for (const d of decks) {
      if (!holdsCards(d)) continue
      // The foil copies the deck's pull list brought in, by name, handed out to its cards in order.
      const foils = new Map<string, number>()
      if (foil) for (const f of d.cameFrom ?? []) if (f.foil === true) foils.set(goalNameKey(f.name), (foils.get(goalNameKey(f.name)) ?? 0) + f.qty)
      for (const e of d.cards) {
        const real = e.quantity - proxyCopies(d, e)
        if (real <= 0) continue
        if (!foil) { add(goalCardKey(goal, e), real); continue }
        const left = foils.get(goalNameKey(e.name)) ?? 0
        const take = Math.min(real, left)
        if (take > 0) { foils.set(goalNameKey(e.name), left - take); add(goalCardKey(goal, e), take) }
      }
    }
  }
  return out
}

const cents = (n: number) => Math.round(n * 100) / 100

/** A copy's price for [foil]: the foil price, else the plain one — each falling back to the other. */
function priceFor(usd: number | null | undefined, usdFoil: number | null | undefined, foil: boolean): number | null {
  const plain = usd ?? null
  const shiny = usdFoil ?? null
  return foil ? shiny ?? plain : plain ?? shiny
}

/** How far [goal] has got: each card's copies, the totals, what's missing and what that would cost. */
export function goalProgress(goal: CollectionGoal, collections: Collection[], decks: Deck[], prices: GoalPrices = {}): GoalProgress {
  const counts = goalCounts(goal, collections, decks)
  const foil = goal.foil === true
  const lines: GoalLine[] = []
  const seen = new Map<string, number>()
  for (const c of goalTargets(goal, decks)) {
    const key = goalCardKey(goal, c)
    const i = seen.get(key)
    if (i !== undefined) { lines[i] = { ...lines[i], need: lines[i].need + c.qty }; continue }
    seen.set(key, lines.length)
    const known = c.scryfallId ? prices[c.scryfallId] : undefined
    const usd = known ? priceFor(known.usd, known.usdFoil, foil) ?? priceFor(c.usd, c.usdFoil, foil) : priceFor(c.usd, c.usdFoil, foil)
    lines.push({
      key, name: c.name, ...(c.scryfallId ? { scryfallId: c.scryfallId } : {}), ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
      ...(c.rarity ? { rarity: c.rarity } : {}), ...(c.number ? { number: c.number } : {}),
      need: c.qty, owned: counts.get(key) ?? 0, have: 0, missing: 0, usd,
    })
  }
  let have = 0
  let need = 0
  let missingUsd = 0
  let unpriced = 0
  const done = lines.map((l) => {
    const h = Math.min(l.owned, l.need)
    const missing = l.need - h
    have += h
    need += l.need
    if (missing > 0) { if (l.usd != null) missingUsd += missing * l.usd; else unpriced += missing }
    return { ...l, have: h, missing }
  })
  return {
    have, need,
    percent: need <= 0 ? 0 : Math.min(100, Math.floor((have * 100) / need)),
    missingUsd: cents(missingUsd),
    unpriced,
    complete: need > 0 && have >= need,
    lines: done,
  }
}

/** The cards still missing, in the goal's order. */
export function missingLines(p: GoalProgress): GoalLine[] {
  return p.lines.filter((l) => l.missing > 0)
}

/** "41/92 · 44%" */
export const progressLine = (p: GoalProgress) => `${p.have}/${p.need} · ${p.percent}%`

/** The line under a goal's bar: "51 missing · about $38.20" — or "Complete". [fmt] writes a US dollar amount in the user's currency. */
export function missingLine(p: GoalProgress, fmt: (usd: number) => string): string {
  if (p.complete) return 'Complete'
  if (p.need <= 0) return 'No cards yet'
  const n = p.need - p.have
  const value = p.missingUsd > 0 ? ` · about ${fmt(p.missingUsd)}${p.unpriced > 0 ? ' and more' : ''}` : ''
  return `${n} missing${value}`
}

// ---- Completed ----

/** Goals still open, most nearly done first (then by name); then the completed ones, most recent first. */
export function sortedGoals(goals: CollectionGoal[], progress: (g: CollectionGoal) => GoalProgress): { open: CollectionGoal[]; done: CollectionGoal[] } {
  const open = goals.filter((g) => g.completedAt == null)
    .map((g) => ({ g, p: progress(g) }))
    .sort((a, b) => b.p.percent - a.p.percent || (b.p.have - a.p.have) || (a.g.name.toLowerCase() < b.g.name.toLowerCase() ? -1 : a.g.name.toLowerCase() > b.g.name.toLowerCase() ? 1 : 0))
    .map((x) => x.g)
  const done = goals.filter((g) => g.completedAt != null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
  return { open, done }
}

/**
 * Goals that are complete now and weren't before: [goals] with each marked complete at [now], and
 * their ids (for the celebration). A goal already marked stays as it is; a goal with nothing to get
 * never completes. The change doesn't count as an edit (updatedAt stays), so it never outweighs one.
 */
export function completeGoals(goals: CollectionGoal[], collections: Collection[], decks: Deck[], now: number): { goals: CollectionGoal[]; done: string[] } {
  const done: string[] = []
  const next = goals.map((g) => {
    if (g.completedAt != null) return g
    if (!goalProgress(g, collections, decks).complete) return g
    done.push(g.id)
    return { ...g, completedAt: now }
  })
  return { goals: done.length ? next : goals, done }
}

// ---- The scanner ----

/** A goal a scanned card moves on: the goal's progress with that copy in. */
export interface GoalHit { id: string; name: string; have: number; need: number }

/**
 * The open goals a scanned card would move on: [pending] copies of it (this one included) are on
 * their way into the collection, and the last of them still fills a gap. Each with its progress
 * once those copies are in. A foil goal moves only for a foil copy.
 */
export function goalHits(goals: CollectionGoal[], collections: Collection[], decks: Deck[], card: { scryfallId: string; name: string }, foil: boolean, pending: number): GoalHit[] {
  const out: GoalHit[] = []
  for (const g of goals) {
    if (g.completedAt != null) continue
    if (g.foil === true && !foil) continue
    const key = goalCardKey(g, card)
    const p = goalProgress(g, collections, decks)
    const line = p.lines.find((l) => l.key === key)
    if (!line || line.owned + pending - 1 >= line.need) continue
    out.push({ id: g.id, name: g.name, have: p.have + Math.min(pending, line.need - line.have), need: p.need })
  }
  return out
}

/** "Goal: Duskmourn uncommons 41/92" */
export const hitLine = (h: GoalHit) => `Goal: ${h.name} ${h.have}/${h.need}`

// ---- Friends' Activity ----

/** A completed goal as friends' Activity shows it: its name, kind, how many cards it took and a card to show (a Scryfall id). */
export interface GoalActivity { goalId: string; name: string; kind: GoalKind; cards: number; cover: string | null }

/**
 * [goal], just completed, for friends' Activity: its copies as [p] counts them (all of them, as the
 * goal is complete) and the card to show — its most valuable printing with a known price, else its
 * first with a printing.
 */
export function goalActivityOf(goal: CollectionGoal, p: GoalProgress): GoalActivity {
  const printed = p.lines.filter((l) => !!l.scryfallId)
  const priced = printed.filter((l) => l.usd !== null)
  const cover = priced.length > 0 ? priced.reduce((best, l) => (l.usd! > best.usd! ? l : best)) : printed[0]
  return { goalId: goal.id, name: goal.name, kind: goal.kind, cards: p.need, cover: cover?.scryfallId ?? null }
}

// ---- Wishlist and trades ----

/** A missing card for the Wishlist: [quantity] copies wanted. */
export interface GoalWant { scryfallId: string; name: string; imageUrl: string | null; quantity: number }

/**
 * What "Add missing to Wishlist" adds: each missing card once by name (its printings' missing copies
 * together), as many copies as are missing — only where the Wishlist doesn't already want that many.
 */
export function goalWishlistAdds(p: GoalProgress, wishlist: CollectionEntry[]): GoalWant[] {
  const wanted = new Map<string, number>()
  for (const e of wishlist) wanted.set(goalNameKey(e.name), Math.max(wanted.get(goalNameKey(e.name)) ?? 0, e.quantity))
  const out = new Map<string, GoalWant>()
  for (const l of missingLines(p)) {
    const k = goalNameKey(l.name)
    const was = out.get(k)
    if (was) was.quantity += l.missing
    else out.set(k, { scryfallId: l.scryfallId ?? '', name: l.name, imageUrl: l.imageUrl ?? null, quantity: l.missing })
  }
  return [...out.values()].filter((w) => w.quantity > (wanted.get(goalNameKey(w.name)) ?? 0))
}

/** The missing cards' names, once each — what to ask friends for. */
export const missingNames = (p: GoalProgress): string[] => [...new Map(missingLines(p).map((l) => [goalNameKey(l.name), l.name])).values()]

// ---- Kept and synced ----

/** The user's goals, kept on the Unsorted pile. */
export const goalsOf = (collections: Collection[]): CollectionGoal[] => collections.find(isUnsorted)?.collectionGoals ?? []

/** [collections] with the goals set to [goals] (on the Unsorted pile, made if it isn't there). */
export function withGoals(collections: Collection[], goals: CollectionGoal[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, collectionGoals: goals.map(collectionGoal) } : c))
}

/** [collections] with [goal] added, or put in place of the one with its id. */
export function saveGoal(collections: Collection[], goal: CollectionGoal): Collection[] {
  const list = goalsOf(collections)
  return withGoals(collections, list.some((g) => g.id === goal.id) ? list.map((g) => (g.id === goal.id ? goal : g)) : [...list, goal])
}

export const deleteGoal = (collections: Collection[], id: string): Collection[] => withGoals(collections, goalsOf(collections).filter((g) => g.id !== id))

/** The earlier of two completions; either may be missing. */
function firstDone(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}

/**
 * Merges two devices' goals: one added on either side is kept, one deleted on either side stays
 * deleted, and one changed on both goes to the more recent change (updatedAt; a tie to [minePreferred]'s
 * side) — as a whole, but completed if either side completed it (at the earlier time). Undefined when
 * no side has any.
 */
export function mergeGoals(base: CollectionGoal[] | undefined, mine: CollectionGoal[] | undefined, theirs: CollectionGoal[] | undefined, minePreferred: boolean): CollectionGoal[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((g) => [g.id, g]))
  const m = new Map((mine ?? []).map((g) => [g.id, g]))
  const t = new Map((theirs ?? []).map((g) => [g.id, g]))
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((id) => !b.has(id)).sort()
  const out: CollectionGoal[] = []
  for (const id of [...b.keys(), ...added]) {
    const bg = b.get(id)
    const mg = m.get(id)
    const tg = t.get(id)
    if (bg && (!mg || !tg)) continue
    let picked: CollectionGoal
    if (!mg || !tg) picked = (tg ?? mg)!
    else if (sameJson(mg, tg)) picked = mg
    else if (bg && sameJson(mg, bg)) picked = tg
    else if (bg && sameJson(tg, bg)) picked = mg
    else picked = mg.updatedAt > tg.updatedAt ? mg : tg.updatedAt > mg.updatedAt ? tg : minePreferred ? mg : tg
    const completedAt = firstDone(mg?.completedAt, tg?.completedAt)
    const { completedAt: _was, ...rest } = picked
    out.push(collectionGoal(completedAt != null ? { ...rest, completedAt } : rest))
  }
  return out
}

/**
 * [theirs] with [source]'s goals, when [theirs] was saved by an app that doesn't know about goals
 * (no "collectionGoals" key) — the same object otherwise.
 */
export function keepGoalsFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (theirs.collectionGoals !== undefined || source.collectionGoals === undefined || !isUnsorted(theirs)) return theirs
  return { ...theirs, collectionGoals: source.collectionGoals }
}

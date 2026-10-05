// Binder pages: a binder seen as it sits on the shelf — sheets of pockets, each sheet with a front
// and a back (page 1 is the front of sheet 1, page 2 its back, page 3 the front of sheet 2…) — and
// the rules for moving cards about in it:
//  - the pockets grid of a page (9 pockets: 3 × 3; 12: 3 × 4; 4: 2 × 2…) and a page's summary
//    ("DMU 12–98", "A–C", "Red · A–F");
//  - a binder's order, its sorting rule (StoragePlace.sortRule, as a box's: by set then number, A–Z,
//    by colour then A–Z, by type then A–Z);
//  - fitting new cards in that order (planFit): where each goes, which cards shift along to make room,
//    and the steps to do it by hand (fitSteps) — moves listed from the last card backwards, so a
//    pocket is always empty when a card goes into it;
//  - closing the gaps, and moving or swapping pockets by hand.
// A pocket is counted from 0 through the whole binder: page 1's pockets, then page 2's, and so on.
// Nothing new is kept: a copy's pocket is its line's "page" and "slot" (CopyPlace), as in round 1.
//
// Pure, so it can be tested. Mirrors the Android app's data/BinderPages.kt rule for rule, with the
// same tests (tests/collection/binderPages.test.ts ↔ BinderPagesTest.kt).

import type { Collection, SortRule, StoragePlace } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import {
  COLOUR_SECTIONS, TYPE_SECTIONS, cardFactsOf, cardsIn, colourSection, letterOf, moveCopies, placedCopies, pocketsOf, typeSection, withPlaces,
  type CardFacts, type PlacedCard,
} from './storagePlaces'

// ---- Pages and sheets ----

/** The sheet a page is printed on: pages 1 and 2 are sheet 1. */
export const sheetOf = (page: number): number => Math.ceil(page / 2)
/** Odd pages are a sheet's front, even pages its back. */
export const sideOf = (page: number): 'Front' | 'Back' => (page % 2 === 1 ? 'Front' : 'Back')
/** "Front of sheet 2". */
export const sideLabel = (page: number): string => `${sideOf(page)} of sheet ${sheetOf(page)}`

/** How a page's pockets are laid out: 9 → 3 × 3, 12 → 3 across and 4 down, 4 → 2 × 2, 8 → 2 × 4. */
export function pageGrid(pockets: number): { cols: number; rows: number } {
  const n = Math.max(1, Math.floor(pockets))
  let cols = 1
  for (let c = 1; c * c <= n; c++) if (n % c === 0) cols = c
  // A number with no good split (7, 11…) is laid out as near a square as it goes.
  if (cols === 1 && n > 3) cols = Math.ceil(Math.sqrt(n))
  return { cols, rows: Math.ceil(n / cols) }
}

/** A pocket counted through the whole binder, from 0. */
export const pocketIndex = (page: number, slot: number, pockets: number): number => (page - 1) * pockets + (slot - 1)
/** The page and slot (both from 1) of the pocket [index]. */
export const pocketAt = (index: number, pockets: number): { page: number; slot: number } =>
  ({ page: Math.floor(index / pockets) + 1, slot: (index % pockets) + 1 })

/** A pocket in use: where it is in the binder and the copies in it. */
export interface Pocket { index: number; cards: PlacedCard[] }

/** Whether a line sits in a pocket the binder's pages have (a slot past the page's pockets doesn't count). */
const inPocket = (line: { page?: number; slot?: number }, pockets: number) =>
  !!line.page && line.page > 0 && !!line.slot && line.slot > 0 && line.slot <= pockets

/** The binder's pockets in use, in order. [cards]: its cards (cardsIn). */
export function binderPockets(place: StoragePlace, cards: PlacedCard[]): Pocket[] {
  const pockets = pocketsOf(place)
  const byIndex = new Map<number, PlacedCard[]>()
  for (const c of cards) {
    if (!inPocket(c.line, pockets)) continue
    const i = pocketIndex(c.line.page!, c.line.slot!, pockets)
    byIndex.set(i, [...(byIndex.get(i) ?? []), c])
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, cards]) => ({ index, cards }))
}

/** The binder's copies that aren't in a pocket yet, one for each copy — the cards waiting to be fitted in. */
export function looseCopies(place: StoragePlace, cards: PlacedCard[]): PlacedCard[] {
  const pockets = pocketsOf(place)
  return cards.filter((c) => !inPocket(c.line, pockets)).flatMap((c) => Array.from({ length: c.line.qty }, () => c))
}

/** How many pages the binder shows: up to the last one used, at least one. */
export const pageCount = (place: StoragePlace, pockets: Pocket[]): number =>
  Math.max(1, ...pockets.map((p) => pocketAt(p.index, pocketsOf(place)).page))

// ---- The order ----

const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const nameKey = (f: CardFacts) => f.name.trim().toLowerCase()
/** A collector number as its number and what follows it: "12a" → 12, "a". Missing sorts last. */
function numberKey(n: string | null | undefined): [number, string] {
  const m = /^(\d{1,9})(.*)$/.exec((n ?? '').trim())
  return m ? [Number(m[1]), m[2].toLowerCase()] : [Number.MAX_SAFE_INTEGER, (n ?? '').trim().toLowerCase()]
}
const setKey = (f: CardFacts) => (f.set ? f.set.toLowerCase() : '￿')
function bySetNumber(a: CardFacts, b: CardFacts): number {
  const [na, sa] = numberKey(a.collectorNumber)
  const [nb, sb] = numberKey(b.collectorNumber)
  return text(setKey(a), setKey(b)) || na - nb || text(sa, sb)
}

/**
 * Which of two cards comes first in a binder sorted by [rule] (null: A–Z): by set code then collector
 * number, by name, by colour section (White … Lands) then name, or by type section then name.
 */
export function compareCards(rule: SortRule | null | undefined, a: CardFacts, b: CardFacts): number {
  switch (rule) {
    case 'SET': return bySetNumber(a, b) || text(nameKey(a), nameKey(b))
    case 'COLOUR': return COLOUR_SECTIONS.indexOf(colourSection(a)) - COLOUR_SECTIONS.indexOf(colourSection(b)) || text(nameKey(a), nameKey(b))
    case 'TYPE': return TYPE_SECTIONS.indexOf(typeSection(a)) - TYPE_SECTIONS.indexOf(typeSection(b)) || text(nameKey(a), nameKey(b))
    default: return text(nameKey(a), nameKey(b)) || bySetNumber(a, b)
  }
}

/** What's on a page, short: "DMU 12–98", "DMU 240 – ONE 12", "A–C", "Red · A–F", "Red to Green", "Empty". */
export function pageSummary(rule: SortRule | null | undefined, facts: CardFacts[]): string {
  if (facts.length === 0) return 'Empty'
  const sorted = [...facts].sort((a, b) => compareCards(rule, a, b))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const letters = letterOf(first.name) === letterOf(last.name) ? letterOf(first.name) : `${letterOf(first.name)}–${letterOf(last.name)}`
  if (rule === 'SET' && sorted.every((f) => f.set)) {
    const at = (f: CardFacts) => [f.set!.toUpperCase(), f.collectorNumber ?? ''].filter(Boolean).join(' ')
    if (first.set!.toLowerCase() !== last.set!.toLowerCase()) return `${at(first)} – ${at(last)}`
    const set = first.set!.toUpperCase()
    if (!first.collectorNumber || !last.collectorNumber) return set
    return first.collectorNumber === last.collectorNumber ? `${set} ${first.collectorNumber}` : `${set} ${first.collectorNumber}–${last.collectorNumber}`
  }
  if (rule === 'COLOUR' || rule === 'TYPE') {
    const section = rule === 'COLOUR' ? colourSection : typeSection
    const a = section(first)
    const b = section(last)
    return a === b ? `${a} · ${letters}` : `${a} to ${b}`
  }
  return letters
}

/** A card's facts for the order: from Scryfall when it's loaded, else just its name. */
export const factsFrom = (data: Map<string, ScryfallCard> | undefined) => (c: PlacedCard): CardFacts => {
  const card = data?.get(c.entry.scryfallId)
  return card ? cardFactsOf(card) : { name: c.entry.name }
}

/** "DMU 107 · foil": a copy's set and number, and whether it's foil. */
export function printingLine(card: { set?: string | null; collector_number?: string | null } | undefined, foil: boolean): string {
  return [card?.set ? `${card.set.toUpperCase()} ${card.collector_number ?? ''}`.trim() : '', foil ? 'foil' : ''].filter(Boolean).join(' · ')
}

// ---- Fitting new cards in order ----

/** One pocket's cards moved to another pocket. */
export interface PocketMove { from: number; to: number }

/** "Keep the order" shifts cards along to make room; "Fill gaps, no shifting" only uses empty pockets. */
export type FitMode = 'KEEP' | 'GAPS'

export interface FitPlan {
  /** The pockets in use that move, each once, from where it is now to where it ends up. */
  moves: PocketMove[]
  /** Where each new card goes: [item] is its place in the list of cards being added. */
  puts: { item: number; to: number }[]
}

type Slot = { old: number; facts: CardFacts } | { item: number; facts: CardFacts }

/**
 * Where [adding] go in a binder sorted by [rule] whose pockets in use are [occupied], and which cards
 * move to make room. Each new card goes after the last card that sorts the same or before it (so it's
 * stable: after the copies already there, and cards added together keep their order), in the first
 * pocket after that card. When there's no empty pocket there:
 *  - KEEP: the cards from there on shift one along up to the next empty pocket (pages that are full
 *    spill onto the next page) — or, when it moves fewer cards, the cards before it shift one back
 *    into the empty pocket before them;
 *  - GAPS: nothing moves, and it goes in the nearest empty pocket, after its place when that's as near.
 * Several cards are fitted one after another in order, each into the binder as the last one left it.
 */
export function planFit(rule: SortRule | null | undefined, occupied: { index: number; facts: CardFacts }[], adding: CardFacts[], mode: FitMode): FitPlan {
  const slots = new Map<number, Slot>()
  occupied.forEach((p, i) => slots.set(p.index, { old: i, facts: p.facts }))
  const order = adding.map((facts, item) => ({ facts, item })).sort((a, b) => compareCards(rule, a.facts, b.facts) || a.item - b.item)
  for (const x of order) {
    const keys = [...slots.keys()].sort((a, b) => a - b)
    const gi = keys.findIndex((k) => compareCards(rule, slots.get(k)!.facts, x.facts) > 0)
    const g = gi < 0 ? null : keys[gi]
    const before = gi < 0 ? keys : keys.slice(0, gi)
    const a = before.length > 0 ? before[before.length - 1] : -1
    let to: number
    if (g === null || g - a > 1) {
      to = a + 1
    } else {
      let ahead = g + 1
      while (slots.has(ahead)) ahead++
      let behind = a - 1
      while (behind >= 0 && slots.has(behind)) behind--
      const forward = ahead - g
      const back = behind >= 0 ? a - behind : Infinity
      if (mode === 'GAPS') {
        to = back < forward ? behind : ahead
      } else if (back < forward) {
        // The cards from the empty pocket behind up to a shift one back.
        for (let k = behind + 1; k <= a; k++) slots.set(k - 1, slots.get(k)!)
        slots.delete(a)
        to = a
      } else {
        // The cards from g up to the empty pocket ahead shift one along, the last first.
        for (let k = ahead - 1; k >= g; k--) slots.set(k + 1, slots.get(k)!)
        slots.delete(g)
        to = g
      }
    }
    slots.set(to, { item: x.item, facts: x.facts })
  }
  const moves: PocketMove[] = []
  const puts: { item: number; to: number }[] = []
  for (const [at, s] of slots) {
    if ('old' in s) {
      const from = occupied[s.old].index
      if (from !== at) moves.push({ from, to: at })
    } else puts.push({ item: s.item, to: at })
  }
  return { moves: moves.sort((a, b) => a.from - b.from), puts: puts.sort((a, b) => a.item - b.item) }
}

/** One step of the instructions: what to do, and a line under it. */
export interface FitStep { title: string; detail: string }

const WORDS = ['', 'one', 'two', 'three', 'four', 'five']
const howFar = (n: number) => `${WORDS[Math.abs(n)] ?? String(Math.abs(n))} ${n > 0 ? 'along' : 'back'}`
const at = (index: number, pockets: number) => { const { page, slot } = pocketAt(index, pockets); return `page ${page}, slot ${slot}` }

/**
 * The plan as steps to follow by hand. Cards moving back go first, from the first card on; then the
 * cards moving along and the new cards, from the last pocket backwards — so the pocket a card goes
 * into is always empty by then. Runs of cards moving the same way are one step ("Page 3: move slots
 * 5–7 one along", "Pages 4–5: move 11 cards one along"), and new cards going into one page together
 * are one step. [nameOf]: the card in a pocket in use now; [newCard]: a new card's name and its
 * line ("DMU 97 · foil").
 */
export function fitSteps(
  plan: FitPlan,
  pockets: number,
  nameOf: (index: number) => string,
  newCard: (item: number) => { name: string; detail: string },
): FitStep[] {
  type Event = { move: PocketMove } | { put: { item: number; to: number } }
  const back = plan.moves.filter((m) => m.to < m.from).sort((a, b) => a.from - b.from)
  const along: Event[] = [
    ...plan.moves.filter((m) => m.to > m.from).map((move) => ({ move })),
    ...plan.puts.map((put) => ({ put })),
  ].sort((a, b) => {
    const ka = 'move' in a ? a.move.from : a.put.to
    const kb = 'move' in b ? b.move.from : b.put.to
    return kb - ka || ('move' in a ? 0 : 1) - ('move' in b ? 0 : 1)
  })
  const events: Event[] = [...back.map((move) => ({ move })), ...along]
  const steps: FitStep[] = []
  let i = 0
  while (i < events.length) {
    const e = events[i]
    if ('move' in e) {
      const run = [e.move]
      const delta = e.move.to - e.move.from
      const step = delta > 0 ? -1 : 1
      while (i + run.length < events.length) {
        const next = events[i + run.length]
        if (!('move' in next)) break
        const prev = run[run.length - 1]
        if (next.move.from !== prev.from + step || next.move.to - next.move.from !== delta) break
        run.push(next.move)
      }
      i += run.length
      if (run.length === 1) {
        steps.push({ title: `Move ${nameOf(e.move.from)} from ${at(e.move.from, pockets)} to ${at(e.move.to, pockets)}`, detail: '' })
        continue
      }
      const froms = run.map((m) => m.from).sort((a, b) => a - b)
      const first = pocketAt(froms[0], pockets)
      const last = pocketAt(froms[froms.length - 1], pockets)
      const title = first.page === last.page
        ? `Page ${first.page}: move slots ${first.slot}–${last.slot} ${howFar(delta)}`
        : `Pages ${first.page}–${last.page}: move ${run.length} cards ${howFar(delta)}`
      steps.push({ title, detail: delta > 0 ? 'Starting from the last card, so nothing is in the way' : 'Starting from the first card, so nothing is in the way' })
    } else {
      const page = pocketAt(e.put.to, pockets).page
      const group = [e.put]
      while (i + group.length < events.length) {
        const next = events[i + group.length]
        if (!('put' in next) || pocketAt(next.put.to, pockets).page !== page) break
        group.push(next.put)
      }
      i += group.length
      if (group.length === 1) {
        const card = newCard(e.put.item)
        steps.push({ title: `Put ${card.name} in ${at(e.put.to, pockets)}`, detail: card.detail })
      } else {
        const lines = [...group].sort((a, b) => a.to - b.to).map((p) => `Slot ${pocketAt(p.to, pockets).slot}: ${newCard(p.item).name}`)
        steps.push({ title: `Put ${group.length} cards in page ${page}`, detail: lines.join(' · ') })
      }
    }
  }
  return steps
}

// ---- Moving pockets by hand ----

/** Closing the gaps: every pocket in use, in order, moved up to fill the empty pockets before it. */
export function closeGapsMoves(occupied: number[]): PocketMove[] {
  return [...occupied].sort((a, b) => a - b).map((from, to) => ({ from, to })).filter((m) => m.from !== m.to)
}

/** Dragging the pocket [from] to [to]: the pockets between shift over by one to make room. */
export function reorderMoves(from: number, to: number, occupied: Set<number>): PocketMove[] {
  if (from === to || !occupied.has(from)) return []
  if (!occupied.has(to)) return [{ from, to }]
  const moves: PocketMove[] = [{ from, to }]
  if (from < to) for (let k = from + 1; k <= to; k++) { if (occupied.has(k)) moves.push({ from: k, to: k - 1 }) }
  else for (let k = to; k < from; k++) { if (occupied.has(k)) moves.push({ from: k, to: k + 1 }) }
  return moves.sort((a, b) => a.from - b.from)
}

/** Swapping two pockets (either may be empty). */
export function swapMoves(a: number, b: number, occupied: Set<number>): PocketMove[] {
  if (a === b) return []
  return [...(occupied.has(a) ? [{ from: a, to: b }] : []), ...(occupied.has(b) ? [{ from: b, to: a }] : [])]
}

/** The moves that take [moves] back. */
export const undoMoves = (moves: PocketMove[]): PocketMove[] => moves.map((m) => ({ from: m.to, to: m.from }))

/** [collections] with the binder's pockets moved, all at once — every copy in a moved pocket goes with it. */
export function relocate(collections: Collection[], place: StoragePlace, moves: PocketMove[]): Collection[] {
  if (moves.length === 0) return collections
  const pockets = pocketsOf(place)
  const to = new Map(moves.map((m) => [m.from, m.to]))
  const moved = (e: Collection['entries'][number]) => placedCopies(e).some((l) => l.placeId === place.id && inPocket(l, pockets) && to.has(pocketIndex(l.page!, l.slot!, pockets)))
  return collections.map((c) => {
    if (c.type === 'WISHLIST' || !c.entries.some(moved)) return c
    return {
      ...c,
      entries: c.entries.map((e) => {
        if (!moved(e)) return e
        return withPlaces(e, placedCopies(e).map((l) => {
          if (l.placeId !== place.id || !inPocket(l, pockets)) return l
          const target = to.get(pocketIndex(l.page!, l.slot!, pockets))
          if (target === undefined) return l
          const { page, slot } = pocketAt(target, pockets)
          return { ...l, page, slot }
        }))
      }),
    }
  })
}

/** [collections] with a fit plan done: the pockets moved, then each new card ([items], loose copies) put in its pocket. */
export function applyFit(collections: Collection[], place: StoragePlace, plan: FitPlan, items: PlacedCard[]): Collection[] {
  const pockets = pocketsOf(place)
  let out = relocate(collections, place, plan.moves)
  for (const put of plan.puts) {
    const item = items[put.item]
    if (!item) continue
    const { page, slot } = pocketAt(put.to, pockets)
    out = out.map((c) => (c.id !== item.collectionId ? c : {
      ...c,
      entries: c.entries.map((e) => (e.scryfallId === item.entry.scryfallId ? moveCopies(e, item.line, { placeId: place.id, page, slot }, 1).entry : e)),
    }))
  }
  return out
}

/** The plan for fitting the binder's loose copies in order, with what it needs: its pockets and the cards. */
export function fitLooseCards(
  collections: Collection[], place: StoragePlace, factsOf: (c: PlacedCard) => CardFacts, mode: FitMode,
): { plan: FitPlan; items: PlacedCard[]; pockets: Pocket[] } {
  const cards = cardsIn(collections, place.id)
  const pockets = binderPockets(place, cards)
  const items = looseCopies(place, cards)
  const plan = planFit(place.sortRule, pockets.map((p) => ({ index: p.index, facts: factsOf(p.cards[0]) })), items.map(factsOf), mode)
  return { plan, items, pockets }
}

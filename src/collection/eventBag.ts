// Packing for an event: "Pack your bag" for tonight's game night, an event, or a quick "Pack for…"
// with a name and a day. A checklist in three sections —
//  - Decks: the decks chosen, each with the deck box it's in (gear.ts), or a warning when some of its
//    cards are out on loan ("Sol Ring lent to Sam", loans.ts);
//  - Tokens and extras: the tokens each deck's cards make, with how many (decks/tokens.ts
//    tokensToBring), the counters each deck asks for, and the dice and playmat from the gear;
//  - For trades: per person coming, the cards they want that are in a place ("3 cards Priya wants ·
//    Trade binder p4, p7", the same trade matches as Friends want these — social/friendsWant.ts), and
//    the cards borrowed from them to give back.
// The ticks are kept on this device only (bagStore.ts): a bag is for one trip, not worth syncing.
// "Coming home" re-checks the decks and extras that went out (what was traded or given back stays
// gone); "All packed" when every line is ticked.
//
// Pure, so it can be tested. Mirrors the Android app's data/EventBag.kt rule for rule, with the same
// tests (tests/collection/eventBag.test.ts ↔ EventBagTest.kt).

import type { Collection, Deck, GearItem, Loan } from '../types/models'
import { andList, sameToken, shortDeckName } from './gear'
import { isOpen, placesOf, stillOut, type PlacedCard } from './storagePlaces'
import { countersLabel, type TokenToBring } from '../decks/tokens'

export type BagSection = 'DECKS' | 'EXTRAS' | 'TRADES'
export const BAG_SECTION_LABELS: Record<BagSection, string> = { DECKS: 'Decks', EXTRAS: 'Tokens and extras', TRADES: 'For trades' }

/** A bag being packed (this device only). [day]: "2026-10-10". [home]: the lines ticked off coming home. */
export interface PackingBag {
  id: string
  name: string
  day: string
  /** Who's coming, by name. */
  attendees: string[]
  deckIds: string[]
  packed: string[]
  comingHome: boolean
  home: string[]
  createdAt: number
}

export interface BagLine {
  key: string
  section: BagSection
  title: string
  detail: string
  /** The detail is a warning (cards out on loan). */
  warn: boolean
}

/** One person's wants among the user's placed cards. */
export interface WantedBy { friend: string; cards: PlacedCard[] }
/** Cards borrowed from someone and not given back yet. */
export interface BorrowedFrom { from: string; cards: number }

export interface BagInput {
  /** The decks chosen, in order. */
  decks: Deck[]
  collections: Collection[]
  gear: GearItem[]
  /** Each deck's tokens to bring, by deck id; a deck not here is still loading (or has none). */
  tokens: Record<string, TokenToBring[]>
  /** Each deck's counters, by deck id (decks/tokens.ts countersNeeded). */
  counters: Record<string, string[]>
  wants: WantedBy[]
  borrowed: BorrowedFrom[]
  attendees: string[]
}

/** Whether [name] (a friend's display name) is one of [attendees]: the same, or one's first name of the other. */
export function isComing(name: string, attendees: string[]): boolean {
  const n = name.trim().toLowerCase()
  if (!n) return false
  return attendees.some((a) => {
    const x = a.trim().toLowerCase()
    return x !== '' && (x === n || n.startsWith(`${x} `) || x.startsWith(`${n} `))
  })
}

/** "Sol Ring lent to Sam", "Sol Ring and 2 more lent to Sam; Mana Crypt lent to Priya" — or null when none are out. */
export function lentFromDeckLine(deck: Deck, loans: Loan[]): string | null {
  const parts: string[] = []
  for (const loan of loans) {
    if (!isOpen(loan)) continue
    const names = [...new Set(loan.cards.filter((c) => c.deckId === deck.id && stillOut(c) > 0).map((c) => c.name))]
    if (names.length === 0) continue
    const what = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`
    parts.push(`${what} lent to ${loan.to}`)
  }
  return parts.length > 0 ? parts.join('; ') : null
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/** "Trade binder p4, p7, Red box" — where [cards] are, by place, with the binder pages. */
export function wantedWhereLine(cards: PlacedCard[], collections: Collection[]): string {
  const places = placesOf(collections)
  const byPlace = new Map<string, Set<number>>()
  for (const c of cards) {
    const pages = byPlace.get(c.line.placeId) ?? new Set<number>()
    if (c.line.page && c.line.page > 0) pages.add(c.line.page)
    byPlace.set(c.line.placeId, pages)
  }
  return [...byPlace.entries()].map(([id, pages]) => {
    const name = places.find((p) => p.id === id)?.name ?? 'A place'
    return pages.size > 0 ? `${name} ${[...pages].sort((a, b) => a - b).map((p) => `p${p}`).join(', ')}` : name
  }).join(', ')
}

/** "Dice, playmat": the dice and playmats in the gear — both when there are neither, as a reminder. */
export function extrasTitle(gear: GearItem[]): string {
  const dice = gear.some((g) => g.kind === 'DICE')
  const mat = gear.some((g) => g.kind === 'PLAYMAT')
  if (dice && !mat) return 'Dice'
  if (mat && !dice) return 'Playmat'
  return 'Dice, playmat'
}

/** Every line of the bag, section by section. */
export function bagLines(input: BagInput): BagLine[] {
  const loans = input.collections.find((c) => c.id === 'unsorted')?.loans ?? []
  const out: BagLine[] = []
  for (const deck of input.decks) {
    const lent = lentFromDeckLine(deck, loans)
    const box = input.gear.find((g) => g.kind === 'DECK_BOX' && g.holds === deck.id)
    out.push({
      key: `deck:${deck.id}`, section: 'DECKS', title: deck.name,
      detail: lent ?? (box ? `Deck box, ${lowerFirst(box.name)}` : ''), warn: lent !== null,
    })
  }
  // Each token once, as many as the deck needing most of it; for the decks that make it.
  const tokens: { name: string; count: number; for: string[] }[] = []
  for (const deck of input.decks) {
    for (const t of input.tokens[deck.id] ?? []) {
      const already = tokens.find((x) => sameToken(x.name, t.name))
      if (already) {
        already.count = Math.max(already.count, t.count)
        if (!already.for.includes(shortDeckName(deck))) already.for.push(shortDeckName(deck))
      } else {
        tokens.push({ name: t.name, count: t.count, for: [shortDeckName(deck)] })
      }
    }
  }
  for (const t of tokens) {
    out.push({ key: `token:${t.name.trim().toLowerCase()}`, section: 'EXTRAS', title: `${t.name} tokens ×${t.count}`, detail: `for ${andList(t.for)}`, warn: false })
  }
  for (const deck of input.decks) {
    const kinds = input.counters[deck.id] ?? []
    if (kinds.length > 0) out.push({ key: `counters:${deck.id}`, section: 'EXTRAS', title: countersLabel(kinds), detail: `for ${shortDeckName(deck)}`, warn: false })
  }
  out.push({ key: 'gear:extras', section: 'EXTRAS', title: extrasTitle(input.gear), detail: 'Gear', warn: false })
  const seen = new Set<string>()
  for (const w of input.wants) {
    if (!isComing(w.friend, input.attendees) || w.cards.length === 0) continue
    const key = `wants:${w.friend.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const n = w.cards.length
    out.push({ key, section: 'TRADES', title: `${n} ${n === 1 ? 'card' : 'cards'} ${w.friend} wants`, detail: wantedWhereLine(w.cards, input.collections), warn: false })
  }
  for (const b of input.borrowed) {
    if (!isComing(b.from, input.attendees) || b.cards <= 0) continue
    const key = `borrowed:${b.from.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, section: 'TRADES', title: `${b.from}'s borrowed cards`, detail: 'to give back', warn: false })
  }
  return out
}

// ---- Ticking ----

/** The lines coming home re-checks: the decks and extras that went out (trades and give-backs stay gone). */
export const homeLines = (bag: PackingBag, lines: BagLine[]): BagLine[] =>
  lines.filter((l) => l.section !== 'TRADES' && bag.packed.includes(l.key))

/** The lines shown: everything while packing, what went out when coming home. */
export const shownLines = (bag: PackingBag, lines: BagLine[]): BagLine[] => (bag.comingHome ? homeLines(bag, lines) : lines)

/** Whether [key] is ticked in the bag's current mode. */
export const isTicked = (bag: PackingBag, key: string): boolean => (bag.comingHome ? bag.home : bag.packed).includes(key)

/** [bag] with [key] ticked or unticked in its current mode. */
export function toggleTick(bag: PackingBag, key: string): PackingBag {
  const flip = (list: string[]) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key])
  return bag.comingHome ? { ...bag, home: flip(bag.home) } : { ...bag, packed: flip(bag.packed) }
}

/** [bag] with every shown line ticked — "All packed". */
export function tickAll(bag: PackingBag, lines: BagLine[]): PackingBag {
  const keys = shownLines(bag, lines).map((l) => l.key)
  return bag.comingHome ? { ...bag, home: [...new Set([...bag.home, ...keys])] } : { ...bag, packed: [...new Set([...bag.packed, ...keys])] }
}

/** Whether every shown line is ticked. */
export const allTicked = (bag: PackingBag, lines: BagLine[]): boolean => shownLines(bag, lines).every((l) => isTicked(bag, l.key))

/** [bag] switched to coming home (nothing ticked off yet), or back to packing. */
export const setComingHome = (bag: PackingBag, on: boolean): PackingBag => ({ ...bag, comingHome: on, ...(on && !bag.comingHome ? { home: [] } : {}) })

/** What went out and isn't back yet — the coming-home diff. */
export const stillAway = (bag: PackingBag, lines: BagLine[]): BagLine[] => homeLines(bag, lines).filter((l) => !bag.home.includes(l.key))

/** "Everything came back." / "Still to come back: Atraxa and Goblin tokens ×20." */
export function homeSummary(bag: PackingBag, lines: BagLine[]): string {
  const away = stillAway(bag, lines)
  if (away.length === 0) return 'Everything came back.'
  return `Still to come back: ${andList(away.map((l) => l.title))}.`
}

// ---- The day ----

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const utc = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) }

/** "Today", "Tomorrow", "Saturday" (within the week), else "12 Oct" — for [day] seen from [today]. */
export function dayLabel(day: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
  const diff = Math.round((utc(day) - utc(today)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  const date = new Date(utc(day))
  if (diff > 1 && diff < 7) return WEEKDAYS[date.getUTCDay()]
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** "Saturday · Game night at Priya's". */
export const bagHeading = (bag: PackingBag, today: string): string => `${dayLabel(bag.day, today)} · ${bag.name}`

/** A new bag: nothing ticked yet. */
export function newBag(id: string, name: string, day: string, attendees: string[], deckIds: string[], now: number): PackingBag {
  return {
    id, name: name.trim() || 'Game night', day,
    attendees: [...new Set(attendees.map((a) => a.trim()).filter(Boolean))],
    deckIds: [...new Set(deckIds)], packed: [], comingHome: false, home: [], createdAt: now,
  }
}

/** "Priya, Sam" typed in: the names. */
export const namesFrom = (text: string): string[] => text.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)

/** Bags kept: the newest few. */
export const MAX_BAGS = 12

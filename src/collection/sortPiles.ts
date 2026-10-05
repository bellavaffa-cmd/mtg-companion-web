// Sorting a new pile with the scanner: up to six piles, each defined by a rule, checked in order —
// "Rares and mythics worth over $2 → Rares binder", "Spares (more than 4 owned) → Trade binder",
// "Wanted by a deck", and "Bulk: everything else → the box whose sorting rule fits". Each card scanned
// gets the first pile whose rule fits it (Bulk only when no other does), shown big and coloured with
// where that pile goes; the session tallies the piles, and "Done: file every pile" adds every card to
// the collection at its pile's place (addedHere — or, for cards already owned, putAway — in
// storagePlaces.ts).
//
// The rules are kept on this device (sortSession.ts), as is the session until it's filed.
//
// Pure, so it can be tested. Mirrors the Android app's data/SortPiles.kt rule for rule, with the same
// tests (tests/collection/sortPiles.test.ts ↔ SortPilesTest.kt).

import type { Collection, CollectionEntry, Deck } from '../types/models'
import { missingCards } from '../decks/missing'
import { realCopiesOf, withUnsortedPile } from './unsorted'
import { addedHere, placePath, placesOf, placeTree, putAway, sameCardName, suggestSpot, type CardFacts, type PutAwayStep, type Spot } from './storagePlaces'
import { bestPlaceByRule } from './pullList'
import { isUnsorted } from '../types/models'

export type PileKind = 'VALUE' | 'PRICE' | 'SPARES' | 'WANTED' | 'BULK'
export const PILE_KINDS: PileKind[] = ['VALUE', 'PRICE', 'SPARES', 'WANTED', 'BULK']

/** A pile's destination meaning "the box whose sorting rule fits the card". */
export const BY_RULE = 'RULE'
export const MAX_PILES = 6
export const MIN_PILES = 1

/**
 * One pile: what goes in it and where it goes. [over]: VALUE and PRICE — worth more than this, in US
 * dollars. [keep]: SPARES — copies owned beyond this many. [to]: a place's id, BY_RULE, or left out:
 * no place (the Unsorted pile). The Android app's PileRule, field for field.
 */
export interface PileRule {
  kind: PileKind
  over?: number
  keep?: number
  to?: string
}

/** The four piles a first sort starts with: rares to a binder, bulk by the boxes' rules, spares to a trade binder, wanted by a deck. */
export function defaultPiles(collections: Collection[]): PileRule[] {
  const binders = placeTree(placesOf(collections)).map((n) => n.place).filter((p) => p.kind === 'BINDER')
  const trade = binders.find((p) => /trade/i.test(p.name))
  const rares = binders.find((p) => p !== trade && /rare|mythic|value|good/i.test(p.name)) ?? binders.find((p) => p !== trade)
  return [
    { kind: 'VALUE', over: 2, ...(rares ? { to: rares.id } : {}) },
    { kind: 'BULK', to: BY_RULE },
    { kind: 'SPARES', keep: 4, ...(trade ? { to: trade.id } : {}) },
    { kind: 'WANTED' },
  ]
}

/** A pile as both apps keep it: only the fields its kind uses. */
export function pileRule(r: PileRule): PileRule {
  return {
    kind: PILE_KINDS.includes(r.kind) ? r.kind : 'BULK',
    ...((r.kind === 'VALUE' || r.kind === 'PRICE') ? { over: Math.max(0, r.over ?? 0) } : {}),
    ...(r.kind === 'SPARES' ? { keep: Math.max(0, Math.round(r.keep ?? 4)) } : {}),
    ...(r.to ? { to: r.to } : {}),
  }
}

/** "Rares and mythics over $2", "Spares over 4", "Wanted by a deck", "Bulk". [fmt] writes a dollar amount. */
export function pileTitle(r: PileRule, fmt: (usd: number) => string): string {
  switch (r.kind) {
    case 'VALUE': return `Rares and mythics over ${fmt(r.over ?? 0)}`
    case 'PRICE': return `Any card over ${fmt(r.over ?? 0)}`
    case 'SPARES': return `Spares over ${r.keep ?? 4}`
    case 'WANTED': return 'Wanted by a deck'
    default: return 'Bulk: everything else'
  }
}

/** Where a pile goes, in words: a place's name, "The box whose rule fits", or "No place (Unsorted)". */
export function pileGoesTo(r: PileRule, collections: Collection[]): string {
  if (r.to === BY_RULE) return 'The box whose rule fits'
  const place = r.to ? placesOf(collections).find((p) => p.id === r.to) : undefined
  return place ? place.name : 'No place (Unsorted)'
}

// ---- What each card is ----

/** What a pile's rule needs to know of a scanned card. */
export interface SortFacts {
  name: string
  /** "common", "uncommon", "rare", "mythic", "special"… as Scryfall says. */
  rarity?: string | null
  /** Its price in US dollars, when known. */
  usd?: number | null
  /** Copies owned before this one: the collection's and the ones scanned before it this session. */
  owned: number
  /** Decks that still want it — on their Considering list, or missing from them. Empty: none. */
  wantedBy: string[]
}

/** The pile a card goes in: its index, why in a few words, and the decks wanting it (the Wanted pile). */
export interface PileChoice { index: number; why: string; decks: string[] }

/** The pile a card goes in; null when no rule takes it. */
export function pileFor(rules: PileRule[], f: SortFacts): PileChoice | null {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]
    const usd = f.usd ?? null
    if (r.kind === 'VALUE' && (f.rarity === 'rare' || f.rarity === 'mythic') && usd !== null && usd > (r.over ?? 0)) return { index: i, why: 'Worth keeping safe', decks: [] }
    if (r.kind === 'PRICE' && usd !== null && usd > (r.over ?? 0)) return { index: i, why: 'Worth keeping safe', decks: [] }
    if (r.kind === 'SPARES' && f.owned >= (r.keep ?? 4)) return { index: i, why: `You have ${f.owned} already`, decks: [] }
    if (r.kind === 'WANTED' && f.wantedBy.length > 0) return { index: i, why: `For ${f.wantedBy.join(', ')}`, decks: f.wantedBy }
  }
  const bulk = rules.findIndex((r) => r.kind === 'BULK')
  return bulk >= 0 ? { index: bulk, why: 'Bulk', decks: [] } : null
}

const key = (name: string) => name.trim().toLowerCase().split(' // ')[0].trim()

/** Copies of each card owned (by name): the binders' and the Unsorted pile's, and physical decks' real ones. */
export function ownedCounts(collections: Collection[], decks: Deck[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) out.set(key(e.name), (out.get(key(e.name)) ?? 0) + e.quantity + (e.foilQuantity ?? 0))
  }
  for (const d of decks) for (const e of realCopiesOf(d)) out.set(key(e.name), (out.get(key(e.name)) ?? 0) + e.quantity)
  return out
}

/** Cards decks want, by name: the decks, and how many copies they want between them. */
export function wantedByDecks(collections: Collection[], decks: Deck[]): Map<string, { decks: string[]; qty: number }> {
  const out = new Map<string, { decks: string[]; qty: number }>()
  const want = (name: string, deck: string, qty: number) => {
    const w = out.get(key(name)) ?? { decks: [], qty: 0 }
    if (!w.decks.includes(deck)) w.decks.push(deck)
    w.qty += qty
    out.set(key(name), w)
  }
  for (const d of decks) {
    for (const e of missingCards(d, collections, decks)) want(e.name, d.name, e.quantity)
    for (const e of d.considering ?? []) want(e.name, d.name, 1)
  }
  return out
}

// ---- A session ----

/** One card scanned while sorting. [entry]: the card as a new binder entry with no copies yet. */
export interface SortScan {
  id: number
  scryfallId: string
  name: string
  rarity?: string | null
  usd?: number | null
  facts: CardFacts
  entry: CollectionEntry
  /** Its pile's index; -1: no pile. */
  pile: number
  why: string
  /** The decks wanting it, when it's in the Wanted pile. */
  decks?: string[]
}

/** A sort under way: the pile's source ("Booster box, Duskmourn"), its rules and its scans, newest last. */
export interface SortSession {
  source: string
  rules: PileRule[]
  /** The cards are new to the collection (a booster box) — or already in it (a pile to tidy). */
  newCards: boolean
  scans: SortScan[]
}

/**
 * The pile for one more card of [session], given the collection's [owned] counts and what decks
 * [wanted] (see ownedCounts, wantedByDecks): copies scanned earlier this session count as owned
 * when the cards are new, and copies already in the Wanted pile come off what decks want.
 */
export function nextPile(session: SortSession, card: { name: string; rarity?: string | null; usd?: number | null }, owned: Map<string, number>, wanted: Map<string, { decks: string[]; qty: number }>): PileChoice | null {
  const before = session.scans.filter((s) => sameCardName(s.name, card.name))
  const w = wanted.get(key(card.name))
  const takenForDecks = before.filter((s) => session.rules[s.pile]?.kind === 'WANTED').length
  return pileFor(session.rules, {
    name: card.name,
    rarity: card.rarity,
    usd: card.usd,
    owned: (owned.get(key(card.name)) ?? 0) + (session.newCards ? before.length : 0),
    wantedBy: w && w.qty > takenForDecks ? w.decks : [],
  })
}

/** Each pile's count, value (US dollars) and the decks its cards are for. */
export interface PileTally { index: number; cards: number; usd: number; decks: string[] }

export function pileTallies(session: SortSession): PileTally[] {
  return session.rules.map((r, index) => {
    const scans = session.scans.filter((s) => s.pile === index)
    const decks = r.kind === 'WANTED' ? [...new Set(scans.flatMap((s) => s.decks ?? []))] : []
    return { index, cards: scans.length, usd: scans.reduce((n, s) => n + (s.usd ?? 0), 0), decks }
  })
}

/** Where a card in pile [rule] goes: a spot in a place, or null — no place. And that in words. */
export function pileDestination(rule: PileRule | undefined, facts: CardFacts, collections: Collection[]): { spot: Spot | null; label: string } {
  const places = placesOf(collections)
  if (rule?.to === BY_RULE) {
    const best = bestPlaceByRule(places, facts, collections)
    if (!best) return { spot: null, label: 'No place yet' }
    return { spot: best.spot, label: [placePath(places, best.place.id), best.spot.section].filter(Boolean).join(' › ') }
  }
  const place = rule?.to ? places.find((p) => p.id === rule.to) : undefined
  if (!place) return { spot: null, label: 'No place yet' }
  const { spot } = suggestSpot(place, facts, collections)
  return { spot, label: [placePath(places, place.id), spot.section].filter(Boolean).join(' › ') }
}

/** What filing did: the collection after, a step per card put in a place (for history), and how many. */
export interface FiledPiles {
  collections: Collection[]
  steps: { scan: SortScan; step: PutAwayStep | null; to: string }[]
  added: number
}

/**
 * "Done: file every pile": every card scanned goes into the collection at its pile's place. New cards
 * are added to the Unsorted pile (kept at that place, or with no place); cards already owned are put
 * away there as the put-away scanner does (a copy with no place first, then one from another place).
 */
export function fileEveryPile(collections: Collection[], session: SortSession): FiledPiles {
  let out = collections
  const steps: FiledPiles['steps'] = []
  let added = 0
  for (const scan of session.scans) {
    const { spot, label } = pileDestination(session.rules[scan.pile], scan.facts, out)
    if (session.newCards) {
      if (spot) {
        const r = addedHere(out, { id: scan.scryfallId }, spot, scan.entry)
        out = r.collections
        steps.push({ scan, step: r.step, to: label })
      } else {
        out = withUnsortedPile(out).map((c) => {
          if (!isUnsorted(c)) return c
          const had = c.entries.find((e) => e.scryfallId === scan.scryfallId)
          return {
            ...c,
            entries: had
              ? c.entries.map((e) => (e === had ? { ...e, quantity: e.quantity + 1 } : e))
              : [...c.entries, { ...scan.entry, scryfallId: scan.scryfallId, quantity: 1, foilQuantity: 0 }],
          }
        })
        steps.push({ scan, step: null, to: label })
      }
      added++
    } else if (spot) {
      const r = putAway(out, { id: scan.scryfallId, name: scan.name }, spot, scan.entry)
      out = r.collections
      if (r.result === 'new') added++
      steps.push({ scan, step: r.step, to: label })
    }
  }
  return { collections: out, steps, added }
}

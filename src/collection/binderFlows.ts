// Copies moving between binders and decks, keeping binders as views (binderViews.ts) true:
//  - Into a deck out of a binder (sent from it, a proxy swapped for it, pulled with the pull list): the
//    copies leave the binder as before, and the deck's card is sorted into that binder
//    (DeckCardEntry.binders += { binder, n, foil }) — so the binder still lists it, "In Talrand deck".
//    Where they were kept goes on the deck (Deck.cameFrom). Out of No binder: no ref, the place noted.
//  - Out of a deck (its count down, the card taken out, the deck deleted keeping its cards, or no
//    longer counting its cards as owned): the copies in no binder leave first, back to No binder; then
//    the ones sorted into a binder, the last ref first, back into THAT binder as its own loose copies —
//    a binder that's gone, No binder — each to the spot it came from (Deck.cameFrom) while that place is
//    still there. The card's refs are cut to what it still holds.
//  - A binder deleted: its own copies go with it; deck copies stay in their decks, now in No binder.
// No copy is made or lost: what's owned and what it's worth (ownedCopies.ts) never change, and the views
// still add up to All cards' real copies. Mirrors the Android app's data/BinderFlows.kt (shared cases:
// tests/collection/returnToBinderVectors.json).

import { UNSORTED_COLLECTION_ID, ownershipOf, type CameFrom, type Collection, type CollectionEntry, type CopyPlace, type Deck, type DeckCardEntry } from '../types/models'
import { binderRef, foilsOf, type BinderRef } from '../decks/binderRefs'
import { proxyCopies } from '../decks/proxies'
import { assignedCopies, sortingBinderIds } from './binderCore'
import { countsAsOwned, ownedCopies } from './ownedCopies'
import { cameFromLine, tidyCameFrom } from './pullList'
import { copyKey, copyPlace, moveCopies, placeCopies, placesOf, sameCardName, splitPlaces, tidied } from './storagePlaces'
import { pileEntryOf, withUnsortedPile } from './unsorted'

const nameKey = (name: string) => name.trim().toLowerCase()
const sum = (refs: BinderRef[]) => refs.reduce((n, r) => n + r.qty, 0)

/** The real copies [deck] holds that are the user's own, all its cards together (ownedCopies). */
export const heldCopies = (deck: Deck): number => deck.cards.reduce((n, e) => n + ownedCopies(deck, e), 0)

/** [refs] with [add] put in at the end: the same binder's counts added up. */
export function withRef(refs: BinderRef[], add: BinderRef): BinderRef[] {
  if (add.qty <= 0) return refs
  const at = refs.findIndex((r) => r.id === add.id)
  if (at < 0) return [...refs, add]
  return refs.map((r, i) => (i === at ? binderRef(r.id, r.qty + add.qty, foilsOf(r) + foilsOf(add)) : r))
}

const sameRefs = (a: BinderRef[] | null | undefined, b: BinderRef[]) => JSON.stringify(a ?? null) === JSON.stringify(b)

/** [deck] with each of the cards [ids] (all, when undefined) whose binders are set tidied to the copies it holds (assignedCopies); the same deck when they are. */
export function tidiedRefs(deck: Deck, ids?: Set<string>): Deck {
  let changed = false
  const cards = deck.cards.map((e) => {
    if ((ids && !ids.has(e.scryfallId)) || e.binders == null) return e
    const tidy = assignedCopies(deck, e)
    if (sameRefs(e.binders, tidy)) return e
    changed = true
    return { ...e, binders: tidy }
  })
  return changed ? { ...deck, cards } : deck
}

/**
 * Whether copies sent out of a binder into a deck's main list leave the binder: only into a deck whose
 * cards count as owned (Physical or Proxy, not a cube or a sample). Any other deck only lists the card,
 * the copies staying where they are.
 */
export const copiesMoveInto = (deck: Deck | undefined | null): boolean => (deck ? countsAsOwned(deck) : true)

/**
 * [deck] with [entry]'s copies — [entry].quantity of them, [foil] of those foil — come out of the
 * collection [from]: added to the main deck (to the card's entry when it has one), as real copies even
 * in a Proxy deck; sorted into [from] when it's a binder deck copies can be sorted into ([valid]) —
 * never No binder or a wishlist; and [came], where they were kept, noted on the deck (Deck.cameFrom).
 * A deck whose cards don't count as owned just gets the card.
 */
export function withCopiesFromBinder(deck: Deck, entry: DeckCardEntry, from: string | null, foil: number, came: CameFrom[], valid: Set<string>): Deck {
  const n = entry.quantity
  if (n <= 0) return deck
  const existing = deck.cards.find((c) => c.scryfallId === entry.scryfallId)
  const owned = countsAsOwned(deck)
  const base: DeckCardEntry = existing ?? (() => { const { binders: _b, proxyQuantity: _p, ...rest } = entry; return { ...rest, quantity: 0 } })()
  let next: DeckCardEntry = { ...base, quantity: base.quantity + n }
  // In a Proxy deck a card is all proxies unless it says otherwise: these copies are real.
  if (owned && ownershipOf(deck) === 'PROXY') next = { ...next, proxyQuantity: proxyCopies(deck, base) }
  if (owned && from !== null && valid.has(from)) {
    const current = existing ? assignedCopies(deck, existing) : []
    next = { ...next, binders: withRef(current, binderRef(from, n, foil)) }
  }
  const cards = existing ? deck.cards.map((c) => (c.scryfallId === entry.scryfallId ? next : c)) : [...deck.cards, next]
  const withCame = owned && came.some((l) => l.qty > 0) ? { cameFrom: tidyCameFrom([...(deck.cameFrom ?? []), ...came]) } : {}
  return tidiedRefs({ ...deck, cards, ...withCame }, new Set([entry.scryfallId]))
}

/** A card coming out of a binder into a deck: [entry] with its count, [foil] of them foil, and where they were kept ([came]). */
export interface FromBinder { entry: DeckCardEntry; foil: number; came: CameFrom[] }

/** Where [entry]'s [plain] and [foil] copies going out of their binder were kept, as cameFrom lines (splitPlaces: no place first, then the last). */
export const cameFromOf = (entry: CollectionEntry, plain: number, foil: number): CameFrom[] =>
  splitPlaces(entry, plain, foil).going.map((l) => cameFromLine(entry.name, l))

/** Copies of a deck card going back into one collection ([collectionId]; the Unsorted pile is No binder), and the spots they go to. */
export interface CopiesBack {
  collectionId: string
  entry: DeckCardEntry
  plain: number
  foil: number
  /** Where some of them go (CopyPlace lines, foil ones marked); the rest have no place. */
  spots: CopyPlace[]
}

/** What [returnCopies] did. */
export interface ReturnResult {
  collections: Collection[]
  /** The deck after, its cards' binders and cameFrom brought up to date; null when it's gone. */
  deck: Deck | null
  back: CopiesBack[]
  /** Each card's refs left, before they're cut to the deck after (applyReturned does that). */
  refs: Map<string, BinderRef[]>
  /** The cameFrom lines the copies took with them. */
  used: CameFrom[]
}

/** Copies back in the collection. */
export const copiesBack = (r: ReturnResult): number => r.back.reduce((n, b) => n + b.plain + b.foil, 0)

/** [before] with the main-deck card [scryfallId] at [quantity] copies (gone at 0). */
export function withCardCount(before: Deck, scryfallId: string, quantity: number): Deck {
  return quantity <= 0
    ? { ...before, cards: before.cards.filter((c) => c.scryfallId !== scryfallId) }
    : { ...before, cards: before.cards.map((c) => (c.scryfallId === scryfallId ? { ...c, quantity } : c)) }
}

interface Chunk { entry: DeckCardEntry; to: string; plain: number; foil: number; bound: boolean; lines: CameFrom[] }

/**
 * The deck going from [before] to [after] (null: deleted, its cards kept): each card's owned copies it
 * no longer holds go back into the collection — the ones in no binder first, to No binder; then the
 * ones sorted into a binder, the last ref first, back into that binder (No binder when it's gone),
 * plain copies before foil. Each takes a spot it came from (Deck.cameFrom, the last line first): copies
 * going back to a binder first, then those going to No binder — only lines more than the copies still
 * sorted into a binder can claim. A spot in a place that's gone is no place.
 */
export function returnCopies(collections: Collection[], before: Deck, after: Deck | null): ReturnResult {
  const valid = sortingBinderIds(collections)
  const placeIds = new Set(placesOf(collections).map((p) => p.id))
  const chunks: Chunk[] = []
  const refs = new Map<string, BinderRef[]>()
  for (const e of before.cards) {
    const owned = ownedCopies(before, e)
    const e2 = after?.cards.find((c) => c.scryfallId === e.scryfallId)
    const stays = after && e2 ? ownedCopies(after, e2) : 0
    const leave = owned - stays
    if (leave <= 0) continue
    const left = [...assignedCopies(before, e)]
    const loose = Math.min(leave, owned - sum(left))
    if (loose > 0) chunks.push({ entry: e, to: UNSORTED_COLLECTION_ID, plain: loose, foil: 0, bound: false, lines: [] })
    let rest = leave - loose
    for (let i = left.length - 1; i >= 0 && rest > 0; i--) {
      const r = left[i]
      const take = Math.min(rest, r.qty)
      const foil = Math.max(0, take - (r.qty - foilsOf(r)))
      rest -= take
      left[i] = binderRef(r.id, r.qty - take, foilsOf(r) - foil)
      chunks.push({ entry: e, to: valid.has(r.id) ? r.id : UNSORTED_COLLECTION_ID, plain: take - foil, foil, bound: true, lines: [] })
    }
    if (e.binders != null) refs.set(e.scryfallId, left.filter((r) => r.qty > 0))
  }

  // Where they were kept: the deck's cameFrom, the last line first.
  const pool = (before.cameFrom ?? []).map((l) => ({ ...l }))
  const used: CameFrom[] = []
  const claim = (c: Chunk, foil: boolean | null, want: number) => {
    let got = 0
    for (let i = pool.length - 1; i >= 0 && got < want; i--) {
      const l = pool[i]
      if (l.qty <= 0 || !sameCardName(l.name, c.entry.name) || (foil !== null && !!l.foil !== foil)) continue
      const take = Math.min(l.qty, want - got)
      pool[i] = { ...l, qty: l.qty - take }
      const line = { ...l, qty: take }
      used.push(line)
      c.lines.push(line)
      got += take
      // A copy in no binder that came out of a foil spot goes back a foil.
      if (foil === null && l.foil) { c.plain -= take; c.foil += take }
    }
  }
  for (const c of chunks) if (c.bound) { claim(c, true, c.foil); claim(c, false, c.plain) }
  // A line the copies still sorted into a binder could have come with stays theirs.
  const staying = new Map<string, number>()
  if (after) for (const e2 of after.cards) {
    const kept = sum(assignedCopies(after, { ...e2, binders: refs.get(e2.scryfallId) ?? e2.binders }))
    if (kept > 0) staying.set(nameKey(e2.name), (staying.get(nameKey(e2.name)) ?? 0) + kept)
  }
  for (const c of chunks) {
    if (c.bound) continue
    const lines = pool.filter((l) => l.qty > 0 && sameCardName(l.name, c.entry.name)).reduce((n, l) => n + l.qty, 0)
    const spare = lines - (staying.get(nameKey(c.entry.name)) ?? 0)
    if (spare > 0) claim(c, null, Math.min(spare, c.plain))
  }

  let cols = chunks.some((c) => c.to === UNSORTED_COLLECTION_ID && c.plain + c.foil > 0) ? withUnsortedPile(collections) : collections
  const back: CopiesBack[] = []
  for (const c of chunks) {
    if (c.plain + c.foil <= 0) continue
    const spots = c.lines.filter((l) => placeIds.has(l.placeId)).map((l) => copyPlace(l, l.qty, !!l.foil))
    const b: CopiesBack = { collectionId: c.to, entry: c.entry, plain: c.plain, foil: c.foil, spots }
    back.push(b)
    cols = cols.map((col) => (col.id !== c.to ? col : { ...col, entries: intoCollection(col.entries, b) }))
  }
  const result: ReturnResult = { collections: cols, deck: null, back, refs, used }
  return { ...result, deck: after ? applyReturned(after, result) : null }
}

/** [entries] with [back]'s copies put in, at their spots: added to the printing's entry when there is one. */
function intoCollection(entries: CollectionEntry[], back: CopiesBack): CollectionEntry[] {
  const at = entries.findIndex((e) => e.scryfallId === back.entry.scryfallId)
  let e: CollectionEntry = at >= 0
    ? tidied({ ...entries[at], quantity: entries[at].quantity + back.plain, foilQuantity: (entries[at].foilQuantity ?? 0) + back.foil })
    : { ...pileEntryOf(back.entry, back.plain), foilQuantity: back.foil }
  for (const s of back.spots) e = placeCopies(e, s, s.qty, !!s.foil).entry
  return at >= 0 ? entries.map((x, i) => (i === at ? e : x)) : [...entries, e]
}

/**
 * [deck] (as it is now) with what [r] did: its cards' binders cut to what's left of them and to the
 * copies they hold, and the cameFrom lines the copies took gone.
 */
export function applyReturned(deck: Deck, r: ReturnResult): Deck {
  let changed = false
  const cards = deck.cards.map((e) => {
    const refs = r.refs.get(e.scryfallId)
    if (!refs) return e
    changed = true
    return { ...e, binders: refs }
  })
  const cameFrom = deck.cameFrom === undefined || r.used.length === 0 ? deck.cameFrom : withoutLines(deck.cameFrom, r.used)
  const next = changed || cameFrom !== deck.cameFrom ? { ...deck, cards, ...(cameFrom !== undefined ? { cameFrom } : {}) } : deck
  return tidiedRefs(next, new Set(r.refs.keys()))
}

/** [lines] less [used], line by line (the same card, spot and finish). */
function withoutLines(lines: CameFrom[], used: CameFrom[]): CameFrom[] {
  const out = lines.map((l) => ({ ...l }))
  for (const u of used) {
    let want = u.qty
    for (let i = out.length - 1; i >= 0 && want > 0; i--) {
      const l = out[i]
      if (l.qty <= 0 || !sameCardName(l.name, u.name) || copyKey(l) !== copyKey(u)) continue
      const take = Math.min(want, l.qty)
      out[i] = { ...l, qty: l.qty - take }
      want -= take
    }
  }
  return tidyCameFrom(out)
}

/** Undo of [returnCopies]'s copies back in the collection: [back] taken out of [collections] again, spots and all. */
export function takeBack(collections: Collection[], back: CopiesBack[]): Collection[] {
  let cols = collections
  for (const b of back) {
    cols = cols.map((c) => (c.id !== b.collectionId ? c : {
      ...c,
      entries: c.entries.flatMap((e) => {
        if (e.scryfallId !== b.entry.scryfallId) return [e]
        let x = e
        for (const s of b.spots) x = moveCopies(x, s, null, s.qty).entry
        x = tidied({ ...x, quantity: Math.max(0, x.quantity - b.plain), foilQuantity: Math.max(0, (x.foilQuantity ?? 0) - b.foil) })
        return x.quantity + (x.foilQuantity ?? 0) > 0 ? [x] : []
      }),
    }))
  }
  return cols
}

/**
 * Where a deck card's owned copies go when the put-back list takes the deck apart (takeApart), in the
 * order its rows take them: each ref's, the last first, to its binder (No binder when [valid] doesn't
 * have it) — so the rows going back to where a card came from go to its binder — then the ones in no
 * binder, to No binder.
 */
export function putBackOrder(deck: Deck, entry: DeckCardEntry, valid: Set<string>): [string, number][] {
  const owned = ownedCopies(deck, entry)
  const refs = assignedCopies(deck, entry)
  const out: [string, number][] = []
  for (let i = refs.length - 1; i >= 0; i--) out.push([valid.has(refs[i].id) ? refs[i].id : UNSORTED_COLLECTION_ID, refs[i].qty])
  const loose = owned - sum(refs)
  if (loose > 0) out.push([UNSORTED_COLLECTION_ID, loose])
  return out
}

/** What's left of [entry] once [plain] and [foil] of its copies leave it for a deck (null: none), and where they were kept, as cameFrom lines. */
export function leftInBinder(entry: CollectionEntry, plain: number, foil: number): { left: CollectionEntry | null; came: CameFrom[] } {
  const { staying, going } = splitPlaces(entry, plain, foil)
  const left: CollectionEntry = { ...entry, quantity: entry.quantity - plain, foilQuantity: (entry.foilQuantity ?? 0) - foil, ...(entry.places !== undefined ? { places: staying } : {}) }
  return { left: left.quantity + (left.foilQuantity ?? 0) > 0 ? left : null, came: going.map((l) => cameFromLine(entry.name, l)) }
}

/**
 * [quantity] copies (plain first) of the card [scryfallId] in the collection [from] sent to [deck]'s
 * main list, as the binder page's Move and Copy to a deck do: into a deck that holds its cards they
 * leave the collection and the deck's card is sorted into it (withCopiesFromBinder); any other deck
 * only gets the card. [deckEntry]: the deck's entry to add, made from the binder's when undefined.
 */
export function sendToDeck(collections: Collection[], deck: Deck, from: string, scryfallId: string, quantity: number, deckEntry?: DeckCardEntry): { collections: Collection[]; deck: Deck } {
  const e = collections.find((c) => c.id === from)?.entries.find((x) => x.scryfallId === scryfallId)
  if (!e) return { collections, deck }
  const plain = Math.min(e.quantity, Math.max(0, quantity))
  const foil = Math.min(e.foilQuantity ?? 0, Math.max(0, quantity) - plain)
  if (plain + foil <= 0) return { collections, deck }
  const made: DeckCardEntry = deckEntry ?? {
    scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, quantity: 0, canBeCommander: false, typeLine: null, partnerAbility: null,
    ...(e.backImageUrl ? { backImageUrl: e.backImageUrl } : {}), ...(e.tags ? { tags: e.tags } : {}),
  }
  const entry = { ...made, quantity: plain + foil }
  if (!copiesMoveInto(deck)) return { collections, deck: withCopiesFromBinder(deck, entry, null, 0, [], new Set()) }
  const { left, came } = leftInBinder(e, plain, foil)
  const cols = collections.map((c) => (c.id !== from ? c : { ...c, entries: c.entries.flatMap((x) => (x !== e ? [x] : left ? [left] : [])) }))
  return { collections: cols, deck: withCopiesFromBinder(deck, entry, from, foil, came, sortingBinderIds(collections)) }
}

/** "2 cards in decks stay in their decks." — said when a binder that lists deck copies is deleted; '' when none. */
export const deckCopiesStayLine = (n: number): string =>
  n <= 0 ? '' : `${n.toLocaleString('en-GB')} ${n === 1 ? 'card' : 'cards'} in decks stay in their decks.`

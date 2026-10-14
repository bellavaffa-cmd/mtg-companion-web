// Binders as views. A copy lives in one place: a binder owns its own copies, a physical or proxy deck
// owns the copies it plays — what's owned and what it's worth never change here (ownedCopies.ts). A
// deck's card can say which binders its real copies belong in (DeckCardEntry.binders,
// decks/binderRefs.ts), and a binder's VIEW is its own cards plus the deck copies sorted into it:
//  - only decks whose cards count as owned (countsAsOwned: Physical and Proxy, never Virtual,
//    Prototype, a cube or a sample), only main-deck cards, and only real copies — a proxy is never in
//    a binder;
//  - a card's refs are walked in order and clamped to its owned real copies (ownedCopies), so a deck
//    cut from 3 copies to 1 shows 1 wherever it was;
//  - owned deck copies with no binder, or sorted into one that's gone or is a wishlist, show in the
//    No binder view (the Unsorted pile, shown as "No binder");
//  - a friend sees a shared binder's own cards only (never these).
// So every real copy shows in exactly one view: the views add up to All cards' real copies. Mirrors
// the Android app's data/BinderViews.kt (shared cases: tests/collection/binderViewVectors.json).

import { NO_BINDER_TITLE, shownName, UNSORTED_COLLECTION_ID, type Collection, type CollectionEntry, type Deck, type DeckCardEntry } from '../types/models'
import { countsAsOwned, ownedCopies } from './ownedCopies'
import { deckTitle } from './upkeep'
import { GROUP_NONE, keptInPlacesLine, type GroupKey } from './collectionLayout'
import { binderRef, foilsOf, type BinderRef } from '../decks/binderRefs'
import { assignedCopies, sortingBinderIds, sortsInto } from './binderCore'

export { assignedCopies, sortingBinderIds }

/** What the Unsorted pile is called wherever it shows (its id and kind stay "unsorted"). */
export { NO_BINDER_TITLE }

/** A binder's name as shown: the Unsorted pile is "No binder". */
export { shownName }

// sortsInto and assignedCopies are in binderCore.ts, which the copy flows (binderFlows.ts, pullList.ts)
// use without the rest of this file.

/** Some of a deck card's real copies, shown in a binder's view. */
export interface DeckCopies {
  deckId: string
  deckName: string
  entry: DeckCardEntry
  qty: number
}

/** Every deck copy that shows in a binder's view, by binder id, and the ones that show in No binder. */
export interface DeckCopiesIndex {
  byBinder: Map<string, DeckCopies[]>
  noBinder: DeckCopies[]
}

let lastIndex: { collections: Collection[]; decks: Deck[]; index: DeckCopiesIndex } | null = null

/**
 * Where every owned deck copy shows, in one walk over the decks — decks in order, their cards in
 * order. The last answer is kept, so the Binders tab, a binder and the Cards tab asking about the same
 * library work it out once.
 */
export function deckCopiesByBinder(collections: Collection[], decks: Deck[]): DeckCopiesIndex {
  if (lastIndex && lastIndex.collections === collections && lastIndex.decks === decks) return lastIndex.index
  const binders = new Set(collections.filter(sortsInto).map((c) => c.id))
  const byBinder = new Map<string, DeckCopies[]>()
  const noBinder: DeckCopies[] = []
  for (const d of decks) {
    if (!countsAsOwned(d)) continue
    for (const e of d.cards) {
      const owned = ownedCopies(d, e)
      if (owned <= 0) continue
      let sorted = 0
      for (const ref of assignedCopies(d, e)) {
        if (!binders.has(ref.id)) continue
        const list = byBinder.get(ref.id) ?? []
        list.push({ deckId: d.id, deckName: d.name, entry: e, qty: ref.qty })
        byBinder.set(ref.id, list)
        sorted += ref.qty
      }
      if (owned - sorted > 0) noBinder.push({ deckId: d.id, deckName: d.name, entry: e, qty: owned - sorted })
    }
  }
  const index = { byBinder, noBinder }
  lastIndex = { collections, decks, index }
  return index
}

/** A binder as it shows: its own cards ([own]) and the deck copies sorted into it ([deckCopies]). */
export interface BinderView {
  binderId: string
  own: CollectionEntry[]
  deckCopies: DeckCopies[]
}

/** Its own copies. */
export const ownCopiesOf = (v: BinderView): number => v.own.reduce((n, e) => n + Math.max(0, e.quantity) + Math.max(0, e.foilQuantity), 0)
/** Copies shown in it that are in decks. */
export const inDecksOf = (v: BinderView): number => v.deckCopies.reduce((n, d) => n + d.qty, 0)
/** Every copy it shows. */
export const viewTotal = (v: BinderView): number => ownCopiesOf(v) + inDecksOf(v)
/** How many decks those are in. */
export const viewDecks = (v: BinderView): number => new Set(v.deckCopies.map((d) => d.deckId)).size

/** The binder [binderId] as it shows: its cards and the deck copies sorted into it. */
export function binderView(binderId: string, collections: Collection[], decks: Deck[], index = deckCopiesByBinder(collections, decks)): BinderView {
  const c = collections.find((x) => x.id === binderId)
  if (binderId === UNSORTED_COLLECTION_ID) return unsortedView(collections, decks, index)
  return { binderId, own: c?.entries ?? [], deckCopies: c && sortsInto(c) ? index.byBinder.get(binderId) ?? [] : [] }
}

/** No binder (the Unsorted pile) as it shows: its own cards, and the owned deck copies in no binder. */
export function unsortedView(collections: Collection[], decks: Deck[], index = deckCopiesByBinder(collections, decks)): BinderView {
  return { binderId: UNSORTED_COLLECTION_ID, own: collections.find((c) => c.id === UNSORTED_COLLECTION_ID)?.entries ?? [], deckCopies: index.noBinder }
}

/** One printing's deck copies in a binder's view, from every deck that has them there. */
export interface DeckCopyRow {
  scryfallId: string
  name: string
  imageUrl: string | null
  backImageUrl: string | null
  copies: DeckCopies[]
  qty: number
  /** The decks, once each: [id, name]. */
  decks: [string, string][]
}

/** [copies] as one row a printing, A to Z. */
export function deckCopyRows(copies: DeckCopies[]): DeckCopyRow[] {
  const by = new Map<string, DeckCopies[]>()
  for (const c of copies) {
    const list = by.get(c.entry.scryfallId) ?? []
    list.push(c)
    by.set(c.entry.scryfallId, list)
  }
  return [...by].map(([id, list]) => {
    const e = list[0].entry
    const decks = new Map<string, string>()
    for (const c of list) if (!decks.has(c.deckId)) decks.set(c.deckId, c.deckName)
    return { scryfallId: id, name: e.name, imageUrl: e.imageUrl, backImageUrl: e.backImageUrl ?? null, copies: list, qty: list.reduce((n, c) => n + c.qty, 0), decks: [...decks] }
  }).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0))
}

/** A deck copy row's badge: "In Talrand deck", "In 2 decks". */
export const inDecksBadge = (decks: string[]): string => (decks.length === 1 ? `In ${deckTitle(decks[0])}` : `In ${decks.length} decks`)

const n = (x: number) => x.toLocaleString('en-GB')
const cards = (x: number) => `${n(x)} ${x === 1 ? 'card' : 'cards'}`

/** A binder row's count: "84 cards", "84 cards · 12 in decks". */
export const binderCountLine = (v: BinderView): string => cards(viewTotal(v)) + (inDecksOf(v) > 0 ? ` · ${n(inDecksOf(v))} in decks` : '')

/** The No binder row's line: "12 cards, not in a binder", "40 cards · 28 in decks, not in a binder", "All sorted". */
export function noBinderLine(v: BinderView): string {
  const total = viewTotal(v)
  if (total <= 0) return 'All sorted'
  return inDecksOf(v) > 0 ? `${cards(total)} · ${n(inDecksOf(v))} in decks, not in a binder` : `${cards(total)}, not in a binder`
}

/** keptInPlacesLine with the decks its copies are in: "kept in 3 places · 2 decks". */
export function keptInPlacesAndDecksLine(places: number, cardCount: number, decks: number): string {
  const kept = keptInPlacesLine(places, cardCount)
  const inDecks = decks <= 0 ? '' : `${n(decks)} ${decks === 1 ? 'deck' : 'decks'}`
  return [kept, inDecks].filter((s) => s !== '').join(' · ')
}

// ---- Changing which binder a deck card's copies are in ----

/** [deck] with [scryfallId]'s main-deck card's binders set to [refs] (tidied); the same deck when that's no change. */
export function withCardBinders(deck: Deck, scryfallId: string, refs: BinderRef[]): Deck {
  const e = deck.cards.find((c) => c.scryfallId === scryfallId)
  if (!e) return deck
  const tidy = assignedCopies(deck, { ...e, binders: refs })
  if (JSON.stringify(e.binders ?? null) === JSON.stringify(tidy)) return deck
  return { ...deck, cards: deck.cards.map((c) => (c.scryfallId === scryfallId ? { ...c, binders: tidy } : c)) }
}

/**
 * The refs once [qty] copies of the card move from binder [from] (null: from no binder — its copies in
 * none, or in one that's gone, [valid] being the binders there are) into binder [to] (null: out of
 * every binder). [current] are its refs as assignedCopies reads them.
 */
export function movedRefs(current: BinderRef[], from: string | null, to: string | null, qty: number, valid: Set<string>): BinderRef[] {
  let left = qty
  let foils = 0
  const out: BinderRef[] = []
  for (const r of current) {
    const leaving = from === null ? !valid.has(r.id) : r.id === from
    if (leaving && left > 0) {
      const take = Math.min(left, r.qty)
      left -= take
      // Plain copies first; a foil goes with them only when that's what's left.
      const foil = Math.max(0, take - (r.qty - foilsOf(r)))
      foils += foil
      if (r.qty - take > 0) out.push(binderRef(r.id, r.qty - take, foilsOf(r) - foil))
    } else out.push(r)
  }
  const moved = qty - (from === null ? 0 : left)
  if (to !== null && moved > 0) {
    const at = out.findIndex((r) => r.id === to)
    if (at >= 0) out[at] = binderRef(to, out[at].qty + moved, foilsOf(out[at]) + foils)
    else out.push(binderRef(to, moved, foils))
  }
  return out
}


/** The binders deck copies can be sorted into, A to Z. */
export const sortingBinders = (collections: Collection[]): Collection[] =>
  collections.filter(sortsInto).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

/**
 * [deck] with every real copy that's in no binder (or one that's gone) put in [binderId], and how many
 * copies that was. A copy already in a binder stays where it is.
 */
export function allIntoBinder(deck: Deck, binderId: string, valid: Set<string>): [Deck, number] {
  if (!countsAsOwned(deck)) return [deck, 0]
  let moved = 0
  const cards = deck.cards.map((e) => {
    const owned = ownedCopies(deck, e)
    if (owned <= 0) return e
    const current = assignedCopies(deck, e)
    const sorted = current.filter((r) => valid.has(r.id)).reduce((s, r) => s + r.qty, 0)
    const loose = owned - sorted
    if (loose <= 0) return e
    moved += loose
    return { ...e, binders: movedRefs(current, null, binderId, loose, valid) }
  })
  return [moved === 0 ? deck : { ...deck, cards }, moved]
}

/** "Binder: Rares ×1", "Binders: Rares ×1, Trade ×2"; null when in none. [names]: binder id -> name. */
export function cardBindersLine(refs: BinderRef[], names: Map<string, string>): string | null {
  const shown = refs.filter((r) => names.has(r.id))
  if (shown.length === 0) return null
  return (shown.length === 1 ? 'Binder: ' : 'Binders: ') + shown.map((r) => `${names.get(r.id)} ×${n(r.qty)}`).join(', ')
}

/**
 * The Cards tab's Group by Binder, by scryfallId: each binder showing copies of the printing — its own
 * or deck copies sorted into it — and No binder (the pile's own and deck copies in no binder) last.
 * Decks aren't groups here; they are in Group by Place.
 */
export function binderGroupIndex(collections: Collection[], decks: Deck[]): Map<string, GroupKey[]> {
  const out = new Map<string, Map<string, GroupKey>>()
  const add = (id: string, key: GroupKey) => {
    let m = out.get(id)
    if (!m) { m = new Map(); out.set(id, m) }
    if (!m.has(key.key)) m.set(key.key, key)
  }
  const none: GroupKey = { key: GROUP_NONE, title: NO_BINDER_TITLE }
  const names = new Map<string, string>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    names.set(c.id, c.name)
    for (const e of c.entries) {
      if (e.quantity + e.foilQuantity <= 0) continue
      add(e.scryfallId, c.id === UNSORTED_COLLECTION_ID ? none : { key: `binder:${c.id}`, title: c.name })
    }
  }
  const index = deckCopiesByBinder(collections, decks)
  for (const [id, list] of index.byBinder) for (const d of list) add(d.entry.scryfallId, { key: `binder:${id}`, title: names.get(id) ?? '' })
  for (const d of index.noBinder) add(d.entry.scryfallId, none)
  return new Map([...out].map(([id, m]) => [id, [...m.values()]]))
}

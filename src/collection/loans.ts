// Loans: cards lent to a friend (by account) or anyone (by name), with where each came from, so
// "Got them back" puts every card back where it was. They replace the old way of marking copies lent
// — a user tag starting "lent" — which still counts until it's turned into loans (loansFromTags).
//
// Where they're kept: the Unsorted pile's "loans" (Collection.loans, JSON in types/models.ts), so they
// sync with the library like the storage places do — the pile is always there with the same id on
// every device. Two devices' loans merge loan by loan (mergeLoans): a loan made on either is kept, one
// deleted on either stays deleted, each field goes to whoever changed it, a card's "back" only ever
// goes up. A pile saved by an app from before loans comes without the key and keeps this device's
// (keepLoansFromOlderApp).
//
// Lending a card from a place takes it off its place (it has no place while it's out — the copies with
// no place that a loan names count as "Lent out", see lentCopies in storagePlaces.ts); lending one from
// a deck leaves the deck's list alone and shows the card there as lent out.
//
// A friend's loan is also sent to the server (social/api.ts upsertLoan, supabase/migrations/
// 20261006010000_loans.sql) so the friend sees "Borrowed" — best effort: the loan itself is the
// library's, and works without it.
//
// Pure, so it can be tested. Mirrors the Android app's data/Loans.kt rule for rule, with the same tests
// (tests/collection/loans.test.ts ↔ LoansTest.kt).

import { isUnsorted, type Collection, type CollectionEntry, type CopyPlace, type Deck, type Loan, type LoanCard } from '../types/models'
import { withUnsortedPile, realCopiesOf } from './unsorted'
import {
  cardsIn, copyPlace, isOpen, lentByEntry, lentCopies, lentFromDeck, lentOf, lentTag, loanCardFrom, loansOf, moveCopies, placeAndInside,
  placeCopies, placedCopies, placesOf, sameCardName, stillOut, unplacedCopies, withPlaces,
} from './storagePlaces'

/** Returned loans are forgotten this long after they came back. */
export const KEEP_RETURNED_MS = 365 * 24 * 60 * 60 * 1000

/** [collections] with the loans set to [loans] (on the Unsorted pile, made if it isn't there). */
export function withLoans(collections: Collection[], loans: Loan[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, loans } : c))
}

/** A loan's card as both apps write it: optional fields left out when not said. */
export function loanCard(c: LoanCard): LoanCard {
  return {
    name: c.name,
    scryfallId: c.scryfallId,
    qty: c.qty,
    ...(c.foil ? { foil: true } : {}),
    ...(c.collectionId ? { collectionId: c.collectionId } : {}),
    ...(c.placeId ? { placeId: c.placeId } : {}),
    ...(c.placeId && c.section ? { section: c.section } : {}),
    ...(c.placeId && c.page && c.page > 0 ? { page: c.page } : {}),
    ...(c.placeId && c.slot && c.slot > 0 ? { slot: c.slot } : {}),
    ...(c.deckId ? { deckId: c.deckId } : {}),
    ...(c.back && c.back > 0 ? { back: Math.min(c.back, c.qty) } : {}),
  }
}

/** A loan as both apps write it. */
export function loanOf(l: Loan): Loan {
  return {
    id: l.id,
    to: l.to.trim(),
    ...(l.friendId ? { friendId: l.friendId } : {}),
    cards: l.cards.map(loanCard),
    lentAt: l.lentAt,
    ...(l.backBy ? { backBy: l.backBy } : {}),
    ...(l.gameNight ? { gameNight: true } : {}),
    ...(l.note?.trim() ? { note: l.note.trim() } : {}),
    ...(l.returnedAt && l.returnedAt > 0 ? { returnedAt: l.returnedAt } : {}),
  }
}

/** How many copies a loan still has out. */
export const copiesOut = (loan: Loan): number => loan.cards.reduce((n, c) => n + stillOut(c), 0)

// ---- What can be lent ----

/** Copies that can be lent, from one spot: a place's line, a deck, or a binder's copies with no place. */
export interface LendSource {
  key: string
  name: string
  scryfallId: string
  foil: boolean
  /** How many are there to lend. */
  qty: number
  /** "Red box › Red", "Atraxa deck", "Unsorted". */
  from: string
  collectionId?: string
  /** The place's line they're in. */
  line?: CopyPlace
  deckId?: string
}

/**
 * Everything that can be lent: of the card called [name] (any printing) — or every card in the place
 * [placeId] and the places inside it. Copies already out on loan, or tagged lent, aren't offered.
 * A card's own: its places first, then its decks, then its copies with no place.
 */
export function lendSources(collections: Collection[], decks: Deck[], what: { name?: string; placeId?: string }): LendSource[] {
  const places = placesOf(collections)
  const known = new Set(places.map((p) => p.id))
  const lent = lentCopies(collections, decks)
  const byEntry = lentByEntry(lent)
  const out: LendSource[] = []
  const fromPlace = (collectionId: string, e: CollectionEntry, line: CopyPlace) => {
    out.push({
      key: `p:${collectionId}:${e.scryfallId}:${line.placeId}|${line.foil ? 'foil' : ''}|${line.section ?? ''}|${line.page ?? ''}|${line.slot ?? ''}`,
      name: e.name, scryfallId: e.scryfallId, foil: !!line.foil, qty: line.qty,
      from: loanCardFrom({ name: e.name, scryfallId: e.scryfallId, qty: 0, placeId: line.placeId, section: line.section }, collections, decks),
      collectionId, line,
    })
  }
  if (what.placeId) {
    for (const id of placeAndInside(places, what.placeId)) {
      for (const c of cardsIn(collections, id)) fromPlace(c.collectionId, c.entry, c.line)
    }
    return out
  }
  const name = what.name ?? ''
  const owned = collections.filter((c) => c.type !== 'WISHLIST')
  for (const c of owned) {
    for (const e of c.entries) {
      if (!sameCardName(e.name, name)) continue
      for (const line of placedCopies(e)) if (known.has(line.placeId)) fromPlace(c.id, e, line)
    }
  }
  for (const d of decks) {
    const real = realCopiesOf(d).filter((e) => sameCardName(e.name, name))
    if (real.length === 0) continue
    const qty = real.reduce((n, e) => n + e.quantity, 0) - lentFromDeck(lent, d.id, name)
    if (qty > 0) out.push({ key: `d:${d.id}`, name: real[0].name, scryfallId: real[0].scryfallId, foil: false, qty, from: `${d.name} deck`, deckId: d.id })
  }
  for (const c of owned) {
    for (const e of c.entries) {
      if (!sameCardName(e.name, name) || lentTag(e)) continue
      const clean = placedCopies(e).every((p) => known.has(p.placeId)) ? e : withPlaces(e, placedCopies(e).filter((p) => known.has(p.placeId)))
      const free = unplacedCopies(clean)
      const away = lentOf(byEntry, c.id, e)
      const plain = free.plain - away.plain
      const foil = free.foil - away.foil
      if (plain > 0) out.push({ key: `n:${c.id}:${e.scryfallId}:`, name: e.name, scryfallId: e.scryfallId, foil: false, qty: plain, from: c.name, collectionId: c.id })
      if (foil > 0) out.push({ key: `n:${c.id}:${e.scryfallId}:foil`, name: e.name, scryfallId: e.scryfallId, foil: true, qty: foil, from: c.name, collectionId: c.id })
    }
  }
  return out
}

// ---- Lending and getting them back ----

/** What to lend: [qty] copies from one source. */
export interface LendPick { source: LendSource; qty: number }

/** The loan's card for [qty] copies from [source]. */
export function loanCardFor(source: LendSource, qty: number): LoanCard {
  return loanCard({
    name: source.name,
    scryfallId: source.scryfallId,
    qty,
    foil: source.foil,
    ...(source.deckId ? { deckId: source.deckId } : { collectionId: source.collectionId }),
    ...(source.line ? { placeId: source.line.placeId, section: source.line.section, page: source.line.page, slot: source.line.slot } : {}),
  })
}

/**
 * [collections] with a new loan of [picks] to [loan]'s person: copies lent from a place come off it
 * (they have no place while they're out); copies from a deck or with no place stay as they are.
 * Returned loans older than a year are forgotten. Unchanged when nothing is picked.
 */
export function lend(collections: Collection[], picks: LendPick[], loan: Omit<Loan, 'cards'>): Collection[] {
  const chosen = picks.filter((p) => p.qty > 0)
  if (chosen.length === 0) return collections
  let out = collections
  const cards: LoanCard[] = []
  for (const { source, qty } of chosen) {
    let n = Math.min(qty, source.qty)
    if (source.line && source.collectionId) {
      const e = out.find((c) => c.id === source.collectionId)?.entries.find((x) => x.scryfallId === source.scryfallId)
      if (!e) continue
      const moved = moveCopies(e, source.line, null, n)
      n = moved.moved
      out = editEntry(out, source.collectionId, source.scryfallId, () => moved.entry)
    }
    if (n > 0) cards.push(loanCardFor(source, n))
  }
  if (cards.length === 0) return collections
  const kept = loansOf(out).filter((l) => isOpen(l) || (l.returnedAt ?? l.lentAt) >= loan.lentAt - KEEP_RETURNED_MS)
  return withLoans(out, [...kept, loanOf({ ...loan, cards })])
}

function editEntry(collections: Collection[], collectionId: string, scryfallId: string, fn: (e: CollectionEntry) => CollectionEntry): Collection[] {
  return collections.map((c) => (c.id !== collectionId ? c : { ...c, entries: c.entries.map((e) => (e.scryfallId === scryfallId ? fn(e) : e)) }))
}

/**
 * [collections] with some of loan [loanId]'s cards back: [counts] says how many of each card (by its
 * index), all that are out when left out. Each copy goes back where it came from — into its place's
 * spot while the place is there, or into no place; one from a deck is simply in the deck again. When
 * every card is back the loan is returned at [now].
 */
export function returnCards(collections: Collection[], loanId: string, now: number, counts?: number[]): Collection[] {
  const loan = loansOf(collections).find((l) => l.id === loanId)
  if (!loan) return collections
  const known = new Set(placesOf(collections).map((p) => p.id))
  let out = collections
  let changed = false
  const cards = loan.cards.map((card, i) => {
    const n = Math.min(stillOut(card), Math.max(0, counts ? counts[i] ?? 0 : stillOut(card)))
    if (n <= 0) return card
    changed = true
    if (card.placeId && known.has(card.placeId) && !card.deckId) {
      // Into its spot: the entry it came from, or another holding that printing (Unsorted first).
      const spot = { placeId: card.placeId, section: card.section, page: card.page, slot: card.slot }
      const owned = out.filter((c) => c.type !== 'WISHLIST')
      const order = [...owned.filter((c) => c.id === card.collectionId), ...owned.filter((c) => c.id !== card.collectionId && isUnsorted(c)), ...owned.filter((c) => c.id !== card.collectionId && !isUnsorted(c))]
      let left = n
      for (const c of order) {
        if (left <= 0) break
        const e = c.entries.find((x) => x.scryfallId === card.scryfallId)
        if (!e) continue
        const placed = placeCopies(e, spot, left, !!card.foil)
        if (placed.moved <= 0) continue
        left -= placed.moved
        out = editEntry(out, c.id, e.scryfallId, () => placed.entry)
      }
    }
    return loanCard({ ...card, back: (card.back ?? 0) + n })
  })
  if (!changed) return collections
  const next: Loan = { ...loan, cards }
  const done = !isOpen(next)
  const kept = loansOf(out).map((l) => (l.id === loanId ? loanOf({ ...next, ...(done ? { returnedAt: now } : {}) }) : l))
  return withLoans(out, kept)
}

// ---- When they're due ----

/** A game night: when it started and its day ("2026-10-12", the device's own calendar). */
export interface NightDay { at: number; day: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "12 Oct" for "2026-10-12"; with the year when it isn't [thisYear]'s. */
export function shortDay(day: string, thisYear?: number): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  return `${d} ${MONTHS[m - 1]}${thisYear !== undefined && thisYear !== y ? ` ${y}` : ''}`
}

/** Days from [from] to [to] ("2026-10-01" to "2026-10-04": 3). */
export function daysBetween(from: string, to: string): number {
  const ms = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((ms(to) - ms(from)) / 86_400_000)
}

/** The day [loan] is due back: its date, or the first game night after it was lent; null when none. */
export function dueDay(loan: Loan, nights: NightDay[]): string | null {
  if (loan.backBy) return loan.backBy
  if (!loan.gameNight) return null
  return [...nights].sort((a, b) => a.at - b.at).find((n) => n.at > loan.lentAt)?.day ?? null
}

/** How a loan stands on [today]: days overdue (0 when not), and that in words. */
export interface LoanDue { overdue: number; label: string }

export function loanDue(loan: Loan, today: string, nights: NightDay[]): LoanDue {
  if (!isOpen(loan)) return { overdue: 0, label: 'All back' }
  const due = dueDay(loan, nights)
  if (!due) return { overdue: 0, label: loan.gameNight ? 'Back by next game night' : 'No date' }
  const days = daysBetween(due, today)
  if (days > 0) return { overdue: days, label: `Overdue · ${days} ${days === 1 ? 'day' : 'days'}` }
  if (days === 0) return { overdue: 0, label: 'Due back today' }
  return { overdue: 0, label: loan.backBy ? `Back by ${shortDay(due, Number(today.slice(0, 4)))}` : 'Back by next game night' }
}

// ---- The Loans page ----

/** One person's open loans, for the Loans page. */
export interface LoanPerson {
  key: string
  name: string
  friendId?: string
  loans: Loan[]
  copies: number
  /** The most days any of them is overdue. */
  overdue: number
  /** The nearest due, in words. */
  label: string
}

/** The open loans, a group for each person (by friend, or by name), the most overdue first, then A–Z. */
export function loanPeople(loans: Loan[], today: string, nights: NightDay[]): LoanPerson[] {
  const groups = new Map<string, LoanPerson>()
  for (const loan of loans.filter(isOpen).sort((a, b) => a.lentAt - b.lentAt)) {
    const key = loan.friendId ? `f:${loan.friendId}` : `n:${loan.to.trim().toLowerCase()}`
    let g = groups.get(key)
    if (!g) { g = { key, name: loan.to.trim(), ...(loan.friendId ? { friendId: loan.friendId } : {}), loans: [], copies: 0, overdue: 0, label: '' }; groups.set(key, g) }
    g.loans.push(loan)
    g.copies += copiesOut(loan)
  }
  for (const g of groups.values()) {
    const dues = g.loans.map((l) => loanDue(l, today, nights))
    g.overdue = Math.max(0, ...dues.map((d) => d.overdue))
    g.label = (g.overdue > 0 ? dues.find((d) => d.overdue === g.overdue) : dues.find((d) => d.label !== 'No date'))?.label ?? 'No date'
  }
  return [...groups.values()].sort((a, b) => b.overdue - a.overdue || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

/** A message asking for the cards back, to send any way the user likes. */
export function reminderText(name: string, loans: Loan[]): string {
  const cards = loans.flatMap((l) => l.cards.filter((c) => stillOut(c) > 0).map((c) => (stillOut(c) > 1 ? `${stillOut(c)}× ${c.name}` : c.name)))
  return `Hi ${name.trim()} — could I have my cards back when you get a chance? ${cards.join(', ')}. Thanks!`
}

/** A loan's cards still out, as the server keeps them for the friend: name, copies and printing. */
export function serverCards(loan: Loan): { name: string; qty: number; printingId: string }[] {
  const out: { name: string; qty: number; printingId: string }[] = []
  for (const c of loan.cards) {
    const n = stillOut(c)
    if (n <= 0) continue
    const had = out.find((x) => x.printingId === c.scryfallId)
    if (had) had.qty += n
    else out.push({ name: c.name, qty: n, printingId: c.scryfallId })
  }
  return out
}

// ---- Turning "lent" tags into loans ----

/** Who a "lent" tag names: "lent to Sam" → Sam, "lent: Priya" → Priya, "lent" → Someone. */
export function tagBorrower(tag: string): string {
  const m = /^lent\b(?:\s+out)?(?:\s+to)?[\s:,-]*(.*)$/i.exec(tag.trim())
  const who = (m?.[1] ?? '').trim()
  return who ? who.charAt(0).toUpperCase() + who.slice(1) : 'Someone'
}

/** What turning the tags into loans does: the binders with the loans, and each printing's tags without its "lent" one. */
export interface TagLoans {
  collections: Collection[]
  loans: Loan[]
  retag: { scryfallId: string; tags: string[] }[]
}

/**
 * "Turn 'lent' tags into loans": the copies with no place of every entry tagged "lent …" become a
 * loan to whoever the tag names (one loan each, lent [now]), and the tag comes off. Copies already
 * out on loan aren't counted twice.
 */
export function loansFromTags(collections: Collection[], now: number, newId: () => string): TagLoans {
  const known = new Set(placesOf(collections).map((p) => p.id))
  const byEntry = lentByEntry(lentCopies(collections))
  const people = new Map<string, Loan>()
  const retag = new Map<string, string[]>()
  for (const c of collections.filter((x) => x.type !== 'WISHLIST')) {
    for (const e of c.entries) {
      const tag = lentTag(e)
      if (!tag) continue
      retag.set(e.scryfallId, (e.userTags ?? []).filter((t) => t !== tag))
      const clean = placedCopies(e).every((p) => known.has(p.placeId)) ? e : withPlaces(e, placedCopies(e).filter((p) => known.has(p.placeId)))
      const free = unplacedCopies(clean)
      const away = lentOf(byEntry, c.id, e)
      const who = tagBorrower(tag)
      const key = who.toLowerCase()
      for (const [foil, n] of [[false, free.plain - away.plain], [true, free.foil - away.foil]] as const) {
        if (n <= 0) continue
        let loan = people.get(key)
        if (!loan) { loan = { id: newId(), to: who, cards: [], lentAt: now, note: 'From your “lent” tags' }; people.set(key, loan) }
        loan.cards.push(loanCard({ name: e.name, scryfallId: e.scryfallId, qty: n, foil, collectionId: c.id }))
      }
    }
  }
  const loans = [...people.values()].map(loanOf)
  return {
    collections: loans.length > 0 ? withLoans(collections, [...loansOf(collections), ...loans]) : collections,
    loans,
    retag: [...retag].map(([scryfallId, tags]) => ({ scryfallId, tags })),
  }
}

/** How many copies are tagged "lent" with no loan yet — what "Turn 'lent' tags into loans" would turn. */
export function taggedLentCopies(collections: Collection[]): number {
  return loansFromTags(collections, 0, () => '').loans.reduce((n, l) => n + l.cards.reduce((m, c) => m + c.qty, 0), 0)
}

// ---- Sync: merging two devices' loans ----

const cardKey = (c: LoanCard) =>
  [c.scryfallId, c.foil ? 'foil' : '', c.collectionId ?? '', c.placeId ?? '', c.section ?? '', c.page ?? '', c.slot ?? '', c.deckId ?? ''].join('|')

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

function mergeLoanCards(base: LoanCard[], mine: LoanCard[], theirs: LoanCard[], minePreferred: boolean): LoanCard[] {
  const b = new Map(base.map((c) => [cardKey(c), c]))
  const m = new Map(mine.map((c) => [cardKey(c), c]))
  const t = new Map(theirs.map((c) => [cardKey(c), c]))
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((k) => !b.has(k)).sort()
  const out: LoanCard[] = []
  for (const key of [...b.keys(), ...added]) {
    const bc = b.get(key)
    const mc = m.get(key)
    const tc = t.get(key)
    if (bc && (!mc || !tc)) continue
    if (!bc) {
      const c = (tc ?? mc)!
      out.push(loanCard({ ...c, qty: Math.max(mc?.qty ?? 0, tc?.qty ?? 0), back: Math.max(mc?.back ?? 0, tc?.back ?? 0) }))
      continue
    }
    out.push(loanCard({
      ...tc!,
      name: pick(bc.name, mc!.name, tc!.name, minePreferred),
      qty: pick(bc.qty, mc!.qty, tc!.qty, minePreferred),
      // Getting cards back only ever counts up.
      back: Math.max(bc.back ?? 0, mc!.back ?? 0, tc!.back ?? 0),
    }))
  }
  return out
}

/**
 * Merges two devices' loans: one made on either side is kept, one deleted on either side stays
 * deleted, each field goes to whoever changed it (the more recent edit when both did), cards merge
 * card by card and the copies back only go up. Returned once every card is back. Left out (undefined)
 * when no side has the key.
 */
export function mergeLoans(base: Loan[] | undefined, mine: Loan[] | undefined, theirs: Loan[] | undefined, minePreferred: boolean): Loan[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((l) => [l.id, l]))
  const m = new Map((mine ?? []).map((l) => [l.id, l]))
  const t = new Map((theirs ?? []).map((l) => [l.id, l]))
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((id) => !b.has(id)).sort()
  const out: Loan[] = []
  for (const id of [...b.keys(), ...added]) {
    const bl = b.get(id)
    const ml = m.get(id)
    const tl = t.get(id)
    if (bl && (!ml || !tl)) continue
    if (!bl) { out.push((tl ?? ml)!); continue }
    const cards = mergeLoanCards(bl.cards, ml!.cards, tl!.cards, minePreferred)
    const merged: Loan = {
      id,
      to: pick(bl.to, ml!.to, tl!.to, minePreferred),
      friendId: pick(bl.friendId, ml!.friendId, tl!.friendId, minePreferred),
      cards,
      lentAt: Math.min(ml!.lentAt, tl!.lentAt),
      backBy: pick(bl.backBy, ml!.backBy, tl!.backBy, minePreferred),
      gameNight: pick(bl.gameNight, ml!.gameNight, tl!.gameNight, minePreferred),
      note: pick(bl.note, ml!.note, tl!.note, minePreferred),
    }
    const returnedAt = Math.max(ml!.returnedAt ?? 0, tl!.returnedAt ?? 0)
    out.push(loanOf(isOpen(merged) || returnedAt === 0 ? merged : { ...merged, returnedAt }))
  }
  return out
}

/**
 * [theirs] with [source]'s loans, when [theirs] was saved by an app that doesn't know about loans (no
 * "loans" key) — the same object otherwise.
 */
export function keepLoansFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (theirs.loans !== undefined || source.loans === undefined || !isUnsorted(theirs)) return theirs
  return { ...theirs, loans: source.loans }
}

/** A copy taken off its place for a loan, as a CopyPlace (for history and undo). */
export const loanSpot = (card: LoanCard): CopyPlace | null =>
  card.placeId ? copyPlace({ placeId: card.placeId, section: card.section, page: card.page, slot: card.slot }, stillOut(card), !!card.foil) : null

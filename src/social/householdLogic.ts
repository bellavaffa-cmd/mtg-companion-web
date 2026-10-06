// Sharing storage at home: the rules behind the Household page and a pull list's "ask Alex" cards.
// A household is 2–6 friends who keep cards in the same storage places; each person's cards stay in
// their own library, and the household only sees what each of them keeps in the places shared in it
// (supabase/migrations/20261006050000_households.sql). Nothing here changes anyone else's library.
//
// Pure, so it can be tested. Mirrors the Android app's data/social/Household.kt rule for rule, with
// the same tests (tests/social/household.test.ts ↔ HouseholdTest.kt).

import type { Collection, PlaceKind } from '../types/models'
import type { Profile } from './api'
import { placedCopies, sameCardName } from '../collection/storagePlaces'

export const HOUSEHOLD_UNAVAILABLE = "Household sharing isn't available yet"
export const DEFAULT_HOUSEHOLD_NAME = 'Shared shelf'

export interface HouseholdMember {
  profile: Profile | null
  status: 'invited' | 'member'
}

/** A place shared in a household: [sharedBy] made it; [users] are the people whose copies there can be seen. */
export interface HouseholdPlace {
  placeId: string
  name: string
  kind: PlaceKind
  sharedBy: string
  users: string[]
}

export interface Household {
  id: string
  name: string
  createdAt: number
  members: HouseholdMember[]
  places: HouseholdPlace[]
}

export interface HouseholdInvite {
  id: string
  name: string
  invitedBy: Profile | null
  /** People in it already. */
  members: number
  at: number
}

export interface MyHouseholds {
  households: Household[]
  invites: HouseholdInvite[]
}

/** Copies of one printing someone keeps in a shared place. */
export interface ShelfCopy {
  userId: string
  placeId: string
  scryfallId: string
  name: string
  imageUrl: string | null
  qty: number
  foil: boolean
}

/** Cards borrowed from the shelf and not back yet: an ordinary loan (lender → borrower). */
export interface ShelfLoan {
  id: string
  clientId: string
  lender: string
  borrower: string
  cards: { name: string; qty: number; printingId: string | null }[]
  note: string | null
  lentAt: number
}

export interface HouseholdCards {
  copies: ShelfCopy[]
  loans: ShelfLoan[]
}

const count = (n: number) => n.toLocaleString('en-GB')

/** The people in it (not the ones only invited), the user first. */
export function membersOf(h: Household, me: string): HouseholdMember[] {
  const in_ = h.members.filter((m) => m.status === 'member' && m.profile)
  return [...in_.filter((m) => m.profile!.user_id === me), ...in_.filter((m) => m.profile!.user_id !== me)]
}

/** The people invited who haven't said yet. */
export const invitedOf = (h: Household): HouseholdMember[] => h.members.filter((m) => m.status === 'invited' && m.profile)

/** A person's name as the page says it: "You" for the user, else their display name. */
export function personName(h: Household, userId: string, me: string): string {
  if (userId === me) return 'You'
  return h.members.find((m) => m.profile?.user_id === userId)?.profile?.display_name ?? 'Someone'
}

const others = (h: Household, me: string) => membersOf(h, me).filter((m) => m.profile!.user_id !== me).map((m) => m.profile!.display_name)

/** "Alex", "Alex and Sam", "Alex, Sam and Jo". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "You and Alex keep cards on the same shelf. Each of you still owns your own cards." */
export function householdIntro(h: Household, me: string): string {
  const o = others(h, me)
  if (o.length === 0) return 'Invite someone you live with to keep cards on the same shelf. Each of you still owns your own cards.'
  return `${andList(['You', ...o])} keep cards on the same shelf. Each of you still owns your own cards.`
}

/** "Pull lists can include Alex's cards, marked "ask Alex", and the borrowed cards show under Loans." */
export function deckNote(h: Household, me: string): string {
  const o = others(h, me)
  if (o.length === 0) return 'Pull lists can include the cards of the people you share with, marked "ask", and the borrowed cards show under Loans.'
  return `Pull lists can include ${andList(o.map((n) => `${n}'s`))} cards, marked ${o.map((n) => `"ask ${n}"`).join(' or ')}, and the borrowed cards show under Loans.`
}

/** The user's own copies in [placeIds], from their library here (newer than the last sync). Wishlists aren't counted. */
export function myShelfCopies(collections: Collection[], placeIds: Iterable<string>, me: string): ShelfCopy[] {
  const ids = new Set(placeIds)
  const byKey = new Map<string, ShelfCopy>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      for (const line of placedCopies(e)) {
        if (!ids.has(line.placeId) || line.qty <= 0) continue
        const foil = !!line.foil
        const key = `${line.placeId}|${e.scryfallId}|${foil}`
        const had = byKey.get(key)
        if (had) had.qty += line.qty
        else byKey.set(key, { userId: me, placeId: line.placeId, scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl ?? null, qty: line.qty, foil })
      }
    }
  }
  return [...byKey.values()]
}

/** One person's tile: how many copies they keep in the shared places, and what they're worth (null: no prices). */
export interface PersonTotal {
  userId: string
  label: string
  copies: number
  usd: number | null
}

/**
 * Each person in the household, the user first, with their copies in the shared places. [copies] is
 * everyone's (the user's from myShelfCopies, the others' from the server); [price] is one copy's
 * price in US dollars, null when there's none — [usd] stays null until any price is known.
 */
export function peopleTotals(h: Household, me: string, copies: ShelfCopy[], price?: (c: ShelfCopy) => number | null): PersonTotal[] {
  const shared = new Set(h.places.map((p) => p.placeId))
  return membersOf(h, me).map((m) => {
    const id = m.profile!.user_id
    const mine = copies.filter((c) => c.userId === id && shared.has(c.placeId))
    let usd: number | null = null
    if (price) {
      for (const c of mine) {
        const p = price(c)
        if (p !== null) usd = (usd ?? 0) + p * c.qty
      }
    }
    return { userId: id, label: personName(h, id, me), copies: mine.reduce((n, c) => n + c.qty, 0), usd }
  })
}

/** A shared place as the page lists it. */
export interface PlaceLine {
  place: HouseholdPlace
  /** "Yours 612 · Alex 0", or "Alex 342 · you can see, not change". */
  line: string
  /** The user keeps no cards there: they can see it, not change it. */
  readOnly: boolean
  /** The user shared it. */
  mine: boolean
  /** The user may keep their cards there too (not in it yet, and not a binder — a binder's pockets are its owner's). */
  canJoin: boolean
}

/**
 * The shared places, each with how many copies each person keeps there. A place the user keeps
 * cards in counts everyone in the household ("Yours 210 · Alex 188"); one they don't is someone
 * else's, which they can look at but not change ("Alex 342 · you can see, not change").
 */
export function placeLines(h: Household, me: string, copies: ShelfCopy[]): PlaceLine[] {
  const people = membersOf(h, me).map((m) => m.profile!.user_id)
  const n = (placeId: string, userId: string) => copies.filter((c) => c.placeId === placeId && c.userId === userId).reduce((s, c) => s + c.qty, 0)
  return h.places.map((p) => {
    const inIt = p.users.includes(me)
    if (inIt) {
      const parts = people.map((id) => `${id === me ? 'Yours' : personName(h, id, me)} ${count(n(p.placeId, id))}`)
      return { place: p, line: parts.join(' · '), readOnly: false, mine: p.sharedBy === me, canJoin: false }
    }
    const users = people.filter((id) => p.users.includes(id))
    const parts = users.map((id) => `${personName(h, id, me)} ${count(n(p.placeId, id))}`)
    return { place: p, line: [...parts, 'you can see, not change'].join(' · '), readOnly: true, mine: false, canJoin: p.kind !== 'BINDER' }
  })
}

/** What's in one shared place, person by person (the user first), each person's cards A–Z. */
export function placeContents(h: Household, me: string, placeId: string, copies: ShelfCopy[]): { userId: string; name: string; copies: ShelfCopy[] }[] {
  return membersOf(h, me)
    .map((m) => m.profile!.user_id)
    .map((id) => ({
      userId: id,
      name: personName(h, id, me),
      copies: copies.filter((c) => c.placeId === placeId && c.userId === id).sort((a, b) => a.name.localeCompare(b.name) || Number(a.foil) - Number(b.foil)),
    }))
    .filter((g) => g.copies.length > 0)
}

/** The household a place of the user's is shared in, if any. */
export const householdOfPlace = (households: Household[], placeId: string): Household | null =>
  households.find((h) => h.places.some((p) => p.placeId === placeId)) ?? null

/** Cards borrowed from the shelf, as the page says them: "Sam has 2 of your cards", "You have 1 of Alex's cards". */
export function shelfLoanLine(h: Household, me: string, loan: ShelfLoan): string {
  const n = loan.cards.reduce((s, c) => s + c.qty, 0)
  const cards = `${n} ${n === 1 ? 'card' : 'cards'}`
  if (loan.lender === me) return `${personName(h, loan.borrower, me)} has ${n} of your cards`
  if (loan.borrower === me) return `You have ${cards} of ${personName(h, loan.lender, me)}'s`
  return `${personName(h, loan.borrower, me)} has ${cards} of ${personName(h, loan.lender, me)}'s`
}

// ---- A deck's pull list: the cards it's short of, from the people at home ----

/** A card a pull list is short of (its "Not owned" rows). */
export interface PullShort {
  name: string
  scryfallId: string
  qty: number
}

/** Someone's copies a deck could use: "ask Alex", or already "borrowed from Alex". */
export interface AskRow {
  key: string
  name: string
  /** The printing the owner has. */
  printingId: string
  qty: number
  householdId: string
  /** Whose they are. */
  from: string
  fromName: string
  /** Where they keep them: "Blue box". */
  placeName: string
  /** Recorded as borrowed already (a loan from them). */
  borrowed: boolean
  hint: string
}

export interface AskGroup {
  householdId: string
  userId: string
  name: string
  /** "Ask Alex". */
  title: string
  rows: AskRow[]
}

export interface PullAsks {
  groups: AskGroup[]
  /** What nobody at home has: still to buy. */
  stillMissing: PullShort[]
}

/** One household and what's on its shelves, as the server answered (null: not loaded, or not available yet). */
export interface Shelf {
  household: Household
  cards: HouseholdCards
}

/**
 * The cards a deck is short of ([missing], in its order), covered by the people at home: first the
 * ones the user has borrowed from them already (open loans from the shelf), then their copies in the
 * shared places that nobody has borrowed — "ask Alex". What's left is still to buy. Without any
 * household data (none, or the server doesn't have households yet) everything stays missing.
 */
export function pullAsks(missing: PullShort[], shelves: Shelf[] | null, me: string): PullAsks {
  if (!shelves || shelves.length === 0) return { groups: [], stillMissing: missing.filter((m) => m.qty > 0) }
  interface Pool { householdId: string; from: string; name: string; printingId: string; placeName: string; left: number; borrowed: boolean; order: number }
  const borrowed: Pool[] = []
  const free: Pool[] = []
  shelves.forEach(({ household: h, cards }, hi) => {
    const people = membersOf(h, me).map((m) => m.profile!.user_id)
    const placeName = (id: string) => h.places.find((p) => p.placeId === id)?.name ?? 'the shelf'
    for (const l of cards.loans) {
      if (l.borrower !== me || l.lender === me) continue
      for (const c of l.cards) {
        if (c.qty > 0) borrowed.push({ householdId: h.id, from: l.lender, name: c.name, printingId: c.printingId ?? '', placeName: 'borrowed', left: c.qty, borrowed: true, order: hi * 100 + Math.max(0, people.indexOf(l.lender)) })
      }
    }
    // Copies out on a loan from the shelf (to anyone) aren't there to ask for.
    const out = new Map<string, number>()
    for (const l of cards.loans) for (const c of l.cards) out.set(`${l.lender}|${c.name.trim().toLowerCase()}`, (out.get(`${l.lender}|${c.name.trim().toLowerCase()}`) ?? 0) + c.qty)
    const shared = new Set(h.places.map((p) => p.placeId))
    for (const c of cards.copies) {
      if (c.userId === me || !people.includes(c.userId) || !shared.has(c.placeId) || c.qty <= 0) continue
      const k = `${c.userId}|${c.name.trim().toLowerCase()}`
      const gone = Math.min(out.get(k) ?? 0, c.qty)
      if (gone > 0) out.set(k, (out.get(k) ?? 0) - gone)
      if (c.qty - gone > 0) free.push({ householdId: h.id, from: c.userId, name: c.name, printingId: c.scryfallId, placeName: placeName(c.placeId), left: c.qty - gone, borrowed: false, order: hi * 100 + people.indexOf(c.userId) })
    }
  })
  const pools = [...borrowed, ...free.sort((a, b) => a.order - b.order)]
  const rows: AskRow[] = []
  const stillMissing: PullShort[] = []
  const names = new Map<string, string>()
  for (const { household: h } of shelves) for (const m of h.members) if (m.profile) names.set(m.profile.user_id, m.profile.display_name)
  for (const need of missing) {
    let wanted = need.qty
    for (const p of pools) {
      if (wanted <= 0) break
      if (p.left <= 0 || !sameCardName(p.name, need.name)) continue
      const take = Math.min(p.left, wanted)
      p.left -= take
      wanted -= take
      const fromName = names.get(p.from) ?? 'someone'
      const key = `${need.name.trim().toLowerCase()}|${p.householdId}|${p.from}|${p.borrowed ? 'b' : 'a'}`
      const had = rows.find((r) => r.key === key)
      if (had) { had.qty += take; continue }
      rows.push({
        key, name: need.name, printingId: p.printingId || need.scryfallId, qty: take, householdId: p.householdId, from: p.from, fromName,
        placeName: p.placeName, borrowed: p.borrowed, hint: p.borrowed ? `borrowed from ${fromName}` : `ask ${fromName} · ${p.placeName}`,
      })
    }
    if (wanted > 0) stillMissing.push({ ...need, qty: wanted })
  }
  const groups: AskGroup[] = []
  for (const r of rows) {
    let g = groups.find((x) => x.householdId === r.householdId && x.userId === r.from)
    if (!g) { g = { householdId: r.householdId, userId: r.from, name: r.fromName, title: `Ask ${r.fromName}`, rows: [] }; groups.push(g) }
    g.rows.push(r)
  }
  for (const g of groups) g.rows.sort((a, b) => Number(a.borrowed) - Number(b.borrowed) || a.name.localeCompare(b.name))
  return { groups, stillMissing }
}

/** The cards to record as borrowed from one person: the group's rows not borrowed yet. */
export const borrowCards = (g: AskGroup): { name: string; qty: number; printingId: string }[] =>
  g.rows.filter((r) => !r.borrowed).map((r) => ({ name: r.name, qty: r.qty, printingId: r.printingId }))

/** "hh-" and a random id: the loan's id, so a retry stores it once. */
export function shelfLoanId(random: () => number = Math.random): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'hh-'
  for (let i = 0; i < 20; i++) s += abc[Math.floor(random() * abc.length) % abc.length]
  return s
}

/** The words for a server answer, for the household's screens. */
export const HOUSEHOLD_ERRORS: Record<string, string> = {
  not_in_household: "You're not sharing that shelf any more.",
  not_invited: 'That invitation has been taken back.',
  household_full: 'A shared shelf is for up to 6 people.',
  too_many_households: "That's 5 shared shelves already.",
  too_many_places: 'Up to 30 places can be shared.',
  not_yours: 'Someone else shared that place.',
  no_such_place: 'That place is not shared any more.',
  not_on_shelf: "Those cards aren't on the shelf any more.",
}

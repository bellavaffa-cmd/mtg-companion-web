// Graded cards: a copy sent to PSA, BGS, CGC or another grader and back in a slab. A graded copy is
// kept apart from the raw copies — marking one takes it out of its binder's counts — so it never fills
// a deck slot, counts as a spare or turns up on a pull list. Its value is what the user enters, since
// card prices are for ungraded copies. It has a place like any copy, and shows on the card's Where it
// is and in Value by place with a "Graded" label.
//
// Where they're kept: the Unsorted pile's "graded" (Collection.graded, JSON in types/models.ts), so they
// sync like the loans and the sealed product. Two devices' slabs merge slab by slab (mergeGraded): one
// added on either side is kept, one taken off on either side stays off, each field goes to whoever
// changed it. A pile saved by an app from before graded cards keeps this device's (keepGradedFromOlderApp).
//
// Pure, so it can be tested. Mirrors the Android app's data/Graded.kt rule for rule, with the same tests
// (tests/collection/graded.test.ts ↔ GradedTest.kt).

import { isUnsorted, UNSORTED_COLLECTION_ID, type Collection, type CollectionEntry, type CopyPlace, type GradedCard, type GradingCompany } from '../types/models'
import { withUnsortedPile } from './unsorted'
import { copyPlace, parentsOf, placedCopies, placesOf, sameCardName, splitPlaces, unplacedCopies, withPlaces } from './storagePlaces'

export const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'BGS', 'CGC', 'OTHER']
export const GRADING_LABELS: Record<GradingCompany, string> = { PSA: 'PSA', BGS: 'BGS', CGC: 'CGC', OTHER: 'Other' }

const companyOf = (c: string | undefined): GradingCompany => (GRADING_COMPANIES as string[]).includes(c ?? '') ? (c as GradingCompany) : 'OTHER'

/** A slab as both apps write it: optional fields left out when not said, money to the cent. */
export function gradedCard(g: GradedCard): GradedCard {
  const value = g.valueUsd !== undefined && Number.isFinite(g.valueUsd) && g.valueUsd >= 0 ? Math.round(g.valueUsd * 100) / 100 : undefined
  const company = companyOf(g.company)
  return {
    id: g.id,
    scryfallId: g.scryfallId,
    name: g.name,
    ...(g.imageUrl ? { imageUrl: g.imageUrl } : {}),
    ...(g.foil ? { foil: true } : {}),
    company,
    ...(company === 'OTHER' && g.companyName?.trim() ? { companyName: g.companyName.trim() } : {}),
    grade: g.grade.trim(),
    ...(g.cert?.trim() ? { cert: g.cert.trim() } : {}),
    ...(value !== undefined ? { valueUsd: value } : {}),
    ...(g.placeId ? { placeId: g.placeId } : {}),
    ...(g.placeId && g.section ? { section: g.section } : {}),
    ...(g.collectionId ? { collectionId: g.collectionId } : {}),
    createdAt: g.createdAt,
  }
}

/** The user's graded copies, kept on the Unsorted pile. */
export function gradedOf(collections: Collection[]): GradedCard[] {
  return collections.find(isUnsorted)?.graded ?? []
}

/** [collections] with the graded copies set to [list] (on the Unsorted pile, made if it isn't there). */
export function withGraded(collections: Collection[], list: GradedCard[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, graded: list.map(gradedCard) } : c))
}

/** Who graded it, as a label says it: "PSA", or the name given for Other. */
export const graderName = (g: Pick<GradedCard, 'company' | 'companyName'>): string =>
  g.company === 'OTHER' ? g.companyName?.trim() || 'Other' : GRADING_LABELS[g.company]

/** The slab short: "PSA 10", "BGS 9.5". */
export const gradeLabel = (g: Pick<GradedCard, 'company' | 'companyName' | 'grade'>): string =>
  [graderName(g), g.grade.trim()].filter(Boolean).join(' ')

/** A raw copy that could be the one graded: in a place (its [line]) or with none, in a binder. */
export interface RawSource {
  key: string
  label: string
  collectionId: string
  scryfallId: string
  name: string
  imageUrl: string | null
  foil: boolean
  /** The place line it's in; null: one of the copies with no place. */
  line: CopyPlace | null
  qty: number
}

/** The raw copies of the card called [name] (any printing) that could be marked graded, a line per spot and finish. */
export function rawSources(collections: Collection[], name: string): RawSource[] {
  const places = placesOf(collections)
  const out: RawSource[] = []
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      if (!sameCardName(e.name, name) || e.quantity + (e.foilQuantity ?? 0) <= 0) continue
      for (const line of placedCopies(e)) {
        const place = places.find((p) => p.id === line.placeId)
        if (!place) continue
        out.push({
          key: `${c.id}|${e.scryfallId}|${line.placeId}|${line.foil ? 'f' : ''}|${line.section ?? ''}|${line.page ?? ''}|${line.slot ?? ''}`,
          label: [line.section ? `${place.name} › ${line.section}` : place.name, line.foil ? 'foil' : ''].filter(Boolean).join(' · '),
          collectionId: c.id, scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, foil: !!line.foil, line, qty: line.qty,
        })
      }
      const free = unplacedCopies(e)
      for (const foil of [false, true]) {
        const n = foil ? free.foil : free.plain
        if (n <= 0) continue
        out.push({
          key: `${c.id}|${e.scryfallId}|none|${foil ? 'f' : ''}`,
          label: [`No place yet (${c.name})`, foil ? 'foil' : ''].filter(Boolean).join(' · '),
          collectionId: c.id, scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, foil, line: null, qty: n,
        })
      }
    }
  }
  return out
}

/** [entry] with one copy fewer — from [line] when given, else (foil if [foil]) one with no place first. Null once none are left. */
function oneCopyFewer(entry: CollectionEntry, line: CopyPlace | null, foil: boolean): CollectionEntry | null {
  const plain = Math.max(0, entry.quantity - (foil ? 0 : 1))
  const foils = Math.max(0, (entry.foilQuantity ?? 0) - (foil ? 1 : 0))
  if (plain + foils <= 0) return null
  let places: CopyPlace[]
  if (line) {
    let taken = false
    places = placedCopies(entry).map((p) => {
      if (taken || p.placeId !== line.placeId || !!p.foil !== !!line.foil || (p.section ?? '') !== (line.section ?? '') || (p.page ?? 0) !== (line.page ?? 0) || (p.slot ?? 0) !== (line.slot ?? 0)) return p
      taken = true
      return { ...p, qty: p.qty - 1 }
    })
  } else {
    places = splitPlaces(entry, foil ? 0 : 1, foil ? 1 : 0).staying
  }
  const left = plain + foils
  const out: CollectionEntry = { ...entry, quantity: plain, foilQuantity: foils }
  if (entry.forTrade !== undefined) out.forTrade = Math.min(entry.forTrade, left)
  if (entry.forSale !== undefined) out.forSale = Math.min(entry.forSale, left)
  return entry.places !== undefined ? withPlaces(out, places) : out
}

/**
 * Marks a copy graded: [card] joins the graded copies and, when it was one of the raw copies
 * ([from]), that copy leaves its binder — so it no longer fills a deck slot or counts as a spare. The
 * binder entry goes once it has no copies left.
 */
export function markGraded(collections: Collection[], from: RawSource | null, card: GradedCard): Collection[] {
  let next = collections
  if (from) {
    next = collections.map((c) => (c.id !== from.collectionId ? c : {
      ...c,
      entries: c.entries.flatMap((e) => (e.scryfallId !== from.scryfallId ? [e] : (() => { const left = oneCopyFewer(e, from.line, from.foil); return left ? [left] : [] })())),
    }))
  }
  const g: GradedCard = from ? { ...card, collectionId: from.collectionId, foil: from.foil || undefined } : card
  return withGraded(next, [...gradedOf(next), g])
}

/** [collections] with the slab [g] changed (its grade, cert, value or place). */
export function saveGraded(collections: Collection[], g: GradedCard): Collection[] {
  const list = gradedOf(collections)
  return withGraded(collections, list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g])
}

/** [collections] without the slab [id] — sold or gone. */
export function removeGraded(collections: Collection[], id: string): Collection[] {
  return withGraded(collections, gradedOf(collections).filter((g) => g.id !== id))
}

/**
 * Out of its slab: the copy [id] is a raw copy again, back in the binder it came from (the Unsorted
 * pile when that's gone) and in the slab's place, so it fills deck slots and counts again.
 */
export function backToRaw(collections: Collection[], id: string): Collection[] {
  const g = gradedOf(collections).find((x) => x.id === id)
  if (!g) return collections
  const rest = withGraded(collections, gradedOf(collections).filter((x) => x.id !== id))
  const places = placesOf(rest)
  const home = rest.some((c) => c.id === g.collectionId && c.type !== 'WISHLIST') ? g.collectionId! : UNSORTED_COLLECTION_ID
  const spot = g.placeId && places.some((p) => p.id === g.placeId) ? copyPlace({ placeId: g.placeId, section: g.section }, 1, !!g.foil) : null
  return withUnsortedPile(rest).map((c) => {
    if (c.id !== home) return c
    const had = c.entries.find((e) => e.scryfallId === g.scryfallId)
    const base: CollectionEntry = had
      ? { ...had, quantity: had.quantity + (g.foil ? 0 : 1), foilQuantity: (had.foilQuantity ?? 0) + (g.foil ? 1 : 0) }
      : { scryfallId: g.scryfallId, name: g.name, imageUrl: g.imageUrl ?? null, quantity: g.foil ? 0 : 1, foilQuantity: g.foil ? 1 : 0 }
    const entry = spot ? withPlaces(base, [...placedCopies(base), spot]) : base
    return { ...c, entries: had ? c.entries.map((e) => (e.scryfallId === g.scryfallId ? entry : e)) : [...c.entries, entry] }
  })
}

/** One graded copy on a card's Where it is. */
export interface GradedLine {
  id: string
  /** "PSA 10". */
  title: string
  /** Where it is and its cert: "Safe, study › Slabs · cert 12345678"; "No place yet". */
  detail: string
  valueUsd: number | null
  placeId: string | null
}

/** The graded copies of the card called [name] (any printing), for its Where it is. */
export function gradedWhere(collections: Collection[], name: string): GradedLine[] {
  const places = placesOf(collections)
  return gradedOf(collections).filter((g) => sameCardName(g.name, name)).map((g) => {
    const place = g.placeId ? places.find((p) => p.id === g.placeId) : undefined
    const where = gradedWhereLabel(collections, g)
    return {
      id: g.id, title: gradeLabel(g), detail: [where, g.foil ? 'foil' : '', g.cert ? `cert ${g.cert}` : ''].filter(Boolean).join(' · '),
      valueUsd: g.valueUsd ?? null, placeId: place?.id ?? null,
    }
  })
}

/** Where a slab is, as its page says it: "Safe, study › Slabs" — the place's path, then its section. */
export function gradedWhereLabel(collections: Collection[], g: Pick<GradedCard, 'placeId' | 'section'>): string {
  const places = placesOf(collections)
  const place = g.placeId ? places.find((p) => p.id === g.placeId) : undefined
  if (!place) return 'No place yet'
  return [...parentsOf(places, place.id), place].map((p) => p.name).join(' › ') + (g.section ? ` › ${g.section}` : '')
}

// ---- Sync: merging two devices' slabs ----

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/**
 * Merges two devices' graded copies: one added on either side is kept, one taken off on either stays
 * off, each field goes to whoever changed it. The order both last agreed on, then additions by id.
 * Left out (undefined) when no side has the key.
 */
export function mergeGraded(base: GradedCard[] | undefined, mine: GradedCard[] | undefined, theirs: GradedCard[] | undefined, minePreferred: boolean): GradedCard[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((g) => [g.id, g]))
  const m = new Map((mine ?? []).map((g) => [g.id, g]))
  const t = new Map((theirs ?? []).map((g) => [g.id, g]))
  const added = [...new Set([...t.keys(), ...m.keys()])].filter((id) => !b.has(id)).sort()
  const out: GradedCard[] = []
  for (const id of [...b.keys(), ...added]) {
    const bg = b.get(id)
    const mg = m.get(id)
    const tg = t.get(id)
    if (bg && (!mg || !tg)) continue
    if (!bg) { out.push((tg ?? mg)!); continue }
    const f = <K extends keyof GradedCard>(k: K): GradedCard[K] => pick(bg[k], mg![k], tg![k], minePreferred)
    const spot = pick({ p: bg.placeId, s: bg.section }, { p: mg!.placeId, s: mg!.section }, { p: tg!.placeId, s: tg!.section }, minePreferred)
    out.push(gradedCard({
      id, scryfallId: f('scryfallId'), name: f('name'), imageUrl: f('imageUrl'), foil: f('foil'), company: f('company'), companyName: f('companyName'),
      grade: f('grade'), cert: f('cert'), valueUsd: f('valueUsd'), placeId: spot.p, section: spot.s, collectionId: f('collectionId'),
      createdAt: Math.min(mg!.createdAt, tg!.createdAt),
    }))
  }
  return out
}

/**
 * [theirs] with [source]'s graded copies, when [theirs] is the Unsorted pile saved by an app that
 * doesn't know about graded cards (no "graded" key) — the same object otherwise.
 */
export function keepGradedFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (theirs.graded !== undefined || source.graded === undefined || !isUnsorted(theirs)) return theirs
  return { ...theirs, graded: source.graded }
}

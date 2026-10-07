// A synthetic big collection for tests and benchmarks — never shipped, never user data. Exactly
// [COPIES] owned copies (binders and the real cards in decks), over thousands of distinct printings,
// in many storage places, with decks, loans, sealed product, graded copies, gear, deck history and
// tags. Deterministic: the same seed makes the same library, so timings compare run to run. The
// Android app builds the same collection in BigCollection.kt (app/src/test).

import type {
  Collection, CollectionEntry, CopyPlace, Deck, DeckCardEntry, GearItem, GradedCard, Loan, SealedProduct, StoragePlace,
} from '../../src/types/models.ts'
import type { DeckHistoryEntry } from '../../src/decks/deckHistory.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

export const COPIES = 25_000
export const PRINTINGS = 18_000
const NAMES = 11_000
const BINDERS = 40
const DECKS = 60
const PHYSICAL_DECKS = 45
const DECK_SIZE = 99
const T0 = 1_780_000_000_000

/** A small, seedable random source (mulberry32), so runs make the same library. */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SYLLABLES = ['ka', 'zor', 'mi', 'thal', 'ven', 'dru', 'syl', 'ar', 'gol', 'eth', 'ri', 'mon', 'qua', 'bel', 'tor', 'ny']
const WORDS = ['Bolt', 'Ring', 'Angel', 'Dragon', 'Growth', 'Counsel', 'Tutor', 'Wall', 'Elf', 'Sphinx', 'Golem', 'Rite', 'Gate', 'Oath', 'Storm']
const COLORS = ['W', 'U', 'B', 'R', 'G']
const TYPES = ['Creature — Elf', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Legendary Creature — Dragon', 'Land', 'Planeswalker — Jace']
const RARITIES = ['common', 'uncommon', 'rare', 'mythic']
const SETS = Array.from({ length: 60 }, (_, i) => `s${String(i).padStart(2, '0')}`)

/** The [i]th printing's id, name and card name. */
export const printingId = (i: number) => `p-${String(i).padStart(5, '0')}-${(i * 2654435761 >>> 0).toString(16)}`
export function cardName(n: number): string {
  const a = SYLLABLES[n % 16], b = SYLLABLES[(n >> 4) % 16], c = SYLLABLES[(n >> 8) % 16]
  return `${a[0].toUpperCase()}${a.slice(1)}${b}${c} ${WORDS[n % 15]}`
}
const nameOf = (i: number) => cardName(i % NAMES)

/** Scryfall's data for the [i]th printing, made up the same way each time: for the filters and prices. */
export function fakeCard(i: number): ScryfallCard {
  const colors = COLORS.filter((_, k) => (i >> k) % 3 === 0).slice(0, 2)
  return {
    id: printingId(i),
    name: nameOf(i),
    set: SETS[i % SETS.length],
    set_name: `Set ${i % SETS.length}`,
    collector_number: String(1 + (i % 300)),
    rarity: RARITIES[i % 4],
    type_line: TYPES[i % TYPES.length],
    mana_cost: colors.map((c) => `{${c}}`).join('') + `{${i % 5}}`,
    cmc: (i % 5) + colors.length,
    colors,
    color_identity: colors,
    oracle_text: `When this enters, draw ${1 + (i % 3)} cards. ${WORDS[i % 15]} ${SYLLABLES[i % 16]}.`,
    power: i % 3 === 0 ? String(i % 7) : undefined,
    toughness: i % 3 === 0 ? String(1 + (i % 6)) : undefined,
    keywords: i % 4 === 0 ? ['Flying'] : [],
    prices: { usd: (0.1 + (i % 400) / 10).toFixed(2), usd_foil: i % 2 === 0 ? (0.5 + (i % 300) / 5).toFixed(2) : null },
    image_uris: { normal: `https://img.example/${i}.jpg`, small: `https://img.example/s/${i}.jpg` },
  } as unknown as ScryfallCard
}

const deckEntry = (i: number, quantity = 1): DeckCardEntry => ({
  scryfallId: printingId(i), name: nameOf(i), imageUrl: `https://img.example/${i}.jpg`, quantity,
  canBeCommander: i % 50 === 0, typeLine: TYPES[i % TYPES.length], partnerAbility: null, tags: i % 7 === 0 ? ['ramp'] : [],
})

export interface BigLibrary { decks: Deck[]; collections: Collection[] }

/** The big collection. */
export function bigCollection(seed = 8): BigLibrary {
  const rnd = random(seed)
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]

  // Places: shelves holding boxes (with sections) and binders, and a few deck boxes on their own.
  const places: StoragePlace[] = []
  for (let s = 0; s < 8; s++) {
    const shelf = `shelf-${s}`
    places.push({ id: shelf, name: `Shelf ${s + 1}`, kind: 'SHELF', createdAt: T0 + s })
    for (let b = 0; b < 6; b++) places.push({ id: `box-${s}-${b}`, name: `Box ${s + 1}.${b + 1}`, kind: 'BOX', parentId: shelf, sections: ['White', 'Blue', 'Black', 'Red', 'Green', 'Multi'], sortRule: 'COLOUR', capacity: 800, createdAt: T0 + 100 + s * 10 + b, lastChecked: T0 + s * 86_400_000 })
    for (let b = 0; b < 2; b++) places.push({ id: `binder-${s}-${b}`, name: `Binder ${s + 1}.${b + 1}`, kind: 'BINDER', parentId: shelf, pocketsPerPage: 9, pages: 40, sortRule: 'NAME', createdAt: T0 + 200 + s * 10 + b })
  }
  for (let d = 0; d < 8; d++) places.push({ id: `deckbox-${d}`, name: `Deck box ${d + 1}`, kind: 'DECK_BOX', createdAt: T0 + 300 + d })
  const boxes = places.filter((p) => p.kind === 'BOX')
  const binderPlaces = places.filter((p) => p.kind === 'BINDER')
  const pockets = new Map<string, number>()
  const spot = (qty: number, foil: boolean): CopyPlace => {
    if (rnd() < 0.8) {
      const box = pick(boxes)
      return { placeId: box.id, qty, ...(foil ? { foil: true } : {}), section: pick(box.sections!) }
    }
    const binder = pick(binderPlaces)
    const n = pockets.get(binder.id) ?? 0
    pockets.set(binder.id, n + 1)
    return { placeId: binder.id, qty, ...(foil ? { foil: true } : {}), page: 1 + Math.floor(n / 9), slot: 1 + (n % 9) }
  }

  // Decks first: the physical ones' cards count toward the copies.
  const decks: Deck[] = []
  let deckCopies = 0
  for (let d = 0; d < DECKS; d++) {
    const ownership = d < PHYSICAL_DECKS ? 'PHYSICAL' : d < PHYSICAL_DECKS + 5 ? 'PROXY' : 'VIRTUAL'
    const cards: DeckCardEntry[] = []
    const seen = new Set<number>()
    while (cards.length < DECK_SIZE) {
      const i = Math.floor(rnd() * PRINTINGS)
      if (seen.has(i)) continue
      seen.add(i)
      cards.push(deckEntry(i))
    }
    if (ownership === 'PHYSICAL') deckCopies += cards.length
    const history: DeckHistoryEntry[] = Array.from({ length: 12 }, (_, h) => ({
      id: `h-${d}-${h}`, at: T0 + h * 3_600_000, from: h % 2 ? 'web' : 'android', dev: `dev-${h % 3}`,
      add: [{ n: cards[h].name, q: 1 }], cut: h > 0 ? [{ n: cards[h - 1].name, q: 1 }] : [],
      ...(h === 0 ? { kind: 'start' as const, list: Object.fromEntries(cards.slice(0, 20).map((c) => [c.name, 1])) } : {}),
    }))
    decks.push({
      id: `deck-${d}`, name: `Deck ${d + 1}`, commander: deckEntry(d * 50), partnerCommander: null, cards,
      gameMode: 'COMMANDER', createdAt: T0 + d, tags: d % 3 === 0 ? ['cEDH'] : [], ownership: ownership as Deck['ownership'],
      gameResults: Array.from({ length: 5 }, (_, g) => ({ id: `g-${d}-${g}`, result: g % 2 ? 'WIN' : 'LOSS', opponent: 'Sam', playedAt: T0 + g })),
      history, folder: d % 4 === 0 ? 'Commander' : '',
    })
  }

  // Binders: every printing once somewhere, then extra copies until the total is [COPIES].
  const binders: Collection[] = Array.from({ length: BINDERS }, (_, b) => ({
    id: `binder-col-${b}`, name: `Binder ${b + 1}`, entries: [], createdAt: T0 + b, type: 'OWNED' as const,
  }))
  const unsortedEntries: CollectionEntry[] = []
  const homes: CollectionEntry[][] = [unsortedEntries, ...binders.map((b) => b.entries)]
  const all: CollectionEntry[] = []
  for (let i = 0; i < PRINTINGS; i++) {
    const home = i % 3 === 0 ? unsortedEntries : homes[1 + (i % BINDERS)]
    const e: CollectionEntry = { scryfallId: printingId(i), name: nameOf(i), imageUrl: `https://img.example/${i}.jpg`, quantity: 1, foilQuantity: 0 }
    if (i % 11 === 0) e.condition = 'NM'
    if (i % 23 === 0) e.language = 'ja'
    if (i % 45 === 0) e.userTags = ['signed']
    if (i % 97 === 0) e.forSale = 1
    home.push(e)
    all.push(e)
  }
  let copies = deckCopies + PRINTINGS
  while (copies < COPIES) {
    const e = pick(all)
    if (rnd() < 0.25) e.foilQuantity += 1
    else e.quantity += 1
    copies++
  }
  // Most copies have a place.
  for (const e of all) {
    if (rnd() < 0.3) continue
    const out: CopyPlace[] = []
    if (e.quantity > 0) out.push(spot(e.quantity, false))
    if (e.foilQuantity > 0) out.push(spot(e.foilQuantity, true))
    e.places = out
  }

  const loans: Loan[] = Array.from({ length: 25 }, (_, l) => ({
    id: `loan-${l}`, to: ['Sam', 'Alex', 'Robin', 'Jo'][l % 4], lentAt: T0 + l * 86_400_000, ...(l % 2 ? { backBy: '2026-11-01' } : {}),
    cards: Array.from({ length: 4 }, (_, k) => {
      const e = unsortedEntries[(l * 4 + k) * 7]
      return { name: e.name, scryfallId: e.scryfallId, qty: 1, collectionId: 'unsorted', ...(l % 5 === 0 ? { back: 1 } : {}) }
    }),
  }))
  const sealed: SealedProduct[] = Array.from({ length: 30 }, (_, s) => ({
    id: `sealed-${s}`, name: `Sealed ${s + 1}`, kind: s % 5 === 0 ? 'PRECON' : 'PLAY_BOX', setCode: SETS[s], count: 1 + (s % 3),
    placeId: `shelf-${s % 8}`, paidUsd: 100 + s, valueUsd: 120 + s, createdAt: T0 + s,
  }))
  const graded: GradedCard[] = Array.from({ length: 40 }, (_, g) => ({
    id: `graded-${g}`, scryfallId: printingId(g * 13), name: nameOf(g * 13), company: 'PSA', grade: String(7 + (g % 4)),
    valueUsd: 50 + g, placeId: 'deckbox-0', createdAt: T0 + g,
  }))
  const gear: GearItem[] = Array.from({ length: 25 }, (_, g) => ({
    id: `gear-${g}`, kind: g % 2 ? 'SLEEVES' : 'DECK_BOX', name: `Gear ${g + 1}`, count: g % 2 ? 100 : 1,
    ...(g % 2 ? { usedBy: [`deck-${g}`] } : { holds: `deck-${g}` }), createdAt: T0 + g,
  }))

  const unsorted: Collection = {
    id: 'unsorted', name: 'Unsorted', entries: unsortedEntries, createdAt: T0, type: 'OWNED',
    storagePlaces: places, loans, sealed, graded, gear,
  }
  const wishlist: Collection = {
    id: 'wishlist', name: 'Wishlist', createdAt: T0, type: 'WISHLIST',
    entries: Array.from({ length: 200 }, (_, w) => ({ scryfallId: `wish-${w}`, name: cardName(NAMES + w), imageUrl: null, quantity: 1, foilQuantity: 0, ...(w % 4 === 0 ? { priceAlert: 5 } : {}) })),
  }
  return { decks, collections: [unsorted, wishlist, ...binders] }
}

/** Owned copies in [lib]: binders (not the Wishlist) and the real cards in physical decks. */
export function ownedCopies(lib: BigLibrary): number {
  let n = 0
  for (const c of lib.collections) if (c.type !== 'WISHLIST') for (const e of c.entries) n += e.quantity + e.foilQuantity
  for (const d of lib.decks) if (d.ownership === 'PHYSICAL') for (const e of d.cards) n += e.quantity
  return n
}

/** Milliseconds [fn] takes, the best of [runs] (the first run warms up). */
export function timed<T>(fn: () => T, runs = 3): { ms: number; value: T } {
  let best = Infinity
  let value!: T
  for (let r = 0; r < runs; r++) {
    const t = performance.now()
    value = fn()
    best = Math.min(best, performance.now() - t)
  }
  return { ms: best, value }
}

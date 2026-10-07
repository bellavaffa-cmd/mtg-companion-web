// The Collection's home: what it's worth, one search over everything, a tile for each part of the
// collection with its numbers ("8 places · 92% placed"), the few things worth doing this week (from
// Upkeep) and Scan / Sort a pile / Import. The numbers and the to-do lines are worked out here, pure,
// so they can be tested. Mirrors the Android app's data/CollectionHome.kt line for line (tests:
// tests/collection/collectionHome.test.ts ↔ CollectionHomeTest.kt).

import type { Collection, Deck } from '../types/models'
import { isUnsorted } from '../types/models'
import { isWishlist } from './wishlist'
import { gradedOf } from './graded'
import { sealedOf, sealedTotalUsd } from './sealed'
import { sellRows, sellQty } from './selling'
import { placedPercent } from './storageSetup'
import { placesOf, storageSummary } from './storagePlaces'
import { deckTitle, type UpkeepItem, type UpkeepKind } from './upkeep'

/** What the home's tiles say. */
export interface HomeNumbers {
  /** Different cards on All cards: owned printings in binders, the Unsorted pile and decks. */
  cards: number
  places: number
  /** The share of copies with a place, as Storage says it (placedPercent). */
  placedPercent: number
  /** Binders, not counting the Unsorted pile and the Wishlist. */
  binders: number
  /** Cards on the Wishlist. */
  wishlist: number
  /** Sealed products (each counted) and graded copies. */
  sealedAndGraded: number
  /** What they're worth, as the user entered it, in US dollars. */
  sealedAndGradedUsd: number
  /** Copies out on loan now. */
  lentOut: number
  /** Copies marked to sell. */
  toSell: number
}

const copiesOf = (e: { quantity: number; foilQuantity?: number }) => Math.max(0, e.quantity) + Math.max(0, e.foilQuantity ?? 0)

/** The home's numbers, from the library. */
export function homeNumbers(collections: Collection[], decks: Deck[]): HomeNumbers {
  const summary = storageSummary(collections, decks)
  const printings = new Set<string>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) if (copiesOf(e) > 0) printings.add(e.scryfallId)
  }
  for (const d of decks) for (const e of d.cards) if (e.quantity > 0) printings.add(e.scryfallId)
  const sealed = sealedOf(collections)
  const graded = gradedOf(collections)
  const wishlist = collections.find(isWishlist)
  return {
    cards: printings.size,
    places: placesOf(collections).length,
    placedPercent: placedPercent(summary),
    binders: collections.filter((c) => !isUnsorted(c) && !isWishlist(c) && c.type !== 'WISHLIST').length,
    wishlist: wishlist?.entries.length ?? 0,
    sealedAndGraded: sealed.reduce((n, p) => n + Math.max(0, p.count), 0) + graded.length,
    sealedAndGradedUsd: sealedTotalUsd(sealed) + graded.reduce((n, g) => n + (g.valueUsd ?? 0), 0),
    lentOut: summary.lent,
    toSell: sellRows(collections).reduce((n, r) => n + sellQty(r), 0),
  }
}

const count = (n: number) => n.toLocaleString('en-GB')

/** One tile: its name and the line under it. */
export interface HomeTile { key: HomeTileKey; title: string; line: string }
export type HomeTileKey = 'all' | 'storage' | 'binders' | 'sets' | 'sealed' | 'loans'

/** The six tiles, in the home's order, with [money] writing an amount the way the app shows prices. */
export function homeTiles(n: HomeNumbers, money: (usd: number) => string): HomeTile[] {
  return [
    { key: 'all', title: 'All cards', line: `${count(n.cards)} · filters` },
    { key: 'storage', title: 'Storage', line: n.places === 0 ? 'Set up your places' : `${count(n.places)} ${n.places === 1 ? 'place' : 'places'} · ${n.placedPercent}% placed` },
    { key: 'binders', title: 'Binders', line: `${count(n.binders)} · wishlist` },
    { key: 'sets', title: 'Sets', line: 'completion' },
    {
      key: 'sealed',
      title: 'Sealed and graded',
      line: n.sealedAndGraded === 0
        ? 'Boxes and slabs'
        : `${count(n.sealedAndGraded)} ${n.sealedAndGraded === 1 ? 'item' : 'items'}` + (n.sealedAndGradedUsd > 0 ? ` · ${money(n.sealedAndGradedUsd)}` : ''),
    },
    { key: 'loans', title: 'Loans and selling', line: `${count(n.lentOut)} out · ${count(n.toSell)} to sell` },
  ]
}

/** One line of the home's To do: Upkeep's item, said short, with its button. */
export interface HomeTodo { item: UpkeepItem; title: string; action: string }

/** At most this many things to do on the home; the rest are on Upkeep. */
export const HOME_TODO_MAX = 3

/** Which kinds come first on the home: copies to put away, then a pull list half done, then the rest. */
const HOME_ORDER: UpkeepKind[] = ['PUT_AWAY', 'CARRY_ON', 'REMIND', 'CHECK', 'SPLIT']

/** "Krenko" from "Krenko deck" — the pull list's line says "pull list" after it. */
const deckShort = (name: string) => deckTitle(name).replace(/\s+deck$/i, '')

/**
 * The home's To do, from Upkeep's [items]: one of each kind first, in HOME_ORDER (so a long list of
 * places to check doesn't hide a pull list), then the rest, at most [max]. A pull list says how far
 * it got: "Krenko pull list: 30 of 60".
 */
export function homeTodo(items: UpkeepItem[], decks: Pick<Deck, 'id' | 'name'>[], max = HOME_TODO_MAX): HomeTodo[] {
  const rank = (i: UpkeepItem) => HOME_ORDER.indexOf(i.kind)
  const sorted = items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i).map((x) => x.item)
  const firsts: UpkeepItem[] = []
  const rest: UpkeepItem[] = []
  for (const item of sorted) (firsts.some((f) => f.kind === item.kind) ? rest : firsts).push(item)
  return [...firsts, ...rest].slice(0, Math.max(0, max)).map((item) => ({ item, title: todoTitle(item, decks), action: item.action }))
}

function todoTitle(item: UpkeepItem, decks: Pick<Deck, 'id' | 'name'>[]): string {
  if (item.kind !== 'CARRY_ON') return item.title
  const deck = decks.find((d) => d.id === item.deckId)
  const done = /^(\d+) of (\d+)/.exec(item.detail)
  if (!deck || !done) return item.title
  return `${deckShort(deck.name)} pull list: ${done[1]} of ${done[2]}`
}

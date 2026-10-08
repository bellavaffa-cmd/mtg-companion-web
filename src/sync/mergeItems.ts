// Three-way merge for decks and binders, so two devices editing the same one keep both sets of
// edits instead of the newer save replacing the older one wholesale.
//
// Every merge compares three versions: the one both devices last agreed on (the base), this
// device's version, and the other device's. Both devices run the same rules on the same three
// versions, so they reach the same result and settle down.
//
// The rules, in short:
//  - A card added on one side is kept.
//  - A card removed on one side stays removed, even if the other side changed its count.
//  - Counts that both sides changed add up: +1 here and +2 there lands on +3; two cuts that would
//    take it below zero settle on the lower count rather than removing the card.
//  - A field both sides changed differently (a deck's name, say) goes to the more recent edit.
//    Clearing a field is a change too. A binder card's own fields — its price alerts, its copies'
//    condition and language — merge this way, each on its own.
//  - Where a binder card's copies are kept (its "places") merges line by line like the cards do, and
//    the storage places themselves (on the Unsorted pile) place by place — see
//    collection/storagePlaces.ts. A binder saved by an app that doesn't know about places leaves them
//    as they were. When a place was last checked (collection/placeCheck.ts) merges to the later check.
//    A place's size (collection/boxSpace.ts) and a card's copies to sell (collection/selling.ts) go to
//    whoever changed them; one saved by an app that doesn't know about them leaves them as they were.
//  - Where a deck's copies came from (its "cameFrom", see collection/pullList.ts) merges card by card
//    the same way; a deck saved by an app that doesn't know about it leaves it as it was.
//  - The loans (on the Unsorted pile, see collection/loans.ts) merge loan by loan, their cards card by
//    card, and the copies back only go up; a pile saved by an app that doesn't know about loans leaves
//    them as they were.
//  - Sealed product and graded copies (on the Unsorted pile, see collection/sealed.ts and graded.ts)
//    merge product by product and slab by slab; a sealed product's count adds up like a card's. A pile
//    saved by an app that doesn't know about them leaves them as they were.
//  - The gear (on the Unsorted pile, see collection/gear.ts) merges item by item, the decks a pack of
//    sleeves is on like a deck's tags; a pile saved by an app that doesn't know about gear leaves it as
//    it was.
//  - What the scanner learned from corrections (on the Unsorted pile, see scan/scanCorrections.ts) merges
//    entry by entry, the one used last winning; a pile saved by an app that doesn't know about them
//    leaves them as they were.
//  - The sorting recipes (on the Unsorted pile, see collection/sortRecipes.ts) merge recipe by recipe;
//    a pile saved by an app that doesn't know about recipes leaves them as they were.
//  - The collection goals (on the Unsorted pile, see collection/collectionGoals.ts) merge goal by goal;
//    a pile saved by an app that doesn't know about goals leaves them as they were.
//  - A deck's primer, folder, archive flag and companion go to whoever changed them; each category's
//    target the same, one by one; a card's categories merge like its tags. A deck saved by an app that
//    doesn't know them leaves them as they were (decks/deckExtras.ts).
//  - A deck's history (decks/deckHistory.ts) is every entry from both sides, once by id, the newer
//    copy of one both have; a deck saved by an app that doesn't know it leaves it as it was.
//  - A cube's settings (decks/cube.ts, the deck's "cube") merge field by field like a deck's name; a
//    cube saved by an app that doesn't know about cubes leaves them as they were. Its cards merge card
//    by card like any deck's.
// The Android app merges the same way — see data/supabase/ItemMerge.kt.

import type { Collection, CollectionEntry, Deck, DeckCardEntry, GameResult } from '../types/models'
import { sameJson } from './canonicalJson'
import { keepPlaceSizes, keepPlacesFromOlderApp, mergeCopyPlaces, mergePlaceLists, tidied } from '../collection/storagePlaces'
import { keepForSaleFromOlderApp } from '../collection/selling'
import { keepAlertOptionsFromOlderApp } from '../collection/wishlistTargets'
import { keepPreReleaseFromOlderApp } from '../collection/spoilers'
import { keepCameFromFromOlderApp, mergeCameFrom } from '../collection/pullList'
import { keepLoansFromOlderApp, mergeLoans } from '../collection/loans'
import { keepSealedFromOlderApp, mergeSealed } from '../collection/sealed'
import { keepGradedFromOlderApp, mergeGraded } from '../collection/graded'
import { keepGearFromOlderApp, mergeGear } from '../collection/gear'
import { keepRecipesFromOlderApp, mergeRecipes } from '../collection/sortRecipes'
import { keepCorrectionsFromOlderApp, mergeCorrections } from '../scan/scanCorrections'
import { keepGoalsFromOlderApp, mergeGoals } from '../collection/collectionGoals'
import { keepDeckExtrasFromOlderApp, mergeDeckExtras } from '../decks/deckExtras'
import { keepHistoryFromOlderApp, mergeHistory } from '../decks/deckHistory'
import { keepCubeFromOlderApp, mergeCubeSettings } from '../decks/cube'
// The phone keeps this many saved versions of a deck (DeckRepository.MAX_VERSIONS).
import { MAX_VERSIONS } from '../decks/versions'

// Key order doesn't count: the server's copy comes back with its keys reordered.
const same = sameJson

/** A field's value after a merge: whoever changed it, or the more recent edit when both did. */
function pick<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/** Merges a set of strings (a deck's tags): additions from both sides, minus what either removed. */
function mergeStringSet(base: string[], mine: string[], theirs: string[]): string[] {
  const baseSet = new Set(base)
  const mineSet = new Set(mine)
  const theirsSet = new Set(theirs)
  const out: string[] = []
  for (const tag of [...theirs, ...mine]) {
    if (out.includes(tag)) continue
    const removedByMe = baseSet.has(tag) && !mineSet.has(tag)
    const removedByThem = baseSet.has(tag) && !theirsSet.has(tag)
    if (!removedByMe && !removedByThem) out.push(tag)
  }
  return out
}

interface EntryRules<T> {
  /** Fields whose changes add up (quantities). */
  counts: (keyof T)[]
  /** Fields that are a set of words, merged like a deck's tags rather than one side winning. */
  sets?: (keyof T)[]
}

/**
 * Merges a list of card entries keyed by printing. The order both devices last agreed on is kept,
 * with whatever either side added appended by id, so both devices end up with the same list in the
 * same order.
 */
function mergeEntries<T extends { scryfallId: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
  rules: EntryRules<T>,
  minePreferred: boolean
): T[] {
  const byId = (list: T[]) => new Map(list.map((e) => [e.scryfallId, e]))
  const baseMap = byId(base)
  const mineMap = byId(mine)
  const theirsMap = byId(theirs)

  // Both devices must land on the same order, so start from the order they agreed on and append
  // what either side added, by id — never "their order, then mine".
  const baseIds = base.map((e) => e.scryfallId)
  // A set, not a search of the list: a big binder has thousands of cards on each side.
  const inBase = new Set(baseIds)
  const added = [...new Set([...theirs, ...mine].map((e) => e.scryfallId))].filter((id) => !inBase.has(id)).sort()
  const ids = [...baseIds, ...added]

  const out: T[] = []
  for (const id of ids) {
    const b = baseMap.get(id)
    const m = mineMap.get(id)
    const t = theirsMap.get(id)
    // Removing a card is deliberate, so it stays removed even if the other side touched it.
    if (b && (!m || !t)) continue
    if (!b) {
      // Added on one side, or on both at once: one copy, the larger count.
      const added = t ?? m!
      if (m && t) {
        const merged = { ...added }
        for (const field of rules.counts) {
          merged[field] = Math.max(Number(m[field] ?? 0), Number(t[field] ?? 0)) as T[keyof T]
        }
        out.push(merged)
      } else {
        out.push(added)
      }
      continue
    }
    // In all three: counts add up, everything else follows whoever changed it.
    const merged = { ...t! } as T
    for (const key of new Set([...Object.keys(b), ...Object.keys(m!), ...Object.keys(t!)]) as Set<keyof T>) {
      if (rules.counts.includes(key)) {
        const mineCount = Number(m![key] ?? 0)
        const theirCount = Number(t![key] ?? 0)
        const summed = theirCount + (mineCount - Number(b[key] ?? 0))
        // Both sides cut the same card: take the lower count rather than letting two reductions
        // cancel it out of the deck entirely.
        merged[key] = (summed <= 0 && mineCount > 0 && theirCount > 0
          ? Math.min(mineCount, theirCount)
          : Math.max(0, summed)) as T[keyof T]
      } else if (rules.sets?.includes(key)) {
        // Two devices tagging the same copy keep both tags, and a tag either took off stays off.
        const set = mergeStringSet((b[key] ?? []) as string[], (m![key] ?? []) as string[], (t![key] ?? []) as string[])
        if (set.length > 0) merged[key] = set as T[keyof T]
        else delete merged[key]
      } else {
        // A field cleared on the side that changed it (a condition taken off, an alert turned off)
        // stays left out, rather than coming back as an empty key.
        const value = pick(b[key], m![key], t![key], minePreferred)
        if (value === undefined) delete merged[key]
        else merged[key] = value
      }
    }
    // Every count down to zero means both sides emptied it out — that's a removal.
    if (rules.counts.length > 0 && rules.counts.every((field) => Number(merged[field] ?? 0) <= 0)) continue
    out.push(merged)
  }
  return out
}

/** Games logged on either device, minus any deleted on either; newest first, like the deck page. */
function mergeGameResults(base: GameResult[], mine: GameResult[], theirs: GameResult[]): GameResult[] {
  const ids = (list: GameResult[]) => new Set(list.map((g) => g.id))
  const baseIds = ids(base)
  const mineIds = ids(mine)
  const theirsIds = ids(theirs)
  const out: GameResult[] = []
  for (const game of [...theirs, ...mine]) {
    const same = out.findIndex((g) => g.id === game.id)
    if (same !== -1) {
      // The same game saved by an app that doesn't know about mulligans keeps the count the other side has.
      if (out[same].mulligans == null && game.mulligans != null) out[same] = { ...out[same], mulligans: game.mulligans }
      continue
    }
    const removedByMe = baseIds.has(game.id) && !mineIds.has(game.id)
    const removedByThem = baseIds.has(game.id) && !theirsIds.has(game.id)
    if (!removedByMe && !removedByThem) out.push(game)
  }
  return out.sort((a, b) => b.playedAt - a.playedAt)
}

const DECK_COUNTS: EntryRules<DeckCardEntry> = { counts: ['quantity'], sets: ['userTags', 'categories'] }
const COLLECTION_COUNTS: EntryRules<CollectionEntry> = { counts: ['quantity', 'foilQuantity'], sets: ['userTags'] }

/** [minePreferred]: this device's edit is the more recent one, so it wins any field both changed. */
export function mergeDeck(base: Deck, mineIn: Deck, theirsIn: Deck, minePreferred: boolean): Deck {
  // A side saved by an app that doesn't know where the deck's copies came from left that as it was.
  // ...and the same for its primer, folder, archive flag, companion and categories.
  // ...and its history (decks/deckHistory.ts), and a cube's settings (decks/cube.ts).
  const mine = keepCubeFromOlderApp(base, keepHistoryFromOlderApp(base, keepDeckExtrasFromOlderApp(base, keepCameFromFromOlderApp(base, mineIn))))
  const theirs = keepCubeFromOlderApp(base, keepHistoryFromOlderApp(base, keepDeckExtrasFromOlderApp(base, keepCameFromFromOlderApp(base, theirsIn))))
  const cube = mergeCubeSettings(base.cube, mine.cube, theirs.cube, minePreferred)
  const history = mergeHistory(mine.history, theirs.history)
  const cameFrom = mergeCameFrom(base.cameFrom, mine.cameFrom, theirs.cameFrom)
  // The phone's deck has two fields this app doesn't show but must not drop or diverge on.
  const asPhone = (deck: Deck) => deck as Deck & { considering?: DeckCardEntry[]; versions?: { id: string; savedAt: number }[] }
  const considering = mergeEntries(
    asPhone(base).considering ?? [], asPhone(mine).considering ?? [], asPhone(theirs).considering ?? [],
    DECK_COUNTS, minePreferred,
  )
  const sideboard = mergeEntries(base.sideboard ?? [], mine.sideboard ?? [], theirs.sideboard ?? [], DECK_COUNTS, minePreferred)
  const versions = [...(asPhone(theirs).versions ?? []), ...(asPhone(mine).versions ?? [])]
    .filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i)
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(-MAX_VERSIONS)
  const {
    cameFrom: _theirs, history: _h, description: _d, folder: _f, archived: _a, companion: _c, categoryTargets: _t, cube: _cube, ...theirsRest
  } = theirs
  return {
    ...theirsRest,
    ...(cameFrom !== undefined ? { cameFrom } : {}),
    ...mergeDeckExtras(base, mine, theirs, minePreferred),
    ...(considering.length > 0 || asPhone(theirs).considering ? { considering } : {}),
    ...(sideboard.length > 0 || theirs.sideboard ? { sideboard } : {}),
    ...(versions.length > 0 ? { versions } : {}),
    ...(history !== undefined ? { history } : {}),
    ...(cube !== undefined ? { cube } : {}),
    name: pick(base.name, mine.name, theirs.name, minePreferred),
    gameMode: pick(base.gameMode, mine.gameMode, theirs.gameMode, minePreferred),
    ownership: pick(base.ownership, mine.ownership, theirs.ownership, minePreferred),
    createdAt: Math.min(mine.createdAt, theirs.createdAt),
    commander: pick(base.commander, mine.commander, theirs.commander, minePreferred),
    partnerCommander: pick(base.partnerCommander, mine.partnerCommander, theirs.partnerCommander, minePreferred),
    cards: mergeEntries(base.cards, mine.cards, theirs.cards, DECK_COUNTS, minePreferred),
    tags: mergeStringSet(base.tags ?? [], mine.tags ?? [], theirs.tags ?? []),
    gameResults: mergeGameResults(base.gameResults ?? [], mine.gameResults ?? [], theirs.gameResults ?? []),
  }
}

export function mergeCollection(base: Collection, mineIn: Collection, theirsIn: Collection, minePreferred: boolean): Collection {
  // A side saved by an app that doesn't know about places left them as they were.
  // ...and one that doesn't know about loans left those as they were.
  // ...and one that doesn't know about place sizes or copies to sell left those as they were.
  // ...and one that doesn't know about a wishlist target's options left those as they were.
  // ...and one that doesn't know about cards wanted from spoilers left their release date as it was.
  // ...and one that doesn't know about sealed product, graded copies or gear left those as they were.
  // ...and one that doesn't know about sorting recipes left those as they were.
  // ...and one that doesn't know about collection goals left those as they were.
  const mine = keepGoalsFromOlderApp(base, keepCorrectionsFromOlderApp(base, keepRecipesFromOlderApp(base, keepGearFromOlderApp(base, keepGradedFromOlderApp(base, keepSealedFromOlderApp(base, keepAlertOptionsFromOlderApp(base, keepPreReleaseFromOlderApp(base, keepForSaleFromOlderApp(base, keepPlaceSizes(base, keepLoansFromOlderApp(base, keepPlacesFromOlderApp(base, mineIn))))))))))))
  const theirs = keepGoalsFromOlderApp(base, keepCorrectionsFromOlderApp(base, keepRecipesFromOlderApp(base, keepGearFromOlderApp(base, keepGradedFromOlderApp(base, keepSealedFromOlderApp(base, keepAlertOptionsFromOlderApp(base, keepPreReleaseFromOlderApp(base, keepForSaleFromOlderApp(base, keepPlaceSizes(base, keepLoansFromOlderApp(base, keepPlacesFromOlderApp(base, theirsIn))))))))))))
  const placesIn = (list: CollectionEntry[]) => new Map(list.map((e) => [e.scryfallId, e]))
  const [b, m, t] = [placesIn(base.entries), placesIn(mine.entries), placesIn(theirs.entries)]
  // Each card's places line by line (one added on both sides keeps the other device's), then no more
  // than its merged copies.
  const entries = mergeEntries(base.entries, mine.entries, theirs.entries, COLLECTION_COUNTS, minePreferred).map((e) => {
    const id = e.scryfallId
    // Added on one side: as it came. On both: the other device's places, within the larger count.
    if (!b.has(id)) return m.has(id) && t.has(id) ? tidied(e) : e
    const places = mergeCopyPlaces(b.get(id)!.places, m.get(id)!.places, t.get(id)!.places)
    if (places === undefined) {
      if (e.places === undefined) return e
      const { places: _gone, ...rest } = e
      return rest
    }
    return tidied({ ...e, places })
  })
  const storagePlaces = mergePlaceLists(base.storagePlaces, mine.storagePlaces, theirs.storagePlaces, minePreferred)
  const loans = mergeLoans(base.loans, mine.loans, theirs.loans, minePreferred)
  const sealed = mergeSealed(base.sealed, mine.sealed, theirs.sealed, minePreferred)
  const graded = mergeGraded(base.graded, mine.graded, theirs.graded, minePreferred)
  const gear = mergeGear(base.gear, mine.gear, theirs.gear, minePreferred)
  const sortRecipes = mergeRecipes(base.sortRecipes, mine.sortRecipes, theirs.sortRecipes, minePreferred)
  const scanCorrections = mergeCorrections(base.scanCorrections, mine.scanCorrections, theirs.scanCorrections, minePreferred)
  const collectionGoals = mergeGoals(base.collectionGoals, mine.collectionGoals, theirs.collectionGoals, minePreferred)
  const { storagePlaces: _theirs, loans: _theirLoans, sealed: _theirSealed, graded: _theirGraded, gear: _theirGear, sortRecipes: _theirRecipes, scanCorrections: _theirCorrections, collectionGoals: _theirGoals, ...rest } = theirs
  return {
    ...rest,
    ...(storagePlaces !== undefined ? { storagePlaces } : {}),
    ...(loans !== undefined ? { loans } : {}),
    ...(sealed !== undefined ? { sealed } : {}),
    ...(graded !== undefined ? { graded } : {}),
    ...(gear !== undefined ? { gear } : {}),
    ...(sortRecipes !== undefined ? { sortRecipes } : {}),
    ...(scanCorrections !== undefined ? { scanCorrections } : {}),
    ...(collectionGoals !== undefined ? { collectionGoals } : {}),
    name: pick(base.name, mine.name, theirs.name, minePreferred),
    type: pick(base.type, mine.type, theirs.type, minePreferred),
    createdAt: Math.min(mine.createdAt, theirs.createdAt),
    notWanted: mergeStringSet(base.notWanted ?? [], mine.notWanted ?? [], theirs.notWanted ?? []),
    entries,
  }
}

// Mirrors the Android app's Moshi-serialized data classes field-for-field (camelCase keys,
// same enum-name strings) so a backup written by one app is read correctly by the other.
// See MtgCompanionApp/app/src/main/java/com/mtgcompanion/app/data/{DeckModels,CollectionModels,SyncModels}.kt

import type { ScryfallCard } from './scryfall'
import type { DeckHistoryEntry } from '../decks/deckHistory'
import type { SortRecipe } from '../collection/sortRecipes'
import type { ScanCorrection } from '../scan/scanCorrections'

export interface DeckCardEntry {
  scryfallId: string
  name: string
  imageUrl: string | null
  quantity: number
  canBeCommander: boolean
  typeLine: string | null
  partnerAbility: string | null
  /** Cached from ScryfallCard's back face — see backImageUrl() in api/scryfall.ts. Null/undefined
   * for single-faced cards and for entries added before this field existed. */
  backImageUrl?: string | null
  /** Cached from cardTags() at add-time — see types/scryfall.ts. Undefined for entries added
   * before this field existed. */
  tags?: string[]
  /**
   * The user's own words about this copy — "proxy", "signed", "borrowed from Sam". They belong to
   * the copy, not to the card, so they follow it from a binder into a deck and back; every entry
   * holding the same printing carries the same set (see collection/userTags.ts). Not to be confused
   * with [tags], which Scryfall writes and the user can't change.
   */
  userTags?: string[]
  /**
   * How many of this entry's copies are proxies (see decks/proxies.ts). Undefined means "whatever
   * the deck is": all of them in a deck marked Proxy, none in any other.
   */
  proxyQuantity?: number
  /**
   * A cut candidate: still in the deck (and in every stat) but flagged as the first thing to take
   * out for something better. Synced under the same key as the phone's DeckCardEntry.replaceable.
   */
  replaceable?: boolean
  /**
   * The user's own groups for this card in this deck — "Ramp", "Removal", "Win cons"; a card can be in
   * several (decks/categories.ts). Left out when it has none. Merged like [userTags]: both devices'
   * additions kept, and one either took off stays off. The phone's DeckCardEntry.categories.
   */
  categories?: string[]
}

export interface GameResult {
  id: string
  result: 'WIN' | 'LOSS' | 'DRAW'
  /** Who they played, as names joined by ", ". */
  opponent: string | null
  playedAt: number
  /** How long the game ran, when a life counter table kept track. */
  turns?: number | null
  minutes?: number | null
  /** The commanders the opponents played (a partner pair as "A & B"). */
  commanders?: string[]
  /** Mulligans taken (0: kept seven), when the table recorded them — see decks/mulligans.ts. */
  mulligans?: number | null
}

export const GAME_MODES = [
  'COMMANDER', 'BRAWL', 'STANDARD', 'PIONEER', 'MODERN', 'PAUPER', 'LEGACY', 'VINTAGE', 'LIMITED',
] as const
export type GameMode = (typeof GAME_MODES)[number]

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  COMMANDER: 'Commander',
  BRAWL: 'Brawl',
  STANDARD: 'Standard',
  PIONEER: 'Pioneer',
  MODERN: 'Modern',
  PAUPER: 'Pauper',
  LEGACY: 'Legacy',
  VINTAGE: 'Vintage',
  // Draft and sealed: a 40-card deck from a pool, any card and any number of copies (decks/limited.ts).
  LIMITED: 'Limited',
}

export const GAME_MODES_USING_COMMANDER: ReadonlySet<GameMode> = new Set(['COMMANDER', 'BRAWL'])

/**
 * Whether a deck's cards represent real cards the user owns.
 * - PHYSICAL: a deck the user physically owns — its cards count toward what they own.
 * - VIRTUAL: a deck the user doesn't physically own (a copy of someone else's list, an
 *   online-only deck) — its cards don't count toward owned totals.
 * - PROTOTYPE: a deck still being built/tested, incomplete by design — same as Virtual, not
 *   counted as owned until the deck is finished and marked Physical.
 */
export const DECK_OWNERSHIP_OPTIONS = ['PHYSICAL', 'PROXY', 'VIRTUAL', 'PROTOTYPE'] as const
export type DeckOwnership = (typeof DECK_OWNERSHIP_OPTIONS)[number]
export const DECK_OWNERSHIP_DEFAULT: DeckOwnership = 'PHYSICAL'

export const DECK_OWNERSHIP_LABELS: Record<DeckOwnership, string> = {
  PHYSICAL: 'Physical',
  PROXY: 'Proxy',
  VIRTUAL: 'Virtual',
  PROTOTYPE: 'Prototype',
}

export const DECK_OWNERSHIP_DESCRIPTIONS: Record<DeckOwnership, string> = {
  PHYSICAL: "You own this deck's cards — they count toward your collection.",
  PROXY: "A real deck built with proxies. It counts as built, but its cards are worth nothing and aren't real copies you can trade.",
  VIRTUAL: "You don't own this deck physically — its cards aren't counted as owned.",
  PROTOTYPE: "Still being built — its cards aren't counted as owned yet.",
}

/**
 * The deck's list as it stood at [savedAt]: card name -> copies (commanders included), keyed by name
 * so that changing a card's printing doesn't read as a change. Edits within one sitting share one
 * version — see decks/versions.ts. The Android app's DeckVersion, field for field.
 */
export interface DeckVersion {
  id: string
  savedAt: number
  cards: Record<string, number>
  commanders: string[]
}

export interface Deck {
  id: string
  name: string
  commander: DeckCardEntry | null
  partnerCommander: DeckCardEntry | null
  cards: DeckCardEntry[]
  gameMode: string
  createdAt: number
  tags: string[]
  gameResults: GameResult[]
  ownership: DeckOwnership
  /**
   * A sample from the welcome flow (onboarding/onboarding.ts): shown with a "Sample" label, never
   * synced to the account, and gone with one "Remove samples". Left out on everything else.
   */
  sample?: boolean
  /** Cards being thought about for this deck (the Android app's "Considering" list). Not in the deck. */
  considering?: DeckCardEntry[]
  /** Saved versions of the list, oldest first, capped (decks/versions.ts). */
  versions?: DeckVersion[]
  /**
   * What changed in the list, when and where, and the versions saved by name — oldest first, capped
   * (decks/deckHistory.ts). Left out until the list first changes; a deck saved without it was saved
   * by an app from before it, and gets this device's back. The Android app's Deck.history.
   */
  history?: DeckHistoryEntry[]
  /**
   * The sideboard, for formats that have one (decks/sideboard.ts). Like [considering] it's kept out of
   * [cards], so it never counts toward size, curve, price or combos — only the legality check looks at
   * it (at most 15 cards; copy limits count main deck and sideboard together). JSON key "sideboard",
   * as on the phone; data saved before it existed reads as empty. Synced and merged like [considering].
   */
  sideboard?: DeckCardEntry[]
  /**
   * Where the deck's real copies came from when they were pulled from storage with its pull list
   * (collection/pullList.ts), so taking it apart can put each back there. Left out until a card is
   * first pulled into it; then kept, as [] once none are left — so a deck with no "cameFrom" key was
   * written by an app that doesn't know about it. The Android app's Deck.cameFrom, line for line.
   */
  cameFrom?: CameFrom[]
  /**
   * The deck's primer: how it plays, what to mulligan, its key cards — light markdown, with
   * [[Card Name]] as links (decks/primer.ts). At most MAX_DESCRIPTION characters.
   */
  description?: string
  /** The folder it's filed in on the decks list (decks/deckFolders.ts); "" for none. */
  folder?: string
  /** Put away: kept, but out of the decks list and every deck picker (decks/deckFolders.ts). */
  archived?: boolean
  /** The companion's name: a card in the sideboard, outside the starting deck (decks/companion.ts); "" for none. */
  companion?: string
  /**
   * How many cards the user wants in each of their categories ("Ramp": 12), by category. Also says
   * the deck's cards' "categories" are known: it's there, as {} with no targets, once any card has
   * had a category (see decks/deckExtras.ts).
   */
  categoryTargets?: Record<string, number>
}

// The deck's own words and filing, as JSON — locally, in sync and in shared decks. All left out until
// first set, then kept even when emptied ("", false, {}), so a deck with none of these keys was saved
// by an app that doesn't know them, and its save can't clear them on other devices (deckExtras.ts):
//   "description": "## How it plays\nRamp into [[Craterhoof Behemoth]]…"
//   "folder": "Modern" | ""          "archived": true | false
//   "companion": "Lurrus of the Dream-Den" | ""
//   "categoryTargets": { "Ramp": 12, "Draw": 10 }
// and on each card: "categories": ["Ramp", "Draw"], left out when it has none.

// The deck's "cameFrom" as JSON — locally and in sync:
//   "cameFrom": [{ "name": "Sol Ring", "placeId": "…", "qty": 1, "section": "Colourless" }, { "name": "Purphoros, God of the Forge", "placeId": "…", "qty": 1, "page": 5, "slot": 1, "foil": true }]
// "foil", "section", "page" and "slot" left out when not said, as in a binder entry's "places".

/**
 * Copies of the card called [name] that were pulled into a deck from one spot of a storage place: a
 * CopyPlace with the card's name. The Android app's CameFrom, field for field.
 */
export interface CameFrom extends CopyPlace {
  name: string
}

/** Commander/Brawl allow only 1 copy of any non-basic-land card; other formats allow up to
 * MAX_COPIES_DEFAULT. Mirrors the Android app's GameMode.singleton/maxCopies fields. */
export const SINGLETON_GAME_MODES: ReadonlySet<GameMode> = new Set(['COMMANDER', 'BRAWL'])
export const MAX_COPIES_DEFAULT = 4

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
])

function isBasicLand(card: ScryfallCard): boolean {
  return BASIC_LAND_NAMES.has(card.name) || (card.type_line ?? '').toLowerCase().includes('basic')
}

/**
 * Null if adding [addingQuantity] more cop(ies) of [card] to [deck] stays within its format's copy
 * limit; otherwise a short warning to show the user (the card is still added — this is
 * informational, not a block, since testing/sideboard scenarios are legitimate). Basic lands are
 * always unlimited. Mirrors the Android app's duplicateWarning() in data/DeckLegality.kt.
 */
export function duplicateWarning(deck: Deck, card: ScryfallCard, addingQuantity = 1): string | null {
  // Limited has no copy limit: a pool can hold several of a card.
  if (isBasicLand(card) || deck.gameMode === 'LIMITED') return null
  const mode = deck.gameMode as GameMode
  const modeLabel = GAME_MODE_LABELS[mode] ?? deck.gameMode
  // The sideboard's copies count toward the same limit.
  const existingQuantity = [...deck.cards, ...(deck.sideboard ?? [])].filter((c) => c.scryfallId === card.id).reduce((n, c) => n + c.quantity, 0)
  const newQuantity = existingQuantity + addingQuantity
  if (SINGLETON_GAME_MODES.has(mode) && newQuantity > 1) {
    return `${modeLabel} is singleton — you'll have ${newQuantity} copies of "${card.name}".`
  }
  if (!SINGLETON_GAME_MODES.has(mode) && newQuantity > MAX_COPIES_DEFAULT) {
    return `Max ${MAX_COPIES_DEFAULT} copies allowed in ${modeLabel} — you'll have ${newQuantity} of "${card.name}".`
  }
  return null
}

/** Fills in fields that may be missing from JSON written by an older version of either app. */
export function normalizeDeck(raw: Partial<Deck> & { id: string; name: string }): Deck {
  return {
    commander: null,
    partnerCommander: null,
    cards: [],
    gameMode: 'COMMANDER',
    createdAt: Date.now(),
    tags: [],
    gameResults: [],
    ownership: DECK_OWNERSHIP_DEFAULT,
    ...raw,
  }
}

export type CollectionType = 'OWNED' | 'WISHLIST'

export interface CollectionEntry {
  scryfallId: string
  name: string
  imageUrl: string | null
  quantity: number
  foilQuantity: number
  /** Cached from ScryfallCard's back face — see DeckCardEntry.backImageUrl. */
  backImageUrl?: string | null
  /** Cached from cardTags() at add-time — see DeckCardEntry.tags. */
  tags?: string[]
  /** Wishlists: tell the user when this card's price (USD, non-foil) is at or under this — its target. */
  priceAlert?: number | null
  /**
   * Wishlists: any printing of the card counts for [priceAlert] — the cheapest is checked (see
   * collection/wishlistTargets.ts). Left out until a target is set with it; then true or false.
   */
  alertAnyPrinting?: boolean
  /** Wishlists: only a foil copy will do — [priceAlert] is checked against the foil price. Left out and kept as [alertAnyPrinting]. */
  alertFoilOnly?: boolean
  /**
   * The user's own words about this copy — "proxy", "signed", "borrowed from Sam". They belong to
   * the copy, not to the card, so they follow it from a binder into a deck and back; every entry
   * holding the same printing carries the same set (see collection/userTags.ts). Not to be confused
   * with [tags], which Scryfall writes and the user can't change.
   */
  userTags?: string[]
  /** The Wishlist: added by itself because a deck is considering the card (see collection/wishlist.ts). */
  auto?: boolean
  /**
   * Owned binders: tell the user when this card's price rises to this or more (US dollars; see
   * collection/priceAlertRules.ts). Checked against the non-foil price, or the foil price when every
   * copy in the entry is foil. The "above" twin of [priceAlert], the wishlist's "at or below".
   */
  priceAlertAbove?: number | null
  /** The copies' condition: one of CARD_CONDITIONS ("NM", "LP", "MP", "HP", "DMG"); left out = not said. */
  condition?: string | null
  /** The language the copies are printed in, as Scryfall codes it (CARD_LANGUAGES: "en", "ja"…); left out = not said. */
  language?: string | null
  /**
   * Where the copies physically are: some in one storage place, some in another (see
   * collection/storagePlaces.ts). Never more than the entry's copies, plain and foil apart; the rest
   * have no place yet. Left out until a copy is given a place; then kept, as [] once none have one —
   * so a binder with no "places" key anywhere was written by an app that doesn't know about places.
   */
  places?: CopyPlace[]
  /**
   * Owned binders: how many of these copies the user offers for trade — friends see them (see
   * social/moreLogic.ts). Never more than the copies; left out when none.
   */
  forTrade?: number
  /**
   * Owned binders: how many of these copies the user means to sell (see collection/selling.ts). Never
   * more than the copies. Left out until the entry is first marked to sell; then kept, as 0 once none
   * are — so an entry with no "forSale" on a device that had one was saved by an app that doesn't know
   * about selling, and keepForSaleFromOlderApp puts it back.
   */
  forSale?: number
}

// The entry as JSON — locally, in sync and in shared binders — is these fields by name. Keys added
// for collecting, which the Android app reads and writes the same way (all optional, left out when
// there's nothing to say; see collection/copyDetails.ts):
//   "priceAlert":      number, USD — wishlists: notify when the price is at or below it
//   "priceAlertAbove": number, USD — owned binders: notify when the price is at or above it
//   "alertAnyPrinting": boolean — wishlists: any printing counts for "priceAlert" (the cheapest is checked)
//   "alertFoilOnly":   boolean — wishlists: "priceAlert" is checked against the foil price
//   "condition":       "NM" | "LP" | "MP" | "HP" | "DMG" — for every copy in the entry
//   "language":        "en" | "ja" | "de" | "fr" | "it" | "es" | "pt" | "ru" | "ko" | "zhs" | "zht"
//   "places":          [{ "placeId": "…", "qty": 2, "foil": true, "section": "Red" }, { "placeId": "…", "qty": 1, "page": 3, "slot": 5 }]
//                      where the copies are kept (CopyPlace below); "foil", "section", "page" and "slot" left out when not said
//   "forTrade":        number — owned binders: how many of the copies are for trade (friends can see them)
//   "forSale":         number — owned binders: how many of the copies are to sell (0 once none are; collection/selling.ts)
// Copies of one printing in different conditions aren't split into entries: the entry says one.

/**
 * Some of an entry's copies in one storage place. [foil]: these are foil copies (left out: plain).
 * In a box, [section] names the section ("Red", "2X2"); in a binder, [page] and [slot] (from 1) say
 * which pocket. The Android app's CopyPlace, field for field.
 */
export interface CopyPlace {
  placeId: string
  qty: number
  foil?: boolean
  section?: string
  page?: number
  slot?: number
}

/** What a storage place is: shown as Box, Binder, Deck box, Shelf, Other. */
export type PlaceKind = 'BOX' | 'BINDER' | 'DECK_BOX' | 'SHELF' | 'OTHER'
/** How a box is sorted, to suggest where a new card goes: by colour then A–Z, by set then number, by type, A–Z. */
export type SortRule = 'COLOUR' | 'SET' | 'TYPE' | 'NAME'

/**
 * A physical place cards are kept — a box, a binder, a shelf — made by the user and nestable
 * ("Shelf › Red box"). Kept in the Unsorted pile's [Collection.storagePlaces], so it syncs with the
 * library. The Android app's StoragePlace, field for field; optional fields are left out when not set.
 */
export interface StoragePlace {
  id: string
  name: string
  kind: PlaceKind
  /** The place it sits in; left out at the top. */
  parentId?: string
  /** A word about it — "Bulk", "Trade fodder". */
  note?: string
  /** A box's sections, in order. */
  sections?: string[]
  /** A binder's pockets per page (9 when left out). */
  pocketsPerPage?: number
  /** A box's sorting rule, or a binder's order (see collection/binderPages.ts). */
  sortRule?: SortRule
  createdAt: number
  /**
   * When the place was last checked by scanning everything in it (collection/placeCheck.ts), in
   * milliseconds; left out until then. It only moves on: two devices' checks merge to the later one,
   * and a place saved by an app that doesn't know it keeps it.
   */
  lastChecked?: number
  /**
   * How many cards a box (or any place but a binder) holds, for how full it is (collection/boxSpace.ts).
   * Left out until a size is set; 0 once it's taken off — so a place with no "capacity" on a device that
   * had one was saved by an app that doesn't know about sizes (keepPlaceSizes).
   */
  capacity?: number
  /** A binder's pages: its size is pages × pockets per page. Left out and 0 as [capacity]. */
  pages?: number
}

export interface Collection {
  id: string
  name: string
  entries: CollectionEntry[]
  createdAt: number
  type: CollectionType
  /**
   * The Wishlist: cards taken off it that a deck is still considering, so they aren't put back
   * (see collection/wishlist.ts). Lower-cased names. Forgotten once no deck considers the card.
   */
  notWanted?: string[]
  /** A sample binder from the welcome flow — see Deck.sample. */
  sample?: boolean
  /**
   * The Unsorted pile only: the user's storage places (see collection/storagePlaces.ts). The pile is
   * always there and has the same id on every device, so the places ride along with it when it syncs.
   * Left out until the first place is made; then kept, as [] once none are left.
   */
  storagePlaces?: StoragePlace[]
  /**
   * The Unsorted pile only: the user's loans — cards lent to a friend or anyone else (see
   * collection/loans.ts). They ride along with the pile when it syncs, like [storagePlaces], and merge
   * loan by loan. Left out until the first loan; then kept, as [] once none are left — so a pile with
   * no "loans" key was saved by an app that doesn't know about loans.
   */
  loans?: Loan[]
  /**
   * The Unsorted pile only: sealed product the user keeps — booster boxes, bundles, precons (see
   * collection/sealed.ts). Rides along with the pile like [loans], merged product by product. Left
   * out until the first one; then kept, as [] once none are left — so a pile with no "sealed" key was
   * saved by an app that doesn't know about sealed product.
   */
  sealed?: SealedProduct[]
  /**
   * The Unsorted pile only: graded copies — slabs, kept apart from raw copies (see
   * collection/graded.ts). Rides along like [sealed], merged slab by slab; left out and kept the same way.
   */
  graded?: GradedCard[]
  /**
   * The Unsorted pile only: the user's gear — sleeves, deck boxes, tokens, dice, playmats (see
   * collection/gear.ts). Rides along with the pile like [loans] and merges item by item. Left out until
   * the first item; then kept, as [] once none are left.
   */
  gear?: GearItem[]
  /**
   * The Unsorted pile only: the user's own sorting recipes (see collection/sortRecipes.ts). Rides along
   * like [gear] and merges recipe by recipe. Left out until the first one is saved; then kept, as [] once
   * none are left — so a pile with no "sortRecipes" key was saved by an app that doesn't know about them.
   */
  sortRecipes?: SortRecipe[]
  /**
   * The Unsorted pile only: what the scanner has learned from the user's corrections (see
   * scan/scanCorrections.ts). Rides along like [sortRecipes] and merges entry by entry, the one used
   * last winning. Left out until the first is learned; then kept, as [] once none are left.
   */
  scanCorrections?: ScanCorrection[]
}

// The pile's "sealed" and "graded" as JSON — locally and in sync, the Android app's exactly:
//   "sealed": [{ "id": "…", "name": "Duskmourn Play Booster Box", "kind": "PLAY_BOX", "setCode": "dsk", "count": 2,
//                "placeId": "…", "paidUsd": 210, "valueUsd": 238, "valueAt": 1790000000000, "createdAt": 1790000000000 },
//              { "id": "…", "name": "Precon: Blame Game", "kind": "PRECON", "preconFile": "BlameGame_DSC", "count": 1 }]
//   "graded": [{ "id": "…", "scryfallId": "…", "name": "Sheoldred, the Apocalypse", "imageUrl": "…", "foil": true,
//                "company": "PSA", "companyName": "…", "grade": "10", "cert": "…", "valueUsd": 450, "placeId": "…",
//                "section": "Slabs", "collectionId": "…", "createdAt": 1790000000000 }]
// Optional keys are left out when not said. Values are what the user entered, in US dollars: no app
// has prices for sealed product or graded copies.

/** What a sealed product is. */
export type SealedKind = 'PLAY_BOX' | 'COLLECTOR_BOX' | 'SET_BOX' | 'DRAFT_BOX' | 'BUNDLE' | 'PRECON' | 'OTHER'

/**
 * Sealed product the user keeps: [count] of one product in one place ([placeId]). [paidUsd] and
 * [valueUsd] are each, in US dollars, as the user entered them ([valueAt]: when the value was last
 * entered). A precon names its MTGJSON deck ([preconFile]) so opening it makes the deck. The Android
 * app's SealedProduct, field for field.
 */
export interface SealedProduct {
  id: string
  name: string
  kind: SealedKind
  setCode?: string
  preconFile?: string
  count: number
  placeId?: string
  paidUsd?: number
  valueUsd?: number
  valueAt?: number
  createdAt: number
}

/** Who graded a copy. */
export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'OTHER'

/**
 * One graded copy (a slab), kept apart from the raw copies: it isn't in any binder's counts, so it
 * never fills a deck slot or counts as a spare. [grade] as the slab says it ("10", "9.5"); [cert]: its
 * cert number; [valueUsd]: what the user says it's worth (card prices are for ungraded copies); where
 * it is ([placeId], [section]); [collectionId]: the binder the copy came from, to go back to if it's
 * cracked out. [companyName]: who, when [company] is OTHER. The Android app's GradedCard, field for field.
 */
export interface GradedCard {
  id: string
  scryfallId: string
  name: string
  imageUrl?: string
  foil?: boolean
  company: GradingCompany
  companyName?: string
  grade: string
  cert?: string
  valueUsd?: number
  placeId?: string
  section?: string
  collectionId?: string
  createdAt: number
}

/** What a piece of gear is. */
export type GearKind = 'SLEEVES' | 'INNER_SLEEVES' | 'DECK_BOX' | 'TOKENS' | 'DICE' | 'PLAYMAT' | 'OTHER'

/**
 * A piece of gear (collection/gear.ts). [count]: sleeves left, tokens of that name, dice… (1 for a
 * deck box). [usedBy]: the decks, binders or places a pack of sleeves is on. [holds]: the deck (or
 * binder) a deck box holds. [placeId]: where it's kept. The Android app's GearItem, field for field.
 */
export interface GearItem {
  id: string
  kind: GearKind
  name: string
  count: number
  usedBy?: string[]
  holds?: string
  placeId?: string
  note?: string
  createdAt: number
}

// The pile's "loans" as JSON — locally and in sync:
//   "loans": [{ "id": "…", "to": "Sam", "friendId": "…", "lentAt": 1790000000000, "backBy": "2026-10-12",
//               "gameNight": true, "note": "for Saturday", "returnedAt": 1790000000000,
//               "cards": [{ "name": "Sol Ring", "scryfallId": "…", "qty": 1, "deckId": "…" },
//                         { "name": "The One Ring", "scryfallId": "…", "qty": 1, "foil": true, "collectionId": "unsorted",
//                           "placeId": "…", "page": 3, "slot": 5, "back": 1 }] }]
// Optional keys are left out when not said, as in a binder entry's "places".

/**
 * Copies of one card lent in a loan, with where they came from: a deck ([deckId]), or a binder's
 * entry ([collectionId]) — and, when they were in a place, that spot ([placeId], [section], [page],
 * [slot]), so getting them back puts them there again. [back]: how many have come back. The Android
 * app's LoanCard, field for field.
 */
export interface LoanCard {
  name: string
  scryfallId: string
  qty: number
  foil?: boolean
  collectionId?: string
  placeId?: string
  section?: string
  page?: number
  slot?: number
  deckId?: string
  back?: number
}

/**
 * Cards lent to someone: a friend by account ([friendId]) or anyone by name ([to] — a friend's name
 * too). [backBy]: the day they're due back ("2026-10-12"); [gameNight]: due at the next game night.
 * [returnedAt]: when the last card came back. The Android app's Loan, field for field.
 */
export interface Loan {
  id: string
  to: string
  friendId?: string
  cards: LoanCard[]
  lentAt: number
  backBy?: string
  gameNight?: boolean
  note?: string
  returnedAt?: number
}

/**
 * The one pile of owned cards that aren't in a binder yet — a whole collection imported before it's
 * sorted. The same id on every device, so piles made on two devices merge into one when they sync.
 */
export const UNSORTED_COLLECTION_ID = 'unsorted'
export const UNSORTED_COLLECTION_NAME = 'Unsorted'

/** Whether [c] is the Unsorted pile — owned cards, but not a binder itself. */
export const isUnsorted = (c: Collection): boolean => c.id === UNSORTED_COLLECTION_ID

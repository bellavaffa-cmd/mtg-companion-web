// "Upgrade with my cards": swaps for a deck — cut X, add Y — where Y is a card the user already owns,
// legal in the deck, doing the same job (role tags, tags/roleTags.ts) and better for it: more played
// with this commander on EDHREC, or, with no EDHREC numbers (offline, or not a commander deck), a
// better EDHREC rank for its mana value. Never cuts the commander, a land, a card tagged "keep" or a
// piece of a combo the deck has; never adds a card that would push the deck's Commander bracket up
// (decks/deckAnalysis.ts estimateBracket) — those are kept apart, marked, and hidden by default.
//
// Pure, so both apps run the same cases: tests/decks/deckUpgradeVectors.json is run here
// (tests/decks/deckUpgrade.test.ts) and by the Android app (DeckUpgradeTest.kt), which mirrors this
// file as data/DeckUpgrade.kt rule for rule.

import { UNSORTED_COLLECTION_ID, type Collection, type CollectionEntry, type Deck, type DeckCardEntry } from '../types/models'
import { intoPile, pileEntryOf, realCopiesLeaving, withUnsortedPile } from '../collection/unsorted'
import { estimateBracket, isLandType } from './deckAnalysis'
import { cardNameKeys } from './comboPieces'
import { proxyCopies } from './proxies'

/** The jobs swaps are matched on, the most important first: a card doing several counts for the first. */
export const UPGRADE_ROLES = [
  'ramp', 'draw', 'removal', 'board-wipe', 'counterspell', 'tutor', 'protection', 'recursion', 'reanimate',
  'sacrifice-outlet', 'tokens', 'graveyard-hate', 'burn', 'lifegain',
] as const

/** "Both are …" */
const ROLE_WORDS: Record<string, string> = {
  ramp: 'ramp', draw: 'card draw', removal: 'removal', 'board-wipe': 'board wipes', counterspell: 'counterspells',
  tutor: 'tutors', protection: 'protection', recursion: 'recursion', reanimate: 'reanimation',
  'sacrifice-outlet': 'sacrifice outlets', tokens: 'token makers', 'graveyard-hate': 'graveyard hate', burn: 'burn', lifegain: 'lifegain',
}
export const roleWord = (role: string) => ROLE_WORDS[role] ?? role

/** How much better the card coming in has to be: EDHREC percentage points, or offline score points. */
export const MIN_GAIN = 10
/** Swaps shown, and swaps that would raise the bracket kept aside. */
export const MAX_SWAPS = 15
export const MAX_BRACKET_SWAPS = 5
/** A user tag that says "never suggest cutting this" (collection/userTags.ts), compared lower-case. */
export const KEEP_TAGS = ['keep', 'must keep', 'must-keep', 'pinned']

/** What both sides of a swap know about a card. */
export interface UpgradeCard {
  name: string
  scryfallId: string
  typeLine: string | null
  cmc: number | null
  /** Role tag ids (tags/roleTags.ts). */
  roles: string[]
  usd: number | null
  gameChanger: boolean
  /** Scryfall's edhrec_rank: its place among all cards by how many decks play it. */
  edhrecRank: number | null
  /** EDHREC: the percentage (whole) of this commander's decks that run it; null when not on its page. */
  inclusion: number | null
}

/** A card in the deck: a cut candidate unless it's the commander, kept, or a combo piece. */
export interface UpgradeDeckCard extends UpgradeCard {
  commander: boolean
  /** Marked as a cut candidate (DeckCardEntry.replaceable): cut first, for any gain. */
  replaceable: boolean
  /** Tagged "keep" by the user (KEEP_TAGS): never cut. */
  keep: boolean
  /** Part of a combo the deck has: cutting it would break it. */
  comboPiece: boolean
}

/** A card the user owns that isn't in the deck. */
export interface UpgradeOwnedCard extends UpgradeCard {
  /** Colour identity letters ("RG", "" colourless); null when not known yet. */
  identity: string | null
  /** Legal in the deck's format. */
  legal: boolean
  /** Adding it completes a combo the deck is one card short of. */
  completesCombo: boolean
  /** Copies free to take: in binders and boxes, less those other decks are waiting on. */
  spare: number
  /** With no spare copy, the deck that has (or is waiting on) the only one. */
  heldBy: string | null
  /** Where a spare copy is: "Red box › Red", "Duskmourn binder p3 s5", "Unsorted". */
  where: string | null
  /** The place (or binder) it's in, for "pull from 3 places". */
  placeKey: string | null
}

export interface UpgradeInput {
  /** The commander's name, for "in 61% of Krenko decks". */
  commander: string | null
  /** The colours cards must be inside ("RG"; "" colourless only); null for no limit. */
  identity: string | null
  /** EDHREC's numbers ([inclusion]) are there; false matches by role and EDHREC rank alone. */
  edhrec: boolean
  /** For the bracket guard: the deck's Game Changers and complete combos now; null for no guard (not Commander). */
  bracket: { gameChangers: number; combos: number } | null
  deck: UpgradeDeckCard[]
  owned: UpgradeOwnedCard[]
  /** Swaps the user said "Not this one" to (pairKey). */
  dismissed: string[]
}

export interface UpgradeSwap {
  /** pairKey(cut, add): what "Not this one" remembers. */
  key: string
  cut: UpgradeDeckCard
  add: UpgradeOwnedCard
  role: string
  /** In plain words: "Both are ramp; Farseek is in 61% of Krenko decks, Wayfarer's Bauble in 22%." */
  reason: string
  /** "Red box › Red", or "in Atraxa deck" when another deck has the only copy. */
  where: string
  /** How much better the card coming in scores. */
  gain: number
  /** The card coming in less the one going out, in US dollars; null when either price isn't known. */
  priceDelta: number | null
  /** The bracket the deck would move to, for a swap that would raise it; null otherwise. */
  raisesBracketTo: number | null
}

const nameKey = (name: string) => name.trim().toLowerCase()
export const pairKey = (cut: string, add: string) => `${nameKey(cut)}>${nameKey(add)}`

/** The card's score: its EDHREC inclusion, or offline, its EDHREC rank against what it costs. */
export function upgradeScore(card: UpgradeCard, edhrec: boolean): number {
  if (edhrec) return card.inclusion ?? 0
  const rank = card.edhrecRank == null ? 0 : 100 / (1 + card.edhrecRank / 1000)
  return round2(rank - 3 * (card.cmc ?? 0))
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** 12345 → "12,345". */
export function grouped(n: number): string {
  const digits = String(Math.trunc(Math.abs(n)))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return (n < 0 ? '-' : '') + out
}

/** "Krenko, Mob Boss" → "Krenko"; "Kraum // …" → its front face. */
export const shortCommander = (name: string) => name.split(' // ')[0].split(',')[0].trim()

/** The first of UPGRADE_ROLES a card does, or null. */
export const upgradeRoleOf = (roles: string[]) => UPGRADE_ROLES.find((r) => roles.includes(r)) ?? null

function isInside(identity: string | null, limit: string | null): boolean {
  if (limit == null) return true
  if (identity == null) return false
  const allowed = limit.toUpperCase()
  return [...identity.toUpperCase()].every((c) => allowed.includes(c))
}

/** Why the swap is worth it, in plain words. */
export function upgradeReason(cut: UpgradeDeckCard, add: UpgradeOwnedCard, role: string, input: Pick<UpgradeInput, 'commander' | 'edhrec'>): string {
  let out = `Both are ${roleWord(role)}`
  if (input.edhrec) {
    const whose = input.commander ? `${shortCommander(input.commander)} decks` : 'decks'
    out += `; ${add.name} is in ${add.inclusion ?? 0}% of ${whose}, `
    out += cut.inclusion != null ? `${cut.name} in ${cut.inclusion}%.` : `${cut.name} isn't on EDHREC's list for it.`
  } else {
    const parts: string[] = []
    if (add.edhrecRank != null && cut.edhrecRank != null) parts.push(`${add.name} ranks #${grouped(add.edhrecRank)} on EDHREC, ${cut.name} #${grouped(cut.edhrecRank)}`)
    else if (add.edhrecRank != null) parts.push(`${add.name} ranks #${grouped(add.edhrecRank)} on EDHREC`)
    if (add.cmc != null && cut.cmc != null && add.cmc < cut.cmc) parts.push(`${add.name} costs ${grouped(cut.cmc - add.cmc)} less`)
    out += parts.length > 0 ? `; ${parts.join('; ')}.` : '.'
  }
  if (cut.replaceable) out += ` You marked ${cut.name} as a cut.`
  return out
}

/**
 * The swaps for the deck, best first: those that keep its bracket, then (marked with the bracket
 * they'd move it to) those that wouldn't. Role by role, the best card owned for the job is paired
 * with the deck's weakest one doing it — cards marked as cuts first — when it's better by MIN_GAIN
 * (any gain for a marked cut). Each card is in one swap at most, and cards that would raise the
 * bracket on their own are paired last, so they don't take the cuts the others could use.
 */
export function upgradeSwaps(input: UpgradeInput): UpgradeSwap[] {
  const { edhrec } = input
  const inDeck = new Set(input.deck.flatMap((c) => cardNameKeys(c.name)))
  const dismissed = new Set(input.dismissed)
  const score = (c: UpgradeCard) => upgradeScore(c, edhrec)
  const cuts = input.deck.filter((c) => !c.commander && !c.keep && !c.comboPiece && !isLandType(c.typeLine) && upgradeRoleOf(c.roles) != null)
  const adds = input.owned.filter((c) =>
    c.legal && !isLandType(c.typeLine) && upgradeRoleOf(c.roles) != null && isInside(c.identity, input.identity)
    && (c.spare > 0 || c.heldBy != null) && !cardNameKeys(c.name).some((k) => inDeck.has(k)))
  const byName = (a: UpgradeCard, b: UpgradeCard) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const usedCuts = new Set<string>()
  const usedAdds = new Set<string>()
  const found: UpgradeSwap[] = []
  // A card that would raise the bracket by itself only gets the cuts the others leave.
  const now = input.bracket ? estimateBracket(input.bracket.gameChangers, input.bracket.combos).bracket : 0
  const raisesAlone = (c: UpgradeOwnedCard) => input.bracket != null
    && estimateBracket(input.bracket.gameChangers + (c.gameChanger ? 1 : 0), input.bracket.combos + (c.completesCombo ? 1 : 0)).bracket > now
  for (const pass of [false, true]) {
    for (const role of UPGRADE_ROLES) {
      const roleCuts = cuts.filter((c) => c.roles.includes(role))
        .sort((a, b) => Number(b.replaceable) - Number(a.replaceable) || score(a) - score(b) || byName(a, b))
      const roleAdds = adds.filter((c) => c.roles.includes(role) && raisesAlone(c) === pass).sort((a, b) => score(b) - score(a) || byName(a, b))
      for (const add of roleAdds) {
        if (usedAdds.has(nameKey(add.name))) continue
        const cut = roleCuts.find((c) => {
          if (usedCuts.has(nameKey(c.name)) || dismissed.has(pairKey(c.name, add.name))) return false
          const gain = score(add) - score(c)
          return c.replaceable ? gain > 0 : gain >= MIN_GAIN
        })
        if (!cut) continue
        usedCuts.add(nameKey(cut.name))
        usedAdds.add(nameKey(add.name))
        found.push({
          key: pairKey(cut.name, add.name),
          cut, add, role,
          reason: upgradeReason(cut, add, role, input),
          where: add.spare > 0 ? add.where ?? 'In your collection' : `in ${add.heldBy} deck`,
          gain: round2(score(add) - score(cut)),
          priceDelta: add.usd != null && cut.usd != null ? round2(add.usd - cut.usd) : null,
          raisesBracketTo: null,
        })
      }
    }
  }
  found.sort((a, b) => Number(b.cut.replaceable) - Number(a.cut.replaceable) || b.gain - a.gain || byName(a.add, b.add))
  if (!input.bracket) return found.slice(0, MAX_SWAPS)
  // Taken in order, as "Apply all" would: each swap that keeps the bracket counts toward the next.
  let { gameChangers, combos } = input.bracket
  const keeping: UpgradeSwap[] = []
  const raising: UpgradeSwap[] = []
  for (const swap of found) {
    const gc = gameChangers + (swap.add.gameChanger ? 1 : 0) - (swap.cut.gameChanger ? 1 : 0)
    const co = combos + (swap.add.completesCombo ? 1 : 0)
    const after = estimateBracket(gc, co).bracket
    if (after > now) {
      raising.push({ ...swap, raisesBracketTo: after })
    } else {
      gameChangers = gc
      combos = co
      keeping.push(swap)
    }
  }
  return [...keeping.slice(0, MAX_SWAPS), ...raising.slice(0, MAX_BRACKET_SWAPS)]
}

/** "Would move the deck to bracket 4". */
export const bracketWarning = (bracket: number) => `Would move the deck to bracket ${bracket}`

/** "8 upgrades from your cards · would save $12.40 · pull from 3 places": what buying the cards coming in would cost. */
export function upgradeSummary(swaps: UpgradeSwap[], money: (usd: number) => string): string {
  const n = swaps.length
  const saved = round2(swaps.reduce((t, s) => t + (s.add.usd ?? 0), 0))
  const places = new Set(swaps.filter((s) => s.add.spare > 0 && s.add.placeKey).map((s) => s.add.placeKey)).size
  const parts = [`${n} upgrade${n === 1 ? '' : 's'} from your cards`, `would save ${money(saved)}`]
  if (places > 0) parts.push(`pull from ${places} place${places === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

// ---- Where the owned cards are ----

/** One card the user owns, by name: how many copies are free, and where one is. */
export interface OwnedSource {
  name: string
  scryfallId: string
  spare: number
  heldBy: string | null
  where: string | null
  placeKey: string | null
}

const holdsCards = (deck: Deck) => deck.ownership === 'PHYSICAL' || deck.ownership === 'PROXY'

/**
 * Every card the user owns outside [deckId], by name key: the copies in binders, boxes and the Unsorted
 * pile (wishlists not), less the copies other decks that don't hold their cards are waiting on (their
 * pull lists); and the cards only another deck you hold has. A spare copy's place is the first spot
 * found — a place before a binder with no place.
 */
export function ownedSources(collections: Collection[], decks: Deck[], deckId: string): Map<string, OwnedSource> {
  const places = new Map((collections.find((c) => c.storagePlaces)?.storagePlaces ?? []).map((p) => [p.id, p]))
  const out = new Map<string, OwnedSource & { placed: boolean }>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      const copies = e.quantity + (e.foilQuantity ?? 0)
      if (copies <= 0) continue
      const key = nameKey(e.name)
      const had = out.get(key) ?? { name: e.name, scryfallId: e.scryfallId, spare: 0, heldBy: null, where: null, placeKey: null, placed: false }
      had.spare += copies
      if (!had.placed) {
        const line = (e.places ?? []).find((l) => l.qty > 0 && places.has(l.placeId))
        if (line) {
          const place = places.get(line.placeId)!
          had.where = `${place.name}${line.section ? ` › ${line.section}` : ''}${line.page && line.slot ? ` p${line.page} s${line.slot}` : ''}`
          had.placeKey = `place:${place.id}`
          had.placed = true
          had.scryfallId = e.scryfallId
        } else if (had.where == null) {
          had.where = c.name
          had.placeKey = `binder:${c.id}`
        }
      }
      out.set(key, had)
    }
  }
  const waiting = new Map<string, { qty: number; deck: string }>()
  const heldIn = new Map<string, { name: string; scryfallId: string; deck: string }>()
  for (const d of decks) {
    if (d.id === deckId) continue
    for (const e of d.cards) {
      const key = nameKey(e.name)
      if (holdsCards(d)) {
        if (e.quantity - proxyCopies(d, e) > 0 && !heldIn.has(key)) heldIn.set(key, { name: e.name, scryfallId: e.scryfallId, deck: d.name })
      } else {
        const need = Math.max(0, e.quantity - Math.max(0, e.proxyQuantity ?? 0))
        if (need <= 0) continue
        const w = waiting.get(key)
        if (w) w.qty += need
        else waiting.set(key, { qty: need, deck: d.name })
      }
    }
  }
  const result = new Map<string, OwnedSource>()
  for (const [key, s] of out) {
    const w = waiting.get(key)
    const spare = s.spare - (w?.qty ?? 0)
    result.set(key, {
      name: s.name, scryfallId: s.scryfallId, spare: Math.max(0, spare),
      heldBy: spare > 0 ? null : w?.deck ?? heldIn.get(key)?.deck ?? null,
      where: spare > 0 ? s.where : null, placeKey: spare > 0 ? s.placeKey : null,
    })
  }
  for (const [key, h] of heldIn) {
    if (!result.has(key)) result.set(key, { name: h.name, scryfallId: h.scryfallId, spare: 0, heldBy: h.deck, where: null, placeKey: null })
  }
  return result
}

// ---- Swapping ----

/**
 * The deck once a swap is made: [cut] (all its copies) onto Considering, as a cut always goes, and
 * [add] into the deck — on the deck's pull list (collection/pullList.ts), so it's fetched from where
 * it's kept: a deck holding its cards counts the new copy as still to pull until it's moved in.
 */
export function withUpgrade(deck: Deck, cutId: string, add: DeckCardEntry): Deck {
  const cut = deck.cards.find((c) => c.scryfallId === cutId)
  if (!cut || deck.cards.some((c) => c.scryfallId === add.scryfallId)) return deck
  const considering = (deck.considering ?? []).filter((c) => c.scryfallId !== cut.scryfallId && c.scryfallId !== add.scryfallId)
  const { proxyQuantity: _old, ...rest } = add
  const incoming: DeckCardEntry = { ...rest, quantity: 1, replaceable: false, ...(holdsCards(deck) ? { proxyQuantity: 1 } : {}) }
  return {
    ...deck,
    cards: [...deck.cards.filter((c) => c.scryfallId !== cutId), incoming],
    considering: [...considering, { ...cut, replaceable: false }],
  }
}

/**
 * [swaps] made in deck [deckId], in one change: each as withUpgrade, and the real copies of each card
 * cut (a physical deck's, proxies aside) back to the Unsorted pile, as moving a card to Considering does.
 */
export function applyUpgrades(
  collections: Collection[], decks: Deck[], deckId: string, swaps: { cutId: string; add: DeckCardEntry }[],
): { collections: Collection[]; decks: Deck[] } {
  const before = decks.find((d) => d.id === deckId)
  if (!before) return { collections, decks }
  let deck = before
  const back: CollectionEntry[] = []
  for (const s of swaps) {
    const cut = deck.cards.find((c) => c.scryfallId === s.cutId)
    const next = withUpgrade(deck, s.cutId, s.add)
    if (next === deck || !cut) continue
    const leaving = realCopiesLeaving(deck, cut, 0)
    if (leaving > 0) back.push(pileEntryOf(cut, leaving))
    deck = next
  }
  if (deck === before) return { collections, decks }
  const cols = back.length === 0 ? collections
    : withUnsortedPile(collections).map((c) => (c.id === UNSORTED_COLLECTION_ID ? { ...c, entries: intoPile(c.entries, back) } : c))
  return { collections: cols, decks: decks.map((d) => (d.id === deckId ? deck : d)) }
}

const DISMISSED_KEY = 'mtgweb_upgrade_dismissed'

/** The swaps the user said "Not this one" to for [deckId], in this browser. */
export function loadDismissed(deckId: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, string[]>
    return Array.isArray(all[deckId]) ? all[deckId] : []
  } catch {
    return []
  }
}

export function saveDismissed(deckId: string, keys: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, string[]>
    all[deckId] = keys
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(all))
  } catch { /* this visit only */ }
}

import type { Collection, CollectionEntry, Deck, DeckCardEntry, StoragePlace } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { cardColours } from './limited'
import { proxyCopies } from './proxies'
import { moveCopies, placeCopies, placedCopies, placesOf, storagePlace } from '../collection/storagePlaces'
import { pullList, type PullList } from '../collection/pullList'

/*
 * Cubes: a list of cards, usually one of each, that a group drafts from. A cube is kept as a deck
 * (Deck.gameMode "CUBE") so it syncs, merges card by card, backs up and shares with friends the way a
 * deck does — no new kind of library item, so nothing on the server changes. Its own settings ride in
 * the deck's JSON under "cube" (CubeSettings). A cube is always:
 *  - Virtual: its cards never count as owned (the copies stay in the collection, in the cube box);
 *  - archived: an app from before cubes shows it with the archived decks and offers it in no picker;
 *  - kept out of the decks list, deck pickers, versions and history by apps that know about cubes.
 *
 * The cube box is a storage place (collection/storagePlaces.ts) named after the cube. An owned card is
 * "in the cube box" when a copy of it is placed there; the pull list (collection/pullList.ts) finds the
 * rest and "Move into cube box" moves them there, so the collection always says where each copy is. A
 * card nobody owns can be in the cube too: it reads "Not owned" until it's marked as a proxy (the
 * deck's own proxyQuantity, see decks/proxies.ts).
 *
 * Everything here is pure, so it can be tested. Mirrors the Android app's data/Cube.kt rule for rule;
 * the shared cases are in tests/decks/cubeVectors.json (cube.test.ts ↔ CubeTest.kt).
 */

/** The deck's game mode that makes it a cube. */
export const CUBE_MODE = 'CUBE'

/** The sizes offered when making a cube; any other is "Custom". */
export const CUBE_SIZES = [360, 540, 720]
export const CUBE_DEFAULT_SIZE = 360
export const CUBE_MIN_SIZE = 40
export const CUBE_MAX_SIZE = 1500

/** Packs for a draft: 15 cards × 3 packs a seat, 8 seats, unless the cube says otherwise. */
export const CUBE_PACK_SIZE = 15
export const CUBE_PACKS = 3
export const CUBE_SEATS = 8

/**
 * A cube's own settings, as JSON under the deck's "cube" key:
 *   "cube": { "size": 360, "singleton": true, "boxPlaceId": "…", "packSize": 15, "packs": 3, "seats": 8 }
 * Optional keys are left out when not set. The Android app's CubeSettings, field for field.
 */
export type CubeSettings = NonNullable<Deck['cube']>
export type CubeDeck = Deck

export const isCube = (deck: Deck): boolean => deck.gameMode === CUBE_MODE

/** The cube's settings, or the defaults for one saved without them. */
export const cubeSettings = (deck: Deck): CubeSettings => (deck as CubeDeck).cube ?? { size: CUBE_DEFAULT_SIZE, singleton: true }

/** A size the cube can be: within CUBE_MIN_SIZE..CUBE_MAX_SIZE. */
export const cubeSize = (size: number): number => Math.min(CUBE_MAX_SIZE, Math.max(CUBE_MIN_SIZE, Math.floor(size) || CUBE_DEFAULT_SIZE))

/** A new, empty cube. */
export function newCube(id: string, name: string, size: number, singleton: boolean, now: number): CubeDeck {
  return {
    id,
    name: name.trim() || 'My cube',
    commander: null,
    partnerCommander: null,
    cards: [],
    gameMode: CUBE_MODE,
    createdAt: now,
    tags: [],
    gameResults: [],
    ownership: 'VIRTUAL',
    archived: true,
    cube: { size: cubeSize(size), singleton },
  }
}

/** [deck] kept a cube: Virtual and archived, whatever an older app did to it. The same object when it is. */
export function asCube(deck: Deck): CubeDeck {
  const d = deck as CubeDeck
  if (d.ownership === 'VIRTUAL' && d.archived === true && d.cube) return d
  return { ...d, ownership: 'VIRTUAL', archived: true, cube: cubeSettings(d) }
}

/**
 * [theirs] with [source]'s cube settings put back when [theirs] was saved by an app that doesn't know
 * about cubes (no "cube" key) — the same object otherwise.
 */
export function keepCubeFromOlderApp<T extends Deck>(source: Deck, theirs: T): T {
  const s = (source as CubeDeck).cube
  if ((theirs as CubeDeck).cube || !s) return theirs
  return { ...theirs, cube: s }
}

const same = (a: unknown, b: unknown) => a === b
function pickCube<T>(base: T, mine: T, theirs: T, minePreferred: boolean): T {
  if (same(mine, theirs)) return mine
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  return minePreferred ? mine : theirs
}

/** Two devices' cube settings, field by field: whoever changed one, or the more recent edit. Undefined when neither side has any. */
export function mergeCubeSettings(
  base: CubeSettings | undefined, mine: CubeSettings | undefined, theirs: CubeSettings | undefined, minePreferred: boolean,
): CubeSettings | undefined {
  if (!mine && !theirs) return undefined
  const m = mine ?? theirs!
  const t = theirs ?? mine!
  const b = base ?? t
  const out: CubeSettings = {
    size: pickCube(b.size, m.size, t.size, minePreferred),
    singleton: pickCube(b.singleton, m.singleton, t.singleton, minePreferred),
  }
  const boxPlaceId = pickCube(b.boxPlaceId, m.boxPlaceId, t.boxPlaceId, minePreferred)
  const packSize = pickCube(b.packSize, m.packSize, t.packSize, minePreferred)
  const packs = pickCube(b.packs, m.packs, t.packs, minePreferred)
  const seats = pickCube(b.seats, m.seats, t.seats, minePreferred)
  if (boxPlaceId != null) out.boxPlaceId = boxPlaceId
  if (packSize != null) out.packSize = packSize
  if (packs != null) out.packs = packs
  if (seats != null) out.seats = seats
  return out
}

// ---- What the balance needs to know about a card ----

/**
 * One card's facts for the balance, the fill suggestions and the filters: its colours (W U B R G),
 * type line, mana value, rarity, set code, price in US dollars, rules text and the mana it makes.
 */
export interface CubeCard {
  id: string
  name: string
  colors: string[]
  typeLine: string
  cmc: number
  rarity: string
  set: string
  usd: number | null
  text: string
  producedMana: string[]
}

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A Scryfall card's facts for the cube. */
export function cubeCardOf(card: ScryfallCard): CubeCard {
  return {
    id: card.id,
    name: card.name,
    colors: cardColours(card),
    typeLine: card.type_line ?? card.card_faces?.[0]?.type_line ?? '',
    cmc: card.cmc ?? 0,
    rarity: (card.rarity ?? '').toLowerCase(),
    set: (card.set ?? '').toLowerCase(),
    usd: num(card.prices?.usd) ?? num(card.prices?.usd_foil),
    text: [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter((t): t is string => t != null).join('\n'),
    producedMana: card.produced_mana ?? [],
  }
}

/** A card in the cube and how many copies. */
export interface CubeLine { card: CubeCard; qty: number }

const WUBRG = ['W', 'U', 'B', 'R', 'G']

/** The balance's colour groups, in order: each colour, then multicolour, colourless and lands. */
export const CUBE_GROUPS = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L']
export const CUBE_GROUP_LABELS: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolour', C: 'Colourless', L: 'Lands',
}

/** Share of the cube each group should have, in thousandths. */
const GROUP_WEIGHTS = [140, 140, 140, 140, 140, 110, 80, 110]

const frontType = (typeLine: string) => typeLine.split(' // ')[0]
const hasWord = (line: string, word: string) => new RegExp(`\\b${word}\\b`).test(line)

/** Which group a card is in (a key of CUBE_GROUP_LABELS): a land, one colour, several, or none. */
export function cubeGroupOf(card: CubeCard): string {
  if (hasWord(frontType(card.typeLine), 'Land')) return 'L'
  const colours = WUBRG.filter((c) => card.colors.includes(c))
  if (colours.length === 0) return 'C'
  if (colours.length > 1) return 'M'
  return colours[0]
}

const isLandCard = (card: CubeCard) => cubeGroupOf(card) === 'L'

/** The card types the type mix counts, in order, and their names. */
export const CUBE_TYPES = ['creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle', 'land', 'other']
export const CUBE_TYPE_LABELS: Record<string, string> = {
  creature: 'Creatures', planeswalker: 'Planeswalkers', instant: 'Instants', sorcery: 'Sorceries',
  artifact: 'Artifacts', enchantment: 'Enchantments', battle: 'Battles', land: 'Lands', other: 'Other',
}

/** A card's main type: a creature first (an artifact creature is a creature), then the rest in CUBE_TYPES order. */
export function cubeTypeOf(card: CubeCard): string {
  const line = frontType(card.typeLine)
  for (const t of ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land']) {
    if (hasWord(line, t)) return t.toLowerCase()
  }
  return 'other'
}

// ---- Roles ----

/** The jobs the balance counts, in order, with their share of the cube in thousandths. */
export const CUBE_ROLES = ['removal', 'fixing', 'draw', 'counter']
export const CUBE_ROLE_LABELS: Record<string, string> = { removal: 'Removal', fixing: 'Fixing', draw: 'Card draw', counter: 'Counterspells' }
const ROLE_WEIGHTS: Record<string, number> = { removal: 120, fixing: 80, draw: 60, counter: 30 }

const REMOVAL = /(destroy|exile) (target|each|all|up to)|deals? (\d+|x) damage to (any target|target|each creature)|gets? -\d+\/-\d+|fights? (target|another|up to)|return target [a-z ]*(creature|permanent) to its owner's hand/i
const FIXING_TEXT = /mana of any (one )?colou?r|search your library for [^.]*(basic land|plains|island|swamp|mountain|forest)|add \{[wubrg]\} or \{[wubrg]\}/i
const DRAW = /draws? (a|an|two|three|four|five|x|\d+) (additional )?cards?/i
const COUNTER = /counter target/i

/** The jobs [card] does, in CUBE_ROLES order: read from its rules text (and, for a land, the mana it makes). */
export function cubeRolesOf(card: CubeCard): string[] {
  const out: string[] = []
  if (REMOVAL.test(card.text)) out.push('removal')
  const colours = new Set(card.producedMana.filter((c) => WUBRG.includes(c))).size
  if ((isLandCard(card) && colours >= 2) || FIXING_TEXT.test(card.text)) out.push('fixing')
  if (DRAW.test(card.text)) out.push('draw')
  if (COUNTER.test(card.text)) out.push('counter')
  return out
}

// ---- Targets and the balance ----

/** [total] split in proportion to [weights], whole numbers that add up to it: the largest remainders get the rest, ties in order. */
export function splitByWeight(total: number, weights: number[]): number[] {
  if (total <= 0) return weights.map(() => 0)
  const sum = weights.reduce((a, b) => a + b, 0)
  const base = weights.map((w) => Math.floor((total * w) / sum))
  const rest = weights.map((w) => (total * w) % sum)
  let left = total - base.reduce((a, b) => a + b, 0)
  const order = weights.map((_, i) => i).sort((a, b) => rest[b] - rest[a] || a - b)
  for (const i of order) {
    if (left <= 0) break
    base[i]++
    left--
  }
  return base
}

/** How many cards of each group a cube of [size] aims for (keys of CUBE_GROUP_LABELS). */
export function cubeTargets(size: number): Record<string, number> {
  const split = splitByWeight(size, GROUP_WEIGHTS)
  return Object.fromEntries(CUBE_GROUPS.map((g, i) => [g, split[i]]))
}

/** How far a count can be from its target before the balance says so. */
export const cubeTolerance = (target: number): number => Math.max(2, Math.floor((target + 9) / 10))

const perMille = (n: number, pm: number) => Math.floor((n * pm + 500) / 1000)

/** The mana value buckets of the curve (non-land cards), and their share in thousandths. */
export const CUBE_CURVE = ['1', '2', '3', '4', '5', '6+']
const CURVE_WEIGHTS = [120, 250, 230, 180, 120, 100]

function curveKey(cmc: number): string {
  const mv = Math.floor(cmc)
  if (mv <= 1) return '1'
  if (mv >= 6) return '6+'
  return String(mv)
}

/** A count against its target (null where there's none). */
export interface CubeCount { key: string; label: string; count: number; target: number | null }

export interface CubeBalance {
  total: number
  size: number
  groups: CubeCount[]
  curve: CubeCount[]
  /** Average mana value of the non-land cards, to two places; 0 with none. */
  averageMv: number
  types: CubeCount[]
  roles: CubeCount[]
  /** What's off, most important first: "12 cards short of 360", "Green is 12 short"… */
  warnings: string[]
}

const groupVerb = (key: string) => (key === 'L' ? 'are' : 'is')
const nameKey = (name: string) => name.trim().toLowerCase()

/** The cube's balance: counts per colour group, curve, types and roles against simple targets for [size], and what's off. */
export function cubeBalance(lines: CubeLine[], size: number, singleton: boolean): CubeBalance {
  const total = lines.reduce((a, l) => a + l.qty, 0)
  const targets = cubeTargets(size)
  const groupCounts: Record<string, number> = Object.fromEntries(CUBE_GROUPS.map((g) => [g, 0]))
  const typeCounts: Record<string, number> = Object.fromEntries(CUBE_TYPES.map((t) => [t, 0]))
  const roleCounts: Record<string, number> = Object.fromEntries(CUBE_ROLES.map((r) => [r, 0]))
  const curveCounts: Record<string, number> = Object.fromEntries(CUBE_CURVE.map((k) => [k, 0]))
  let nonLand = 0
  let mvSum = 0
  for (const l of lines) {
    if (l.qty <= 0) continue
    const g = cubeGroupOf(l.card)
    groupCounts[g] += l.qty
    typeCounts[cubeTypeOf(l.card)] += l.qty
    for (const r of cubeRolesOf(l.card)) roleCounts[r] += l.qty
    if (g !== 'L') {
      nonLand += l.qty
      mvSum += l.card.cmc * l.qty
      curveCounts[curveKey(l.card.cmc)] += l.qty
    }
  }
  const curveTargets = splitByWeight(size - targets.L, CURVE_WEIGHTS)
  const groups = CUBE_GROUPS.map((g) => ({ key: g, label: CUBE_GROUP_LABELS[g], count: groupCounts[g], target: targets[g] }))
  const curve = CUBE_CURVE.map((k, i) => ({ key: k, label: k, count: curveCounts[k], target: curveTargets[i] }))
  const creatureTarget = perMille(size - targets.L, 450)
  const types = CUBE_TYPES.filter((t) => typeCounts[t] > 0 || t === 'creature')
    .map((t) => ({ key: t, label: CUBE_TYPE_LABELS[t], count: typeCounts[t], target: t === 'creature' ? creatureTarget : null }))
  const roles = CUBE_ROLES.map((r) => ({ key: r, label: CUBE_ROLE_LABELS[r], count: roleCounts[r], target: perMille(size, ROLE_WEIGHTS[r]) }))

  const warnings: string[] = []
  const cards = (n: number) => (n === 1 ? '1 card' : `${n} cards`)
  if (total < size) warnings.push(`${cards(size - total)} short of ${size}`)
  else if (total > size) warnings.push(`${cards(total - size)} over ${size}`)
  if (singleton) {
    const byName = new Map<string, number>()
    for (const l of lines) byName.set(nameKey(l.card.name), (byName.get(nameKey(l.card.name)) ?? 0) + l.qty)
    const doubled = [...byName.values()].filter((n) => n > 1).length
    if (doubled === 1) warnings.push('1 card has more than one copy')
    else if (doubled > 1) warnings.push(`${doubled} cards have more than one copy`)
  }
  for (const g of groups) {
    const diff = g.count - g.target
    const tol = cubeTolerance(g.target)
    if (diff <= -tol) warnings.push(`${g.label} ${groupVerb(g.key)} ${-diff} short`)
    else if (diff >= tol) warnings.push(`${g.label} ${groupVerb(g.key)} ${diff} over`)
  }
  const creatures = typeCounts.creature
  if (creatureTarget - creatures >= cubeTolerance(creatureTarget)) warnings.push(`Creatures are ${creatureTarget - creatures} short`)
  for (const r of roles) {
    if (r.target - r.count >= cubeTolerance(r.target)) warnings.push(`${r.label} ${r.key === 'counter' ? 'are' : 'is'} ${r.target - r.count} short`)
  }
  const averageMv = nonLand === 0 ? 0 : Math.round((mvSum / nonLand) * 100) / 100
  return { total, size, groups, curve, averageMv, types, roles, warnings }
}

// ---- Fill from collection ----

const RARITY_RANK: Record<string, number> = { mythic: 4, rare: 3, uncommon: 2, common: 1 }
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const bestFirst = (a: CubeCard, b: CubeCard) =>
  (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) || (b.usd ?? 0) - (a.usd ?? 0) || cmpStr(a.name.toLowerCase(), b.name.toLowerCase())

/**
 * "Fill from collection": cards the user owns to bring the cube up to [size], balanced by colour —
 * each group short of its target gets one in turn (W U B R G, multicolour, colourless, lands), the
 * best first (rarer, then dearer, then A–Z), until the groups reach their targets or the cube is full.
 * Cards already in the cube (by name) and basic lands aren't suggested; each name once.
 */
export function cubeFill(cube: CubeLine[], owned: CubeCard[], size: number): CubeCard[] {
  const have = new Set(cube.map((l) => nameKey(l.card.name)))
  let room = size - cube.reduce((a, l) => a + l.qty, 0)
  if (room <= 0) return []
  const counts: Record<string, number> = Object.fromEntries(CUBE_GROUPS.map((g) => [g, 0]))
  for (const l of cube) counts[cubeGroupOf(l.card)] += l.qty
  const targets = cubeTargets(size)
  const need: Record<string, number> = Object.fromEntries(CUBE_GROUPS.map((g) => [g, Math.max(0, targets[g] - counts[g])]))
  const seen = new Set<string>()
  const pools: Record<string, CubeCard[]> = Object.fromEntries(CUBE_GROUPS.map((g) => [g, []]))
  for (const c of [...owned].sort(bestFirst)) {
    const key = nameKey(c.name)
    if (have.has(key) || seen.has(key) || hasWord(frontType(c.typeLine), 'Basic')) continue
    seen.add(key)
    pools[cubeGroupOf(c)].push(c)
  }
  const out: CubeCard[] = []
  let progress = true
  while (room > 0 && progress) {
    progress = false
    for (const g of CUBE_GROUPS) {
      if (room <= 0) break
      if (need[g] <= 0) continue
      const next = pools[g].shift()
      if (!next) continue
      out.push(next)
      need[g]--
      room--
      progress = true
    }
  }
  return out
}

// ---- Add from collection: the filters ----

/** The filters of "Add from collection". Empty lists and blank text don't filter. */
export interface CubeFilter {
  query?: string
  /** Colour groups (keys of CUBE_GROUP_LABELS). */
  groups?: string[]
  rarities?: string[]
  /** Words that must all be in the type line. */
  type?: string
  /** A set code. */
  set?: string
  minUsd?: number | null
  maxUsd?: number | null
}

/** Whether [card] passes [f]. A card with no price fails a price filter. */
export function cubeFilterMatches(f: CubeFilter, card: CubeCard): boolean {
  const q = (f.query ?? '').trim().toLowerCase()
  if (q && !card.name.toLowerCase().includes(q)) return false
  if (f.groups?.length && !f.groups.includes(cubeGroupOf(card))) return false
  if (f.rarities?.length && !f.rarities.includes(card.rarity.toLowerCase())) return false
  const words = (f.type ?? '').trim().toLowerCase().split(/\s+/).filter((w) => w)
  if (words.some((w) => !card.typeLine.toLowerCase().includes(w))) return false
  const set = (f.set ?? '').trim().toLowerCase()
  if (set && card.set.toLowerCase() !== set) return false
  if (f.minUsd != null && (card.usd == null || card.usd < f.minUsd)) return false
  if (f.maxUsd != null && (card.usd == null || card.usd > f.maxUsd)) return false
  return true
}

// ---- Packs for a draft ----

/** A small seeded random number source (mulberry32), the same in both apps, so a seed deals the same packs. */
export function cubeRandom(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = ((t + Math.imul(t ^ (t >>> 7), t | 61)) | 0) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [items] shuffled by [seed] (Fisher–Yates from the end). */
export function cubeShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const rnd = cubeRandom(seed)
  for (let i = out.length - 1; i >= 1; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const x = out[i]
    out[i] = out[j]
    out[j] = x
  }
  return out
}

/**
 * The packs for a draft: [seats] seats × [packs] packs × [packSize] cards, dealt from [pool] (one
 * item per copy) shuffled by [seed]. Seat s's pack p is the shuffled pool's cards from
 * ((p × seats) + s) × packSize. [short]: how many cards the pool is short (no packs then).
 */
export interface CubePacks { seats: string[][][]; needed: number; short: number }

export function cubePacks(pool: string[], seats: number, packs: number, packSize: number, seed: number): CubePacks {
  const s = Math.max(1, Math.floor(seats))
  const p = Math.max(1, Math.floor(packs))
  const n = Math.max(1, Math.floor(packSize))
  const needed = s * p * n
  if (pool.length < needed) return { seats: [], needed, short: needed - pool.length }
  const dealt = cubeShuffle(pool, seed)
  const out: string[][][] = []
  for (let seat = 0; seat < s; seat++) {
    const mine: string[][] = []
    for (let pack = 0; pack < p; pack++) {
      const from = (pack * s + seat) * n
      mine.push(dealt.slice(from, from + n))
    }
    out.push(mine)
  }
  return { seats: out, needed, short: 0 }
}

/** The cube's cards as a pool for packs: each copy once, in the cube's order (scryfall ids). */
export const cubePool = (cube: Deck): string[] => cube.cards.flatMap((e) => Array.from({ length: Math.max(0, e.quantity) }, () => e.scryfallId))

/**
 * A draft or sealed deck (decks/limited.ts) made from packs of a cube: its pool (the sideboard) is
 * [cardIds], copies added together, and the main deck starts empty — the deck page's draft and sealed
 * tools take it from there. Virtual: the cards are the cube's.
 */
export function limitedDeckFromCube(cube: Deck, cardIds: string[], id: string, name: string, note: string, now: number): Deck {
  const byId = new Map(cube.cards.map((e) => [e.scryfallId, e]))
  const counts = new Map<string, number>()
  for (const c of cardIds) if (byId.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1)
  const pool: DeckCardEntry[] = [...counts].map(([cid, n]) => {
    const { proxyQuantity: _p, replaceable: _r, categories: _c, ...rest } = byId.get(cid)!
    return { ...rest, quantity: n }
  })
  const deck: Deck = {
    id, name, commander: null, partnerCommander: null, cards: [], gameMode: 'LIMITED', createdAt: now,
    tags: [], gameResults: [], ownership: 'VIRTUAL', sideboard: pool,
  }
  if (note.trim()) deck.description = note
  return deck
}

// ---- The plain list: export and import ----

/** The cube as a plain list, a card a line (a card with two copies on two lines), A–Z — what CubeCobra imports. */
export function cubeListText(cards: { name: string; qty: number }[]): string {
  return cards
    .filter((c) => c.qty > 0)
    .sort((a, b) => cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.name, b.name))
    .flatMap((c) => Array.from({ length: c.qty }, () => c.name))
    .join('\n')
}

/** One card of an imported list: its name and how many copies. */
export interface CubeListLine { name: string; qty: number }

const HEADER = /^(mainboard|maybeboard|sideboard|deck|commander|main|maybe|cube)\s*:?$/i
const COUNT = /^(\d+)\s*[xX]?\s+(.+)$/
const FOIL_MARK = /\s+\*[A-Za-z]+\*$/
const SET_MARK = /\s+\([A-Za-z0-9]{2,6}\)(\s+[A-Za-z0-9★-]+)?$/

function csvFields(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted && ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
    else if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * A cube list pasted or read from a file: CubeCobra's plain text (a name a line), a "2 Name" or
 * "2x Name (SET) 123" list, or CubeCobra's CSV export (its "name" column; maybeboard rows left out).
 * Blank lines, "#" and "//" comments and headers like "Mainboard" are skipped; the same card on two
 * lines adds up, under the first spelling, in the order first seen.
 */
export function parseCubeList(text: string): CubeListLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l)
  const names: [string, number][] = []
  const first = lines[0]
  if (first != null && first.toLowerCase().startsWith('name,')) {
    const header = csvFields(first).map((h) => h.trim().toLowerCase())
    const maybe = header.indexOf('maybeboard')
    for (const l of lines.slice(1)) {
      const f = csvFields(l)
      if (maybe >= 0 && (f[maybe] ?? '').trim().toLowerCase() === 'true') continue
      const name = (f[0] ?? '').trim()
      if (name) names.push([name, 1])
    }
  } else {
    for (const l of lines) {
      if (l.startsWith('#') || l.startsWith('//') || HEADER.test(l)) continue
      let qty = 1
      let name = l
      const m = COUNT.exec(l)
      if (m) { qty = Number(m[1]); name = m[2] }
      name = name.replace(FOIL_MARK, '').replace(SET_MARK, '').trim()
      if (!name || qty <= 0) continue
      names.push([name, qty])
    }
  }
  const out = new Map<string, CubeListLine>()
  for (const [name, qty] of names) {
    const k = nameKey(name)
    const had = out.get(k)
    out.set(k, had ? { ...had, qty: had.qty + qty } : { name, qty })
  }
  return [...out.values()]
}

// ---- Building the cube ----

/** What adding cards did: the cube after, how many went in, and the names left out as already there (singleton). */
export interface CubeAdd { cube: Deck; added: number; skipped: string[] }

function cubeEntry(e: DeckCardEntry): DeckCardEntry {
  const { replaceable: _r, categories: _c, ...rest } = e
  return rest
}

/**
 * [entries] added to [cube]. In a singleton cube a card whose name is already there is left out (and
 * named in skipped), and each is one copy; otherwise copies of a printing add up.
 */
export function addToCube(cube: Deck, entries: DeckCardEntry[]): CubeAdd {
  const singleton = cubeSettings(cube).singleton
  const cards = [...cube.cards]
  const names = new Set(cards.map((c) => nameKey(c.name)))
  const skipped: string[] = []
  let added = 0
  for (const e of entries) {
    if (e.quantity <= 0) continue
    if (singleton) {
      if (names.has(nameKey(e.name))) { skipped.push(e.name); continue }
      cards.push({ ...cubeEntry(e), quantity: 1 })
      names.add(nameKey(e.name))
      added++
    } else {
      const i = cards.findIndex((c) => c.scryfallId === e.scryfallId)
      if (i >= 0) cards[i] = { ...cards[i], quantity: cards[i].quantity + e.quantity }
      else cards.push(cubeEntry(e))
      names.add(nameKey(e.name))
      added += e.quantity
    }
  }
  return { cube: added === 0 ? cube : { ...cube, cards }, added, skipped }
}

/** [cube] without the card [scryfallId]. */
export const removeFromCube = (cube: Deck, scryfallId: string): Deck => ({ ...cube, cards: cube.cards.filter((c) => c.scryfallId !== scryfallId) })

/** [cube] with the card [scryfallId] marked as a proxy (every copy) or not. */
export function markCubeProxy(cube: Deck, scryfallId: string, proxy: boolean): Deck {
  return {
    ...cube,
    cards: cube.cards.map((c) => {
      if (c.scryfallId !== scryfallId) return c
      if (proxy) return { ...c, proxyQuantity: c.quantity }
      const { proxyQuantity: _p, ...rest } = c
      return rest
    }),
  }
}

// ---- The cube box ----

/** Where one of the cube's cards stands: in the box, owned somewhere else, a proxy, or not owned. */
export type CubeCardState = 'IN_BOX' | 'OWNED' | 'PROXY' | 'NOT_OWNED'

export interface CubeCardStatus {
  scryfallId: string
  name: string
  qty: number
  /** Copies placed in the cube box. */
  inBox: number
  /** Copies owned outside the box. */
  elsewhere: number
  proxies: number
  state: CubeCardState
  /** Where the copies outside the box are: "Red box ×2 · No place (Unsorted) ×1"; "" for none. */
  where: string
}

const ownedOnly = (collections: Collection[]) => collections.filter((c) => c.type !== 'WISHLIST')

/** The cube box, when the cube has one and it's still a storage place. */
export function cubeBoxOf(cube: Deck, collections: Collection[]): StoragePlace | null {
  const id = (cube as CubeDeck).cube?.boxPlaceId
  if (!id) return null
  return placesOf(collections).find((p) => p.id === id) ?? null
}

/** Each of the cube's cards with where it stands (see CubeCardState), in the cube's order. */
export function cubeStatus(cube: Deck, collections: Collection[]): CubeCardStatus[] {
  const box = cubeBoxOf(cube, collections)?.id
  const places = new Map(placesOf(collections).map((p) => [p.id, p]))
  const held = new Map<string, { inBox: number; elsewhere: number; where: Map<string, number> }>()
  for (const c of ownedOnly(collections)) for (const e of c.entries) {
    const copies = e.quantity + e.foilQuantity
    if (copies <= 0) continue
    const k = nameKey(e.name)
    let h = held.get(k)
    if (!h) { h = { inBox: 0, elsewhere: 0, where: new Map() }; held.set(k, h) }
    let placed = 0
    for (const line of placedCopies(e)) {
      const place = places.get(line.placeId)
      if (!place) continue
      placed += line.qty
      if (line.placeId === box) h.inBox += line.qty
      else { h.elsewhere += line.qty; h.where.set(place.name, (h.where.get(place.name) ?? 0) + line.qty) }
    }
    const loose = copies - placed
    if (loose > 0) {
      h.elsewhere += loose
      const label = `No place (${c.name})`
      h.where.set(label, (h.where.get(label) ?? 0) + loose)
    }
  }
  return cube.cards.map((e) => {
    const h = held.get(nameKey(e.name)) ?? { inBox: 0, elsewhere: 0, where: new Map<string, number>() }
    const proxies = proxyCopies(cube, e)
    const inBox = Math.min(h.inBox, e.quantity)
    const state: CubeCardState = inBox >= e.quantity ? 'IN_BOX' : h.elsewhere > 0 ? 'OWNED' : proxies > 0 ? 'PROXY' : 'NOT_OWNED'
    return {
      scryfallId: e.scryfallId, name: e.name, qty: e.quantity, inBox, elsewhere: h.elsewhere, proxies, state,
      where: [...h.where].map(([k, v]) => `${k} ×${v}`).join(' · '),
    }
  })
}

/** [collections] as if the copies in [placeId] weren't there — so the pull list doesn't fetch what's in the box already. */
function withoutPlace(collections: Collection[], placeId: string): Collection[] {
  return collections.map((c) => {
    if (c.type === 'WISHLIST' || !c.entries.some((e) => (e.places ?? []).some((l) => l.placeId === placeId))) return c
    const entries: CollectionEntry[] = []
    for (const e of c.entries) {
      const lines = placedCopies(e)
      const there = lines.filter((l) => l.placeId === placeId)
      if (there.length === 0) { entries.push(e); continue }
      const plain = there.filter((l) => !l.foil).reduce((a, l) => a + l.qty, 0)
      const foil = there.filter((l) => l.foil).reduce((a, l) => a + l.qty, 0)
      const left = { ...e, quantity: e.quantity - plain, foilQuantity: e.foilQuantity - foil, places: lines.filter((l) => l.placeId !== placeId) }
      if (left.quantity + left.foilQuantity > 0) entries.push(left)
    }
    return { ...c, entries }
  })
}

/**
 * The cube's pull list: every copy still to go into the cube box, with where to fetch it from, in
 * walking order (collection/pullList.ts) — not the copies in the box already, nor the proxies. Copies
 * only another deck holds are listed but stay there; the cards not owned come last.
 */
export function cubePullList(cube: Deck, collections: Collection[], decks: Deck[]): PullList {
  const box = cubeBoxOf(cube, collections)?.id
  const inBox = new Map<string, number>()
  if (box) for (const c of ownedOnly(collections)) for (const e of c.entries) for (const line of placedCopies(e)) {
    if (line.placeId === box) inBox.set(nameKey(e.name), (inBox.get(nameKey(e.name)) ?? 0) + line.qty)
  }
  const cards: DeckCardEntry[] = []
  for (const e of cube.cards) {
    const there = inBox.get(nameKey(e.name)) ?? 0
    const take = Math.min(there, e.quantity)
    inBox.set(nameKey(e.name), there - take)
    const need = e.quantity - take - proxyCopies(cube, e)
    if (need <= 0) continue
    const { proxyQuantity: _p, ...rest } = e
    cards.push({ ...rest, quantity: need })
  }
  const wanted: Deck = { ...cube, cards, ownership: 'VIRTUAL', commander: null, partnerCommander: null }
  return pullList(wanted, box ? withoutPlace(collections, box) : collections, decks.filter((d) => !isCube(d)))
}

/**
 * "Move into cube box": the copies of the [ticked] rows go into the box [boxPlaceId] — a copy in a
 * place moves from there, one with no place yet is put there. Copies in another deck, basic lands and
 * cards not owned stay as they are. Also how many copies moved.
 */
export function moveIntoCubeBox(list: PullList, ticked: ReadonlySet<string>, collections: Collection[], boxPlaceId: string): { collections: Collection[]; moved: number } {
  let cols = collections
  let moved = 0
  const to = { placeId: boxPlaceId }
  const change = (collectionId: string, scryfallId: string, f: (e: CollectionEntry) => { entry: CollectionEntry; moved: number }) => {
    cols = cols.map((c) => c.id !== collectionId ? c : {
      ...c,
      entries: c.entries.map((e) => {
        if (e.scryfallId !== scryfallId) return e
        const out = f(e)
        moved += out.moved
        return out.entry
      }),
    })
  }
  for (const row of list.groups.flatMap((g) => g.rows)) {
    if (!ticked.has(row.key)) continue
    const src = row.source
    if (src.kind === 'place') change(src.collectionId, src.scryfallId, (e) => moveCopies(e, src.line, to, row.qty))
    else if (src.kind === 'loose') change(src.collectionId, src.scryfallId, (e) => placeCopies(e, to, row.qty, src.foil))
  }
  return { collections: moved === 0 ? collections : cols, moved }
}

/** A new storage place to be the cube box: a box named after the cube, sized to it, sorted by colour. */
export function cubeBoxPlace(cube: Deck, id: string, now: number): StoragePlace {
  return storagePlace({ id, name: `${cube.name} box`, kind: 'BOX', sortRule: 'COLOUR', capacity: cubeSettings(cube).size, createdAt: now })
}

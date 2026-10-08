import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addToCube, asCube, cubeBalance, cubeBoxPlace, cubeFill, cubeFilterMatches, cubeGroupOf, cubeListText, cubePacks, cubePool, cubePullList,
  cubeRandom, cubeRolesOf, cubeShuffle, cubeStatus, cubeTargets, cubeTypeOf, isCube, keepCubeFromOlderApp, limitedDeckFromCube, markCubeProxy,
  mergeCubeSettings, moveIntoCubeBox, newCube, parseCubeList, removeFromCube, splitByWeight,
  type CubeCard, type CubeCount, type CubeFilter, type CubeListLine, type CubePacks,
} from '../../src/decks/cube.ts'
import { placedCopies } from '../../src/collection/storagePlaces.ts'
import { proxySwaps } from '../../src/decks/proxies.ts'
import { mergeDeck } from '../../src/sync/mergeItems.ts'
import { resetCounts, resetCountsText, resetLibrary } from '../../src/settings/resetCollection.ts'
import { normalizeDeck, type Collection, type CollectionEntry, type CopyPlace, type Deck, type DeckCardEntry, type StoragePlace } from '../../src/types/models.ts'

// Cubes. The cases in cubeVectors.json are run by the Android app too (CubeTest.kt), so both apps
// balance, fill, filter, deal packs and read lists the same way.

interface Vectors {
  cards: CubeCard[]
  facts: { name: string; group: string; type: string; roles: string[] }[]
  targets: { size: number; groups: Record<string, number> }[]
  splits: { total: number; weights: number[]; expect: number[] }[]
  balances: {
    lines: [string, number][]; size: number; singleton: boolean
    expect: { total: number; groups: string[]; curve: string[]; averageMv: number; types: string[]; roles: string[]; warnings: string[] }
  }[]
  fills: { cube: [string, number][]; owned: string[]; size: number; expect: string[] }[]
  filters: { filter: CubeFilter; expect: string[] }[]
  random: { seed: number; first: number[] }[]
  shuffles: { items: string[]; seed: number; expect: string[] }[]
  packs: { pool: string[]; seats: number; packs: number; packSize: number; seed: number; expect: CubePacks }[]
  exports: { cards: { name: string; qty: number }[]; text: string }[]
  imports: { text: string; expect: CubeListLine[] }[]
}

const V = JSON.parse(readFileSync(new URL('./cubeVectors.json', import.meta.url), 'utf8')) as Vectors
const byName = new Map(V.cards.map((c) => [c.name, c]))
const lines = (spec: [string, number][]) => spec.map(([n, qty]) => ({ card: byName.get(n)!, qty }))
const flat = (xs: CubeCount[]) => xs.map((x) => `${x.key} ${x.count}/${x.target ?? '-'}`)

test('each card’s colour group, type and roles', () => {
  for (const f of V.facts) {
    const c = byName.get(f.name)!
    assert.equal(cubeGroupOf(c), f.group, f.name)
    assert.equal(cubeTypeOf(c), f.type, f.name)
    assert.deepEqual(cubeRolesOf(c), f.roles, f.name)
  }
})

test('targets for each size add up to it', () => {
  for (const t of V.targets) {
    assert.deepEqual(cubeTargets(t.size), t.groups)
    assert.equal(Object.values(t.groups).reduce((a, b) => a + b, 0), t.size)
  }
  for (const s of V.splits) assert.deepEqual(splitByWeight(s.total, s.weights), s.expect)
})

test('the balance: counts against targets, curve, types, roles and what’s off', () => {
  for (const b of V.balances) {
    const r = cubeBalance(lines(b.lines), b.size, b.singleton)
    const label = `${b.size} ${b.lines.length}`
    assert.equal(r.total, b.expect.total, label)
    assert.deepEqual(flat(r.groups), b.expect.groups, label)
    assert.deepEqual(flat(r.curve), b.expect.curve, label)
    assert.equal(r.averageMv, b.expect.averageMv, label)
    assert.deepEqual(flat(r.types), b.expect.types, label)
    assert.deepEqual(flat(r.roles), b.expect.roles, label)
    assert.deepEqual(r.warnings, b.expect.warnings, label)
  }
  // The warning the owner asked for, word for word.
  assert.ok(V.balances[0].expect.warnings.includes('Green is 50 short'))
})

test('fill from collection: balanced by colour, best first, never what’s in already', () => {
  for (const f of V.fills) {
    assert.deepEqual(cubeFill(lines(f.cube), f.owned.map((n) => byName.get(n)!), f.size).map((c) => c.name), f.expect)
  }
})

test('add from collection: the filters', () => {
  for (const f of V.filters) assert.deepEqual(V.cards.filter((c) => cubeFilterMatches(f.filter, c)).map((c) => c.name), f.expect, JSON.stringify(f.filter))
})

test('packs: the same seed deals the same packs in both apps', () => {
  for (const r of V.random) {
    const next = cubeRandom(r.seed)
    assert.deepEqual(r.first.map(() => next()), r.first)
  }
  for (const s of V.shuffles) assert.deepEqual(cubeShuffle(s.items, s.seed), s.expect)
  for (const p of V.packs) {
    const got = cubePacks(p.pool, p.seats, p.packs, p.packSize, p.seed)
    assert.deepEqual(got, p.expect)
    if (got.short === 0) {
      const dealt = got.seats.flat(2)
      assert.equal(new Set(dealt).size, p.seats * p.packs * p.packSize)
    }
  }
})

test('the plain list: export, and import from CubeCobra and others', () => {
  for (const e of V.exports) assert.equal(cubeListText(e.cards), e.text)
  for (const i of V.imports) assert.deepEqual(parseCubeList(i.text), i.expect)
  // What one app exports, the other reads back.
  const text = cubeListText([{ name: 'Sol Ring', qty: 1 }, { name: 'Island', qty: 2 }])
  assert.deepEqual(parseCubeList(text), [{ name: 'Island', qty: 2 }, { name: 'Sol Ring', qty: 1 }])
})

// ---- Kept as a deck ----

const card = (id: string, name: string, quantity = 1, over: Partial<DeckCardEntry> = {}): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...over })

test('a new cube is a virtual, archived deck with its settings', () => {
  const c = newCube('c1', '  Vintage ', 540, true, 7)
  assert.ok(isCube(c))
  assert.equal(c.name, 'Vintage')
  assert.equal(c.ownership, 'VIRTUAL')
  assert.equal(c.archived, true)
  assert.deepEqual(c.cube, { size: 540, singleton: true })
  assert.equal(newCube('c2', '', 5, false, 1).cube!.size, 40)
  // An older app that un-archived it, or made it physical, gets it put back.
  const touched = { ...c, archived: false, ownership: 'PHYSICAL' as const }
  assert.equal(asCube(touched).archived, true)
  assert.equal(asCube(touched).ownership, 'VIRTUAL')
  assert.equal(asCube(c), c)
})

test('adding: singleton leaves out a name already there; otherwise copies add up', () => {
  const c = newCube('c', 'C', 360, true, 1)
  const a = addToCube(c, [card('a', 'Sol Ring', 2), card('b', 'Sol Ring'), card('x', 'Bolt')])
  assert.deepEqual(a.cube.cards.map((e) => `${e.quantity} ${e.name}`), ['1 Sol Ring', '1 Bolt'])
  assert.equal(a.added, 2)
  assert.deepEqual(a.skipped, ['Sol Ring'])
  const many = addToCube({ ...c, cube: { size: 360, singleton: false } }, [card('a', 'Sol Ring', 2), card('a', 'Sol Ring', 1)])
  assert.deepEqual(many.cube.cards.map((e) => `${e.quantity} ${e.name}`), ['3 Sol Ring'])
  assert.equal(addToCube(a.cube, [card('a', 'sol ring')]).cube, a.cube)
  const proxied = markCubeProxy(a.cube, 'x', true)
  assert.equal(proxied.cards[1].proxyQuantity, 1)
  assert.equal(markCubeProxy(proxied, 'x', false).cards[1].proxyQuantity, undefined)
  assert.deepEqual(removeFromCube(a.cube, 'a').cards.map((e) => e.name), ['Bolt'])
})

test('sync: settings merge field by field, and an older app’s save keeps them', () => {
  const base = { ...newCube('c', 'C', 360, true, 1), cards: [card('a', 'A')] }
  const mine = { ...base, cube: { ...base.cube!, size: 540 }, cards: [card('a', 'A'), card('b', 'B')] }
  const theirs = { ...base, cube: { ...base.cube!, boxPlaceId: 'box' }, cards: [card('a', 'A'), card('c', 'C')] }
  const merged = mergeDeck(base, mine, theirs, true)
  assert.deepEqual(merged.cube, { size: 540, singleton: true, boxPlaceId: 'box' })
  assert.deepEqual(merged.cards.map((e) => e.name), ['A', 'B', 'C'])
  assert.equal(merged.gameMode, 'CUBE')
  // An app from before cubes drops the key it doesn't know (the Android app reads JSON into fixed fields).
  const { cube: _gone, ...older } = theirs
  const kept = mergeDeck(base, mine, older as Deck, false)
  assert.deepEqual(kept.cube, { size: 540, singleton: true })
  assert.equal(keepCubeFromOlderApp(base, older as Deck).cube, base.cube)
  assert.equal(mergeCubeSettings(undefined, undefined, undefined, true), undefined)
})

// ---- The cube box ----

const place = (id: string, over: Partial<StoragePlace> = {}): StoragePlace => ({ id, name: id, kind: 'BOX', createdAt: 1, ...over })
const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}) })
const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })

function setup() {
  const cube = { ...newCube('cube', 'Pauper', 360, true, 1), cards: [card('bolt', 'Lightning Bolt'), card('ring', 'Sol Ring'), card('ele', 'Elvish Mystic'), card('lotus', 'Black Lotus'), card('mox', 'Mox Pearl', 1, { proxyQuantity: 1 })] }
  const box = cubeBoxPlace(cube, 'box', 2)
  const withBox = { ...cube, cube: { ...cube.cube!, boxPlaceId: 'box' } }
  const collections: Collection[] = [
    {
      id: 'unsorted', name: 'Unsorted', type: 'OWNED', createdAt: 0, storagePlaces: [place('red', { name: 'Red box' }), box],
      entries: [entry('bolt', 'Lightning Bolt', 2, 0, [at('red', 1), at('box', 1)]), entry('ring', 'Sol Ring', 1)],
    },
    { id: 'b1', name: 'Trade binder', type: 'OWNED', createdAt: 1, entries: [entry('ele2', 'Elvish Mystic', 0, 1, [at('red', 1, { foil: true })])] },
    { id: 'w', name: 'Wishlist', type: 'WISHLIST', createdAt: 1, entries: [entry('lotus', 'Black Lotus', 1)] },
  ]
  return { cube: withBox, collections }
}

test('where each card stands: in the box, owned elsewhere, proxy or not owned', () => {
  const { cube, collections } = setup()
  assert.equal(cubeBoxPlace(cube, 'box', 2).name, 'Pauper box')
  assert.deepEqual(cubeStatus(cube, collections).map((s) => `${s.name}: ${s.state} ${s.inBox}/${s.elsewhere} ${s.where}`), [
    'Lightning Bolt: IN_BOX 1/1 Red box ×1',
    'Sol Ring: OWNED 0/1 No place (Unsorted) ×1',
    'Elvish Mystic: OWNED 0/1 Red box ×1',
    'Black Lotus: NOT_OWNED 0/0 ',
    'Mox Pearl: PROXY 0/0 ',
  ])
  // With no box (or one deleted since), nothing is in it.
  assert.equal(cubeStatus({ ...cube, cube: { size: 360, singleton: true } }, collections)[0].state, 'OWNED')
})

test('the pull list fetches what’s not in the box yet, and moving puts it there', () => {
  const { cube, collections } = setup()
  const list = cubePullList(cube, collections, [cube])
  const rows = list.groups.flatMap((g) => g.rows.map((r) => `${g.kind} ${r.name} ${r.qty}`))
  assert.deepEqual(rows, ['place Elvish Mystic 1', 'loose Sol Ring 1', 'missing Black Lotus 1'])
  const ticked = new Set(list.groups.flatMap((g) => g.rows).map((r) => r.key))
  const { collections: after, moved } = moveIntoCubeBox(list, ticked, collections, 'box')
  assert.equal(moved, 2)
  assert.deepEqual(placedCopies(after[0].entries[1]), [{ placeId: 'box', qty: 1 }])
  assert.deepEqual(placedCopies(after[1].entries[0]), [{ placeId: 'box', qty: 1, foil: true }])
  // Copies counts don't change: the cards stay in the collection.
  assert.equal(after[0].entries[1].quantity, 1)
  assert.deepEqual(cubeStatus(cube, after).map((s) => s.state), ['IN_BOX', 'IN_BOX', 'IN_BOX', 'NOT_OWNED', 'PROXY'])
  assert.equal(cubePullList(cube, after, [cube]).total, 0)
  assert.equal(moveIntoCubeBox(list, new Set(), collections, 'box').collections, collections)
})

test('a cube’s proxies aren’t offered for swapping like a deck’s', () => {
  const { cube } = setup()
  const owned: Collection[] = [{ id: 'unsorted', name: 'Unsorted', type: 'OWNED', createdAt: 0, entries: [entry('mox', 'Mox Pearl', 1)] }]
  assert.deepEqual(proxySwaps(owned, [cube]), [])
})

test('draft: a limited deck from packs, its pool the picked cards', () => {
  const { cube } = setup()
  assert.deepEqual(cubePool({ ...cube, cards: [card('a', 'A', 2), card('b', 'B')] }), ['a', 'a', 'b'])
  const d = limitedDeckFromCube(cube, ['bolt', 'ring', 'bolt', 'nope'], 'd', 'Pauper — seat 1', 'From the cube', 5)
  assert.equal(d.gameMode, 'LIMITED')
  assert.equal(d.ownership, 'VIRTUAL')
  assert.deepEqual(d.sideboard!.map((e) => `${e.quantity} ${e.name}`), ['2 Lightning Bolt', '1 Sol Ring'])
  assert.deepEqual(d.cards, [])
  assert.equal(d.description, 'From the cube')
  assert.equal(limitedDeckFromCube(cube, [], 'e', 'x', ' ', 5).description, undefined)
})

test('reset: Everything removes cubes; Collection and Cards only keep them', () => {
  const cube = newCube('cube', 'C', 360, true, 1)
  const deck = normalizeDeck({ id: 'd', name: 'd' })
  const lib = { decks: [deck, cube], collections: [{ id: 'unsorted', name: 'Unsorted', type: 'OWNED' as const, createdAt: 0, entries: [] }] }
  assert.equal(resetCountsText(resetCounts(lib, 'everything')), '1 deck · 1 cube')
  assert.equal(resetLibrary(lib, 'collection', 1).decks.length, 2)
  assert.equal(resetLibrary(lib, 'cards', 1).decks.length, 2)
  assert.equal(resetLibrary(lib, 'everything', 1).decks.length, 0)
})

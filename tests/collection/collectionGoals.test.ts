import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectionGoal, completeGoals, deleteGoal, goalHits, goalProgress, goalsOf, goalWishlistAdds, hitLine, keepGoalsFromOlderApp, mergeGoals,
  missingLine, missingNames, newDeckGoal, newListGoal, newSetGoal, progressLine, saveGoal, setGoalName, sortedGoals,
  type CollectionGoal, type GoalPrices, type GoalSetCard,
} from '../../src/collection/collectionGoals.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import { resetLibrary, resetCounts, resetCountsText } from '../../src/settings/resetCollection.ts'
import { isUnsorted, type Collection, type Deck } from '../../src/types/models.ts'

// Collection goals. The cases in collectionGoalVectors.json are run by the Android app too
// (CollectionGoalsTest.kt), so both apps count, complete, merge and name goals the same way.

interface Line { name: string; need: number; owned: number; have: number; missing: number; usd: number | null }
interface Vectors {
  library: { collections: Collection[]; decks: Deck[] }
  goals: CollectionGoal[]
  prices: GoalPrices
  progress: { goal: string; have: number; need: number; percent: number; missingUsd: number; unpriced: number; complete: boolean; lines: Line[] }[]
  complete: { now: number; done: string[]; completedAt: Record<string, number | null> }
  hits: { card: { scryfallId: string; name: string }; foil: boolean; pending: number; expect: string[] }[]
  wishlist: { goal: string; expect: string[] }[]
  normalize: { in: CollectionGoal; out: CollectionGoal }[]
  setNames: { set: string; rarities: string[]; foil: boolean; name: string }[]
  setGoal: { set: { code: string; name: string }; cards: GoalSetCard[]; cases: { rarities: string[]; foil: boolean; goal: CollectionGoal }[] }
  deckGoals: { deckId: string; foil: boolean; goal: CollectionGoal }[]
  merge: { about: string; minePreferred: boolean; base: CollectionGoal[] | null; mine: CollectionGoal[] | null; theirs: CollectionGoal[] | null; expect: CollectionGoal[] | null }[]
  missingLines: { goal: string; line: string; progress: string }[]
}

const V = JSON.parse(readFileSync(new URL('./collectionGoalVectors.json', import.meta.url), 'utf8')) as Vectors
const decks = V.library.decks.map((d) => ({ ...d, cards: d.cards ?? [] }))
const cols = V.library.collections
const goal = (id: string) => V.goals.find((g) => g.id === id)!
const fmt = (n: number) => `$${n}`

test('progress: have/need, percent, value of what’s missing, each card’s copies', () => {
  for (const e of V.progress) {
    const p = goalProgress(goal(e.goal), cols, decks, V.prices)
    assert.deepEqual(
      { have: p.have, need: p.need, percent: p.percent, missingUsd: p.missingUsd, unpriced: p.unpriced, complete: p.complete },
      { have: e.have, need: e.need, percent: e.percent, missingUsd: e.missingUsd, unpriced: e.unpriced, complete: e.complete },
      e.goal,
    )
    assert.deepEqual(p.lines.map((l) => ({ name: l.name, need: l.need, owned: l.owned, have: l.have, missing: l.missing, usd: l.usd })), e.lines, e.goal)
  }
})

test('completion: goals complete now are marked once, at that time', () => {
  const r = completeGoals(V.goals, cols, decks, V.complete.now)
  assert.deepEqual(r.done, V.complete.done)
  assert.deepEqual(Object.fromEntries(r.goals.map((g) => [g.id, g.completedAt ?? null])), V.complete.completedAt)
  // Marked, they don't complete again; and nothing changes when nothing completes.
  const again = completeGoals(r.goals, cols, decks, V.complete.now + 1)
  assert.deepEqual(again.done, [])
  assert.equal(again.goals, r.goals)
  // A completion is not an edit.
  for (const g of r.goals) assert.equal(g.updatedAt, goal(g.id).updatedAt)
})

test('the scanner: which goals a scanned card moves on', () => {
  for (const h of V.hits) {
    assert.deepEqual(goalHits(V.goals, cols, decks, h.card, h.foil, h.pending).map(hitLine), h.expect, `${h.card.name} foil=${h.foil} pending=${h.pending}`)
  }
})

test('Add missing to Wishlist: only what the Wishlist doesn’t already want', () => {
  const wishlist = cols.find((c) => c.type === 'WISHLIST')!.entries
  for (const w of V.wishlist) {
    assert.deepEqual(goalWishlistAdds(goalProgress(goal(w.goal), cols, decks), wishlist).map((x) => `${x.name} ${x.quantity}`), w.expect, w.goal)
  }
})

test('a goal as both apps write it', () => {
  for (const n of V.normalize) {
    assert.deepEqual(collectionGoal(n.in), n.out, n.in.id)
    assert.deepEqual(collectionGoal(n.out), n.out, `${n.in.id} again`)
  }
})

test('making goals: set names, a set goal, a deck goal', () => {
  for (const s of V.setNames) assert.equal(setGoalName(s.set, s.rarities, s.foil), s.name)
  for (const c of V.setGoal.cases) assert.deepEqual(newSetGoal('s', V.setGoal.set, V.setGoal.cards, c.rarities, c.foil, 10), c.goal)
  for (const c of V.deckGoals) assert.deepEqual(newDeckGoal('d', decks.find((d) => d.id === c.deckId)!, c.foil, 10), c.goal)
})

test('merging two devices’ goals, goal by goal', () => {
  for (const m of V.merge) {
    assert.deepEqual(mergeGoals(m.base ?? undefined, m.mine ?? undefined, m.theirs ?? undefined, m.minePreferred) ?? null, m.expect, m.about)
  }
})

test('the lines under a goal', () => {
  for (const m of V.missingLines) {
    const p = goalProgress(goal(m.goal), cols, decks, V.prices)
    assert.equal(missingLine(p, fmt), m.line, m.goal)
    assert.equal(progressLine(p), m.progress, m.goal)
  }
})

test('a playset goal: every card at the playset’s count', () => {
  const g = newListGoal('p', 'PLAYSET', 'Shocks', [{ name: 'Steam Vents', qty: 1 }, { name: 'Sacred Foundry', qty: 2 }], null, 5)
  assert.deepEqual(g.cards.map((c) => c.qty), [4, 4])
  const three = newListGoal('p', 'PLAYSET', 'Shocks', [{ name: 'Steam Vents', qty: 1 }], 3, 5)
  assert.equal(three.cards[0].qty, 3)
  const custom = newListGoal('c', 'CUSTOM', 'Mine', [{ name: 'Opt', qty: 2 }, { name: 'Opt', qty: 1 }], null, 5)
  assert.deepEqual(custom.cards, [{ name: 'Opt', qty: 3 }])
})

test('missing names: once each, to ask friends', () => {
  assert.deepEqual(missingNames(goalProgress(goal('g-set'), cols, decks)), ['Gamma Uncommon', 'Alpha Uncommon'])
})

test('open goals most nearly done first; completed ones last, newest first', () => {
  const r = completeGoals(V.goals, cols, decks, 100)
  const s = sortedGoals(r.goals, (g) => goalProgress(g, cols, decks))
  assert.equal(s.open[0].id, 'g-custom')
  assert.deepEqual(s.done.map((g) => g.id), ['g-deck-gone', 'g-done', 'g-was-done'])
})

test('kept on the Unsorted pile: saved, replaced, deleted', () => {
  const g = goal('g-done')
  let c: Collection[] = []
  c = saveGoal(c, g)
  assert.equal(c.length, 1)
  assert.ok(isUnsorted(c[0]))
  assert.deepEqual(goalsOf(c).map((x) => x.id), ['g-done'])
  c = saveGoal(c, { ...g, name: 'Renamed', updatedAt: 9 })
  assert.deepEqual(goalsOf(c).map((x) => x.name), ['Renamed'])
  c = deleteGoal(c, 'g-done')
  assert.deepEqual(c[0].collectionGoals, [])
})

const pile = (goals?: CollectionGoal[]): Collection => ({ id: 'unsorted', name: 'Unsorted', entries: [], createdAt: 0, type: 'OWNED', ...(goals ? { collectionGoals: goals } : {}) })

test('a pile saved by an app from before goals keeps this device’s', () => {
  const mine = pile([goal('g-done')])
  const older = pile()
  assert.deepEqual(keepGoalsFromOlderApp(mine, older).collectionGoals, [goal('g-done')])
  assert.equal(keepGoalsFromOlderApp(pile(), older), older)
  // Through the binder merge: the older app's save leaves the goals as they were.
  const merged = mergeCollection(mine, mine, older, false)
  assert.deepEqual(merged.collectionGoals, [goal('g-done')])
  // And one added on each side meets.
  const other = { ...goal('g-set'), updatedAt: 3 }
  const both = mergeCollection(pile([]), pile([goal('g-done')]), pile([other]), true)
  assert.deepEqual(both.collectionGoals?.map((g) => g.id), ['g-done', 'g-set'])
})

test('Reset collection: Collection and Everything clear goals; Cards only keeps them', () => {
  const lib = { decks: [] as Deck[], collections: [pile([goal('g-done'), goal('g-set')])], deleted: {} }
  assert.deepEqual(resetLibrary(lib as never, 'cards', 1).collections[0].collectionGoals?.length, 2)
  assert.deepEqual(resetLibrary(lib as never, 'collection', 1).collections[0].collectionGoals, [])
  assert.deepEqual(resetLibrary(lib as never, 'everything', 1).collections[0].collectionGoals, [])
  assert.equal(resetCountsText(resetCounts(lib, 'collection')), '2 goals')
  assert.equal(resetCountsText(resetCounts(lib, 'cards')), 'Nothing to remove')
})

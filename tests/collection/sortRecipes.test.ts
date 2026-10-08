import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  alsoLine, bucketOf, capWarning, cardLine, checkPileCard, derivePiles, fileRecipe, HandsFreeCapture, keepRecipesFromOlderApp, levelBuckets,
  levelLine, mergeRecipes, newRecipe, pileGoesTo, reasonLine, recipeLine, recipeTemplates, recipesOf, saveRecipe, deleteRecipe, sortCard,
  sortRecipe, spokenPile, summarize, withGoTo, ordinal, otherPile, pileSignsHtml, deckNeedsOf, friendWantsOf, orderedBinders,
  goalNeedsOf, binderFiledInto, reasonsFor,
  type RecipeCard, type RecipeScan, type SmartContext, type SortRecipe, type SplitLevel, type OrderedBinder,
} from '../../src/collection/sortRecipes.ts'
import { newListGoal, newSetGoal, type CollectionGoal } from '../../src/collection/collectionGoals.ts'
import { BY_RULE } from '../../src/collection/sortPiles.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import { isUnsorted, type Collection, type Deck, type StoragePlace } from '../../src/types/models.ts'

// Sorting recipes. The cases in sortRecipeVectors.json are run by the Android app too (SortRecipesTest.kt),
// so both apps make the same piles and send every card to the same one.

interface Session {
  recipe: SortRecipe
  rate: number
  expect: { pile: number; key: string; reason: string | null; also: string[]; spoken: string; line: string }[]
  summary: { cards: number; usd: number; rows: string[] }
  checks: { pile: number; names: string[]; lines: string[] }[]
}

interface Vectors {
  derive: { recipe: SortRecipe; piles: string[]; wanted: number; capped: boolean; warning: string | null; line: string }[]
  labels: { level: SplitLevel; labels: string[]; line: string }[]
  buckets: { level: SplitLevel; rate: number; card: RecipeCard; key: string }[]
  ctx: SmartContext
  session: RecipeCard[]
  sessions: Session[]
  goalSessions: { ctx: SmartContext; session: RecipeCard[]; sessions: Session[] }
  handsFree: { steady: number; gap: number; steps: { read?: string | null; captured?: string; rescan?: true; missed?: true }[]; takes: (boolean | null)[] }[]
}

const V = JSON.parse(readFileSync(new URL('./sortRecipeVectors.json', import.meta.url), 'utf8')) as Vectors
const fmt = (n: number) => `$${n}`

test('the piles each recipe makes, in table order, capped with a warning', () => {
  for (const d of V.derive) {
    const got = derivePiles(d.recipe, fmt)
    assert.deepEqual(got.piles.map((p) => `${p.number} ${p.key} ${p.name} ${p.band}`), d.piles, d.recipe.name)
    assert.equal(got.wanted, d.wanted, d.recipe.name)
    assert.equal(got.capped, d.capped, d.recipe.name)
    assert.equal(capWarning(got), d.warning, d.recipe.name)
    assert.equal(recipeLine(d.recipe, fmt), d.line, d.recipe.name)
    assert.ok(got.piles.length <= 24)
  }
})

test('each level’s buckets and its line', () => {
  for (const l of V.labels) {
    assert.deepEqual(levelBuckets(l.level, fmt).map((b) => `${b.key} ${b.label}`), l.labels, JSON.stringify(l.level))
    assert.equal(levelLine(l.level, fmt), l.line)
  }
})

test('the bucket a card falls in: value bands in the user’s currency, A–Z ranges, numbers…', () => {
  for (const b of V.buckets) assert.equal(bucketOf(b.level, b.card, b.rate), b.key, `${JSON.stringify(b.level)} ${JSON.stringify(b.card)} @${b.rate}`)
})

function runSessions(ctx: SmartContext, cards: RecipeCard[], sessions: Session[]) {
  for (const s of sessions) {
    const d = derivePiles(s.recipe, fmt)
    const scans: RecipeScan[] = []
    cards.forEach((card, i) => {
      const c = sortCard(s.recipe, d, ctx, card, scans, s.rate)
      const pile = d.piles.find((p) => p.number === c.pile)!
      const scan: RecipeScan = {
        id: i + 1, scryfallId: `id${i}`, name: card.name, card, pile: c.pile, key: c.key, reason: c.reason, also: c.also, setName: null,
        facts: { name: card.name, colors: card.colors ?? [], typeLine: card.typeLine ?? null, set: card.set ?? null, collectorNumber: card.collectorNumber ?? null },
        entry: { scryfallId: `id${i}`, name: card.name, imageUrl: null, quantity: 0, foilQuantity: 0 },
      }
      const e = s.expect[i]
      const what = `${s.recipe.name} #${i} ${card.name}`
      assert.equal(c.pile, e.pile, what)
      assert.equal(c.key, e.key, what)
      assert.equal(c.reason ? reasonLine(c.reason) : null, e.reason, what)
      assert.deepEqual(c.also.map(alsoLine), e.also, what)
      assert.equal(spokenPile(pile, c.reason), e.spoken, what)
      assert.equal(cardLine(scan, fmt), e.line, what)
      scans.push(scan)
    })
    const sum = summarize(s.recipe, d, scans)
    assert.equal(sum.cards, s.summary.cards)
    assert.equal(sum.usd, s.summary.usd)
    assert.deepEqual(sum.rows.map((r) => `${r.from}-${r.to} ${r.name} ${r.cards} ${r.usd} ${r.detail ?? ''}`.trim()), s.summary.rows, s.recipe.name)
    for (const c of s.checks) {
      const checked: string[] = []
      assert.deepEqual(c.names.map((n) => { const r = checkPileCard(d, scans, c.pile, checked, n); if (r.belongs) checked.push(n); return r.line }), c.lines)
    }
  }
}

test('a session: smart piles first (deck > goal > friend > binder > trade), then keep apart, then the levels', () => {
  runSessions(V.ctx, V.session, V.sessions)
})

test('the Goals need pile: each goal claims only what it’s missing, the session’s copies counted; after decks, before friends and binders', () => {
  runSessions(V.goalSessions.ctx, V.goalSessions.session, V.goalSessions.sessions)
})

test('capture without tapping: steady frames, and never the same card twice until it has left', () => {
  for (const r of V.handsFree) {
    const h = new HandsFreeCapture(r.steady, r.gap)
    const takes = r.steps.map((s) => { if (s.captured) { h.captured(s.captured); return null } if (s.rescan) { h.rescan(); return null } if (s.missed) { h.missed(); return null } return h.onRead(s.read ?? null) })
    assert.deepEqual(takes, r.takes, JSON.stringify(r.steps))
  }
})

test('templates and a new recipe', () => {
  const t = recipeTemplates(['dsk'])
  assert.deepEqual(t.map((r) => r.name), ['Commander by colour', 'Binder by set', 'Rares by value', 'What my collection needs'])
  assert.deepEqual(derivePiles(t[1], fmt).piles.slice(3, 5).map((p) => p.name), ['DSK · #1–99', 'DSK · #100–199'])
  assert.deepEqual(derivePiles(t[2], fmt).piles.slice(3).map((p) => p.name), ['$20+', '$5–$20', '$1–$5', 'under $1'])
  // Goals need is off unless a goal is under way — then only "What my collection needs" pulls it out.
  assert.ok(t.every((r) => !r.pullOut.includes('GOALS')))
  const withGoals = recipeTemplates(['dsk'], true)
  assert.deepEqual(withGoals.map((r) => r.pullOut.includes('GOALS')), [false, false, false, true])
  assert.equal(recipeLine(withGoals[3], fmt), 'Decks need · Goals need · Friends want · Binder gaps · To trade · 6 piles')
  const mine = newRecipe('n1', 5)
  assert.ok(!mine.pullOut.includes('GOALS'))
  assert.equal(recipeLine(mine, fmt), 'Value $2+ apart · then colour · 12 piles')
  assert.equal(ordinal(1) + ordinal(2) + ordinal(3) + ordinal(11) + ordinal(22), '1st2nd3rd11th22nd')
})

test('a recipe is kept tidy: known kinds in order, three levels at most, cuts sorted', () => {
  const r = sortRecipe({
    id: 'x', name: '  ', pullOut: ['TRADE', 'DECKS', 'NOPE' as never], apart: ['PLAYED', 'FOIL'],
    levels: [{ by: 'VALUE', cuts: [1, 5, 5, -2] }, { by: 'NAME', letters: ['q', 'c', '9'] }, { by: 'NUMBER', cuts: [50] }, { by: 'TYPE' }],
    goTo: [{ pile: 'L:v0', to: 'a' }, { pile: 'L:v0', to: 'b' }], createdAt: 3,
  })
  assert.deepEqual(r, {
    id: 'x', name: 'My recipe', pullOut: ['DECKS', 'TRADE'], apart: ['FOIL', 'PLAYED'],
    levels: [{ by: 'VALUE', cuts: [5, 1] }, { by: 'NAME', letters: ['A', 'C', 'Q'] }, { by: 'NUMBER', cuts: [1, 50] }],
    goTo: [{ pile: 'L:v0', to: 'b' }], createdAt: 3, goals: false,
  })
  // "goals" says whether the Goals need pile is pulled out, always.
  assert.equal(sortRecipe({ ...newRecipe('y', 1), pullOut: ['FRIENDS', 'GOALS'] }).goals, true)
  assert.deepEqual(sortRecipe({ ...newRecipe('y', 1), pullOut: ['FRIENDS', 'GOALS'] }).pullOut, ['GOALS', 'FRIENDS'])
})

const pile = (recipes?: SortRecipe[]): Collection => ({ id: 'unsorted', name: 'Unsorted', entries: [], createdAt: 0, type: 'OWNED', ...(recipes ? { sortRecipes: recipes } : {}) })
const R = (id: string, name: string, more: Partial<SortRecipe> = {}): SortRecipe => sortRecipe({ ...newRecipe(id, 1), name, ...more })

test('recipes merge recipe by recipe, each field to whoever changed it', () => {
  const base = [R('a', 'Bulk'), R('b', 'Rares')]
  const mine = [R('a', 'Bulk boxes'), R('b', 'Rares'), R('c', 'Mine')]
  const theirs = [R('a', 'Bulk', { apart: ['FOIL', 'FOREIGN'] }), R('d', 'Theirs')]
  const merged = mergeRecipes(base, mine, theirs, true)!
  assert.deepEqual(merged.map((r) => r.id), ['a', 'c', 'd'])
  assert.equal(merged[0].name, 'Bulk boxes')
  assert.deepEqual(merged[0].apart, ['FOIL', 'FOREIGN'])
  assert.equal(mergeRecipes(undefined, undefined, undefined, true), undefined)
  // Both renamed it: the more recent edit.
  assert.equal(mergeRecipes(base, [R('a', 'Mine')], [R('a', 'Theirs')], false)![0].name, 'Theirs')
})

test('a pile saved by an app from before recipes keeps this device’s', () => {
  const here = pile([R('a', 'Bulk')])
  const older = pile()
  assert.deepEqual(keepRecipesFromOlderApp(here, older).sortRecipes, here.sortRecipes)
  assert.equal(keepRecipesFromOlderApp(here, pile([])).sortRecipes!.length, 0)
  // Through the whole merge: the older app's save of the pile doesn't wipe them.
  const merged = mergeCollection(here, here, older, false)
  assert.deepEqual(merged.sortRecipes, here.sortRecipes)
  const both = mergeCollection(pile([]), pile([R('a', 'Bulk')]), pile([R('b', 'Rares')]), true)
  assert.deepEqual(both.sortRecipes!.map((r) => r.id), ['a', 'b'])
})

test('a recipe saved by an app from before the Goals need pile keeps this device’s pile; one turned off stays off', () => {
  const goals = R('a', 'Bulk', { pullOut: ['DECKS', 'GOALS', 'FRIENDS'] })
  const here = pile([goals, R('b', 'Rares')])
  // The older app drops GOALS and the "goals" key — and here it renamed the recipe too.
  const { goals: _drop, ...older } = { ...goals, name: 'Bulk boxes', pullOut: ['DECKS', 'FRIENDS'] as SortRecipe['pullOut'] }
  void _drop
  const olderPile = pile([older, R('b', 'Rares')])
  const kept = keepRecipesFromOlderApp(here, olderPile).sortRecipes!
  assert.deepEqual(kept[0].pullOut, ['DECKS', 'GOALS', 'FRIENDS'])
  assert.equal(kept[0].name, 'Bulk boxes')
  assert.equal(kept[0].goals, true)
  // Nothing to put back: the same object.
  assert.equal(keepRecipesFromOlderApp(here, here), here)
  // Through the whole merge, both ways round: the rename comes through, the pile stays.
  for (const minePreferred of [true, false]) {
    const merged = mergeCollection(here, here, olderPile, minePreferred).sortRecipes!
    assert.deepEqual(merged[0].pullOut, ['DECKS', 'GOALS', 'FRIENDS'])
    assert.equal(merged[0].name, 'Bulk boxes')
    const back = mergeCollection(here, olderPile, here, minePreferred).sortRecipes!
    assert.deepEqual(back[0].pullOut, ['DECKS', 'GOALS', 'FRIENDS'])
  }
  // A newer app that turned it off says so ("goals": false): it stays off.
  const off = pile([R('a', 'Bulk', { pullOut: ['DECKS', 'FRIENDS'] }), R('b', 'Rares')])
  assert.equal(off.sortRecipes![0].goals, false)
  assert.deepEqual(mergeCollection(here, here, off, true).sortRecipes![0].pullOut, ['DECKS', 'FRIENDS'])
})

test('the goals the Goals need pile goes by: open ones missing something, most nearly done first, a set goal with its set binder', () => {
  const dskCards = [
    { id: 'd1', name: 'Fear of Exposure', rarity: 'uncommon' }, { id: 'd2', name: 'Grim Cellar', rarity: 'uncommon' }, { id: 'd3', name: 'Valgavoth', rarity: 'mythic' },
  ]
  const dsk = newSetGoal('g-dsk', { code: 'DSK', name: 'Duskmourn' }, dskCards, ['uncommon'], false, 1)
  const shocks = newListGoal('g-shock', 'PLAYSET', 'Shock lands', [{ name: 'Steam Vents', qty: 1 }, { name: 'Sacred Foundry', qty: 1 }], 4, 1)
  const done: CollectionGoal = { ...newListGoal('g-done', 'CUSTOM', 'Done', [{ name: 'Opt', qty: 1 }], null, 1), completedAt: 5 }
  const full = newListGoal('g-full', 'CUSTOM', 'Full', [{ name: 'Opt', qty: 1 }], null, 1)
  const cols: Collection[] = [{
    ...pile(), entries: [
      { scryfallId: 'd1', name: 'Fear of Exposure', imageUrl: null, quantity: 1, foilQuantity: 0 },
      { scryfallId: 'sv', name: 'Steam Vents', imageUrl: null, quantity: 1, foilQuantity: 0 },
      { scryfallId: 'opt', name: 'Opt', imageUrl: null, quantity: 1, foilQuantity: 0 },
    ],
  }]
  const binder = (placeId: string, sets: string[]): OrderedBinder => ({ placeId, name: placeId, rule: 'SET', pockets: 9, occupied: [], names: [], sets })
  const needs = goalNeedsOf([shocks, done, full, dsk], cols, [], [binder('mixed', ['dsk', 'm10']), binder('dskonly', ['dsk'])])
  assert.deepEqual(needs, [
    { goalId: 'g-dsk', name: 'Duskmourn uncommons', kind: 'SET', foil: false, have: 1, need: 2, missing: { 'id:d2': 1 }, placeId: 'dskonly' },
    { goalId: 'g-shock', name: 'Shock lands', kind: 'PLAYSET', foil: false, have: 1, need: 8, missing: { 'n:steam vents': 3, 'n:sacred foundry': 4 } },
  ])
  assert.equal(goalNeedsOf([dsk], cols, [], [binder('mixed', ['dsk', 'm10'])])[0].placeId, 'mixed')
  assert.equal(goalNeedsOf([dsk], cols, [], [binder('m10', ['m10'])])[0].placeId, undefined)
  // A foil goal moves only for a foil copy; a set goal only for its printing.
  const ctx: SmartContext = { deckNeeds: {}, friendWants: {}, binders: [], owned: {}, goals: [{ ...needs[0], foil: true }] }
  assert.deepEqual(reasonsFor(ctx, { name: 'Grim Cellar', scryfallId: 'd2' }, []), [])
  assert.deepEqual(reasonsFor(ctx, { name: 'Grim Cellar', scryfallId: 'other-printing', foil: true }, []), [])
  assert.deepEqual(reasonsFor(ctx, { name: 'Grim Cellar', scryfallId: 'd2', foil: true }, []).map(reasonLine), ['GOAL · DUSKMOURN UNCOMMONS'])
})

test('filing the Goals need pile: into the goal’s set binder, else no place — or where the recipe says', () => {
  const dsk: StoragePlace = { id: 'dsk', name: 'Duskmourn', kind: 'BINDER', sortRule: 'SET', createdAt: 2 }
  const box: StoragePlace = { id: 'box', name: 'Goal box', kind: 'BOX', createdAt: 3 }
  const cols: Collection[] = [{ ...pile(), storagePlaces: [dsk, box] }]
  let recipe = sortRecipe({ id: 'r', name: 'Goals', pullOut: ['GOALS'], levels: [], apart: [], createdAt: 1 })
  const d = derivePiles(recipe, fmt)
  assert.equal(pileGoesTo(recipe, d.piles[0]), '')
  const scan = (id: string, name: string, placeId?: string): RecipeScan => ({
    id: Number(id.slice(1)), scryfallId: id, name, card: { name }, facts: { name, set: 'dsk' }, entry: { scryfallId: id, name, imageUrl: null, quantity: 0, foilQuantity: 0 },
    pile: 1, key: 'S:GOALS', reason: { kind: 'GOALS', goalId: 'g', goal: 'Duskmourn uncommons', have: 91, need: 92, ...(placeId ? { placeId } : {}) },
  })
  const scans = [scan('s1', 'Grim Cellar', 'dsk'), scan('s2', 'Steam Vents')]
  assert.deepEqual(scans.map((s) => binderFiledInto(recipe, s)), ['dsk', null])
  let filed = fileRecipe(cols, recipe, d, scans)
  assert.deepEqual(filed.steps.map((s) => `${s.scan.name} → ${s.to}`), ['Grim Cellar → Duskmourn', 'Steam Vents → No place yet'])
  recipe = withGoTo(recipe, 'S:GOALS', 'box')
  assert.equal(binderFiledInto(recipe, scans[0]), null)
  filed = fileRecipe(cols, recipe, d, scans)
  assert.deepEqual(filed.steps.map((s) => `${s.scan.name} → ${s.to}`), ['Grim Cellar → Goal box', 'Steam Vents → Goal box'])
})

test('saving and deleting recipes on the Unsorted pile', () => {
  let cols: Collection[] = []
  cols = saveRecipe(cols, R('a', 'Bulk'))
  cols = saveRecipe(cols, R('a', 'Bulk 2'))
  cols = saveRecipe(cols, R('b', 'Rares'))
  assert.deepEqual(recipesOf(cols).map((r) => r.name), ['Bulk 2', 'Rares'])
  assert.ok(isUnsorted(cols[0]))
  assert.deepEqual(recipesOf(deleteRecipe(cols, 'a')).map((r) => r.id), ['b'])
})

test('filing: binder gaps into their binder, deck needs with no place, the rest by rule or where the recipe says', () => {
  const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', sortRule: 'COLOUR', sections: ['Blue', 'Red'], createdAt: 1 }
  const dsk: StoragePlace = { id: 'dsk', name: 'Duskmourn', kind: 'BINDER', sortRule: 'SET', createdAt: 2 }
  const trade: StoragePlace = { id: 'trade', name: 'Trade binder', kind: 'BINDER', createdAt: 3 }
  const cols: Collection[] = [{ ...pile(), storagePlaces: [red, dsk, trade] }]
  let recipe = sortRecipe({ id: 'r', name: 'Bulk', pullOut: ['DECKS', 'BINDER', 'TRADE'], levels: [{ by: 'COLOUR' }], apart: [], createdAt: 1 })
  const d = derivePiles(recipe, fmt)
  const tradePile = d.piles.find((p) => p.key === 'S:TRADE')!
  assert.equal(pileGoesTo(recipe, tradePile), '')
  assert.equal(pileGoesTo(recipe, d.piles.find((p) => p.key === 'L:R')!), BY_RULE)
  recipe = withGoTo(recipe, 'S:TRADE', 'trade')
  assert.equal(pileGoesTo(recipe, tradePile), 'trade')
  const scan = (id: string, name: string, key: string, more: Partial<RecipeScan> = {}): RecipeScan => ({
    id: Number(id.slice(1)), scryfallId: id, name, card: { name, colors: ['R'] }, facts: { name, colors: ['R'], typeLine: 'Instant' },
    entry: { scryfallId: id, name, imageUrl: null, quantity: 0, foilQuantity: 0 }, pile: d.piles.find((p) => p.key === key)!.number, key, ...more,
  })
  const scans = [
    scan('s1', 'Shock', 'L:R'),
    scan('s2', 'Goblin Chieftain', 'S:DECKS', { reason: { kind: 'DECKS', deckId: 'k', deck: 'Krenko' } }),
    scan('s3', 'Unholy Annex', 'S:BINDER', { reason: { kind: 'BINDER', placeId: 'dsk', binder: 'Duskmourn', page: 1, slot: 2 } }),
    scan('s4', 'Lightning Bolt', 'S:TRADE', { reason: { kind: 'TRADE', copy: 5 } }),
    scan('s5', 'Fling', 'L:R', { filed: true }),
  ]
  const filed = fileRecipe(cols, recipe, d, scans)
  assert.equal(filed.added, 4)
  assert.deepEqual(filed.steps.map((s) => `${s.scan.name} → ${s.to}`), ['Shock → Red box › Red', 'Goblin Chieftain → No place yet', 'Unholy Annex → Duskmourn', 'Lightning Bolt → Trade binder'])
  const entries = filed.collections.find(isUnsorted)!.entries
  assert.deepEqual(entries.map((e) => `${e.name} ${e.quantity} ${(e.places ?? []).map((p) => p.placeId + (p.section ? `:${p.section}` : '')).join(',')}`).sort(), [
    'Goblin Chieftain 1 ', 'Lightning Bolt 1 trade', 'Shock 1 red:Red', 'Unholy Annex 1 dsk',
  ])
})

test('send to pile N instead: the next smart pile that wants it, else its own pile', () => {
  const recipe = V.sessions[0].recipe
  const d = derivePiles(recipe, fmt)
  const card: RecipeCard = { name: 'Goblin Chieftain', colors: ['R'], typeLine: 'Creature', usd: 0.6 }
  const deck = { kind: 'DECKS' as const, deckId: 'k', deck: 'Krenko' }
  const friend = { kind: 'FRIENDS' as const, friend: 'Priya', friendId: 'u-priya' }
  assert.equal(otherPile(recipe, d, { card, pile: 1, reason: deck, also: [friend] }, 1)?.pile, 2)
  assert.deepEqual(otherPile(recipe, d, { card, pile: 1, reason: deck, also: [friend] }, 1)?.also, [deck])
  // Nothing else wants it: the pile it'd go in without the smart piles.
  assert.equal(otherPile(recipe, d, { card, pile: 2, reason: friend, also: [] }, 1)?.key, 'L:v1/R')
  assert.equal(otherPile(recipe, d, { card, pile: 11, reason: null, also: [] }, 1), null)
  // From the Goals need pile, the next smart pile after it: a friend's.
  const goalRecipe = V.goalSessions.sessions[0].recipe
  const gd = derivePiles(goalRecipe, fmt)
  const goal = { kind: 'GOALS' as const, goalId: 'g', goal: 'Shock lands', have: 38, need: 40 }
  assert.equal(otherPile(goalRecipe, gd, { card, pile: 2, reason: goal, also: [deck, friend] }, 1)?.key, 'S:FRIENDS')
  assert.equal(otherPile(goalRecipe, gd, { card, pile: 1, reason: deck, also: [goal] }, 1)?.key, 'S:GOALS')
})

test('pile signs: each pile’s number and name, two to a page of the paper chosen', () => {
  const d = derivePiles(V.sessions[0].recipe, fmt)
  const a4 = pileSignsHtml(d.piles.slice(6, 8), 'A4', 'Bulk <signs>')
  assert.match(a4, /size:A4 portrait/)
  assert.match(a4, /<div class="num">7<\/div><div class="name">\$2 and up<\/div>/)
  assert.match(a4, /<div class="num">8<\/div><div class="name">White<\/div>/)
  assert.match(a4, /<title>Bulk &lt;signs&gt;<\/title>/)
  assert.match(a4, /height:134\.5mm/)
  assert.match(pileSignsHtml(d.piles, 'LETTER'), /size:letter portrait.*height:125\.7mm/)
})

test('what the smart piles go by: deck needs, friends’ wants, binders in order', () => {
  const card = (id: string, name: string, quantity = 1) => ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })
  const krenko = {
    id: 'k', name: 'Krenko', commander: null, partnerCommander: null, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'VIRTUAL',
    cards: [card('matron', 'Goblin Matron', 2), card('shock', 'Shock')], considering: [card('fling', 'Fling')],
  } as unknown as Deck
  const dsk: StoragePlace = { id: 'dsk', name: 'Duskmourn', kind: 'BINDER', sortRule: 'SET', createdAt: 2 }
  const cols: Collection[] = [{
    ...pile(), storagePlaces: [dsk],
    entries: [
      { scryfallId: 'shock', name: 'Shock', imageUrl: null, quantity: 1, foilQuantity: 0 },
      { scryfallId: 'a1', name: 'Acrobat', imageUrl: null, quantity: 1, foilQuantity: 0, places: [{ placeId: 'dsk', qty: 1, page: 1, slot: 1 }] },
      { scryfallId: 'z9', name: 'Zimone', imageUrl: null, quantity: 1, foilQuantity: 0, places: [{ placeId: 'dsk', qty: 1 }] },
    ],
  }]
  assert.deepEqual(deckNeedsOf(cols, [krenko]), { 'goblin matron': [{ deckId: 'k', deck: 'Krenko', qty: 2 }], fling: [{ deckId: 'k', deck: 'Krenko', qty: 1 }] })
  const names: Record<string, string> = { 'u-priya': 'Priya', 'u-jo': 'Jo' }
  assert.deepEqual(
    friendWantsOf([
      { friend: 'u-priya', they_want: [{ name: 'Shock' }, { name: 'Opt' }] }, { friend: 'u-jo', they_want: [{ name: 'shock' }] }, { friend: 'u-gone', they_want: [{ name: 'Opt' }] },
    ], (id) => names[id] ?? null),
    { shock: [{ id: 'u-priya', name: 'Priya' }, { id: 'u-jo', name: 'Jo' }], opt: [{ id: 'u-priya', name: 'Priya' }] },
  )
  const facts = (id: string) => (id === 'a1' ? { name: 'Acrobat', set: 'dsk', collectorNumber: '1' } : id === 'z9' ? { name: 'Zimone', set: 'DSK', collectorNumber: '40' } : null)
  assert.deepEqual(orderedBinders(cols, facts), [{
    placeId: 'dsk', name: 'Duskmourn', rule: 'SET', pockets: 9, occupied: [{ index: 0, facts: { name: 'Acrobat', set: 'dsk', collectorNumber: '1' } }],
    names: ['acrobat', 'zimone'], sets: ['dsk'],
  }])
})

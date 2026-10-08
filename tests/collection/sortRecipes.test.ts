import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  alsoLine, bucketOf, capWarning, cardLine, checkPileCard, derivePiles, fileRecipe, HandsFreeCapture, keepRecipesFromOlderApp, levelBuckets,
  levelLine, mergeRecipes, newRecipe, pileGoesTo, reasonLine, recipeLine, recipeTemplates, recipesOf, saveRecipe, deleteRecipe, sortCard,
  sortRecipe, spokenPile, summarize, withGoTo, ordinal, otherPile, pileSignsHtml, deckNeedsOf, friendWantsOf, orderedBinders,
  type RecipeCard, type RecipeScan, type SmartContext, type SortRecipe, type SplitLevel,
} from '../../src/collection/sortRecipes.ts'
import { BY_RULE } from '../../src/collection/sortPiles.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import { isUnsorted, type Collection, type Deck, type StoragePlace } from '../../src/types/models.ts'

// Sorting recipes. The cases in sortRecipeVectors.json are run by the Android app too (SortRecipesTest.kt),
// so both apps make the same piles and send every card to the same one.

interface Vectors {
  derive: { recipe: SortRecipe; piles: string[]; wanted: number; capped: boolean; warning: string | null; line: string }[]
  labels: { level: SplitLevel; labels: string[]; line: string }[]
  buckets: { level: SplitLevel; rate: number; card: RecipeCard; key: string }[]
  ctx: SmartContext
  session: RecipeCard[]
  sessions: {
    recipe: SortRecipe
    rate: number
    expect: { pile: number; key: string; reason: string | null; also: string[]; spoken: string; line: string }[]
    summary: { cards: number; usd: number; rows: string[] }
    checks: { pile: number; names: string[]; lines: string[] }[]
  }[]
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

test('a session: smart piles first (deck > friend > binder > trade), then keep apart, then the levels', () => {
  for (const s of V.sessions) {
    const d = derivePiles(s.recipe, fmt)
    const scans: RecipeScan[] = []
    V.session.forEach((card, i) => {
      const c = sortCard(s.recipe, d, V.ctx, card, scans, s.rate)
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
  const mine = newRecipe('n1', 5)
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
    goTo: [{ pile: 'L:v0', to: 'b' }], createdAt: 3,
  })
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

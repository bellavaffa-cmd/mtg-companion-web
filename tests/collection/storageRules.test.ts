import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  compareForSort, copyFitsItsPlace, fitsPlace, hasRule, holdsFromMap, holdsMap, holdsMatch, keepPlaceRules, misfits, moveMisfit, movedInOrder, overlapLine, overlaps,
  placeFor, placeOrderOf, placeRules, ruleSectionFor, ruleSections, rulePlaces, rulesLine, ruleSpot, sectionLabel, sortedForRule, sortHint,
  sortRuleFor, withPlaceOrder, withRules, type RuleCard,
} from '../../src/collection/storageRules.ts'
import { derivePiles, levelKey, pileGoesTo, recipeTemplates, type SplitLevel } from '../../src/collection/sortRecipes.ts'
import { NO_ADVANCED_FILTER, type AdvancedFacts } from '../../src/collection/advancedFilter.ts'
import { NO_COLLECTION_FILTER } from '../../src/collection/cardFilter.ts'
import { cardsIn, placesOf, placeSubtitle, storagePlace, suggestSpot, type CardFacts } from '../../src/collection/storagePlaces.ts'
import { bestPlaceByRule } from '../../src/collection/pullList.ts'
import { cardsFilterCount, filterCopies, NO_CARDS_FILTER } from '../../src/collection/placeFilter.ts'
import { canLetAppChoose } from '../../src/scan/scannerModes.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import type { Collection, CollectionEntry, PlaceHolds, StoragePlace } from '../../src/types/models.ts'

// A place's rules. The cases in storageRulesVectors.json are run by the Android app too
// (StorageRulesTest.kt), so both apps put every card in the same place, section and spot.

interface VCard {
  name: string; colors: string[]; colorIdentity: string[]; typeLine: string; set: string; collectorNumber: string; cmc: number; rarity: string
  usd?: number; usdFoil?: number; text?: string; foil?: boolean; roleTags?: string[]; userTags?: string[]; noData?: boolean
}
type PlaceRef = string | StoragePlace
interface Vectors {
  cards: Record<string, VCard>
  places: StoragePlace[]
  order: string[]
  rulePlaces: { order: string[]; ids: string[] }[]
  placeFor: { card: string; order?: string[]; place: string | null }[]
  holds: { holds: PlaceHolds | null; yes: string[]; no: string[] }[]
  migration: { place: StoragePlace; sectionsBy: SplitLevel | null; sortBy: string[]; hasRule: boolean }[]
  sortRuleFor: { sectionsBy: SplitLevel | null; sortBy: string[]; sortRule: string | null }[]
  withRules: { place: StoragePlace; holds: PlaceHolds | null; sectionsBy: SplitLevel | null; sortBy: string[]; expect: { holds: PlaceHolds | null; sectionsBy: SplitLevel | null; sortBy: string[] | null; sortRule: string | null } }[]
  sections: { sectionsBy: SplitLevel; card: string; label: string }[]
  ruleSections: { sectionsBy: SplitLevel | null; sections: string[] }[]
  sectionFor: { place: PlaceRef; card: string; section: string | null }[]
  hints: { sortBy: string[]; card: string; others: string[]; hint: string | null }[]
  lines: { place: PlaceRef; line: string }[]
  overlaps: { draft: string; order?: string[]; cards: string[]; lines: string[] }[]
  keep: { source: Collection; theirs: Collection; expect: { placeOrder: string[] | null; storagePlaces: StoragePlace[] } }[]
  templates: { storage: [string, string][]; first: string; piles?: string[]; cards?: { place: string | null; pile: string; goesTo: string }[] }[]
}

const V = JSON.parse(readFileSync(new URL('./storageRulesVectors.json', import.meta.url), 'utf8')) as Vectors

function factsOf(c: VCard): CardFacts {
  return {
    name: c.name, colors: c.colors, typeLine: c.typeLine, set: c.set, collectorNumber: c.collectorNumber, colorIdentity: c.colorIdentity,
    cmc: c.cmc, rarity: c.rarity, usd: c.usd ?? null, usdFoil: c.usdFoil ?? null, foil: !!c.foil,
  }
}

function advancedOf(c: VCard): AdvancedFacts {
  return {
    colors: c.colors, identity: c.colorIdentity, cmc: c.cmc, manaCost: [], stats: [], legalities: {}, set: c.set.toLowerCase(),
    canBeCommander: false, gameChanger: false, reserved: false, dfc: false, fullArt: false, token: false, keywords: [],
    usd: c.usd ?? null, usdFoil: c.usdFoil ?? null, artist: '', flavor: '', etchedOnly: false,
  }
}

/** A vector card as the rules judge it: no filter facts when its data isn't here. */
function ruleCard(key: string): RuleCard {
  const c = V.cards[key]
  const facts = factsOf(c)
  if (c.noData) return { facts }
  return {
    facts,
    basic: { colors: new Set(c.colorIdentity), typeLine: c.typeLine, rarity: c.rarity, text: c.text ?? '' },
    advanced: advancedOf(c),
    roleTags: c.roleTags,
    userTags: c.userTags ?? [],
  }
}

const placeOf = (ref: PlaceRef): StoragePlace => (typeof ref === 'string' ? V.places.find((p) => p.id === ref)! : ref)

test('the places with rules are tried in the order the user chose', () => {
  for (const c of V.rulePlaces) assert.deepEqual(rulePlaces(V.places, c.order).map((p) => p.id), c.ids, JSON.stringify(c.order))
})

test('a card goes to the first place in rule order that holds it', () => {
  for (const c of V.placeFor) {
    assert.equal(placeFor(V.places, c.order ?? V.order, ruleCard(c.card))?.id ?? null, c.place, c.card)
  }
})

test('what a place holds is a Cards filter', () => {
  for (const c of V.holds) {
    const h = holdsFromMap(c.holds)
    for (const k of c.yes) assert.ok(holdsMatch(h, ruleCard(k)), `${k} fits`)
    for (const k of c.no) assert.ok(!holdsMatch(h, ruleCard(k)), `${k} doesn't fit`)
  }
})

test('an older app\'s sorting rule reads as the rules it meant', () => {
  for (const c of V.migration) {
    const r = placeRules(c.place)
    assert.deepEqual(r.sectionsBy, c.sectionsBy, JSON.stringify(c.place))
    assert.deepEqual(r.sortBy, c.sortBy, JSON.stringify(c.place))
    assert.equal(hasRule(c.place), c.hasRule, JSON.stringify(c.place))
  }
  for (const c of V.sortRuleFor) assert.equal(sortRuleFor(c.sectionsBy, c.sortBy), c.sortRule, JSON.stringify(c))
})

test('saving rules writes the new fields and the nearest old rule', () => {
  for (const c of V.withRules) {
    const p = storagePlace(withRules(c.place, c.holds, c.sectionsBy, c.sortBy))
    assert.deepEqual(p.holds ?? null, c.expect.holds, JSON.stringify(c.place))
    assert.deepEqual(p.sectionsBy ?? null, c.expect.sectionsBy, JSON.stringify(c.place))
    assert.deepEqual(p.sortBy ?? null, c.expect.sortBy, JSON.stringify(c.place))
    assert.equal(p.sortRule ?? null, c.expect.sortRule, JSON.stringify(c.place))
  }
})

test('sections come from one level of the sorting recipes', () => {
  for (const c of V.sections) assert.equal(sectionLabel(c.sectionsBy, factsOf(V.cards[c.card])), c.label, `${c.sectionsBy.by} ${c.card}`)
  for (const c of V.ruleSections) assert.deepEqual(ruleSections(c.sectionsBy), c.sections, JSON.stringify(c.sectionsBy))
  for (const c of V.sectionFor) assert.equal(ruleSectionFor(placeOf(c.place), factsOf(V.cards[c.card])), c.section, `${JSON.stringify(c.place)} ${c.card}`)
})

test('where in a section a card goes', () => {
  for (const c of V.hints) {
    assert.equal(sortHint(c.sortBy, factsOf(V.cards[c.card]), c.others.map((k) => factsOf(V.cards[k]))), c.hint, `${c.sortBy} ${c.card}`)
  }
})

test('a place says its rules in a line', () => {
  for (const c of V.lines) assert.equal(rulesLine(placeOf(c.place)), c.line, JSON.stringify(c.place))
  assert.equal(placeSubtitle(placeOf('blue')), 'Box · Holds blue cards · by card type · A–Z')
})

test('places whose rules overlap say which comes first', () => {
  for (const c of V.overlaps) {
    const got = overlaps(placeOf(c.draft), V.places, c.order ?? V.order, c.cards.map(ruleCard)).map(overlapLine)
    assert.deepEqual(got, c.lines, c.draft)
  }
})

test('an older app\'s save keeps the rules', () => {
  for (const c of V.keep) {
    const out = keepPlaceRules(c.source, c.theirs)
    assert.deepEqual(out.placeOrder ?? null, c.expect.placeOrder)
    assert.deepEqual(out.storagePlaces, c.expect.storagePlaces)
  }
})

test('Into my storage: a pile per place in rule order, filed there', () => {
  for (const c of V.templates) {
    const t = recipeTemplates([], false, c.storage.map(([id, name]) => ({ id, name })))
    assert.equal(t[0].id, c.first)
    if (!c.piles) continue
    const d = derivePiles(t[0], (n) => `$${n}`)
    assert.deepEqual(d.piles.map((p) => p.name), c.piles)
    for (const k of c.cards ?? []) {
      const key = levelKey(t[0], { name: 'X', place: k.place }, 1)
      const pile = d.piles.find((p) => p.key === key)!
      assert.equal(pile.name, k.pile)
      assert.equal(pileGoesTo(t[0], pile), k.goesTo)
    }
  }
})

// ---- The app's own ----

const entry = (id: string, name: string, placeId: string, qty: number, section?: string): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity: qty, foilQuantity: 0, places: [{ placeId, qty, ...(section ? { section } : {}) }] })

const library = (): Collection[] => [{
  id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', storagePlaces: V.places, placeOrder: V.order,
  entries: [
    entry('counterspell', 'Counterspell', 'blue', 1, 'Instants'),
    entry('cryptic', 'Cryptic Command', 'blue', 1, 'Sorceries'),
    entry('bolt', 'Lightning Bolt', 'blue', 2, 'Instants'),
    entry('brainstorm', 'Brainstorm', 'blue', 1, 'Instants'),
  ],
}]

test('put away: the place, the section and where in it', () => {
  const cols = library()
  const best = bestPlaceByRule(placesOf(cols), factsOf(V.cards.ponder), cols, ruleCard('ponder'))!
  assert.equal(best.place.id, 'blue')
  assert.deepEqual(best.spot, { placeId: 'blue', section: 'Sorceries' })
  const { hint } = suggestSpot(placeOf('blue'), factsOf(V.cards.ponder), cols)
  assert.equal(hint, 'Sorceries › after Cryptic Command')
  const s = ruleSpot(placeOf('blue'), factsOf(V.cards.counterspell), cardsIn(cols, 'blue'))
  assert.equal(s.hint, 'Instants › next to Counterspell')
  // Without its data, a card is judged by its sorting facts; with only its name, only the places holding everything take it.
  assert.equal(bestPlaceByRule(placesOf(cols), factsOf(V.cards.mystery), cols)?.place.id, 'blue')
  assert.equal(bestPlaceByRule(placesOf(cols), { name: 'Mystery Card' }, cols)?.place.id, 'bulk')
  assert.ok(canLetAppChoose(V.places))
  assert.ok(!canLetAppChoose([placeOf('plain')]))
})

test('put away passes over a full place when asked', () => {
  const full = V.places.map((p) => (p.id === 'blue' ? { ...p, capacity: 5 } : p))
  const cols = library().map((c) => ({ ...c, storagePlaces: full }))
  assert.equal(bestPlaceByRule(full, factsOf(V.cards.ponder), cols, ruleCard('ponder'))?.place.id, 'blue')
  assert.equal(bestPlaceByRule(full, factsOf(V.cards.ponder), cols, ruleCard('ponder'), undefined, undefined, true)?.place.id, 'bulk')
})

test('check a place: what doesn\'t belong, and moving it', () => {
  const cols = library()
  const found = misfits(placeOf('blue'), cols, (c) => (V.cards[c.entry.scryfallId] ? ruleCard(c.entry.scryfallId) : null))
  assert.deepEqual(found.map((m) => `${m.card.entry.name}: ${m.line}`), [
    'Cryptic Command: In Sorceries — belongs in Instants',
    'Lightning Bolt: Doesn\'t belong here — belongs in Red box',
  ])
  const bolt = found.find((m) => m.wrongPlace)!
  const moved = moveMisfit(cols, bolt, { placeId: 'red' })
  assert.deepEqual(moved[0].entries.find((e) => e.scryfallId === 'bolt')!.places, [{ placeId: 'red', qty: 2 }])
  const cryptic = found.find((m) => !m.wrongPlace)!
  assert.deepEqual(moveMisfit(cols, cryptic, null)[0].entries.find((e) => e.scryfallId === 'cryptic')!.places, [{ placeId: 'blue', qty: 1, section: 'Instants' }])
})

test('a section listed in its order', () => {
  const cards = ['ponder', 'cryptic', 'brainstorm', 'counterspell'].map((k) => factsOf(V.cards[k]))
  assert.deepEqual(sortedForRule(['MANA_VALUE', 'NAME'], cards, (f) => f).map((f) => f.name), ['Brainstorm', 'Ponder', 'Counterspell', 'Cryptic Command'])
  assert.deepEqual(sortedForRule([], cards, (f) => f).map((f) => f.name), ['Ponder', 'Cryptic Command', 'Brainstorm', 'Counterspell'])
  assert.ok(compareForSort(['VALUE'], cards[1], cards[0]) < 0)
})

test('the rule order is kept on the Unsorted pile and moved place by place', () => {
  const cols = withPlaceOrder(library(), ['blue', 'red', 'blue'])
  assert.deepEqual(placeOrderOf(cols), ['blue', 'red'])
  assert.deepEqual(movedInOrder(V.places, ['red', 'blue'], 'bulk', 0), ['bulk', 'red', 'blue', 'rares', 'lands', 'trade'])
  assert.deepEqual(movedInOrder(V.places, ['red', 'blue'], 'red', 9), ['blue', 'rares', 'lands', 'trade', 'bulk', 'red'])
})

test('two devices\' rules merge field by field, and the rule order too', () => {
  const base = library()[0]
  const mine = { ...base, placeOrder: ['blue', 'red'] }
  const blueTheirs = withRules(placeOf('blue'), holdsMap({ ...NO_COLLECTION_FILTER, colors: ['U', 'B'] }, NO_ADVANCED_FILTER), { by: 'TYPE' }, ['NAME'])
  const theirs = { ...base, storagePlaces: V.places.map((p) => (p.id === 'blue' ? blueTheirs : p)) }
  const merged = mergeCollection(base, mine, theirs, true)
  assert.deepEqual(merged.placeOrder, ['blue', 'red'])
  assert.deepEqual(merged.storagePlaces!.find((p) => p.id === 'blue')!.holds, { basic: { type: '', text: '', colors: ['U', 'B'], rarities: [] } })
  // An older app's save of the pile (no rules, no order) keeps both.
  const older: Collection = { ...base, placeOrder: undefined, storagePlaces: V.places.map((p) => storagePlace({ id: p.id, name: p.name, kind: p.kind, createdAt: p.createdAt, ...(p.sortRule ? { sortRule: p.sortRule } : {}), ...(p.sections ? { sections: p.sections } : {}) })) }
  const kept = mergeCollection(base, base, older, true)
  assert.deepEqual(kept.placeOrder, V.order)
  assert.deepEqual(kept.storagePlaces!.find((p) => p.id === 'red')!.sortBy, ['MANA_VALUE', 'NAME'])
})

test('the Storage filters\' Doesn\'t fit its place', () => {
  const cols = library()
  const byId = new Map(V.places.map((p) => [p.id, p]))
  const cards = cardsIn(cols, 'blue')
  assert.deepEqual(Object.fromEntries(cards.map((c) => [c.entry.name, copyFitsItsPlace(byId, c, ruleCard(c.entry.scryfallId))])),
    { Brainstorm: true, Counterspell: true, 'Cryptic Command': false, 'Lightning Bolt': false })
  assert.equal(copyFitsItsPlace(byId, cards[0], null), null)
  const facts = { card: () => undefined, advanced: () => undefined, copies: new Map(), chains: new Map(), fitsItsPlace: (c: (typeof cards)[number]) => copyFitsItsPlace(byId, c, ruleCard(c.entry.scryfallId)) }
  assert.deepEqual(filterCopies(cards, { ...NO_CARDS_FILTER, misfitsOnly: true }, facts).map((c) => c.entry.name), ['Cryptic Command', 'Lightning Bolt'])
  assert.equal(cardsFilterCount({ ...NO_CARDS_FILTER, misfitsOnly: true }), 1)
})

test('holds with nothing on is everything', () => {
  assert.equal(holdsMap(NO_COLLECTION_FILTER, NO_ADVANCED_FILTER), null)
  assert.equal(holdsFromMap({ basic: { type: '', text: '', colors: [], rarities: [] } }), null)
  assert.ok(fitsPlace(placeOf('plain'), ruleCard('mystery')))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advancedActive, advancedCount, advancedFactsOf, advancedMatches, chipText, compare, copyFactsOf, costContains, filterChips,
  manaSymbols, NO_ADVANCED_FILTER, numberOf, queryNumber, removeChip, savedFiltersFromJson, savedFiltersToJson, scryfallQuery,
  type AdvancedFilter, type CopyFacts,
} from '../../src/collection/advancedFilter.ts'
import { NO_COLLECTION_FILTER, type CollectionFilter } from '../../src/collection/cardFilter.ts'
import type { Collection, Deck } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The All cards Advanced filters, as the Android app's AdvancedFilterTest — the same cases.

const card = (over: Partial<ScryfallCard>): ScryfallCard => ({ id: 'x', name: 'X', ...over }) as ScryfallCard
const adv = (over: Partial<AdvancedFilter>): AdvancedFilter => ({ ...NO_ADVANCED_FILTER, ...over })
const basic = (over: Partial<CollectionFilter>): CollectionFilter => ({ ...NO_COLLECTION_FILTER, ...over })
const copies = (over: Partial<CopyFacts>): CopyFacts => ({ nonfoil: 1, foil: 0, conditions: [], languages: ['en'], binders: [], inDeck: false, copies: 1, ...over })
const one = copies({})

const atraxa = advancedFactsOf(card({
  name: 'Atraxa, Praetors\' Voice', type_line: 'Legendary Creature — Phyrexian Angel Horror', mana_cost: '{G}{W}{U}{B}', cmc: 4,
  colors: ['W', 'U', 'B', 'G'], color_identity: ['W', 'U', 'B', 'G'], power: '4', toughness: '4',
  keywords: ['Flying', 'Vigilance', 'Deathtouch', 'Lifelink'], legalities: { commander: 'legal', modern: 'not_legal' },
  set: '2XM', prices: { usd: '20.00', usd_foil: '45.00' }, artist: 'Victor Adame Minguez', finishes: ['nonfoil', 'foil'],
  oracle_text: 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.', game_changer: false,
}))
const bolt = advancedFactsOf(card({
  name: 'Lightning Bolt', type_line: 'Instant', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  legalities: { commander: 'legal', modern: 'legal', standard: 'not_legal' }, set: 'lea', prices: { usd: '2.50', usd_foil: null },
  artist: 'Christopher Rush', flavor_text: 'The sparkmage shrieked, calling on the rage of the storms of his youth.',
}))
const delver = advancedFactsOf(card({
  name: 'Delver of Secrets // Insectile Aberration', layout: 'transform', cmc: 1, color_identity: ['U'], set: 'isd',
  card_faces: [
    { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', power: '1', toughness: '1', colors: ['U'], artist: 'Nils Hamm' },
    { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect', power: '3', toughness: '2', colors: ['U'], artist: 'Nils Hamm', flavor_text: 'If only he had used his gift for good.' },
  ],
  prices: { usd: '0.25' },
}))
const goyf = advancedFactsOf(card({ name: 'Tarmogoyf', type_line: 'Creature — Lhurgoyf', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], power: '*', toughness: '1+*' }))
const jace = advancedFactsOf(card({
  name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace', mana_cost: '{2}{U}{U}', cmc: 4, colors: ['U'], color_identity: ['U'],
  loyalty: '3', legalities: { vintage: 'restricted', standard: 'banned' }, game_changer: true,
}))
const solRing = advancedFactsOf(card({
  name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], legalities: { commander: 'legal', vintage: 'restricted' },
  finishes: ['etched'], prices: { usd: null, usd_foil: '30.00' }, full_art: false,
}))
const mox = advancedFactsOf(card({ name: 'Mox Diamond', type_line: 'Artifact', mana_cost: '{0}', cmc: 0, colors: [], color_identity: [], reserved: true, full_art: true }))
const soldier = advancedFactsOf(card({ name: 'Soldier', type_line: 'Token Creature — Soldier', layout: 'token', colors: ['W'], color_identity: ['W'], power: '1', toughness: '1' }))
const teferi = advancedFactsOf(card({ name: 'Teferi, Temporal Archmage', type_line: 'Legendary Planeswalker — Teferi', oracle_text: 'Teferi, Temporal Archmage can be your commander.', colors: ['U'], color_identity: ['U'], cmc: 6, loyalty: '5' }))

test('numbers: typed numbers only, * and blanks are none', () => {
  assert.equal(numberOf('3'), 3)
  assert.equal(numberOf(' 2.5 '), 2.5)
  assert.equal(numberOf('-1'), -1)
  assert.equal(numberOf('*'), null)
  assert.equal(numberOf('1+*'), null)
  assert.equal(numberOf(''), null)
  assert.equal(numberOf('abc'), null)
})

test('compare: every operator', () => {
  assert.equal(compare(3, '=', 3), true)
  assert.equal(compare(2, '<', 3), true)
  assert.equal(compare(3, '<=', 3), true)
  assert.equal(compare(4, '>', 3), true)
  assert.equal(compare(3, '>=', 3), true)
  assert.equal(compare(3, '!=', 3), false)
  assert.equal(compare(4, '!=', 3), true)
  assert.equal(compare(3, '<', 3), false)
})

test('mana symbols: braces, plain letters and hybrid', () => {
  assert.deepEqual(manaSymbols('{2}{U}{U}'), ['2', 'U', 'U'])
  assert.deepEqual(manaSymbols('2uu'), ['2', 'U', 'U'])
  assert.deepEqual(manaSymbols('{10}{w/u}'), ['10', 'W/U'])
  assert.deepEqual(manaSymbols(''), [])
})

test('cost contains: as much generic, and each coloured symbol as often', () => {
  assert.equal(costContains(['2', 'U', 'U'], ['1', 'U']), true)
  assert.equal(costContains(['2', 'U', 'U'], ['U', 'U']), true)
  assert.equal(costContains(['2', 'U', 'U'], ['U', 'U', 'U']), false)
  assert.equal(costContains(['1', 'G'], ['2']), false)
  assert.equal(costContains(['G', 'W', 'U', 'B'], ['B', 'G']), true)
})

test('no advanced filter lets everything through, even cards not loaded yet', () => {
  assert.equal(advancedActive(NO_ADVANCED_FILTER), false)
  assert.equal(advancedMatches(NO_ADVANCED_FILTER, undefined, undefined), true)
  // A number field that isn't a number yet isn't on.
  assert.equal(advancedActive(adv({ mv: '*' })), false)
  assert.equal(advancedActive(adv({ colorTarget: 'color', colorMode: 'exactly' })), false)
})

test('a card not loaded yet is left out while a filter is on; so is one with no copies while a Your copies filter is', () => {
  assert.equal(advancedMatches(adv({ mv: '3' }), undefined, one), false)
  assert.equal(advancedMatches(adv({ inDeck: 'yes' }), bolt, undefined), false)
  assert.equal(advancedMatches(adv({ mv: '3', mvOp: '<=' }), bolt, undefined), true)
})

test('colours: commander identity at most, including, exactly', () => {
  const ub = (colorMode: AdvancedFilter['colorMode']) => adv({ colorTarget: 'identity', colorMode, colors: ['U', 'B'] })
  assert.equal(advancedMatches(ub('atMost'), jace, one), true)
  assert.equal(advancedMatches(ub('atMost'), solRing, one), true)
  assert.equal(advancedMatches(ub('atMost'), atraxa, one), false)
  assert.equal(advancedMatches(ub('including'), atraxa, one), true)
  assert.equal(advancedMatches(ub('including'), jace, one), false)
  assert.equal(advancedMatches(ub('exactly'), atraxa, one), false)
  assert.equal(advancedMatches(adv({ colorMode: 'exactly', colors: ['U'] }), jace, one), true)
})

test('colours: card colour reads every face of a double-faced card', () => {
  assert.equal(advancedMatches(adv({ colorTarget: 'color', colorMode: 'exactly', colors: ['U'] }), delver, one), true)
  assert.equal(advancedMatches(adv({ colorTarget: 'color', colorMode: 'including', colors: ['R'] }), bolt, one), true)
})

test('colours: colourless and multicolour', () => {
  assert.equal(advancedMatches(adv({ colors: ['C'] }), solRing, one), true)
  assert.equal(advancedMatches(adv({ colors: ['C'] }), bolt, one), false)
  assert.equal(advancedMatches(adv({ multicolor: true }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ multicolor: true }), bolt, one), false)
  assert.equal(advancedMatches(adv({ multicolor: true, colorMode: 'including', colors: ['G'] }), atraxa, one), true)
})

test('mana value with an operator', () => {
  assert.equal(advancedMatches(adv({ mvOp: '<=', mv: '3' }), bolt, one), true)
  assert.equal(advancedMatches(adv({ mvOp: '<=', mv: '3' }), atraxa, one), false)
  assert.equal(advancedMatches(adv({ mvOp: '=', mv: '0' }), mox, one), true)
  assert.equal(advancedMatches(adv({ mvOp: '!=', mv: '4' }), atraxa, one), false)
  assert.equal(advancedMatches(adv({ mvOp: '>', mv: '3' }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ mvOp: '>=', mv: '0' }), soldier, one), false)
})

test('mana cost must hold at least the symbols typed', () => {
  assert.equal(advancedMatches(adv({ manaCost: '{2}{U}{U}' }), jace, one), true)
  assert.equal(advancedMatches(adv({ manaCost: '{U}{U}' }), jace, one), true)
  assert.equal(advancedMatches(adv({ manaCost: '{U}{U}{U}' }), jace, one), false)
  assert.equal(advancedMatches(adv({ manaCost: 'u' }), delver, one), true)
  assert.equal(advancedMatches(adv({ manaCost: '{R}' }), jace, one), false)
})

test('power and toughness: * fails a number, and every face counts', () => {
  assert.equal(advancedMatches(adv({ powerOp: '>=', power: '4' }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ powerOp: '>=', power: '0' }), goyf, one), false)
  assert.equal(advancedMatches(adv({ toughnessOp: '>=', toughness: '0' }), goyf, one), false)
  // Delver's back face is a 3/2.
  assert.equal(advancedMatches(adv({ powerOp: '>=', power: '3' }), delver, one), true)
  assert.equal(advancedMatches(adv({ toughnessOp: '=', toughness: '2' }), delver, one), true)
  assert.equal(advancedMatches(adv({ powerOp: '>=', power: '1' }), bolt, one), false)
})

test('loyalty', () => {
  assert.equal(advancedMatches(adv({ loyaltyOp: '>=', loyalty: '3' }), jace, one), true)
  assert.equal(advancedMatches(adv({ loyaltyOp: '>', loyalty: '3' }), jace, one), false)
  assert.equal(advancedMatches(adv({ loyaltyOp: '>=', loyalty: '1' }), atraxa, one), false)
})

test('format: legal, banned, restricted', () => {
  assert.equal(advancedMatches(adv({ format: 'commander', legality: 'legal' }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ format: 'modern', legality: 'legal' }), atraxa, one), false)
  assert.equal(advancedMatches(adv({ format: 'standard', legality: 'banned' }), jace, one), true)
  assert.equal(advancedMatches(adv({ format: 'vintage', legality: 'restricted' }), solRing, one), true)
  assert.equal(advancedMatches(adv({ format: 'vintage', legality: 'restricted' }), bolt, one), false)
})

test('sets: any of the sets picked', () => {
  assert.equal(advancedMatches(adv({ sets: ['2xm'] }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ sets: ['isd', 'lea'] }), bolt, one), true)
  assert.equal(advancedMatches(adv({ sets: ['isd'] }), bolt, one), false)
})

test('card is: commander, Game Changer, Reserved List, double-faced, full art, token', () => {
  assert.equal(advancedMatches(adv({ cardIs: ['commander'] }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['commander'] }), teferi, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['commander'] }), jace, one), false)
  assert.equal(advancedMatches(adv({ cardIs: ['gamechanger'] }), jace, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['gamechanger'] }), atraxa, one), false)
  assert.equal(advancedMatches(adv({ cardIs: ['reserved'] }), mox, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['reserved'] }), solRing, one), false)
  assert.equal(advancedMatches(adv({ cardIs: ['dfc'] }), delver, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['dfc'] }), bolt, one), false)
  assert.equal(advancedMatches(adv({ cardIs: ['fullart'] }), mox, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['token'] }), soldier, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['token'] }), bolt, one), false)
  assert.equal(advancedMatches(adv({ cardIs: ['reserved', 'fullart'] }), mox, one), true)
  assert.equal(advancedMatches(adv({ cardIs: ['reserved', 'token'] }), mox, one), false)
})

test('keywords: every one, in any case', () => {
  assert.equal(advancedMatches(adv({ keywords: 'flying, DEATHTOUCH' }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ keywords: 'flying, trample' }), atraxa, one), false)
  assert.equal(advancedMatches(adv({ keywords: ' , ' }), bolt, one), true)
})

test('price per copy: dollars, the chosen currency, foil when every copy is foil', () => {
  assert.equal(advancedMatches(adv({ priceMin: '10' }), atraxa, one), true)
  assert.equal(advancedMatches(adv({ priceMax: '10' }), atraxa, one), false)
  assert.equal(advancedMatches(adv({ priceMin: '2', priceMax: '3' }), bolt, one), true)
  assert.equal(advancedMatches(adv({ priceMin: '2.5' }), bolt, one), true)
  // Typed in pounds at 0.8 to the dollar: £16 is $20.
  const toUsd = (n: number) => n / 0.8
  assert.equal(advancedMatches(adv({ priceMin: '16' }), atraxa, one, toUsd), true)
  assert.equal(advancedMatches(adv({ priceMin: '17' }), atraxa, one, toUsd), false)
  // Only foils owned: the foil price.
  assert.equal(advancedMatches(adv({ priceMin: '40' }), atraxa, copies({ nonfoil: 0, foil: 1 })), true)
  // No non-foil price: the foil one.
  assert.equal(advancedMatches(adv({ priceMin: '25' }), solRing, one), true)
  // No price at all: can't be judged.
  assert.equal(advancedMatches(adv({ priceMax: '100' }), goyf, one), false)
})

test('artist and flavour text contain, every face too', () => {
  assert.equal(advancedMatches(adv({ artist: 'rush' }), bolt, one), true)
  assert.equal(advancedMatches(adv({ artist: 'guay' }), bolt, one), false)
  assert.equal(advancedMatches(adv({ artist: 'nils' }), delver, one), true)
  assert.equal(advancedMatches(adv({ flavor: 'SPARKMAGE' }), bolt, one), true)
  assert.equal(advancedMatches(adv({ flavor: 'gift for good' }), delver, one), true)
  assert.equal(advancedMatches(adv({ flavor: 'storm' }), atraxa, one), false)
})

const entry = (scryfallId: string, quantity: number, foilQuantity = 0, more: object = {}) => ({ scryfallId, name: scryfallId, imageUrl: null, quantity, foilQuantity, ...more })
const collections: Collection[] = [
  { id: 'b1', name: 'Trade binder', createdAt: 0, type: 'OWNED', entries: [entry('bolt', 2, 1, { condition: 'LP', language: 'ja' }), entry('ring', 0, 1)] },
  { id: 'b2', name: 'Bulk', createdAt: 0, type: 'OWNED', entries: [entry('bolt', 1, 0, { condition: 'NM' })] },
  { id: 'w', name: 'Wishlist', createdAt: 0, type: 'WISHLIST', entries: [entry('jace', 1)] },
]
const decks = [{ id: 'd1', name: 'Izzet', cards: [{ ...entry('bolt', 1), canBeCommander: false, typeLine: null, partnerAbility: null }, { ...entry('jace', 1), canBeCommander: false, typeLine: null, partnerAbility: null }] }] as unknown as Deck[]

test('copies: binders and decks, not wishlists; a copy with no language said is English', () => {
  const facts = copyFactsOf(collections, decks)
  assert.deepEqual(facts.get('bolt'), { nonfoil: 4, foil: 1, conditions: ['LP', 'NM'], languages: ['ja', 'en'], binders: ['b1', 'b2'], inDeck: true, copies: 5 })
  assert.deepEqual(facts.get('jace'), { nonfoil: 1, foil: 0, conditions: [], languages: [], binders: [], inDeck: true, copies: 1 })
  assert.deepEqual(facts.get('ring'), { nonfoil: 0, foil: 1, conditions: [], languages: ['en'], binders: ['b1'], inDeck: false, copies: 1 })
})

test('your copies: finish, etched kept as foil, condition, language, binder, in a deck, copies', () => {
  const facts = copyFactsOf(collections, decks)
  const boltCopies = facts.get('bolt')
  const ringCopies = facts.get('ring')
  assert.equal(advancedMatches(adv({ finishes: ['foil'] }), bolt, boltCopies), true)
  assert.equal(advancedMatches(adv({ finishes: ['nonfoil'] }), solRing, ringCopies), false)
  // Sol Ring's printing only comes etched: its foil copy is etched.
  assert.equal(advancedMatches(adv({ finishes: ['etched'] }), solRing, ringCopies), true)
  assert.equal(advancedMatches(adv({ finishes: ['foil'] }), solRing, ringCopies), false)
  assert.equal(advancedMatches(adv({ finishes: ['nonfoil', 'etched'] }), solRing, ringCopies), true)
  assert.equal(advancedMatches(adv({ conditions: ['NM', 'MP'] }), bolt, boltCopies), true)
  assert.equal(advancedMatches(adv({ conditions: ['DMG'] }), bolt, boltCopies), false)
  assert.equal(advancedMatches(adv({ language: 'ja' }), bolt, boltCopies), true)
  assert.equal(advancedMatches(adv({ language: 'de' }), bolt, boltCopies), false)
  assert.equal(advancedMatches(adv({ binder: 'b2' }), bolt, boltCopies), true)
  assert.equal(advancedMatches(adv({ binder: 'b2' }), solRing, ringCopies), false)
  assert.equal(advancedMatches(adv({ inDeck: 'yes' }), bolt, boltCopies), true)
  assert.equal(advancedMatches(adv({ inDeck: 'no' }), bolt, boltCopies), false)
  assert.equal(advancedMatches(adv({ inDeck: 'no' }), solRing, ringCopies), true)
  assert.equal(advancedMatches(adv({ copiesOp: '>=', copies: '4' }), bolt, boltCopies), true)
  assert.equal(advancedMatches(adv({ copiesOp: '<', copies: '2' }), bolt, boltCopies), false)
})

test('count: one per chip', () => {
  assert.equal(advancedCount(NO_ADVANCED_FILTER), 0)
  assert.equal(advancedCount(adv({ colors: ['U', 'B'], mv: '3', sets: ['mh3', 'ltr'], cardIs: ['reserved'], priceMin: '1', priceMax: '5', finishes: ['foil'], inDeck: 'no' })), 8)
})

const usd = (n: number) => `$${n.toFixed(2)}`
const ctx = { binderName: (id: string) => (id === 'b1' ? 'Trade binder' : undefined), formatLocal: usd }

test('query: the mockup\'s filters', () => {
  assert.equal(
    scryfallQuery(basic({ type: 'creature' }), adv({ colorTarget: 'identity', colorMode: 'atMost', colors: ['B', 'U'], mvOp: '<=', mv: '3', format: 'commander' })),
    't:creature id<=ub mv<=3 f:commander',
  )
})

test('query: every Scryfall field, Your copies left out', () => {
  const a = adv({
    colorTarget: 'color', colorMode: 'including', colors: ['G', 'W'], multicolor: true, mvOp: '!=', mv: '2', manaCost: '2uu',
    powerOp: '>', power: '3', toughnessOp: '<', toughness: '5', loyaltyOp: '=', loyalty: '4', format: 'vintage', legality: 'restricted',
    sets: ['mh3', 'ltr'], cardIs: ['token', 'commander', 'gamechanger', 'reserved', 'dfc', 'fullart'], keywords: 'Flying, first strike',
    priceMin: '1', priceMax: '5.5', artist: 'Rebecca Guay', flavor: 'storms',
    finishes: ['foil'], conditions: ['NM'], language: 'ja', binder: 'b1', inDeck: 'yes', copies: '2',
  })
  assert.equal(
    scryfallQuery(basic({ type: 'legendary  Creature', text: 'draw a card', colors: ['U', 'W'], rarities: ['mythic', 'rare'] }), a),
    't:legendary t:creature o:"draw a card" id>=wu (r:rare or r:mythic) c>=wg c:m mv!=2 m:{2}{U}{U} pow>3 tou<5 loy=4 restricted:vintage (e:mh3 or e:ltr) '
      + 'is:commander is:gamechanger is:reserved is:dfc is:fullart t:token kw:flying kw:"first strike" usd>=1 usd<=5.5 a:"Rebecca Guay" ft:storms',
  )
  assert.equal(scryfallQuery(NO_COLLECTION_FILTER, adv({ finishes: ['foil'], conditions: ['NM'], language: 'ja', binder: 'b1', inDeck: 'yes', copies: '2' })), '')
})

test('query: colourless, banned, one set, one rarity, prices in another currency', () => {
  assert.equal(scryfallQuery(basic({ rarities: ['common'] }), adv({ colorTarget: 'color', colors: ['C'], format: 'modern', legality: 'banned', sets: ['lea'] })), 'r:common c=c banned:modern e:lea')
  assert.equal(scryfallQuery(NO_COLLECTION_FILTER, adv({ colorTarget: 'identity', colorMode: 'exactly', colors: ['R'] })), 'id=r')
  // £8 at 0.8 to the dollar is $10; £1 is $1.25.
  assert.equal(scryfallQuery(NO_COLLECTION_FILTER, adv({ priceMin: '1', priceMax: '8' }), (n) => n / 0.8), 'usd>=1.25 usd<=10')
  assert.equal(queryNumber(1 / 3), '0.33')
  assert.equal(queryNumber(3), '3')
})

test('chips: the mockup\'s, short and with mana symbols', () => {
  const chips = filterChips(
    basic({ type: 'creature' }),
    adv({ colorTarget: 'identity', colorMode: 'atMost', colors: ['B', 'U'], mvOp: '<=', mv: '3', format: 'commander', sets: ['mh3'], finishes: ['foil'] }),
    ctx,
  )
  assert.deepEqual(chips.map(chipText), ['Creature', 'Identity ≤ UB', 'MV ≤ 3', 'Legal in Commander', 'MH3', 'Foil'])
  assert.deepEqual(chips[1], { key: 'colors', label: 'Identity ≤', symbols: ['U', 'B'] })
})

test('chips: every kind', () => {
  const chips = filterChips(
    basic({ text: 'draw a card', colors: ['G'], rarities: ['rare'] }),
    adv({
      colorTarget: 'color', colors: ['C'], multicolor: true, manaCost: '{2}{U}', powerOp: '>=', power: '3', toughnessOp: '<', toughness: '2', loyaltyOp: '=', loyalty: '4',
      format: 'vintage', legality: 'restricted', cardIs: ['reserved', 'commander'], keywords: 'flying,  deathtouch', priceMin: '1.5', priceMax: '5',
      artist: 'Guay', flavor: 'storm', finishes: ['etched', 'nonfoil'], conditions: ['DMG', 'NM'], language: 'ja', binder: 'b1', inDeck: 'no', copiesOp: '>=', copies: '2',
    }),
    ctx,
  )
  assert.deepEqual(chips.map(chipText), [
    'Text: draw a card', 'Colour G', 'Rare', 'Colour C', 'Multicolour', 'Cost 2U', 'Power ≥ 3', 'Toughness < 2', 'Loyalty = 4',
    'Restricted in Vintage', 'Can be a commander', 'Reserved List', 'Keywords: flying, deathtouch', 'Price $1.50–$5.00', 'Artist: Guay', 'Flavour: storm',
    'Non-foil', 'Etched', 'NM', 'Damaged', 'Japanese', 'Trade binder', 'Not in a deck', 'Copies ≥ 2',
  ])
  assert.deepEqual(filterChips(NO_COLLECTION_FILTER, adv({ priceMax: '5', inDeck: 'yes' }), ctx).map(chipText), ['Price ≤ $5.00', 'In a deck'])
  assert.deepEqual(filterChips(NO_COLLECTION_FILTER, adv({ priceMin: '5' }), ctx).map(chipText), ['Price ≥ $5.00'])
})

test('removing a chip takes off just that filter', () => {
  const b = basic({ type: 'creature', colors: ['U', 'B'] })
  const a = adv({ sets: ['mh3', 'ltr'], priceMin: '1', priceMax: '5', inDeck: 'yes', colors: ['U'] })
  assert.deepEqual(removeChip(b, a, 'color:U').basic.colors, ['B'])
  assert.deepEqual(removeChip(b, a, 'set:mh3').advanced.sets, ['ltr'])
  const noPrice = removeChip(b, a, 'price').advanced
  assert.equal(noPrice.priceMin + noPrice.priceMax, '')
  assert.equal(removeChip(b, a, 'inDeck').advanced.inDeck, 'any')
  assert.deepEqual(removeChip(b, a, 'colors').advanced.colors, [])
  assert.equal(removeChip(b, a, 'type').basic.type, '')
  // The rest stays.
  assert.deepEqual(removeChip(b, a, 'type').advanced, a)
})

const SAVED_JSON = '[{"id":"s1","name":"Cheap blue","basic":{"type":"creature","text":"","colors":["U","B"],"rarities":["rare","mythic"]},'
  + '"advanced":{"colorTarget":"identity","colorMode":"atMost","colors":["U","B"],"multicolor":false,"mvOp":"<=","mv":"3","manaCost":"",'
  + '"powerOp":">=","power":"","toughnessOp":">=","toughness":"","loyaltyOp":">=","loyalty":"","format":"commander","legality":"legal",'
  + '"sets":["mh3"],"cardIs":["commander","token"],"keywords":"flying","priceMin":"","priceMax":"5","artist":"Rebecca \\"Becky\\" Guay","flavor":"",'
  + '"finishes":["nonfoil","foil"],"conditions":["NM","DMG"],"language":"ja","binder":"b1","inDeck":"no","copiesOp":">=","copies":"2"}}]'

test('saved filters: the same JSON text as the Android app, and back', () => {
  const saved = [{
    id: 's1', name: 'Cheap blue',
    basic: basic({ type: 'creature', colors: ['B', 'U'], rarities: ['mythic', 'rare'] }),
    advanced: adv({
      colors: ['B', 'U'], mv: '3', format: 'commander', sets: ['mh3'], cardIs: ['token', 'commander'], keywords: 'flying', priceMax: '5',
      artist: 'Rebecca "Becky" Guay', finishes: ['foil', 'nonfoil'], conditions: ['DMG', 'NM'], language: 'ja', binder: 'b1', inDeck: 'no', copies: '2',
    }),
  }]
  assert.equal(savedFiltersToJson(saved), SAVED_JSON)
  const back = savedFiltersFromJson(SAVED_JSON)
  assert.equal(savedFiltersToJson(back), SAVED_JSON)
  assert.equal(back[0].advanced.artist, 'Rebecca "Becky" Guay')
})

test('saved filters: anything unreadable is skipped, missing fields take their defaults', () => {
  assert.deepEqual(savedFiltersFromJson('not json'), [])
  assert.deepEqual(savedFiltersFromJson('{"id":"x"}'), [])
  assert.deepEqual(savedFiltersFromJson(null), [])
  const read = savedFiltersFromJson('[{"id":"a","name":"Old","advanced":{"mv":"2","mvOp":"??","colors":["U","X"],"inDeck":"maybe"}},{"name":"no id"}]')
  assert.equal(read.length, 1)
  assert.deepEqual(read[0].basic, NO_COLLECTION_FILTER)
  assert.deepEqual(read[0].advanced, adv({ mv: '2', colors: ['U'] }))
})

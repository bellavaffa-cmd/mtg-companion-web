import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkCompanion, companionAddProblem, companionCard, hasActivatedAbility, nameList, repeatsManaSymbol, withCompanion, type CompanionCard,
} from '../../src/decks/companion.ts'
import { deckIssues } from '../../src/decks/deckLegality.ts'
import { normalizeDeck, type DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// The ten companions' conditions, and the companion in a deck's legality. The Android app runs the
// same cases — see CompanionTest.kt.

const c = (name: string, cmc: number | null, typeLine: string | null, manaCost: string | null = null, oracleText: string | null = '', quantity = 1): CompanionCard =>
  ({ name, quantity, cmc, manaCost, typeLine, oracleText })
const forest = c('Forest', 0, 'Basic Land — Forest', '', '({T}: Add {G}.)', 20)
const check = (name: string, cards: CompanionCard[], min = 60) => checkCompanion(name, cards, min)

test('Gyruda: even mana values only (lands are 0)', () => {
  assert.deepEqual(check('Gyruda, Doom of Depths', [forest, c('Ox', 2, 'Creature — Ox'), c('Bolt', 1, 'Instant')]).offenders, ['Bolt'])
})

test('Jegantha: no mana symbol twice in a cost', () => {
  assert.equal(repeatsManaSymbol('{2}{R}{G}'), false)
  assert.equal(repeatsManaSymbol('{R}{R}'), true)
  assert.equal(repeatsManaSymbol('{1}{R}{1}{U}'), true)
  assert.equal(repeatsManaSymbol('{G/W}{G/W}'), true)
  assert.deepEqual(check('Jegantha, the Wellspring', [forest, c('Goblin Guide', 1, 'Creature — Goblin', '{R}'), c('Lava Spike', 1, 'Sorcery', '{R}'), c('Ball Lightning', 3, 'Creature — Elemental', '{R}{R}{R}')]).offenders, ['Ball Lightning'])
})

test('Kaheera: creatures are Cats, Elementals, Nightmares, Dinosaurs or Beasts', () => {
  const r = check('kaheera, the orphanguard', [forest, c('Lion', 2, 'Creature — Cat Soldier'), c('Bear', 2, 'Creature — Bear'), c('Shapeshifter', 2, 'Creature — Shapeshifter', '{1}{U}', 'Changeling'), c('Bolt', 1, 'Instant')])
  assert.deepEqual(r.offenders, ['Bear'])
})

test('Keruga: mana value 3 or more, lands aside', () => {
  assert.deepEqual(check('Keruga, the Macrosage', [forest, c('Ox', 3, 'Creature — Ox'), c('Signet', 2, 'Artifact'), c('Unknown', null, null)]).offenders, ['Signet'])
})

test('Lurrus: permanents of mana value 2 or less; instants and sorceries may cost more', () => {
  assert.deepEqual(check('Lurrus of the Dream-Den', [forest, c('Ring', 1, 'Artifact'), c('Titan', 6, 'Creature — Giant'), c('Fireball', 3, 'Sorcery')]).offenders, ['Titan'])
})

test('Lutri: every nonland card a different name', () => {
  const r = check('Lutri, the Spellchaser', [forest, c('Bolt', 1, 'Instant', '{R}', '', 2), c('Shock', 1, 'Instant'), c('Shock', 1, 'Instant')])
  assert.deepEqual(r.offenders, ['Bolt', 'Shock'])
})

test('Obosh: odd mana values, lands aside', () => {
  assert.deepEqual(check('Obosh, the Preypiercer', [forest, c('Bolt', 1, 'Instant'), c('Bear', 2, 'Creature — Bear'), c('Zero', 0, 'Artifact')]).offenders, ['Bear', 'Zero'])
})

test('Umori: nonland cards share a card type — the most common one', () => {
  const r = check('Umori, the Collector', [forest, c('A', 1, 'Creature — Elf'), c('B', 2, 'Artifact Creature — Golem'), c('C', 1, 'Instant'), c('D', 1, 'Kindred Instant — Elf')])
  assert.deepEqual(r.offenders, ['C', 'D'])
  assert.equal(check('Umori, the Collector', [forest, c('A', 1, 'Instant'), c('B', 2, 'Tribal Instant — Elf')]).met, true)
})

test('Yorion: twenty cards over the minimum', () => {
  assert.deepEqual(check('Yorion, Sky Nomad', [c('Island', 0, 'Basic Land — Island', '', '', 79)]), { met: false, offenders: [], has: 79, needs: 80 })
  assert.equal(check('Yorion, Sky Nomad', [c('Island', 0, 'Basic Land — Island', '', '', 60)], 40).met, true)
})

test('Zirda: permanents with an activated ability', () => {
  assert.equal(hasActivatedAbility('({T}: Add {G}.)'), true)
  assert.equal(hasActivatedAbility('Equip {2}'), true)
  assert.equal(hasActivatedAbility('Basic landcycling {1}'), true)
  assert.equal(hasActivatedAbility('Swampcycling {2}'), true)
  assert.equal(hasActivatedAbility('Creatures you control have "{T}: Add {G}."'), false)
  assert.equal(hasActivatedAbility('+1: Draw a card.'), true)
  const r = check('Zirda, the Dawnwaker', [forest, c('Elf', 1, 'Creature — Elf', '{G}', '{T}: Add {G}.'), c('Bear', 2, 'Creature — Bear', '{1}{G}', ''), c('Bolt', 1, 'Instant', '{R}', 'Deal 3.'), c('Unknown', null, 'Creature', null, null)])
  assert.deepEqual(r.offenders, ['Bear'])
})

test('not a companion: nothing to meet', () => {
  assert.deepEqual(check('Sol Ring', [c('Bear', 2, 'Creature — Bear')]), { met: true, offenders: [] })
})

test('names in a sentence', () => {
  assert.equal(nameList(['A']), 'A')
  assert.equal(nameList(['A', 'B']), 'A and B')
  assert.equal(nameList(['A', 'B', 'C']), 'A, B and C')
  assert.equal(nameList(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more')
})

const entry = (id: string, name: string, quantity = 1, typeLine: string | null = null): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine, partnerAbility: null })
const sc = (id: string, name: string, cmc: number, typeLine: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id, name, cmc, type_line: typeLine, oracle_text: '', mana_cost: '', legalities: { modern: 'legal', commander: 'legal' }, color_identity: [], ...extra })

test('a double-faced card is checked by its front, a split card by both halves', () => {
  const dfc = companionCard(entry('x', 'Delver of Secrets // Insectile Aberration'), sc('x', 'Delver', 1, 'Creature — Human Wizard // Creature — Human Insect', {
    mana_cost: undefined, card_faces: [{ mana_cost: '{U}', type_line: 'Creature — Human Wizard', oracle_text: 'Flip' }, { mana_cost: '', type_line: 'Creature — Human Insect', oracle_text: 'Flying' }], layout: 'transform',
  }))
  assert.deepEqual(dfc, { name: 'Delver of Secrets // Insectile Aberration', quantity: 1, cmc: 1, manaCost: '{U}', typeLine: 'Creature — Human Wizard', oracleText: 'Flip\nFlying' })
  const split = companionCard(entry('y', 'Fire // Ice'), sc('y', 'Fire // Ice', 4, 'Instant // Instant', {
    mana_cost: '{1}{R} // {1}{U}', card_faces: [{ mana_cost: '{1}{R}' }, { mana_cost: '{1}{U}' }], layout: 'split',
  }))
  assert.equal(split.manaCost, '{1}{R}{1}{U}')
  assert.equal(split.typeLine, 'Instant')
})

test("the companion in a deck's legality: in the sideboard, and its condition", () => {
  const lurrus = entry('lur', 'Lurrus of the Dream-Den', 1, 'Legendary Creature — Cat Nightmare')
  const cards = [entry('f', 'Forest', 58), entry('t', 'Titan', 2)]
  const byId = new Map([sc('f', 'Forest', 0, 'Basic Land — Forest'), sc('t', 'Titan', 6, 'Creature — Giant'), sc('lur', 'Lurrus of the Dream-Den', 3, 'Legendary Creature — Cat Nightmare')].map((x) => [x.id, x]))
  const modern = withCompanion(normalizeDeck({ id: 'd', name: 'D', gameMode: 'MODERN', cards, sideboard: [lurrus] }), 'Lurrus of the Dream-Den')
  const issues = deckIssues(modern, byId).filter((i) => i.kind === 'COMPANION')
  assert.deepEqual(issues.map((i) => i.reason), ['Every permanent must have mana value 2 or less. Not met by Titan.'])
  const away = deckIssues({ ...modern, sideboard: [] }, byId).filter((i) => i.kind === 'COMPANION').map((i) => i.reason)
  assert.deepEqual(away, ["The companion isn't in the sideboard.", 'Every permanent must have mana value 2 or less. Not met by Titan.'])
  assert.deepEqual(deckIssues(withCompanion(modern, null), byId).filter((i) => i.kind === 'COMPANION'), [])
  assert.equal(withCompanion(modern, null).companion, '')
  assert.equal(withCompanion(normalizeDeck({ id: 'd', name: 'D' }), null).companion, undefined)
})

test("in Commander the companion waits outside the 100 without counting as a sideboard", () => {
  const lurrus = entry('lur', 'Lurrus of the Dream-Den', 1)
  const deck = withCompanion(normalizeDeck({ id: 'd', name: 'D', gameMode: 'COMMANDER', cards: [entry('f', 'Forest', 100)], sideboard: [lurrus] }), 'Lurrus of the Dream-Den')
  const issues = deckIssues(deck, new Map())
  assert.equal(issues.some((i) => i.reason.includes('has no sideboard')), false)
  const two = deckIssues({ ...deck, sideboard: [lurrus, entry('x', 'Extra')] }, new Map())
  assert.equal(two.some((i) => i.reason === 'Commander has no sideboard — 2 cards still there.'), true)
})

test('adding a card that breaks the condition says so', () => {
  const deck = withCompanion(normalizeDeck({ id: 'd', name: 'D', gameMode: 'MODERN', cards: [entry('b', 'Bolt', 4, 'Instant')] }), 'Lurrus of the Dream-Den')
  assert.equal(companionAddProblem(deck, c('Titan', 6, 'Creature — Giant')), "Breaks Lurrus's companion condition")
  assert.equal(companionAddProblem(deck, c('Fireball', 5, 'Sorcery')), null)
  const umori = withCompanion(deck, 'Umori, the Collector')
  assert.equal(companionAddProblem(umori, c('Bear', 2, 'Creature — Bear')), "Breaks Umori's companion condition")
  assert.equal(companionAddProblem(withCompanion(deck, 'Lutri, the Spellchaser'), c('Bolt', 1, 'Instant')), "Breaks Lutri's companion condition")
  assert.equal(companionAddProblem(withCompanion(deck, 'Yorion, Sky Nomad'), c('Bear', 2, 'Creature — Bear')), null)
})

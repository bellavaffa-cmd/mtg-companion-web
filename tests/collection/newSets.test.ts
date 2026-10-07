import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { SetInfo } from '../../src/collection/setCompletion.ts'
import {
  cardsLabel, commanderDecks, creatureTypes, deckFits, deckProfile, fitReason, releaseLabel, releaseSets, setsToAnnounce, themeKey, wishlistReprints,
  type SetCard,
} from '../../src/collection/newSets.ts'

// New sets and the cards in them for the user's decks. The Android app has the same checks — NewSetsTest.kt.

const set = (code: string, releasedAt: string | null, extra: Partial<SetInfo> = {}): SetInfo => ({ code, name: code.toUpperCase(), cardCount: 10, releasedAt, setType: 'expansion', digital: false, ...extra })
const entry = (name: string, typeLine: string, tags: string[] = [], categories?: string[]): DeckCardEntry => ({
  scryfallId: name, name, imageUrl: null, quantity: 1, canBeCommander: false, typeLine, partnerAbility: null, tags, categories,
})
const card = (name: string, typeLine: string, colorIdentity: string[], tags: string[] = []): SetCard => ({ id: name, name, typeLine, colorIdentity, tags, imageUrl: null, rarity: 'rare' })
const deck = (cards: DeckCardEntry[], extra: Partial<Deck> = {}): Deck => ({
  id: 'd1', name: 'Elves', commander: entry('Lathril', 'Legendary Creature — Elf Noble'), partnerCommander: null, cards,
  gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'OWNED' as Deck['ownership'], ...extra,
})

test('upcoming sets soonest first, just-out sets newest first, odd sets left out', () => {
  const today = '2026-10-07'
  const { upcoming, recent } = releaseSets([
    set('far', '2027-02-01'),
    set('soon', '2026-11-14'),
    set('today', '2026-10-07'),
    set('week', '2026-09-30'),
    set('old', '2026-08-01'),
    set('tok', '2026-11-14', { setType: 'token' }),
    set('arena', '2026-11-01', { digital: true }),
    set('nodate', null),
  ], today)
  assert.deepEqual(upcoming.map((s) => s.code), ['soon', 'far'])
  assert.deepEqual(recent.map((s) => s.code), ['today', 'week'])
})

test('release and card labels', () => {
  assert.equal(releaseLabel('2026-10-07', '2026-10-07'), 'Out today')
  assert.equal(releaseLabel('2026-10-08', '2026-10-07'), 'Out tomorrow')
  assert.equal(releaseLabel('2026-10-19', '2026-10-07'), 'In 12 days')
  assert.equal(releaseLabel('2026-10-04', '2026-10-07'), 'Out 3 days ago')
  assert.equal(cardsLabel(set('a', '2026-11-01', { cardCount: 0 }), '2026-10-07'), 'No cards shown yet')
  assert.equal(cardsLabel(set('a', '2026-11-01', { cardCount: 12 }), '2026-10-07'), '12 cards shown so far')
  assert.equal(cardsLabel(set('a', '2026-10-01', { cardCount: 286 }), '2026-10-07'), '286 cards')
})

test('followed sets are announced once, on release day or the week after', () => {
  const sets = [set('a', '2026-10-07'), set('b', '2026-10-08'), set('c', '2026-09-20'), set('d', '2026-10-05')]
  const followed = new Set(['a', 'b', 'c', 'd'])
  assert.deepEqual(setsToAnnounce(followed, sets, '2026-10-07', new Set()).map((s) => s.code), ['a', 'd'])
  assert.deepEqual(setsToAnnounce(followed, sets, '2026-10-07', new Set(['a'])).map((s) => s.code), ['d'])
  assert.deepEqual(setsToAnnounce(new Set(['b']), sets, '2026-10-07', new Set()), [])
})

test('creature types and theme spellings', () => {
  assert.deepEqual(creatureTypes('Legendary Creature — Elf Druid'), ['Elf', 'Druid'])
  assert.deepEqual(creatureTypes('Kindred Instant — Elf'), ['Elf'])
  assert.deepEqual(creatureTypes('Artifact — Equipment'), [])
  assert.deepEqual(creatureTypes('Creature — Human Wizard // Creature — Human Insect'), ['Human', 'Wizard', 'Insect'])
  assert.equal(themeKey('Draw'), 'card draw')
  assert.equal(themeKey('Card Draw'), 'card draw')
  assert.equal(themeKey('Board wipes'), 'board wipe')
})

test('cards fit a deck by colour identity and what the deck has plenty of', () => {
  const elves = Array.from({ length: 5 }, (_, i) => entry(`Elf ${i}`, 'Creature — Elf Druid', ['Flying']))
  const tokens = Array.from({ length: 4 }, (_, i) => entry(`Maker ${i}`, 'Sorcery', i < 2 ? ['Tokens'] : [], i >= 2 ? ['Tokens'] : undefined))
  const ramp = Array.from({ length: 3 }, (_, i) => entry(`Rock ${i}`, 'Artifact', [], ['Ramp']))
  const p = deckProfile(deck([...elves, ...tokens, ...ramp]), ['G', 'B'])
  // Six elves with the commander; four token makers (tags and categories together); ramp only three.
  assert.equal(p.types.get('Elf')?.count, 6)
  assert.equal(p.themes.get('tokens')?.count, 4)
  assert.equal(p.themes.has('ramp'), false)
  // Flying is too common to say anything.
  assert.equal(p.themes.has('flying'), false)

  const fits = deckFits(p, [
    card('Elf Lord', 'Creature — Elf Warrior', ['G'], ['Tokens']),
    card('Green Elf', 'Creature — Elf', ['G']),
    card('Blue Elf', 'Creature — Elf', ['U']),
    card('Token Spell', 'Instant', ['B'], ['Tokens']),
    card('Plain Rock', 'Artifact', [], ['Ramp']),
    card('Flyer', 'Creature — Bird', ['G'], ['Flying']),
    card('Elf 0', 'Creature — Elf Druid', ['G']),
    card('Forest', 'Basic Land — Forest', ['G']),
    card('Elf Token', 'Token Creature — Elf', ['G']),
  ], 8)
  assert.deepEqual(fits.map((f) => f.card.name), ['Elf Lord', 'Green Elf', 'Token Spell'])
  assert.equal(fitReason(fits[0]), 'Elf, like 6 cards in the deck · Tokens, like 4')
  assert.equal(fits[0].score, 10)
})

test('only Commander decks with a commander, not put away', () => {
  const decks = [deck([]), deck([], { id: 'm', gameMode: 'MODERN' }), deck([], { id: 'a', archived: true }), deck([], { id: 'n', commander: null })]
  assert.deepEqual(commanderDecks(decks).map((d) => d.id), ['d1'])
})

test('reprints of wishlist cards, once each, double-faced by their front', () => {
  const wanted = new Set(['sol ring', 'delver of secrets'])
  const found = wishlistReprints(wanted, [
    card('Sol Ring', 'Artifact', []),
    card('Sol Ring', 'Artifact', []),
    card('Delver of Secrets // Insectile Aberration', 'Creature — Human Wizard // Creature — Human Insect', ['U']),
    card('Arcane Signet', 'Artifact', []),
  ])
  assert.deepEqual(found.map((c) => c.name), ['Sol Ring', 'Delver of Secrets // Insectile Aberration'])
})

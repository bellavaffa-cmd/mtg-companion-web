import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collection, CollectionEntry, Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { SetInfo } from '../../src/collection/setCompletion.ts'
import { deckProfile, type SetCard } from '../../src/collection/newSets.ts'
import {
  cardFits, fitsByCard, galleryCards, isConsidering, isPreRelease, keepPreReleaseFromOlderApp, mayTellReveals, openingPacks, preReleaseLabel, releaseCountdown,
  REVEAL_NEWS_GAP_MS, revealedLabel, revealNews, revealNewsTitle, wantedCount, withConsideredCard, withPulled, withReleasedCleared, withSpoilerWant,
} from '../../src/collection/spoilers.ts'
import { WISHLIST_ID } from '../../src/collection/wishlist.ts'

// Spoiler season. The Android app has the same checks — SpoilersTest.kt.

const today = '2026-10-08'
const set = (code: string, releasedAt: string | null, cardCount = 10, printedSize: number | null = null): SetInfo =>
  ({ code, name: code.toUpperCase(), cardCount, releasedAt, setType: 'expansion', digital: false, printedSize })
const card = (name: string, extra: Partial<SetCard> = {}): SetCard => ({
  id: name, name, typeLine: 'Creature — Elf Druid', colorIdentity: ['G'], tags: [], imageUrl: null, rarity: 'rare',
  roles: [], releasedAt: '2026-10-20', usd: null, commanderLegality: 'not_legal', ...extra,
})
const entry = (name: string, typeLine = 'Creature — Elf Druid', tags: string[] = []): DeckCardEntry => ({
  scryfallId: name, name, imageUrl: null, quantity: 1, canBeCommander: false, typeLine, partnerAbility: null, tags,
})
const deck = (id: string, name: string, cards: DeckCardEntry[]): Deck => ({
  id, name, commander: entry('Lathril', 'Legendary Creature — Elf Noble'), partnerCommander: null, cards,
  gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'OWNED' as Deck['ownership'],
})
const wished = (scryfallId: string, name: string, quantity: number, extra: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId, name, imageUrl: null, quantity, foilQuantity: 0, ...extra })
const wishlist = (...entries: CollectionEntry[]): Collection => ({ id: WISHLIST_ID, name: 'Wishlist', entries, createdAt: 0, type: 'WISHLIST' })
const theWishlist = (cs: Collection[]) => cs.find((c) => c.id === WISHLIST_ID)!

// --- Countdown and revealed count

test('countdown before release only, then nothing', () => {
  assert.equal(releaseCountdown('2026-10-13', today), 'Releases in 5 days')
  assert.equal(releaseCountdown('2026-10-09', today), 'Releases tomorrow')
  assert.equal(releaseCountdown('2026-10-08', today), 'Out today')
  assert.equal(releaseCountdown('2026-10-01', today), null)
  assert.equal(releaseCountdown(null, today), null)
})

test('revealed of total when Scryfall knows the size', () => {
  assert.equal(revealedLabel(set('a', '2026-11-01', 48, 286), today), '48 of 286 revealed')
  assert.equal(revealedLabel(set('a', '2026-11-01', 48), today), '48 revealed')
  // More printings than numbered cards (showcase frames): no "of".
  assert.equal(revealedLabel(set('a', '2026-11-01', 300, 286), today), '300 revealed')
  assert.equal(revealedLabel(set('a', '2026-11-01', 0, 286), today), 'Nothing revealed yet')
  assert.equal(revealedLabel(set('a', '2026-10-01', 286, 286), today), '286 cards')
})

// --- The pre-release flag's life

test('wanting a revealed card puts it on the Wishlist flagged until release', () => {
  const c = card('Elvish Spoiler')
  const after = withSpoilerWant([], c, 2, '2026-10-20', today)
  const e = theWishlist(after).entries[0]
  assert.equal(theWishlist(after).entries.length, 1)
  assert.equal(e.name, 'Elvish Spoiler')
  assert.equal(e.quantity, 2)
  assert.equal(e.preRelease, '2026-10-20')
  assert.ok(!e.auto)
  assert.ok(isPreRelease(e, today))
  assert.equal(preReleaseLabel(e, today), 'Releases in 12 days')
  assert.equal(wantedCount(after, c.id), 2)

  // A different count replaces it; 0 takes it off.
  const three = withSpoilerWant(after, c, 3, '2026-10-20', today)
  assert.equal(wantedCount(three, c.id), 3)
  assert.equal(wantedCount(withSpoilerWant(three, c, 0, '2026-10-20', today), c.id), 0)
})

test('wanting a card already out is a plain Wishlist card', () => {
  const after = withSpoilerWant([], card('Old News', { releasedAt: '2026-10-01' }), 1, '2026-10-01', today)
  const e = theWishlist(after).entries[0]
  assert.equal(e.preRelease, undefined)
  assert.equal(preReleaseLabel(e, today), null)
})

test('wanting undoes not interested', () => {
  const start = [{ ...wishlist(), notWanted: ['Elvish Spoiler'] }]
  const after = withSpoilerWant(start, card('Elvish Spoiler'), 1, '2026-10-20', today)
  assert.deepEqual(theWishlist(after).notWanted, [])
})

test('the flag clears on release day and not before', () => {
  const start = [wishlist(
    wished('a', 'Soon', 1, { preRelease: '2026-10-20' }),
    wished('b', 'Today', 1, { preRelease: '2026-10-08' }),
    wished('c', 'Plain', 1),
  )]
  const after = withReleasedCleared(start, today)
  const byId = new Map(theWishlist(after).entries.map((e) => [e.scryfallId, e]))
  assert.equal(byId.get('a')!.preRelease, '2026-10-20')
  assert.equal(byId.get('b')!.preRelease, undefined)
  assert.ok(!('preRelease' in byId.get('b')!))
  assert.equal(byId.get('c')!.preRelease, undefined)
  // Nothing to clear: the same array.
  assert.equal(withReleasedCleared(after, today), after)
  // The day before release nothing changes.
  assert.equal(withReleasedCleared(start, '2026-10-07'), start)
})

test("an older app's save gets the flag back", () => {
  const mine = wishlist(wished('a', 'Soon', 1, { preRelease: '2026-10-20' }))
  const theirs = wishlist(wished('a', 'Soon', 2))
  const healed = keepPreReleaseFromOlderApp(mine, theirs)
  assert.equal(healed.entries[0].preRelease, '2026-10-20')
  assert.equal(healed.entries[0].quantity, 2)
  // Nothing lacking: the same object.
  assert.equal(keepPreReleaseFromOlderApp(mine, healed), healed)
})

// --- Fits your decks

const elves = deck('d1', 'Elves', [1, 2, 3, 4, 5].map((i) => entry(`Elf ${i}`, 'Creature — Elf Druid', ['Card draw'])))
const goblins = deck('d2', 'Goblins', [1, 2, 3, 4, 5].map((i) => entry(`Goblin ${i}`, 'Creature — Goblin Warrior')))
const profiles = (roles: (name: string) => string[] | undefined = () => undefined) => [
  deckProfile(elves, ['G'], roles),
  deckProfile(goblins, ['R'], roles),
]

test('a card fits the decks in its colours that share a type', () => {
  const fits = cardFits(card('New Elf'), profiles(), today)
  assert.deepEqual(fits.map((f) => f.deckName), ['Elves'])
  assert.ok(fits[0].why.startsWith('Elf, like'))
  // Outside the commander's colours: nowhere.
  assert.deepEqual(cardFits(card('Blue Elf', { colorIdentity: ['U'] }), profiles(), today), [])
})

test('roles and themes match like types', () => {
  // A non-Elf with card draw fits the deck full of card draw.
  const drawer = card('Green Sage', { typeLine: 'Creature — Human Druid', tags: ['Card Draw'] })
  assert.deepEqual(cardFits(drawer, profiles(), today).map((f) => f.deckName), ['Elves'])
  // The deck's role tags count as its themes: "Token maker" ↔ the card's "Tokens".
  const goblinRoles = profiles((name) => (name.startsWith('Goblin') ? ['Token maker'] : undefined))
  const tokens = card('Red Tokens', { typeLine: 'Sorcery', colorIdentity: ['R'], tags: ['Tokens'] })
  assert.deepEqual(cardFits(tokens, goblinRoles, today).map((f) => f.deckName), ['Goblins'])
  assert.deepEqual(cardFits(tokens, profiles(), today), [])
})

test('legality counts only once the card is out', () => {
  // Before release every card is "not_legal" on Scryfall: ignored.
  assert.equal(cardFits(card('New Elf', { releasedAt: '2026-10-20', commanderLegality: 'not_legal' }), profiles(), today).length, 1)
  // Once out, a card not legal in Commander fits nothing; a legal one fits.
  assert.deepEqual(cardFits(card('Banned Elf', { releasedAt: '2026-10-01', commanderLegality: 'banned' }), profiles(), today), [])
  assert.equal(cardFits(card('Legal Elf', { releasedAt: '2026-10-01', commanderLegality: 'legal' }), profiles(), today).length, 1)
})

test('cards in the deck already, tokens and basics fit nothing', () => {
  assert.deepEqual(cardFits(card('Elf 1'), profiles(), today), [])
  assert.deepEqual(cardFits(card('Elf Warrior', { typeLine: 'Token Creature — Elf Warrior' }), profiles(), today), [])
  assert.deepEqual(cardFits(card('Forest', { typeLine: 'Basic Land — Forest', colorIdentity: [] }), profiles(), today), [])
})

test('only cards for my decks filter', () => {
  const cards = [card('New Elf'), card('Blue Thing', { typeLine: 'Instant', colorIdentity: ['U'] })]
  const fits = fitsByCard(cards, profiles(), today)
  assert.deepEqual([...fits.keys()], ['New Elf'])
  assert.deepEqual(galleryCards(cards, fits, true).map((c) => c.name), ['New Elf'])
  assert.equal(galleryCards(cards, fits, false).length, 2)
  assert.equal(fitsByCard(cards, [], today).size, 0)
})

test("a deck chip puts the card on that deck's Considering list, once", () => {
  const c = card('New Elf')
  const decks = withConsideredCard([elves, goblins], 'd1', c)
  assert.deepEqual(decks[0].considering?.map((e) => e.name), ['New Elf'])
  assert.ok(isConsidering(decks[0], c))
  assert.ok(!isConsidering(decks[1], c))
  assert.equal(withConsideredCard(decks, 'd1', c), decks)
  // A card the deck plays already isn't added.
  assert.equal(withConsideredCard([elves], 'd1', card('Elf 1')).length, 1)
  assert.equal(withConsideredCard([elves], 'd1', card('Elf 1'))[0].considering, undefined)
})

// --- Opening packs

test('opening packs lists the wanted cards from the set', () => {
  const setCards = [card('New Elf', { id: 'p1' }), card('Showcase Elf', { id: 'p2' }), card('Reprint Ring', { id: 'p3' })]
  const collections = [wishlist(
    wished('p2', 'Showcase Elf', 2),
    wished('old-ring', 'Reprint Ring', 1),
    wished('x', 'Elsewhere', 1),
  )]
  const packs = openingPacks(collections, setCards)
  assert.deepEqual(packs.map((p) => p.entry.name), ['Reprint Ring', 'Showcase Elf'])
  // Another printing wanted: this set's printing is the one pulled.
  assert.equal(packs[0].card.id, 'p3')
})

test('ticking a pulled card adds it to Unsorted and wants one fewer', () => {
  const setCards = [card('Showcase Elf', { id: 'p2' })]
  let collections = [wishlist(wished('p2', 'Showcase Elf', 2, { preRelease: '2026-10-20' }))]
  collections = withPulled(collections, openingPacks(collections, setCards)[0])
  assert.equal(wantedCount(collections, 'p2'), 1)
  const pileOf = (cs: Collection[]) => cs.find((c) => c.id === 'unsorted')!
  assert.equal(pileOf(collections).entries.find((e) => e.scryfallId === 'p2')!.quantity, 1)
  collections = withPulled(collections, openingPacks(collections, setCards)[0], true)
  assert.equal(wantedCount(collections, 'p2'), 0)
  assert.equal(theWishlist(collections).entries.length, 0)
  const pile = pileOf(collections).entries
  assert.equal(pile.length, 1)
  assert.equal(pile[0].quantity, 1)
  assert.equal(pile[0].foilQuantity, 1)
  assert.deepEqual(openingPacks(collections, setCards), [])
})

// --- The daily news

test('reveal news once a day and only what is new', () => {
  assert.ok(mayTellReveals(null, 1000))
  assert.ok(!mayTellReveals(1, REVEAL_NEWS_GAP_MS))
  assert.ok(mayTellReveals(1, 1 + REVEAL_NEWS_GAP_MS))
  // The first look only notes what's there.
  assert.deepEqual(revealNews(null, ['a', 'b']), [])
  assert.deepEqual(revealNews(new Set(['a', 'b']), ['a', 'b', 'c', 'c']), ['c'])
  assert.equal(revealNewsTitle([{ set: set('aaa', '2026-11-01'), count: 1 }]), '1 new card revealed for AAA that fit your decks')
  assert.equal(revealNewsTitle([{ set: set('aaa', '2026-11-01'), count: 1 }, { set: set('bbb', '2026-11-02'), count: 3 }]), '4 new cards revealed that fit your decks')
})

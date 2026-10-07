import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARDS_PER_PAGE, defaultPaper, markPrintedAsProxies, pickedCopies, picksForDeck, picksFromNeeds, picksFromThin, proxyImageUrl,
  sheetCards, sheetLayout, sheetPages, sheetSummary, withCopies, type ProxyPick,
} from '../../src/decks/proxySheet.ts'
import type { Collection, Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { ThinCard } from '../../src/collection/spreadThin.ts'

// Proxy sheets: what to print, and where it goes on the page. The Android app's ProxySheetTest.kt has
// the same cases.

const card = (name: string, quantity = 1, extra: Partial<DeckCardEntry> = {}) =>
  ({ scryfallId: `id-${name}`, name, imageUrl: `https://cards.scryfall.io/normal/front/a/b/${name}.jpg?1`, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...extra }) as DeckCardEntry
const deck = (ownership: string, ...cards: DeckCardEntry[]) =>
  ({ id: 'd', name: 'Deck', ownership, commander: null, partnerCommander: null, cards }) as unknown as Deck
const binder = (names: [string, number][]): Collection =>
  ({ id: 'b', name: 'b', type: 'OWNED', createdAt: 0, entries: names.map(([name, quantity]) => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, foilQuantity: 0 })) }) as Collection

test('nine cards to a page, at real size, in the middle of the paper', () => {
  const a4 = sheetLayout('A4')
  assert.equal(a4.slots.length, 9)
  assert.equal(a4.leftMm, 10.5)
  assert.equal(a4.topMm, 16.5)
  assert.deepEqual(a4.slots[4], { xMm: 73.5, yMm: 104.5 })
  assert.deepEqual(a4.cutsXMm, [10.5, 73.5, 136.5, 199.5])
  assert.deepEqual(a4.cutsYMm, [16.5, 104.5, 192.5, 280.5])
  const letter = sheetLayout('LETTER')
  assert.equal(letter.leftMm, 13.45)
  assert.equal(letter.topMm, 7.7)
  assert.deepEqual(letter.slots[8], { xMm: 139.45, yMm: 183.7 })
  assert.equal(defaultPaper('us'), 'LETTER')
  assert.equal(defaultPaper('IT'), 'A4')
  assert.equal(defaultPaper(null), 'A4')
})

test('copies spread over pages of nine, backs after their fronts', () => {
  const picks: ProxyPick[] = [
    { name: 'Bolt', scryfallId: '1', imageUrl: 'https://cards.scryfall.io/small/front/1.jpg', copies: 4 },
    { name: 'Delver', scryfallId: '2', imageUrl: 'https://cards.scryfall.io/normal/front/2.jpg', backImageUrl: 'https://cards.scryfall.io/normal/back/2.jpg', copies: 3 },
    { name: 'Island', scryfallId: '3', imageUrl: null, copies: 0 },
  ]
  assert.equal(sheetCards(picks, false).length, 7)
  const cards = sheetCards(picks, true)
  assert.equal(cards.length, 10)
  assert.deepEqual(cards.slice(4, 6).map((c) => c.name), ['Delver', 'Delver (back)'])
  assert.equal(cards[0].imageUrl, 'https://cards.scryfall.io/large/front/1.jpg')
  const pages = sheetPages(cards)
  assert.deepEqual(pages.map((p) => p.length), [CARDS_PER_PAGE, 1])
  assert.equal(sheetSummary(picks, true), '10 cards · 2 pages')
  assert.equal(sheetSummary(picks, false), '7 cards · 1 page')
  assert.equal(sheetSummary([], false), 'Nothing picked')
  assert.equal(pickedCopies(picks), 7)
})

test('picture addresses go to the large size', () => {
  assert.equal(proxyImageUrl('https://cards.scryfall.io/art_crop/front/a/b/x.jpg?1'), 'https://cards.scryfall.io/large/front/a/b/x.jpg?1')
  assert.equal(proxyImageUrl('https://cards.scryfall.io/png/front/a/b/x.png?1'), 'https://cards.scryfall.io/large/front/a/b/x.jpg?1')
  assert.equal(proxyImageUrl('https://example.com/x.jpg'), 'https://example.com/x.jpg')
  assert.equal(proxyImageUrl(null), null)
})

test('choosing how many: never below 0 or above 99', () => {
  let picks: ProxyPick[] = [{ name: 'Bolt', scryfallId: '1', imageUrl: null, copies: 1 }]
  picks = withCopies(picks, 'bolt', 5)
  assert.equal(picks[0].copies, 5)
  assert.equal(withCopies(picks, 'Bolt', -2)[0].copies, 0)
  assert.equal(withCopies(picks, 'Bolt', 500)[0].copies, 99)
})

test('from a pull list, a deck and Spread thin', () => {
  const d = deck('COLLECTION', card('Sol Ring'), card('Bolt', 4), card('Forest', 10))
  const fromPull = picksFromNeeds(d, [{ name: 'Bolt', scryfallId: 'other', qty: 2 }, { name: 'bolt', scryfallId: 'other', qty: 1 }])
  assert.equal(fromPull.length, 1)
  assert.equal(fromPull[0].copies, 3)
  // The deck's own printing, picture and all.
  assert.equal(fromPull[0].scryfallId, 'id-Bolt')

  // A deck on paper: the cards you don't own are picked; basics and owned ones start at 0.
  const fromDeck = picksForDeck(d, [binder([['Bolt', 1]])], [d])
  assert.deepEqual(fromDeck.map((p) => [p.name, p.copies]), [['Bolt', 3], ['Sol Ring', 1], ['Forest', 0]])
  // A deck you hold: its proxies.
  const held = deck('PHYSICAL', card('Sol Ring', 1, { proxyQuantity: 1 }), card('Bolt', 4))
  assert.deepEqual(picksForDeck(held, [], [held]).map((p) => [p.name, p.copies]), [['Sol Ring', 1], ['Bolt', 0]])

  const thin = [{ name: 'Sol Ring', imageUrl: 'x', scryfallIds: ['s1', 's2'], owned: 1, used: 3, short: 2, decks: [] }] as ThinCard[]
  assert.deepEqual(picksFromThin(thin).map((p) => [p.name, p.scryfallId, p.copies]), [['Sol Ring', 's1', 2]])
})

test('printed copies marked as proxies, never more than the deck plays', () => {
  const d = deck('COLLECTION', card('Bolt', 4, { proxyQuantity: 1 }), card('Sol Ring'))
  const picks: ProxyPick[] = [
    { name: 'Bolt', scryfallId: 'id-Bolt', imageUrl: null, copies: 5 },
    { name: 'Sol Ring', scryfallId: 'id-Sol Ring', imageUrl: null, copies: 1 },
  ]
  const marked = markPrintedAsProxies(d, picks)
  assert.deepEqual(marked.cards.map((e) => e.proxyQuantity), [4, 1])
  // A deck you hold counts what it hasn't got as proxies already.
  const held = deck('PHYSICAL', card('Bolt', 4))
  assert.equal(markPrintedAsProxies(held, picks), held)
  assert.equal(markPrintedAsProxies(d, []), d)
})

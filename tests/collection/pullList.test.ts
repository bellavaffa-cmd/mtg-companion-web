import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  basicsTitle, bestPlaceByRule, keepCameFromFromOlderApp, markMissingAsProxies, mergeCameFrom, movePulled, pullBuyList,
  pulledCopies, pullGroupsIn, pullList, pullNeeds, pullRowsAZ, putBackList, rowToTick, takeApart, tidyCameFrom,
} from '../../src/collection/pullList.ts'
import { placedCopies } from '../../src/collection/storagePlaces.ts'
import { mergeDeck } from '../../src/sync/mergeItems.ts'
import {
  normalizeDeck,
  type CameFrom, type Collection, type CollectionEntry, type CopyPlace, type Deck, type DeckCardEntry, type DeckOwnership, type StoragePlace,
} from '../../src/types/models.ts'

// Pull lists and put-back lists: building a deck out of storage and taking it apart again, the same
// way on both apps. The Android app has the same checks — see PullListTest.kt.

const place = (id: string, over: Partial<StoragePlace> = {}): StoragePlace => ({ id, name: id, kind: 'BOX', createdAt: 1, ...over })
const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CopyPlace[], userTags?: string[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}), ...(userTags ? { userTags } : {}) })
const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const pile = (entries: CollectionEntry[], places?: StoragePlace[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries, createdAt: 0, type: 'OWNED', ...(places ? { storagePlaces: places } : {}) })
const binder = (id: string, entries: CollectionEntry[]): Collection => ({ id, name: id, entries, createdAt: 5, type: 'OWNED' })
const card = (id: string, name: string, quantity: number, proxyQuantity?: number, typeLine: string | null = null): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine, partnerAbility: null, ...(proxyQuantity !== undefined ? { proxyQuantity } : {}) })
const deckOf = (id: string, name: string, cards: DeckCardEntry[], ownership: DeckOwnership, cameFrom?: CameFrom[]): Deck =>
  normalizeDeck({ id, name, cards, ownership, createdAt: 1, ...(cameFrom ? { cameFrom } : {}) })

const shelf = place('shelf', { name: 'Shelf, study', kind: 'SHELF', createdAt: 1 })
const red = place('red', { name: 'Red box', parentId: 'shelf', sortRule: 'COLOUR', sections: ['White', 'Blue', 'Black', 'Red', 'Green'], createdAt: 2 })
const rares = place('rares', { name: 'Rares binder', kind: 'BINDER', parentId: 'shelf', createdAt: 3 })
const PLACES = [shelf, red, rares]

const COLLECTIONS: Collection[] = [
  pile([
    entry('gm1', 'Goblin Matron', 2, 0, [at('red', 1, { section: 'Red' })]),
    entry('mtn', 'Mountain', 5),
  ], PLACES),
  binder('b1', [
    entry('gb', 'Goblin Bombardment', 1, 0, [at('red', 1, { section: 'Red' })]),
    entry('gc', 'Goblin Chieftain', 1, 0, [at('rares', 1, { page: 2, slot: 4 })]),
    entry('pu', 'Purphoros', 0, 1, [at('rares', 1, { foil: true, page: 5, slot: 1 })]),
    // Its place is gone: it has no place now.
    entry('it', 'Impact Tremors', 1, 0, [at('old', 1)]),
    entry('sp1', 'Skirk Prospector', 1, 0, undefined, ['lent to Sam']),
  ]),
  { id: 'wish', name: 'Wishlist', entries: [entry('lw1', 'Legion Warboss', 1)], createdAt: 1, type: 'WISHLIST' },
]

const KRENKO = deckOf('krenko', 'Krenko goblins', [
  card('gm2', 'Goblin Matron', 2), card('gb', 'Goblin Bombardment', 1), card('gc', 'Goblin Chieftain', 1), card('pu', 'Purphoros', 1),
  card('it', 'Impact Tremors', 1), card('sr', 'Sol Ring', 1), card('sp', 'Skirk Prospector', 1), card('lw', 'Legion Warboss', 1),
  card('mtn', 'Mountain', 7),
], 'PROTOTYPE')
const ATRAXA = deckOf('atraxa', 'Atraxa', [card('sr2', 'Sol Ring', 1)], 'PHYSICAL')
const DECKS = [KRENKO, ATRAXA]

const summary = (rows: { name: string; qty: number; hint: string | null }[]) => rows.map((r) => `${r.name} ×${r.qty}${r.hint ? ` — ${r.hint}` : ''}`)

test('a deck being built needs every copy; a deck you hold only its proxies', () => {
  assert.deepEqual(pullNeeds(KRENKO).map((n) => `${n.name} ×${n.qty}`), [
    'Goblin Bombardment ×1', 'Goblin Chieftain ×1', 'Goblin Matron ×2', 'Impact Tremors ×1', 'Legion Warboss ×1', 'Mountain ×7',
    'Purphoros ×1', 'Skirk Prospector ×1', 'Sol Ring ×1',
  ])
  const held = deckOf('d', 'Held', [card('a', 'Sol Ring', 1), card('b', 'Arcane Signet', 2, 1)], 'PHYSICAL')
  assert.deepEqual(pullNeeds(held).map((n) => `${n.name} ×${n.qty}`), ['Arcane Signet ×1'])
  // A proxy deck is proxies all through until real cards are swapped in.
  assert.deepEqual(pullNeeds(deckOf('p', 'Proxies', [card('a', 'Sol Ring', 2, 1), card('b', 'Arcane Signet', 1)], 'PROXY')).map((n) => `${n.name} ×${n.qty}`),
    ['Arcane Signet ×1', 'Sol Ring ×1'])
  // Copies marked as proxies in a deck being built aren't asked for.
  assert.deepEqual(pullNeeds(deckOf('v', 'Virtual', [card('a', 'Sol Ring', 2, 2)], 'VIRTUAL')), [])
})

test('the pull list walks the places in tree order, then the rest', () => {
  const list = pullList(KRENKO, COLLECTIONS, DECKS)
  assert.deepEqual(list.groups.map((g) => `${g.kind}: ${g.title}${g.detail ? ` (${g.detail})` : ''}`), [
    'place: Red box › Red (Shelf, study)',
    'place: Rares binder (Shelf, study)',
    'loose: No place yet (Owned, not put away)',
    'deck: In another deck (Only another deck has it)',
    'basic: Basic lands (From your basics)',
    'missing: Not owned',
  ])
  assert.deepEqual(summary(list.groups[0].rows), ['Goblin Bombardment ×1 — around “G”', 'Goblin Matron ×1 — around “G”'])
  assert.deepEqual(summary(list.groups[1].rows), ['Goblin Chieftain ×1 — Page 2, slot 4', 'Purphoros ×1 — Page 5, slot 1 · foil'])
  assert.deepEqual(summary(list.groups[2].rows), ['Goblin Matron ×1 — In Unsorted', 'Impact Tremors ×1 — In b1', 'Mountain ×5 — In Unsorted'])
  assert.deepEqual(summary(list.groups[3].rows), ['Sol Ring ×1 — in Atraxa — take it?'])
  assert.deepEqual(summary(list.groups[4].rows), ['Mountain ×2'])
  // A lent copy isn't fetched, and a wishlist isn't owned.
  assert.deepEqual(summary(list.groups[5].rows), ['Legion Warboss ×1', 'Skirk Prospector ×1'])
  assert.equal(list.total, 14)
  assert.equal(list.toBuy, 2)
  assert.equal(list.places, 2)
  assert.equal(pullBuyList(list), '1 Legion Warboss\n1 Skirk Prospector')
})

test('a box goes section by section in its own order, a binder page by page', () => {
  const box = place('box', { name: 'Box', sortRule: 'COLOUR', sections: ['Blue', 'Red'] })
  const cols = [pile([
    entry('a', 'Arc Lightning', 1, 0, [at('box', 1, { section: 'Red' })]),
    entry('b', 'Brainstorm', 1, 0, [at('box', 1, { section: 'Blue' })]),
    entry('c', 'Counterspell', 1, 0, [at('box', 1)]),
    entry('d', 'Abrade', 1, 0, [at('box', 1, { section: 'Red' })]),
  ], [box])]
  const deck = deckOf('x', 'X', [card('a', 'Arc Lightning', 1), card('b', 'Brainstorm', 1), card('c', 'Counterspell', 1), card('d', 'Abrade', 1)], 'VIRTUAL')
  const list = pullList(deck, cols, [deck])
  assert.deepEqual(list.groups.map((g) => g.title), ['Box › Blue', 'Box › Red', 'Box'])
  assert.deepEqual(list.groups[1].rows.map((r) => r.name), ['Abrade', 'Arc Lightning'])
  assert.deepEqual(pullRowsAZ(list).map((r) => r.where), ['Box › Red · around “A”', 'Box › Red · around “A”', 'Box › Blue · around “B”', 'Box · around “C”'])
})

test('ticking, scanning to tick, and pulling from one box', () => {
  const list = pullList(KRENKO, COLLECTIONS, DECKS)
  const rows = list.groups.flatMap((g) => g.rows)
  const ticked = new Set<string>()
  const first = rowToTick(rows, ticked, 'Goblin Matron')!
  assert.equal(first.where, 'Red box › Red · around “G”')
  ticked.add(first.key)
  assert.equal(rowToTick(rows, ticked, 'goblin matron')!.where, 'In Unsorted')
  assert.equal(rowToTick(rows, ticked, 'Legion Warboss'), null)
  // Only another deck has it: still offered, and the list asks before taking it.
  assert.equal(rowToTick(rows, ticked, 'Sol Ring')!.source.kind, 'deck')
  assert.equal(pulledCopies(rows, ticked), 1)
  assert.deepEqual(pullGroupsIn(list, COLLECTIONS, 'shelf').map((g) => g.title), ['Red box › Red', 'Rares binder'])
  assert.deepEqual(pullGroupsIn(list, COLLECTIONS, 'rares').map((g) => g.title), ['Rares binder'])
})

test('moving the pulled copies into the deck box', () => {
  const list = pullList(KRENKO, COLLECTIONS, DECKS)
  const ticked = new Set(list.groups.filter((g) => g.kind !== 'missing').flatMap((g) => g.rows.map((r) => r.key)))
  const out = movePulled(KRENKO, list, ticked, COLLECTIONS, DECKS)
  assert.equal(out.moved, 14)
  assert.equal(out.nowPhysical, true)
  assert.equal(out.proxies, 2)
  assert.deepEqual(out.taken, [{ deckId: 'atraxa', deck: 'Atraxa', name: 'Sol Ring', qty: 1 }])
  // The copies left their binders; the lent one stayed.
  assert.deepEqual(out.collections[0].entries, [])
  assert.deepEqual(out.collections[1].entries.map((e) => e.name), ['Skirk Prospector'])
  const deck = out.decks.find((d) => d.id === 'krenko')!
  assert.equal(deck.ownership, 'PHYSICAL')
  assert.deepEqual(deck.cards.filter((c) => c.proxyQuantity !== undefined).map((c) => `${c.name} ${c.proxyQuantity}`), ['Skirk Prospector 1', 'Legion Warboss 1'])
  assert.deepEqual(deck.cameFrom, [
    { name: 'Goblin Bombardment', placeId: 'red', qty: 1, section: 'Red' },
    { name: 'Goblin Matron', placeId: 'red', qty: 1, section: 'Red' },
    { name: 'Goblin Chieftain', placeId: 'rares', qty: 1, page: 2, slot: 4 },
    { name: 'Purphoros', placeId: 'rares', qty: 1, foil: true, page: 5, slot: 1 },
  ])
  // Taken from Atraxa: a proxy there now, its list still whole.
  assert.equal(out.decks.find((d) => d.id === 'atraxa')!.cards[0].proxyQuantity, 1)
  // Built now: only its proxies are left to pull.
  assert.deepEqual(pullNeeds(deck).map((n) => `${n.name} ×${n.qty}`), ['Legion Warboss ×1', 'Skirk Prospector ×1'])
})

test('moving some: a deck you hold swaps proxies for the real thing; nothing ticked changes nothing', () => {
  const held = deckOf('h', 'Held', [card('gb', 'Goblin Bombardment', 2, 2)], 'PHYSICAL')
  const list = pullList(held, COLLECTIONS, [held])
  const out = movePulled(held, list, new Set(list.groups[0].rows.map((r) => r.key)), COLLECTIONS, [held])
  assert.equal(out.moved, 1)
  assert.equal(out.decks[0].cards[0].proxyQuantity, 1)
  assert.equal(out.nowPhysical, false)
  const none = movePulled(held, list, new Set(), COLLECTIONS, [held])
  assert.equal(none.collections, COLLECTIONS)
  assert.equal(none.moved, 0)
  // A proxy deck says 0 rather than leaving the key out (which would mean "all proxies").
  const proxy = deckOf('p', 'P', [card('gb', 'Goblin Bombardment', 1)], 'PROXY')
  const pl = pullList(proxy, COLLECTIONS, [proxy])
  assert.equal(movePulled(proxy, pl, new Set(pl.groups[0].rows.map((r) => r.key)), COLLECTIONS, [proxy]).decks[0].cards[0].proxyQuantity, 0)
})

test('the cards not owned can be marked as proxies in a deck being built', () => {
  const list = pullList(KRENKO, COLLECTIONS, DECKS)
  const marked = markMissingAsProxies(KRENKO, list)
  assert.deepEqual(marked.cards.filter((c) => c.proxyQuantity).map((c) => c.name), ['Skirk Prospector', 'Legion Warboss'])
  assert.equal(pullList(marked, COLLECTIONS, DECKS).toBuy, 0)
  assert.equal(markMissingAsProxies(ATRAXA, list), ATRAXA)
})

const BUILT = deckOf('built', 'Built', [
  card('gm2', 'Goblin Matron', 2, undefined, 'Creature — Goblin'), card('cs', 'Counterspell', 1, undefined, 'Instant'),
  card('sl', 'Sol Ring', 1, 1), card('mtn', 'Mountain', 3, undefined, 'Basic Land — Mountain'),
], 'PHYSICAL', [
  { name: 'Goblin Matron', placeId: 'red', qty: 1, section: 'Red' },
  { name: 'Mountain', placeId: 'gone', qty: 3 },
])
const FACTS: Record<string, string[]> = { gm2: ['R'], cs: ['U'], mtn: [] }

test('putting back: where each came from, or the best place by rule', () => {
  const facts = (e: DeckCardEntry) => ({ name: e.name, typeLine: e.typeLine, colors: FACTS[e.scryfallId] ?? [] })
  const origin = putBackList(BUILT, COLLECTIONS, 'ORIGIN', facts)
  // Blue comes before Red in the box.
  assert.deepEqual(origin.groups.map((g) => `${g.kind}: ${g.title}`), ['place: Red box › Blue', 'place: Red box › Red', 'basic: Mountains'])
  assert.deepEqual(origin.groups[1].rows.map((r) => `${r.name} ×${r.qty}${r.fromOrigin ? ' (came from here)' : ''} — ${r.hint}`),
    ['Goblin Matron ×1 (came from here) — around “G”', 'Goblin Matron ×1 — around “G”'])
  // Its place is gone, and no box takes lands: no place yet.
  assert.equal(origin.groups[2].detail, 'No place yet · or keep with the deck box')
  // The proxy isn't a copy to put back.
  assert.equal(origin.total, 6)
  const rule = putBackList(BUILT, COLLECTIONS, 'RULE', facts)
  assert.deepEqual(rule.groups[1].rows.map((r) => `${r.name} ×${r.qty}`), ['Goblin Matron ×2'])
  // With nothing known of its colours, a card no section takes has no place yet.
  const bare = putBackList(BUILT, COLLECTIONS, 'RULE')
  assert.deepEqual(bare.groups.map((g) => `${g.kind}: ${g.title}`), ['none: No place yet', 'basic: Mountains'])
  assert.deepEqual(bestPlaceByRule(PLACES, { name: 'Brainstorm', colors: ['U'] }, COLLECTIONS)?.spot, { placeId: 'red', section: 'Blue' })
  assert.equal(bestPlaceByRule(PLACES, { name: 'Sol Ring', colors: [] }, COLLECTIONS), null)
  assert.equal(basicsTitle('Plains'), 'Plains')
  assert.equal(basicsTitle('Snow-Covered Island'), 'Snow-Covered Islands')
})

test('taking a deck apart puts every copy in the Unsorted pile, at its place, and leaves the list', () => {
  const facts = (e: DeckCardEntry) => ({ name: e.name, typeLine: e.typeLine, colors: FACTS[e.scryfallId] ?? [] })
  const list = putBackList(BUILT, COLLECTIONS, 'ORIGIN', facts)
  const out = takeApart(BUILT, list, COLLECTIONS)
  assert.equal(out.placed, 3)
  assert.equal(out.unplaced, 3)
  const gm = out.collections[0].entries.find((e) => e.scryfallId === 'gm2')!
  assert.equal(gm.quantity, 2)
  assert.deepEqual(placedCopies(gm), [at('red', 2, { section: 'Red' })])
  assert.equal(out.collections[0].entries.find((e) => e.scryfallId === 'mtn')!.quantity, 8)
  assert.equal(out.deck.ownership, 'VIRTUAL')
  assert.deepEqual(out.deck.cameFrom, [])
  assert.equal(out.deck.cards.some((c) => c.proxyQuantity !== undefined), false)
  assert.equal(out.deck.cards.length, 4)
})

test('where the copies came from merges card by card, and an older app leaves it as it was', () => {
  const line = (name: string, qty: number, over: Partial<CopyPlace> = {}): CameFrom => ({ name, placeId: 'red', qty, ...over })
  assert.deepEqual(tidyCameFrom([line('Sol Ring', 1), line('sol ring', 2), line('Sol Ring', 1, { foil: true }), line('Bolt', 0)]),
    [line('Sol Ring', 3), line('Sol Ring', 1, { foil: true })])
  const base = [line('Sol Ring', 1)]
  const mine = [line('Sol Ring', 1), line('Arcane Signet', 1)]
  const theirs: CameFrom[] = []
  assert.deepEqual(mergeCameFrom(base, mine, theirs), [line('Arcane Signet', 1)])
  assert.equal(mergeCameFrom(undefined, undefined, undefined), undefined)

  const deck = deckOf('d', 'D', [card('a', 'Sol Ring', 1)], 'PHYSICAL', base)
  const older = deckOf('d', 'D renamed', [card('a', 'Sol Ring', 1)], 'PHYSICAL')
  assert.deepEqual(keepCameFromFromOlderApp(deck, older).cameFrom, base)
  assert.equal(keepCameFromFromOlderApp(older, deck), deck)
  const merged = mergeDeck(deck, { ...deck, cameFrom: mine }, older, false)
  assert.equal(merged.name, 'D renamed')
  assert.deepEqual(merged.cameFrom, [line('Arcane Signet', 1), line('Sol Ring', 1)])
  // Neither side knows about it: no key.
  assert.equal('cameFrom' in mergeDeck(older, older, older, false), false)
})

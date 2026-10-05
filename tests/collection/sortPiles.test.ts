import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BY_RULE, defaultPiles, fileEveryPile, nextPile, ownedCounts, pileDestination, pileFor, pileTallies, pileTitle, wantedByDecks,
  type PileRule, type SortFacts, type SortScan, type SortSession,
} from '../../src/collection/sortPiles.ts'
import { isUnsorted, type Collection, type CollectionEntry, type Deck, type StoragePlace } from '../../src/types/models.ts'

// Sorting a new pile into piles by rules, the same on both apps. The Android app has the same checks —
// see SortPilesTest.kt.

const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', sortRule: 'COLOUR', sections: ['Blue', 'Red'], createdAt: 1 }
const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 2 }
const trade: StoragePlace = { id: 'trade', name: 'Trade binder', kind: 'BINDER', createdAt: 3 }
const entry = (id: string, name: string, quantity: number): CollectionEntry => ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity: 0 })
const COLS: Collection[] = [{ id: 'unsorted', name: 'Unsorted', entries: [entry('shock', 'Shock', 3)], createdAt: 0, type: 'OWNED', storagePlaces: [red, rares, trade] }]
const card = (id: string, name: string, quantity = 1) => ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })
const krenko = {
  id: 'krenko', name: 'Krenko', commander: null, partnerCommander: null, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'VIRTUAL',
  cards: [card('matron', 'Goblin Matron'), card('shock', 'Shock')], considering: [card('fling', 'Fling')],
} as unknown as Deck
const RULES = defaultPiles(COLS)
const facts = (over: Partial<SortFacts>): SortFacts => ({ name: 'Card', rarity: 'common', usd: 0.1, owned: 0, wantedBy: [], ...over })
const usd = (n: number) => `$${n}`

test('the piles a first sort starts with', () => {
  assert.deepEqual(RULES, [
    { kind: 'VALUE', over: 2, to: 'rares' },
    { kind: 'BULK', to: BY_RULE },
    { kind: 'SPARES', keep: 4, to: 'trade' },
    { kind: 'WANTED' },
  ])
  assert.deepEqual(RULES.map((r) => pileTitle(r, usd)), ['Rares and mythics over $2', 'Bulk: everything else', 'Spares over 4', 'Wanted by a deck'])
})

test('each card goes in the first pile whose rule fits, bulk only when none does', () => {
  const pile = (f: Partial<SortFacts>) => { const p = pileFor(RULES, facts(f)); return p ? `${p.index} ${p.why}` : null }
  assert.equal(pile({ rarity: 'rare', usd: 5 }), '0 Worth keeping safe')
  assert.equal(pile({ rarity: 'mythic', usd: 3, owned: 6 }), '0 Worth keeping safe')
  assert.equal(pile({ rarity: 'rare', usd: 2 }), '1 Bulk')
  assert.equal(pile({ rarity: 'uncommon', usd: 9 }), '1 Bulk')
  assert.equal(pile({ rarity: 'rare', usd: null }), '1 Bulk')
  assert.equal(pile({ owned: 4 }), '2 You have 4 already')
  assert.equal(pile({ owned: 3 }), '1 Bulk')
  assert.equal(pile({ wantedBy: ['Krenko', 'Atraxa'] }), '3 For Krenko, Atraxa')
  const pricey: PileRule[] = [{ kind: 'WANTED' }, { kind: 'PRICE', over: 1 }]
  assert.equal(pileFor(pricey, facts({ usd: 1.5 }))?.index, 1)
  assert.equal(pileFor(pricey, facts({ usd: 0.5 })), null)
})

test('what decks want, and how many of each card is owned', () => {
  const wanted = wantedByDecks(COLS, [krenko])
  assert.deepEqual([...wanted].map(([k, w]) => `${k}: ${w.decks.join(', ')} ×${w.qty}`), ['goblin matron: Krenko ×1', 'fling: Krenko ×1'])
  assert.deepEqual([...ownedCounts(COLS, [krenko])], [['shock', 3]])
})

function scan(id: string, name: string, pile: number, over: Partial<SortScan> = {}): SortScan {
  return { id: 0, scryfallId: id, name, rarity: 'common', usd: 0.1, facts: { name, colors: ['R'], typeLine: 'Instant' }, entry: entry(id, name, 0), pile, why: '', ...over }
}

test('a session: copies scanned count as owned, and copies decks want are only wanted once', () => {
  const owned = ownedCounts(COLS, [krenko])
  const wanted = wantedByDecks(COLS, [krenko])
  let session: SortSession = { source: 'Booster box, Duskmourn', rules: RULES, newCards: true, scans: [] }
  const add = (id: string, name: string, extra: { rarity?: string; usd?: number } = {}) => {
    const p = nextPile(session, { name, ...extra }, owned, wanted)!
    session = { ...session, scans: [...session.scans, scan(id, name, p.index, { why: p.why, decks: p.decks, usd: extra.usd ?? 0.1 })] }
    return p.index
  }
  assert.deepEqual([add('shock', 'Shock'), add('shock', 'Shock'), add('matron', 'Goblin Matron'), add('matron', 'Goblin Matron'), add('ring', 'The One Ring', { rarity: 'mythic', usd: 60 })], [1, 2, 3, 1, 0])
  assert.deepEqual(pileTallies(session).map((t) => `${t.cards} ${t.usd.toFixed(2)} ${t.decks.join(',')}`), ['1 60.00 ', '2 0.20 ', '1 0.10 ', '1 0.10 Krenko'])
  // Cards already owned: scanning them doesn't make more.
  const tidy: SortSession = { ...session, newCards: false, scans: [] }
  assert.equal(nextPile({ ...tidy, scans: [scan('shock', 'Shock', 1)] }, { name: 'Shock' }, owned, wanted)?.index, 1)
})

test("where a pile's cards go", () => {
  const bolt = { name: 'Lightning Bolt', colors: ['R'], typeLine: 'Instant' }
  assert.deepEqual(pileDestination(RULES[1], bolt, COLS), { spot: { placeId: 'red', section: 'Red' }, label: 'Red box › Red' })
  assert.deepEqual(pileDestination(RULES[1], { name: 'Island', colors: [], typeLine: 'Basic Land — Island' }, COLS), { spot: null, label: 'No place yet' })
  assert.deepEqual(pileDestination(RULES[0], bolt, COLS), { spot: { placeId: 'rares', page: 1, slot: 1 }, label: 'Rares binder' })
  assert.deepEqual(pileDestination(RULES[3], bolt, COLS), { spot: null, label: 'No place yet' })
})

test('Done: every pile is filed — new cards added at their places', () => {
  const session: SortSession = {
    source: '', rules: RULES, newCards: true,
    scans: [scan('ring', 'The One Ring', 0), scan('bolt', 'Lightning Bolt', 1), scan('matron', 'Goblin Matron', 3), scan('ring', 'The One Ring', 0)],
  }
  const filed = fileEveryPile(COLS, session)
  assert.equal(filed.added, 4)
  assert.deepEqual(filed.steps.map((s) => `${s.scan.name} → ${s.to}`), [
    'The One Ring → Rares binder', 'Lightning Bolt → Red box › Red', 'Goblin Matron → No place yet', 'The One Ring → Rares binder',
  ])
  const pile = filed.collections.find(isUnsorted)!
  assert.deepEqual(pile.entries.map((e) => `${e.name} ×${e.quantity} ${JSON.stringify(e.places ?? null)}`), [
    'Shock ×3 null',
    'The One Ring ×2 [{"placeId":"rares","qty":1,"page":1,"slot":1},{"placeId":"rares","qty":1,"page":1,"slot":2}]',
    'Lightning Bolt ×1 [{"placeId":"red","qty":1,"section":"Red"}]',
    'Goblin Matron ×1 null',
  ])
  // Cards already owned are put away instead: the Shocks with no place go into the box.
  const tidy = fileEveryPile(COLS, { ...session, newCards: false, scans: [scan('shock', 'Shock', 1)] })
  assert.equal(tidy.added, 0)
  assert.deepEqual(tidy.collections.find(isUnsorted)!.entries[0].places, [{ placeId: 'red', qty: 1, section: 'Red' }])
})

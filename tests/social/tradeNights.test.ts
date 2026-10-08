import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bagNamesOf, bringCards, defaultSources, mergeWants, nightDecksUse, nightWantsOf, parseTradeNight, priceIdsNeeded, suggestTrade, suggestedTrades,
  nightTableLine, theyWantFromYou, tradeTable, wantedHere,
  type NightCard, type NightList, type NightSource, type NightSuggestion, type NightWant, type TheyWantRow, type WantedHereRow,
} from '../../src/social/tradeNights.ts'
import type { CardPrice } from '../../src/social/tradeFairness.ts'
import type { Trade } from '../../src/social/api.ts'
import type { Collection, Deck } from '../../src/types/models.ts'

// Trade nights. The cases in tradeNightVectors.json are run by the Android app too
// (TradeNightsTest.kt, which keeps a copy), so both apps match wants, build lists and suggest the
// same fair trades.

interface Vectors {
  prices: Record<string, CardPrice>
  mergeWants: { about: string; wishlist: string[]; decks: string[]; goals: string[]; expect: NightWant[] }[]
  bring: { collections: Collection[]; decksUse: string[]; defaultSources: NightSource[]; cases: { about: string; sources: NightSource[]; bagNames: string[]; expect: NightCard[] }[] }
  lists: { me: NightList; others: NightList[]; wantedHere: WantedHereRow[]; theyWant: TheyWantRow[]; suggested: NightSuggestion[]; priceIds: string[] }
  suggest: { about: string; me: NightList; them: NightList; expect: NightSuggestion | null }[]
  table: { me: string; trades: Trade[]; expect: { id: string; other: string; state: string }[]; line: string | null }
}

const V = JSON.parse(readFileSync(new URL('./tradeNightVectors.json', import.meta.url), 'utf8')) as Vectors
const book = new Map(Object.entries(V.prices))

test('wants: wishlist over decks over goals, each name once, most wanted first', () => {
  for (const c of V.mergeWants) assert.deepEqual(mergeWants(c.wishlist, c.decks, c.goals), c.expect, c.about)
})

test('bring list: the trade binder by default, binders and the event bag', () => {
  assert.deepEqual(defaultSources(V.bring.collections), V.bring.defaultSources)
  for (const c of V.bring.cases) assert.deepEqual(bringCards(V.bring.collections, c.sources, c.bagNames, new Set(V.bring.decksUse)), c.expect, c.about)
})

test('wanted here and they want from you', () => {
  assert.deepEqual(wantedHere(V.lists.me.wants, V.lists.others), V.lists.wantedHere)
  assert.deepEqual(theyWantFromYou(V.lists.me.cards, V.lists.others), V.lists.theyWant)
})

test('suggested trades: fair bundles of spare, priced cards each side wants most', () => {
  for (const c of V.suggest) assert.deepEqual(suggestTrade(c.me, c.them, book), c.expect, c.about)
  assert.deepEqual(suggestedTrades(V.lists.me, V.lists.others, book), V.lists.suggested)
  assert.deepEqual(priceIdsNeeded(V.lists.me, V.lists.others), V.lists.priceIds)
})

test('every suggestion is fair', () => {
  for (const s of [...V.suggest.map((c) => c.expect), ...V.lists.suggested]) {
    if (!s) continue
    assert.ok(Math.abs(s.getValue - s.giveValue) <= Math.max(2, 0.1 * Math.max(s.getValue, s.giveValue)))
  }
})

test('trade table: agreed, then waiting, then done; closed ones left out', () => {
  const rows = tradeTable(V.table.trades, V.table.me)
  assert.deepEqual(rows.map((r) => ({ id: r.trade.id, other: r.other, state: r.state })), V.table.expect)
  assert.equal(nightTableLine(rows), V.table.line)
  assert.equal(nightTableLine([]), null)
})

test('wants from the library: wishlist, cards decks are missing, unfinished goals', () => {
  const collections = [
    { id: 'wl', name: 'Wishlist', type: 'WISHLIST', createdAt: 0, entries: [{ scryfallId: 'tithe', name: 'Smothering Tithe', imageUrl: null, quantity: 0, foilQuantity: 0 }] },
    { id: 'b', name: 'Binder', type: 'OWNED', createdAt: 0, entries: [{ scryfallId: 'sol', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0 }] },
  ] as Collection[]
  const deck = (id: string, name: string, cards: string[], extra: Partial<Deck> = {}): Deck =>
    ({ id, name, ownership: 'VIRTUAL', cards: cards.map((n) => ({ scryfallId: n, name: n, imageUrl: null, quantity: 1 })), createdAt: 0, ...extra }) as unknown as Deck
  const decks = [
    deck('d1', 'Krenko', ['Sol Ring', 'Goblin Bombardment']),
    deck('d2', 'Old', ['Archived Card'], { archived: true }),
    deck('d3', 'Bring to game night', ['Bag Card']),
  ]
  assert.deepEqual(nightWantsOf(collections, decks), [
    { name: 'Smothering Tithe', weight: 3 },
    { name: 'Goblin Bombardment', weight: 2 },
  ])
  assert.deepEqual(bagNamesOf(decks), ['Bag Card'])
  assert.deepEqual([...nightDecksUse(decks)].sort(), ['archived card', 'goblin bombardment', 'sol ring'])
})

test('reading trade_night: lists, trades, junk left out', () => {
  assert.equal(parseTradeNight(null), null)
  assert.equal(parseTradeNight({}), null)
  const n = parseTradeNight({
    nightId: 'n1', going: true, open: true,
    mine: { user: { user_id: 'me', username: 'me', display_name: 'Me', avatar_path: null }, sources: [{ kind: 'binder', id: 'tb', name: 'Trade binder' }, { kind: 'x' }], cards: [{ scryfallId: 's', name: 'Sol Ring', quantity: 1, spare: true }, { name: 'bad' }], wants: [{ name: 'A', weight: 3 }, { name: 'B' }], updatedAt: 5 },
    others: [{ user: { user_id: 'bob', display_name: 'Bob' }, cards: [], wants: [] }, { user: {} }],
    trades: [{ id: 't', from_user: 'me', to_user: 'bob', status: 'accepted', from_applied: true }, { nope: 1 }],
  })!
  assert.equal(n.going, true)
  assert.deepEqual(n.mine?.sources, [{ kind: 'binder', id: 'tb', name: 'Trade binder' }])
  assert.deepEqual(n.mine?.cards, [{ scryfallId: 's', name: 'Sol Ring', imageUrl: null, foil: false, quantity: 1, collectionId: null, condition: null, spare: true }])
  assert.deepEqual(n.mine?.wants, [{ name: 'A', weight: 3 }])
  assert.deepEqual(n.others.map((o) => o.user.display_name), ['Bob'])
  assert.equal(n.trades.length, 1)
  assert.equal(n.trades[0].status, 'accepted')
  assert.equal(n.trades[0].from_applied, true)
  assert.equal(parseTradeNight({ nightId: 'n', mine: null })?.mine, null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allCardsOf } from '../../src/collection/allCards.ts'
import {
  allIntoBinder, assignedCopies, binderCountLine, binderView, deckCopiesByBinder, deckCopyRows, inDecksBadge, inDecksOf, keptInPlacesAndDecksLine,
  movedRefs, noBinderLine, ownCopiesOf, shownName, sortingBinderIds, unsortedView, viewTotal, withCardBinders, cardBindersLine,
} from '../../src/collection/binderViews.ts'
import type { Collection, Deck, DeckCardEntry, DeckOwnership } from '../../src/types/models.ts'

// Binders as views (src/collection/binderViews.ts). The cases in binderViewVectors.json are run by the
// Android app's BinderViewsTest.kt too.

type Refs = { id: string; qty: number }[]
interface VCard { id: string; qty: number; proxies?: number; binders?: Refs }
interface Case {
  name: string
  collections: { id: string; type: string; entries: { id: string; qty: number; foil?: number }[] }[]
  decks: { id: string; ownership?: string; gameMode?: string; sample?: boolean; cards: VCard[] }[]
  expect: {
    binders: Record<string, { own: number; deck: [string, string, number][] }>
    noBinder: { own: number; deck: [string, string, number][] }
  }
}
const V = JSON.parse(readFileSync(new URL('./binderViewVectors.json', import.meta.url), 'utf8')) as { cases: Case[] }

const collectionsOf = (c: Case): Collection[] => c.collections.map((b) => ({
  id: b.id, name: b.id, createdAt: 1, type: b.type,
  entries: b.entries.map((e) => ({ scryfallId: e.id, name: e.id, imageUrl: null, quantity: e.qty, foilQuantity: e.foil ?? 0 })),
}) as Collection)

const decksOf = (c: Case): Deck[] => c.decks.map((d) => ({
  id: d.id, name: d.id, commander: null, partnerCommander: null, createdAt: 1, tags: [], gameResults: [],
  gameMode: d.gameMode ?? 'COMMANDER',
  ownership: (d.ownership ?? 'PHYSICAL') as DeckOwnership,
  ...(d.sample ? { sample: true } : {}),
  cards: d.cards.map((e): DeckCardEntry => ({
    scryfallId: e.id, name: e.id, imageUrl: null, quantity: e.qty, canBeCommander: false, typeLine: null, partnerAbility: null,
    ...(e.proxies !== undefined ? { proxyQuantity: e.proxies } : {}),
    ...(e.binders !== undefined ? { binders: e.binders } : {}),
  })),
}) as Deck)

const shown = (list: { deckId: string; entry: DeckCardEntry; qty: number }[]) => list.map((d) => [d.deckId, d.entry.scryfallId, d.qty])

for (const c of V.cases) {
  test(`binder views: ${c.name}`, () => {
    const collections = collectionsOf(c)
    const decks = decksOf(c)
    const binders = collections.filter((x) => x.type !== 'WISHLIST' && x.id !== 'unsorted').map((x) => x.id)
    assert.deepEqual(binders.sort(), Object.keys(c.expect.binders).sort())
    let shownCopies = 0
    for (const id of binders) {
      const v = binderView(id, collections, decks)
      assert.deepEqual({ own: ownCopiesOf(v), deck: shown(v.deckCopies) }, c.expect.binders[id], id)
      shownCopies += viewTotal(v)
    }
    const none = unsortedView(collections, decks)
    assert.deepEqual({ own: ownCopiesOf(none), deck: shown(none.deckCopies) }, c.expect.noBinder)
    shownCopies += viewTotal(none)
    // Every real copy shows in exactly one view: the views add up to All cards' real copies.
    const real = allCardsOf(collections, decks).reduce((n, a) => n + a.total - a.proxies, 0)
    assert.equal(shownCopies, real)
  })
}

const deck = (cards: DeckCardEntry[], over: Partial<Deck> = {}): Deck =>
  ({ id: 'd', name: 'Talrand', commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL', ...over })
const card = (id: string, quantity = 1, more: Partial<DeckCardEntry> = {}): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...more })
const binder = (id: string, over: Partial<Collection> = {}): Collection => ({ id, name: id, entries: [], createdAt: 1, type: 'OWNED', ...over })

test('binder views: the index is worked out once for the same library', () => {
  const collections = [binder('b1')]
  const decks = [deck([card('sol', 1, { binders: [{ id: 'b1', qty: 1 }] })])]
  assert.equal(deckCopiesByBinder(collections, decks), deckCopiesByBinder(collections, decks))
})

test('binder views: valued totals are unchanged — sorting a deck card only changes where it shows', () => {
  const collections = [binder('b1', { entries: [{ scryfallId: 'bolt', name: 'bolt', imageUrl: null, quantity: 2, foilQuantity: 0 }] }), binder('unsorted')]
  const before = [deck([card('sol', 2), card('path', 1)])]
  const after = [allIntoBinder(before[0], 'b1', sortingBinderIds(collections))[0]]
  const real = (decks: Deck[]) => allCardsOf(collections, decks).map((a) => [a.scryfallId, a.total - a.proxies])
  assert.deepEqual(real(after), real(before))
  assert.equal(inDecksOf(binderView('b1', collections, after)), 3)
  assert.equal(inDecksOf(unsortedView(collections, after)), 0)
})

test('binder views: clamping walks the refs in order', () => {
  const d = deck([card('sol', 2, { binders: [{ id: 'a', qty: 1 }, { id: 'b', qty: 5 }, { id: 'c', qty: 1 }] })])
  assert.deepEqual(assignedCopies(d, d.cards[0]), [{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }])
  assert.deepEqual(assignedCopies(deck(d.cards, { ownership: 'VIRTUAL' }), d.cards[0]), [])
})

test('binder views: put all cards in a binder leaves sorted copies where they are and fixes ones in a binder that is gone', () => {
  const d = deck([
    card('sol', 2, { binders: [{ id: 'b2', qty: 1 }] }),
    card('bolt', 1, { binders: [{ id: 'gone', qty: 1 }] }),
    card('path', 2, { proxyQuantity: 2 }),
  ])
  const [out, moved] = allIntoBinder(d, 'b1', new Set(['b1', 'b2']))
  assert.equal(moved, 2)
  assert.deepEqual(out.cards.map((c) => c.binders ?? null), [[{ id: 'b2', qty: 1 }, { id: 'b1', qty: 1 }], [{ id: 'b1', qty: 1 }], null])
  assert.equal(allIntoBinder(out, 'b1', new Set(['b1', 'b2']))[1], 0)
  assert.equal(allIntoBinder(deck(d.cards, { ownership: 'PROTOTYPE' }), 'b1', new Set(['b1']))[1], 0)
})

test('binder views: move to another binder and take out of a binder', () => {
  const valid = new Set(['b1', 'b2'])
  const refs = [{ id: 'b1', qty: 2 }, { id: 'b2', qty: 1 }]
  assert.deepEqual(movedRefs(refs, 'b1', 'b2', 2, valid), [{ id: 'b2', qty: 3 }])
  assert.deepEqual(movedRefs(refs, 'b1', null, 2, valid), [{ id: 'b2', qty: 1 }])
  assert.deepEqual(movedRefs([{ id: 'b1', qty: 1 }], 'b1', null, 1, valid), [])
  // From No binder: copies in no binder, or one that's gone.
  assert.deepEqual(movedRefs([{ id: 'gone', qty: 1 }], null, 'b1', 2, valid), [{ id: 'b1', qty: 2 }])
  const d = deck([card('sol', 2)])
  assert.deepEqual(withCardBinders(d, 'sol', [{ id: 'b1', qty: 5 }]).cards[0].binders, [{ id: 'b1', qty: 2 }])
  assert.deepEqual(withCardBinders(d, 'sol', []).cards[0].binders, [])
  const set = withCardBinders(d, 'sol', [{ id: 'b1', qty: 2 }])
  assert.equal(withCardBinders(set, 'sol', [{ id: 'b1', qty: 2 }]), set)
})

test('binder views: rows a printing, and the words', () => {
  const decks = [deck([card('sol', 1, { binders: [{ id: 'b1', qty: 1 }] })]), deck([card('sol', 1, { binders: [{ id: 'b1', qty: 1 }] })], { id: 'd2', name: 'Atraxa' })]
  const v = binderView('b1', [binder('b1')], decks)
  const rows = deckCopyRows(v.deckCopies)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].qty, 2)
  assert.equal(inDecksBadge(rows[0].decks.map((d) => d[1])), 'In 2 decks')
  assert.equal(inDecksBadge(['Talrand']), 'In Talrand deck')
  assert.equal(binderCountLine({ binderId: 'b', own: [{ scryfallId: 'x', name: 'x', imageUrl: null, quantity: 72, foilQuantity: 0 }], deckCopies: v.deckCopies }), '74 cards · 2 in decks')
  assert.equal(noBinderLine({ binderId: 'unsorted', own: [], deckCopies: [] }), 'All sorted')
  assert.equal(noBinderLine({ binderId: 'unsorted', own: [{ scryfallId: 'x', name: 'x', imageUrl: null, quantity: 3, foilQuantity: 0 }], deckCopies: [] }), '3 cards, not in a binder')
  assert.equal(noBinderLine({ binderId: 'unsorted', own: [], deckCopies: v.deckCopies }), '2 cards · 2 in decks, not in a binder')
  assert.equal(keptInPlacesAndDecksLine(3, 10, 2), 'kept in 3 places · 2 decks')
  assert.equal(keptInPlacesAndDecksLine(0, 0, 1), '1 deck')
  assert.equal(shownName(binder('unsorted', { name: 'Unsorted' })), 'No binder')
  assert.equal(cardBindersLine([{ id: 'b1', qty: 1 }, { id: 'gone', qty: 1 }], new Map([['b1', 'Rares']])), 'Binder: Rares ×1')
})

test("binder views: a friend's shared binder is its own cards — a wishlist or unknown id shows no deck copies", () => {
  const decks = [deck([card('sol', 1, { binders: [{ id: 'wishlist', qty: 1 }] })])]
  assert.deepEqual(binderView('wishlist', [binder('wishlist', { type: 'WISHLIST' })], decks).deckCopies, [])
  assert.deepEqual(binderView('nope', [], decks).deckCopies, [])
})

test("binder views: a proxy deck's real swapped-in copies get its deck chip; its proxies don't", async () => {
  const { locationIndex } = await import('../../src/collection/collectionLayout.ts')
  const d = deck([card('sol', 3, { proxyQuantity: 1 }), card('bolt', 2)], { ownership: 'PROXY' })
  const chips = locationIndex([], [d])
  assert.deepEqual(chips.get('sol')?.map((c) => [c.kind, c.qty]), [['deck', 2]])
  assert.equal(chips.get('bolt'), undefined)
})

test('binder views: the backup from before the binders update is made once, and read back', async () => {
  const { saveBeforeBinders, readBeforeBinders, BEFORE_BINDERS_KEY } = await import('../../src/sync/beforeBinders.ts')
  const mem = new Map<string, string>()
  const local = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) } }
  const lib = { decks: [deck([card('sol', 1)])], collections: [binder('b1')] } as never
  assert.equal(await saveBeforeBinders(lib, 5, local, null), true)
  const saved = mem.get(BEFORE_BINDERS_KEY)
  assert.ok(saved)
  // Once only: a later visit with a changed library leaves it as it was.
  assert.equal(await saveBeforeBinders({ decks: [], collections: [binder('b2')] } as never, 6, local, null), false)
  assert.equal(mem.get(BEFORE_BINDERS_KEY), saved)
  const read = await readBeforeBinders(local, null)
  assert.ok(read && read.ok)
  if (read && read.ok) assert.deepEqual(read.backup.decks.map((x) => x.id), ['d'])
  // Storage that's blocked: nothing made, nothing thrown.
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
  assert.equal(await saveBeforeBinders(lib, 5, blocked, null), false)
})

test('binder views: group by binder — deck copies under their binder, the rest under No binder, no deck groups', async () => {
  const { binderGroupIndex } = await import('../../src/collection/binderViews.ts')
  const collections = [binder('b1', { name: 'Rares' }), binder('unsorted', { entries: [{ scryfallId: 'bolt', name: 'bolt', imageUrl: null, quantity: 1, foilQuantity: 0 }] })]
  const decks = [deck([card('sol', 2, { binders: [{ id: 'b1', qty: 1 }] }), card('bolt')])]
  const keys = binderGroupIndex(collections, decks)
  assert.deepEqual(keys.get('sol'), [{ key: 'binder:b1', title: 'Rares' }, { key: '', title: 'No binder' }])
  assert.deepEqual(keys.get('bolt'), [{ key: '', title: 'No binder' }])
})

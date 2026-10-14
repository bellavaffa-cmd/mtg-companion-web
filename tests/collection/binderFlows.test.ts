import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allCardsOf } from '../../src/collection/allCards.ts'
import { binderView, ownCopiesOf, unsortedView, viewTotal, withCardBinders } from '../../src/collection/binderViews.ts'
import { returnCopies, sendToDeck, takeBack, withCardCount } from '../../src/collection/binderFlows.ts'
import { binderRef } from '../../src/decks/binderRefs.ts'
import { withSwapIn } from '../../src/decks/swapIn.ts'
import { movePulled, pullList, putBackList, takeApart } from '../../src/collection/pullList.ts'
import { withPlaceList } from '../../src/collection/storagePlaces.ts'
import { mergeCollection, mergeDeck } from '../../src/sync/mergeItems.ts'
import type { CameFrom, Collection, CollectionEntry, CopyPlace, Deck, DeckCardEntry, DeckOwnership, StoragePlace } from '../../src/types/models.ts'

// Copies moving between binders and decks (src/collection/binderFlows.ts). The cases in
// returnToBinderVectors.json are run by the Android app's BinderFlowsTest.kt too.

type Refs = { id: string; qty: number; foil?: number }[]
interface VPlace { placeId: string; qty: number; foil?: boolean; section?: string }
interface VEntry { id: string; name?: string; qty: number; foil?: number; places?: VPlace[] }
interface VCard { id: string; name?: string; qty: number; proxies?: number; binders?: Refs }
interface VDeck { id: string; ownership?: string; cards: VCard[]; cameFrom?: (VPlace & { name: string })[] }
interface VView { own: number; deck: [string, string, number][] }
interface Case {
  name: string
  places: string[]
  collections: { id: string; type: string; entries: VEntry[] }[]
  deck: VDeck
  do: { flow: string; binder?: string; card?: string; qty?: number; to?: string | number }
  expect: {
    collections: Record<string, VEntry[]>
    deck: Omit<VDeck, 'id'> | null
    binders: Record<string, VView>
    noBinder: VView
  }
}
const V = JSON.parse(readFileSync(new URL('./returnToBinderVectors.json', import.meta.url), 'utf8')) as { cases: Case[] }

const placeOf = (p: VPlace): CopyPlace => ({ placeId: p.placeId, qty: p.qty, ...(p.foil ? { foil: true } : {}), ...(p.section ? { section: p.section } : {}) })

function collectionsOf(c: Case): Collection[] {
  const cols = c.collections.map((b) => ({
    id: b.id, name: b.id, createdAt: 1, type: b.type,
    entries: b.entries.map((e): CollectionEntry => ({
      scryfallId: e.id, name: e.name ?? e.id, imageUrl: null, quantity: e.qty, foilQuantity: e.foil ?? 0,
      ...(e.places ? { places: e.places.map(placeOf) } : {}),
    })),
  }) as Collection)
  const places = c.places.map((id) => ({ id, name: id }) as StoragePlace)
  return places.length === 0 ? cols : withPlaceList(cols, places)
}

const deckOf = (d: VDeck): Deck => ({
  id: d.id, name: d.id, commander: null, partnerCommander: null, createdAt: 1, tags: [], gameResults: [], gameMode: 'COMMANDER',
  ownership: (d.ownership ?? 'PHYSICAL') as DeckOwnership,
  cards: d.cards.map((e): DeckCardEntry => ({
    scryfallId: e.id, name: e.name ?? e.id, imageUrl: null, quantity: e.qty, canBeCommander: false, typeLine: null, partnerAbility: null,
    ...(e.proxies !== undefined ? { proxyQuantity: e.proxies } : {}),
    ...(e.binders !== undefined ? { binders: e.binders.map((r) => binderRef(r.id, r.qty, r.foil ?? 0)) } : {}),
  })),
  ...(d.cameFrom ? { cameFrom: d.cameFrom.map((l): CameFrom => ({ name: l.name, ...placeOf(l) })) } : {}),
})

// What's compared, as plain values, the same shapes as the vectors.
const placesShown = (p: CopyPlace[] | undefined) => (p ?? []).map((l) => ({ placeId: l.placeId, qty: l.qty, ...(l.foil ? { foil: true } : {}), ...(l.section ? { section: l.section } : {}) }))
const entryShown = (e: CollectionEntry) => ({ id: e.scryfallId, qty: e.quantity, foil: e.foilQuantity ?? 0, places: placesShown(e.places) })
const wantEntry = (e: VEntry) => ({ id: e.id, qty: e.qty, foil: e.foil ?? 0, places: (e.places ?? []).map(placeOf) })
const deckShown = (d: Deck | null) => d && ({
  ownership: d.ownership,
  cards: d.cards.map((e) => ({
    id: e.scryfallId, qty: e.quantity,
    ...(e.proxyQuantity != null ? { proxies: e.proxyQuantity } : {}),
    ...(e.binders != null ? { binders: e.binders.map((r) => ({ id: r.id, qty: r.qty, ...(r.foil ? { foil: r.foil } : {}) })) } : {}),
  })),
  ...(d.cameFrom !== undefined ? { cameFrom: d.cameFrom.map((l) => ({ name: l.name, ...placesShown([l])[0] })) } : {}),
})
const wantDeck = (d: Omit<VDeck, 'id'> | null, was: Deck) => d && deckShown(deckOf({ ...d, id: was.id, ownership: d.ownership ?? was.ownership }))

const realCopies = (collections: Collection[], decks: Deck[]) => allCardsOf(collections, decks).reduce((n, a) => n + a.total - a.proxies, 0)
const viewShown = (v: ReturnType<typeof binderView>): VView => ({ own: ownCopiesOf(v), deck: v.deckCopies.map((d) => [d.deckId, d.entry.scryfallId, d.qty]) })

function run(c: Case, collections: Collection[], deck: Deck): { collections: Collection[]; deck: Deck | null } {
  const d = c.do
  switch (d.flow) {
    case 'fromBinder': return sendToDeck(collections, deck, d.binder!, d.card!, d.qty!)
    case 'countDown': return returnCopies(collections, deck, withCardCount(deck, d.card!, d.to as number))
    case 'remove': return returnCopies(collections, deck, withCardCount(deck, d.card!, 0))
    case 'deleteDeck': return returnCopies(collections, deck, null)
    case 'ownership': return returnCopies(collections, deck, { ...deck, ownership: d.to as DeckOwnership })
    case 'deleteBinder': return { collections: collections.filter((x) => x.id !== d.binder), deck }
    case 'swapIn': { const out = withSwapIn(collections, [deck], deck.id, d.card!); return { collections: out.collections, deck: out.decks[0] } }
    case 'pull': {
      const list = pullList(deck, collections, [deck])
      const out = movePulled(deck, list, new Set(list.groups.flatMap((g) => g.rows.map((r) => r.key))), collections, [deck])
      return { collections: out.collections, deck: out.decks[0] }
    }
    case 'putBack': return takeApart(deck, putBackList(deck, collections, 'ORIGIN'), collections)
  }
  throw new Error(`unknown flow ${d.flow}`)
}

for (const c of V.cases) {
  test(`binder flows: ${c.name}`, () => {
    const collections = collectionsOf(c)
    const deck = deckOf(c.deck)
    const out = run(c, collections, deck)
    const shown = out.collections.filter((x) => x.type !== 'WISHLIST')
    assert.deepEqual(shown.map((x) => x.id).sort(), Object.keys(c.expect.collections).sort())
    for (const col of shown) assert.deepEqual(col.entries.map(entryShown), c.expect.collections[col.id].map(wantEntry), col.id)
    assert.deepEqual(deckShown(out.deck), wantDeck(c.expect.deck, deck))

    const decks = out.deck ? [out.deck] : []
    const binders = out.collections.filter((x) => x.type !== 'WISHLIST' && x.id !== 'unsorted').map((x) => x.id)
    assert.deepEqual(binders.sort(), Object.keys(c.expect.binders).sort())
    let inViews = 0
    for (const id of binders) {
      const v = binderView(id, out.collections, decks)
      assert.deepEqual(viewShown(v), c.expect.binders[id], `view ${id}`)
      inViews += viewTotal(v)
    }
    const none = unsortedView(out.collections, decks)
    assert.deepEqual(viewShown(none), c.expect.noBinder, 'no binder')
    inViews += viewTotal(none)

    // No copy made or lost (a deleted binder's own go with it), and every one in exactly one view.
    const gone = c.do.flow === 'deleteBinder' ? collections.find((x) => x.id === c.do.binder)!.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0) : 0
    assert.equal(realCopies(out.collections, decks), realCopies(collections, [deck]) - gone, 'copies')
    assert.equal(inViews, realCopies(out.collections, decks), 'views')
  })
}

// ---- Two devices ----

const card = (id: string, quantity = 1, more: Partial<DeckCardEntry> = {}): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...more })
const deckWith = (cards: DeckCardEntry[], over: Partial<Deck> = {}): Deck =>
  ({ id: 'd1', name: 'Talrand', commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL', ...over })
const own = (id: string, quantity: number): CollectionEntry => ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity: 0 })
const binder = (id: string, entries: CollectionEntry[] = []): Collection => ({ id, name: id, entries, createdAt: 1, type: 'OWNED' })

function mergedBothWays(base: Deck, a: Deck, b: Deck): Deck {
  const one = mergeDeck(base, a, b, true)
  const other = mergeDeck(base, b, a, false)
  assert.deepEqual(one.cards, other.cards)
  return one
}

test('binder flows: one device moves a card from a binder into a deck while the other edits the deck', () => {
  const baseCols = [binder('b1', [own('sol', 1), own('bolt', 1)]), binder('unsorted')]
  const baseDeck = deckWith([card('path', 1)])
  const before = realCopies(baseCols, [baseDeck])

  // Browser A: Sol Ring out of b1 into the deck.
  const a = sendToDeck(baseCols, baseDeck, 'b1', 'sol', 1)
  // Browser B: the deck renamed and its other card put in a binder (no copies of Sol Ring touched).
  const deckB: Deck = { ...baseDeck, name: 'Talrand, Sky Summoner', cards: [card('path', 1, { binders: [] })] }

  const deck = mergedBothWays(baseDeck, a.deck, deckB)
  const b1 = mergeCollection(baseCols[0], a.collections[0], baseCols[0], true)
  const cols = [b1, baseCols[1]]
  assert.deepEqual(deck.cards.map((e) => [e.scryfallId, e.quantity]).sort(), [['path', 1], ['sol', 1]])
  assert.deepEqual(deck.cards.find((e) => e.scryfallId === 'sol')!.binders, [{ id: 'b1', qty: 1 }])
  assert.deepEqual(b1.entries.map((e) => e.scryfallId), ['bolt'])
  // Sol Ring is in one place only, and b1 still lists it.
  assert.equal(realCopies(cols, [deck]), before)
  assert.deepEqual(binderView('b1', cols, [deck]).deckCopies.map((d) => d.entry.scryfallId), ['sol'])
})

test('binder flows: one device takes a card out of a deck back to its binder while the other edits the deck', () => {
  const baseCols = [binder('b1'), binder('unsorted')]
  const baseDeck = deckWith([card('sol', 1, { binders: [{ id: 'b1', qty: 1 }] }), card('path', 1)])
  const before = realCopies(baseCols, [baseDeck])

  // Browser A: Sol Ring taken out of the deck — back to b1.
  const r = returnCopies(baseCols, baseDeck, withCardCount(baseDeck, 'sol', 0))
  // Browser B: Path's copies put in b1 too.
  const deckB = withCardBinders(baseDeck, 'path', [{ id: 'b1', qty: 1 }])

  const deck = mergedBothWays(baseDeck, r.deck!, deckB)
  const b1 = mergeCollection(baseCols[0], r.collections[0], baseCols[0], true)
  const cols = [b1, baseCols[1]]
  assert.deepEqual(deck.cards.map((e) => e.scryfallId), ['path'])
  assert.deepEqual(b1.entries.map((e) => [e.scryfallId, e.quantity]), [['sol', 1]])
  assert.equal(realCopies(cols, [deck]), before)
  assert.equal(viewTotal(binderView('b1', cols, [deck])), 2)
})

// ---- Smaller things ----

test('binder flows: refs written without a foil count when there are none; an older app\'s plain refs still go back', () => {
  assert.deepEqual(binderRef('b1', 2, 0), { id: 'b1', qty: 2 })
  assert.deepEqual(binderRef('b1', 2, 1), { id: 'b1', qty: 2, foil: 1 })
  const deck = deckWith([card('sol', 1, { binders: [{ id: 'b1', qty: 1 }] })])
  const r = returnCopies([binder('b1'), binder('unsorted')], deck, null)
  assert.deepEqual(r.back.map((b) => [b.collectionId, b.plain, b.foil]), [['b1', 1, 0]])
})

test('binder flows: a virtual deck\'s cards never go anywhere', () => {
  const deck = deckWith([card('sol', 2, { binders: [{ id: 'b1', qty: 2 }] })], { ownership: 'VIRTUAL' })
  const cols = [binder('b1'), binder('unsorted')]
  const r = returnCopies(cols, deck, null)
  assert.equal(r.back.length, 0)
  assert.equal(r.collections, cols)
})

test('binder flows: a card sent to a deck and taken back is in its binder again; undo takes it out again', () => {
  const cols = [binder('b1', [own('sol', 1)]), binder('unsorted')]
  const sent = sendToDeck(cols, deckWith([]), 'b1', 'sol', 1)
  const r = returnCopies(sent.collections, sent.deck, withCardCount(sent.deck, 'sol', 0))
  assert.deepEqual(r.collections.find((c) => c.id === 'b1')!.entries.map((e) => [e.scryfallId, e.quantity]), [['sol', 1]])
  assert.deepEqual(r.deck!.cards, [])
  assert.deepEqual(takeBack(r.collections, r.back).find((c) => c.id === 'b1')!.entries, [])
})

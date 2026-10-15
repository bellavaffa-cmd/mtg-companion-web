import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allCardsOf } from '../../src/collection/allCards.ts'
import { binderView, unsortedView, viewTotal } from '../../src/collection/binderViews.ts'
import { sendDeckCard, toMain, toSideboard, type SendTo } from '../../src/collection/binderFlows.ts'
import { binderRef } from '../../src/decks/binderRefs.ts'
import { withPlaceList } from '../../src/collection/storagePlaces.ts'
import { mergeDeck } from '../../src/sync/mergeItems.ts'
import type { CameFrom, Collection, CollectionEntry, CopyPlace, Deck, DeckCardEntry, DeckOwnership, StoragePlace } from '../../src/types/models.ts'
import type { DeckPart } from '../../src/decks/sideboard.ts'

// Cards sent between decks and in and out of a sideboard (src/collection/binderFlows.ts). The cases in
// moveVectors.json are run by the Android app's MoveFlowsTest.kt too.

type Refs = { id: string; qty: number; foil?: number }[]
interface VPlace { placeId: string; qty: number; foil?: boolean; section?: string }
interface VEntry { id: string; name?: string; qty: number; foil?: number; places?: VPlace[] }
interface VCard { id: string; name?: string; qty: number; proxies?: number; binders?: Refs }
interface VDeck { id: string; ownership?: string; cards: VCard[]; sideboard?: VCard[]; considering?: VCard[]; cameFrom?: (VPlace & { name: string })[] }
interface Sent { real: number; taken: number; toPull: number; added: number }
interface Case {
  name: string
  places: string[]
  collections: { id: string; type: string; entries: VEntry[] }[]
  decks: VDeck[]
  do: { flow: string; from?: string; deck?: string; card: string; qty?: number; to?: { deck?: string; part?: string; binder?: string }; keep?: boolean }
  expect: { collections: Record<string, VEntry[]>; decks: Record<string, Omit<VDeck, 'id'>>; sent?: Sent }
}
const V = JSON.parse(readFileSync(new URL('./moveVectors.json', import.meta.url), 'utf8')) as { cases: Case[] }

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

const cardOf = (e: VCard): DeckCardEntry => ({
  scryfallId: e.id, name: e.name ?? e.id, imageUrl: null, quantity: e.qty, canBeCommander: false, typeLine: null, partnerAbility: null,
  ...(e.proxies !== undefined ? { proxyQuantity: e.proxies } : {}),
  ...(e.binders !== undefined ? { binders: e.binders.map((r) => binderRef(r.id, r.qty, r.foil ?? 0)) } : {}),
})

const deckOf = (d: VDeck): Deck => ({
  id: d.id, name: d.id, commander: null, partnerCommander: null, createdAt: 1, tags: [], gameResults: [], gameMode: 'STANDARD',
  ownership: (d.ownership ?? 'PHYSICAL') as DeckOwnership,
  cards: d.cards.map(cardOf),
  ...(d.sideboard ? { sideboard: d.sideboard.map(cardOf) } : {}),
  ...(d.considering ? { considering: d.considering.map(cardOf) } : {}),
  ...(d.cameFrom ? { cameFrom: d.cameFrom.map((l): CameFrom => ({ name: l.name, ...placeOf(l) })) } : {}),
})

// What's compared, as plain values, the same shapes as the vectors.
const placesShown = (p: CopyPlace[] | undefined) => (p ?? []).map((l) => ({ placeId: l.placeId, qty: l.qty, ...(l.foil ? { foil: true } : {}), ...(l.section ? { section: l.section } : {}) }))
const entryShown = (e: CollectionEntry) => ({ id: e.scryfallId, qty: e.quantity, foil: e.foilQuantity ?? 0, places: placesShown(e.places) })
const wantEntry = (e: VEntry) => ({ id: e.id, qty: e.qty, foil: e.foil ?? 0, places: (e.places ?? []).map(placeOf) })
const cardShown = (e: DeckCardEntry) => ({
  id: e.scryfallId, qty: e.quantity,
  ...(e.proxyQuantity != null ? { proxies: e.proxyQuantity } : {}),
  ...(e.binders != null ? { binders: e.binders.map((r) => ({ id: r.id, qty: r.qty, ...(r.foil ? { foil: r.foil } : {}) })) } : {}),
})
const deckShown = (d: Deck, want: Omit<VDeck, 'id'>) => ({
  ownership: d.ownership,
  cards: d.cards.map(cardShown),
  ...(want.sideboard ? { sideboard: (d.sideboard ?? []).map(cardShown) } : {}),
  ...(want.considering ? { considering: (d.considering ?? []).map(cardShown) } : {}),
  ...(d.cameFrom !== undefined ? { cameFrom: d.cameFrom.map((l) => ({ name: l.name, ...placesShown([l])[0] })) } : {}),
})
const wantDeck = (d: Omit<VDeck, 'id'>, was: Deck) => deckShown(deckOf({ ...d, id: was.id, ownership: d.ownership ?? was.ownership }), d)

const realCopies = (collections: Collection[], decks: Deck[]) => allCardsOf(collections, decks).reduce((n, a) => n + a.total - a.proxies, 0)

function run(c: Case, collections: Collection[], decks: Deck[]): { collections: Collection[]; decks: Deck[]; sent?: Sent } {
  const d = c.do
  const find = (id: string) => decks.find((x) => x.id === id)!
  const put = (out: Deck[], ...changed: (Deck | null)[]) => out.map((x) => changed.find((y) => y?.id === x.id) ?? x)
  switch (d.flow) {
    case 'send': {
      const to: SendTo = d.to!.binder !== undefined ? { binder: d.to!.binder } : { deck: find(d.to!.deck!), part: d.to!.part as DeckPart }
      const r = sendDeckCard(collections, find(d.from!), d.card, d.qty!, to, !!d.keep)
      return { collections: r.collections, decks: put(decks, r.from, r.to), sent: { real: r.real, taken: r.taken, toPull: r.toPull, added: r.added } }
    }
    case 'toSideboard': { const r = toSideboard(collections, find(d.deck!), d.card); return { collections: r.collections, decks: put(decks, r.deck) } }
    case 'toMain': { const r = toMain(collections, find(d.deck!), d.card); return { collections: r.collections, decks: put(decks, r.deck) } }
  }
  throw new Error(`unknown flow ${d.flow}`)
}

for (const c of V.cases) {
  test(`move flows: ${c.name}`, () => {
    const collections = collectionsOf(c)
    const decks = c.decks.map(deckOf)
    const out = run(c, collections, decks)
    const shown = out.collections.filter((x) => x.type !== 'WISHLIST')
    assert.deepEqual(shown.map((x) => x.id).sort(), Object.keys(c.expect.collections).sort())
    for (const col of shown) assert.deepEqual(col.entries.map(entryShown), c.expect.collections[col.id].map(wantEntry), col.id)
    for (const [id, want] of Object.entries(c.expect.decks)) {
      const was = decks.find((x) => x.id === id)!
      assert.deepEqual(deckShown(out.decks.find((x) => x.id === id)!, want), wantDeck(want, was), `deck ${id}`)
    }
    if (c.expect.sent) assert.deepEqual(out.sent, c.expect.sent, 'sent')

    // No copy made or lost (but the ones a deck that holds none of its cards adds to a binder), and every one in exactly one view.
    assert.equal(realCopies(out.collections, out.decks), realCopies(collections, decks) + (c.expect.sent?.added ?? 0), 'copies')
    let inViews = viewTotal(unsortedView(out.collections, out.decks))
    for (const b of out.collections) if (b.type !== 'WISHLIST' && b.id !== 'unsorted') inViews += viewTotal(binderView(b.id, out.collections, out.decks))
    assert.equal(inViews, realCopies(out.collections, out.decks), 'views')
  })
}

// ---- Two devices ----

test('move flows: one device moves a card to another deck while the other edits that deck', () => {
  const card = (id: string, quantity: number, more: Partial<DeckCardEntry> = {}): DeckCardEntry =>
    ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...more })
  const deck = (id: string, cards: DeckCardEntry[]): Deck =>
    ({ id, name: id, commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL' })
  const cols: Collection[] = [{ id: 'b1', name: 'b1', entries: [], createdAt: 1, type: 'OWNED' }, { id: 'unsorted', name: 'unsorted', entries: [], createdAt: 1, type: 'OWNED' }]
  const d1 = deck('d1', [card('sol', 1, { binders: [{ id: 'b1', qty: 1 }] })])
  const d2 = deck('d2', [card('path', 1)])
  const before = realCopies(cols, [d1, d2])

  // Browser A: Sol Ring moved from d1 to d2, its binder with it.
  const a = sendDeckCard(cols, d1, 'sol', 1, { deck: d2, part: 'main' }, false)
  // Browser B: d2's Path put in b1 and one more copy of it added by hand.
  const d2b: Deck = { ...d2, cards: [card('path', 2, { binders: [{ id: 'b1', qty: 1 }] })] }

  const one = mergeDeck(d2, a.to!, d2b, true)
  const other = mergeDeck(d2, d2b, a.to!, false)
  assert.deepEqual(one.cards, other.cards)
  assert.deepEqual(one.cards.find((e) => e.scryfallId === 'sol')!.binders, [{ id: 'b1', qty: 1 }])
  // Sol Ring is in d2 only, still listed in b1; the only new copy is B's Path.
  assert.equal(realCopies(a.collections, [a.from, one]), before + 1)
  assert.deepEqual(binderView('b1', a.collections, [a.from, one]).deckCopies.map((d) => [d.deckId, d.entry.scryfallId]).sort(), [['d2', 'path'], ['d2', 'sol']])
})

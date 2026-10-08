import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PendingReset, RESET_NOTHING, resetConfirmed, resetCounts, resetCountsText, resetLibrary,
} from '../../src/settings/resetCollection.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import type { Library } from '../../src/sync/cloudSync.ts'
import type { Collection, CollectionEntry, Deck } from '../../src/types/models.ts'
import { createSim } from '../sync/harness.ts'

// Settings › Data and speed › Reset collection: what each choice removes and says, Undo, and the sync
// bringing every device to the reset. The Android app's ResetCollectionTest.kt has the same cases.

const card = (id: string, quantity: number, foilQuantity = 0, extra: Partial<CollectionEntry> = {}): CollectionEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, foilQuantity, ...extra })
const binder = (id: string, entries: CollectionEntry[], extra: Partial<Collection> = {}): Collection =>
  ({ id, name: id, entries, createdAt: 1, type: 'OWNED', ...extra })
const deck = (id: string, extra: Partial<Deck> = {}): Deck =>
  ({ id, name: id, commander: null, partnerCommander: null, cards: [], gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL', ...extra })

const place = (id: string) => ({ id, name: id, kind: 'BOX' as const, createdAt: 1 })

function library(): Library {
  return {
    decks: [deck('d1', { gameResults: [{ id: 'g1', result: 'WIN', opponent: null, playedAt: 5 }] }), deck('d2'), deck('s1', { sample: true })],
    collections: [
      binder('unsorted', [card('a', 2, 1, { places: [{ placeId: 'p1', qty: 2 }], forSale: 1 })], {
        name: 'Unsorted',
        storagePlaces: [place('p1'), place('p2')],
        loans: [{ id: 'l1', to: 'Sam', cards: [], lentAt: 1 } as never],
        sealed: [{ id: 's1', name: 'Box', kind: 'PLAY_BOX', count: 1, createdAt: 1 } as never],
        graded: [{ id: 'g1', scryfallId: 'z', name: 'z', company: 'PSA', grade: '10', createdAt: 1 } as never],
        gear: [{ id: 'k1', kind: 'DICE', name: 'Dice', count: 6, createdAt: 1 } as never],
        scanCorrections: [{
          key: 'm:lightnin bolt', kind: 'MISREAD', read: 'Lightnin Bolt', wrongId: 'x', wrongName: 'X',
          scryfallId: 'bolt', name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', count: 1, used: 0, lastUsed: 1,
        }],
        collectionGoals: [{ id: 'goal1', name: 'Shock lands', kind: 'CUSTOM', cards: [{ name: 'Steam Vents', qty: 1 }], createdAt: 1, updatedAt: 1 } as never],
      }),
      binder('wishlist', [card('w', 1)], { type: 'WISHLIST', name: 'Wishlist' }),
      binder('b1', [card('b', 1000), card('c', 399)]),
      binder('b2', []),
      binder('w2', [card('x', 1)], { type: 'WISHLIST' }),
    ],
  }
}

test('Cards only empties the binders and the pile, and keeps everything else', () => {
  const before = library()
  const after = resetLibrary(before, 'cards', 100)
  assert.deepEqual(after.decks, before.decks)
  assert.deepEqual(after.collections.map((c) => [c.id, c.entries.length]), [['unsorted', 0], ['wishlist', 1], ['b1', 0], ['b2', 0], ['w2', 1]])
  const pile = after.collections[0]
  assert.equal(pile.storagePlaces?.length, 2)
  assert.equal(pile.loans?.length, 1)
  assert.equal(pile.sealed?.length, 1)
  assert.equal(pile.graded?.length, 1)
  assert.equal(pile.gear?.length, 1)
  // Collection goals and what the scanner learned stay too.
  assert.equal(pile.collectionGoals?.length, 1)
  assert.equal(pile.scanCorrections?.length, 1)
  assert.deepEqual(after.deleted ?? {}, {})
  // Unchanged binders stay the same objects, so the sync has nothing to send for them.
  assert.equal(after.collections[3], before.collections[3])
})

test('Collection removes binders, places, sealed, graded, gear, loans, goals and learned corrections; the pile and Wishlist stay, empty', () => {
  const after = resetLibrary(library(), 'collection', 100)
  assert.equal(after.decks.length, 3)
  assert.deepEqual(after.collections.map((c) => c.id), ['unsorted', 'wishlist'])
  const [pile, wishlist] = after.collections
  assert.deepEqual([pile.entries, pile.storagePlaces, pile.loans, pile.sealed, pile.graded, pile.gear], [[], [], [], [], [], []])
  assert.deepEqual([pile.collectionGoals, pile.scanCorrections], [[], []])
  assert.deepEqual(wishlist.entries, [])
  // Noted as deleted, as deleting them by hand does, so the sync sends their deletion.
  assert.deepEqual(after.deleted, { 'collection:b1': 100, 'collection:b2': 100, 'collection:w2': 100 })
})

test('Everything removes every deck too, with its games; samples go without being noted', () => {
  const after = resetLibrary(library(), 'everything', 100)
  assert.deepEqual(after.decks, [])
  const pile = after.collections.find((c) => c.id === 'unsorted')!
  assert.deepEqual([pile.collectionGoals, pile.scanCorrections], [[], []])
  assert.deepEqual(Object.keys(after.deleted ?? {}).sort(), ['collection:b1', 'collection:b2', 'collection:w2', 'deck:d1', 'deck:d2'])
})

test('a pile that never had places or loans gets none: absent stays absent', () => {
  const after = resetLibrary({ decks: [], collections: [binder('unsorted', [card('a', 1)])] }, 'collection', 1)
  assert.deepEqual(after.collections[0], binder('unsorted', []))
})

test('what will go, counted and said', () => {
  const lib = library()
  assert.equal(resetCountsText(resetCounts(lib, 'cards')), '1,402 copies in 1 binder')
  assert.equal(resetCountsText(resetCounts(lib, 'collection')), '1,402 copies in 3 binders · 2 wishlist cards · 2 places · 1 sealed · 1 graded · 1 piece of gear · 1 loan · 1 goal')
  assert.equal(resetCountsText(resetCounts(lib, 'everything')), '1,402 copies in 3 binders · 2 wishlist cards · 2 places · 1 sealed · 1 graded · 1 piece of gear · 1 loan · 1 goal · 3 decks')
  assert.equal(resetCountsText(resetCounts({ decks: [], collections: [binder('unsorted', [])] }, 'everything')), RESET_NOTHING)
  assert.equal(resetCountsText(resetCounts({ decks: [], collections: [binder('unsorted', [card('a', 1)])] }, 'cards')), '1 copy')
})

test('RESET in any case enables Reset', () => {
  assert.equal(resetConfirmed('reset'), true)
  assert.equal(resetConfirmed(' ReSeT '), true)
  assert.equal(resetConfirmed('rese'), false)
  assert.equal(resetConfirmed(''), false)
})

test('Undo gives back the very library from before; after a commit there is nothing to undo', () => {
  const before = library()
  const pending = new PendingReset('everything', before, 10_000)
  assert.equal(pending.undo(), before)
  assert.equal(pending.undo(), null)
  assert.equal(pending.commit(), false)

  const committed = new PendingReset('cards', before, 10_000)
  assert.equal(committed.commit(), true)
  assert.equal(committed.commit(), false)
  assert.equal(committed.undo(), null)
})

test('an emptied pile merged with an older copy from another device stays empty', () => {
  const base = library().collections[0]
  const mine = resetLibrary(library(), 'collection', 1).collections[0]
  // The other device changed a count and a place since: the removal still wins.
  const theirs = { ...base, entries: [card('a', 5, 1)], storagePlaces: [{ ...place('p1'), name: 'Red box' }, place('p2')] }
  for (const minePreferred of [true, false]) {
    const merged = mergeCollection(base, mine, theirs, minePreferred)
    assert.deepEqual(merged.entries, [])
    assert.deepEqual(merged.storagePlaces, [])
    assert.deepEqual([merged.loans, merged.sealed, merged.graded, merged.gear], [[], [], [], []])
    assert.deepEqual([merged.collectionGoals, merged.scanCorrections], [[], []])
    // And the same seen from the other device.
    assert.deepEqual(mergeCollection(base, theirs, mine, !minePreferred).entries, [])
  }
})

for (const cas of [false, true]) {
  const server = cas ? 'compare-and-swap' : 'old'
  // Made inside each test: a simulated world takes over fetch and localStorage.
  let sim = createSim(cas)
  const binderCards = (dev: string, id: string) => sim.library(dev).collections.find((c) => c.id === id)?.entries.map((e) => e.scryfallId + e.quantity).join(',') ?? '(none)'
  const setUp = async () => {
    sim = createSim(cas)
    sim.reset('A', 'B')
    sim.setLibrary('A', {
      decks: [deck('d1'), deck('d2')],
      collections: [binder('unsorted', [card('a', 2)], { storagePlaces: [place('p1')] }), binder('wishlist', [card('w', 1)], { type: 'WISHLIST' }), binder('b1', [card('b', 3)])],
    })
    await sim.settle('A', 'B')
    assert.equal(binderCards('B', 'b1'), 'b3')
  }

  test(`after Everything, the other device converges and nothing comes back (${server} server)`, async () => {
    await setUp()
    sim.setLibrary('A', resetLibrary(sim.library('A'), 'everything'))
    await sim.settle('A', 'B')
    for (const dev of ['A', 'B']) {
      assert.deepEqual(sim.library(dev).decks, [], dev)
      assert.deepEqual(sim.library(dev).collections.map((c) => c.id).sort(), ['unsorted', 'wishlist'], dev)
      assert.equal(binderCards(dev, 'unsorted'), '', dev)
      assert.equal(binderCards(dev, 'wishlist'), '', dev)
      assert.deepEqual(sim.library(dev).collections.find((c) => c.id === 'unsorted')?.storagePlaces, [], dev)
    }
    assert.equal(sim.server('d1'), '(deleted)')
    assert.equal(sim.collectionRow('b1')?.deleted, true)
  })

  test(`a device that touched the cards before syncing doesn't bring them back (${server} server)`, async () => {
    await setUp()
    sim.setLibrary('A', resetLibrary(sim.library('A'), 'cards'))
    // B, not yet synced, adds a copy of a card A's reset removed, and a new card.
    sim.setLibrary('B', {
      ...sim.library('B'),
      collections: sim.library('B').collections.map((c) => (c.id === 'b1' ? { ...c, entries: [card('b', 4), card('n', 1)] } : c)),
    })
    await sim.pass('A')
    await sim.settle('B', 'A')
    for (const dev of ['A', 'B']) {
      // The reset's cards stay gone; the card added elsewhere meanwhile is kept.
      assert.equal(binderCards(dev, 'b1'), 'n1', dev)
      assert.equal(binderCards(dev, 'unsorted'), '', dev)
      assert.equal(sim.library(dev).decks.length, 2, dev)
    }
  })

  test(`a reset made offline goes when back online, and still wins (${server} server)`, async () => {
    await setUp()
    sim.setLibrary('A', resetLibrary(sim.library('A'), 'collection'))
    // Offline: the edits are noted with their time, nothing reaches the server.
    sim.recordEdits('A')
    sim.hooks.failPush = true
    await sim.pass('A')
    assert.equal(sim.collectionRow('b1')?.deleted, false)
    await sim.settle('A', 'B')
    for (const dev of ['A', 'B']) {
      assert.deepEqual(sim.library(dev).collections.map((c) => c.id).sort(), ['unsorted', 'wishlist'], dev)
      assert.equal(binderCards(dev, 'unsorted'), '', dev)
      assert.equal(sim.library(dev).decks.length, 2, dev)
    }
  })

  test(`decks reset away stay deleted when a pass takes in another device's edit and then can't push (${server} server)`, async () => {
    await setUp()
    sim.setLibrary('A', resetLibrary(sim.library('A'), 'everything'))
    // B adds a card to the pile and sends it; A's next pass takes that in, then its push fails.
    sim.setLibrary('B', { ...sim.library('B'), collections: sim.library('B').collections.map((c) => (c.id === 'unsorted' ? { ...c, entries: [...c.entries, card('n', 1)] } : c)) })
    await sim.pass('B')
    sim.hooks.failPush = true
    await sim.pass('A')
    await sim.settle('A', 'B')
    for (const dev of ['A', 'B']) {
      assert.deepEqual(sim.library(dev).decks, [], dev)
      assert.equal(binderCards(dev, 'unsorted'), 'n1', dev)
    }
  })

  test(`Undo before anything was sent leaves every device as it was (${server} server)`, async () => {
    await setUp()
    const before = sim.library('A')
    const pending = new PendingReset('everything', before, 0)
    sim.setLibrary('A', resetLibrary(before, 'everything'))
    // The sync is held back while Undo is offered; Undo puts the library back.
    sim.setLibrary('A', pending.undo()!)
    await sim.settle('A', 'B')
    assert.equal(sim.library('A'), before)
    assert.equal(binderCards('B', 'b1'), 'b3')
    assert.equal(sim.library('B').decks.length, 2)
    assert.equal(sim.server('d1'), '')
  })
}

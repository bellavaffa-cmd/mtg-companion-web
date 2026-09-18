// Sync scenarios: two or three devices editing, syncing, failing and racing, checked against what
// each device and the server end up with. Run against both servers (see sync.test.ts and
// sync-cas.test.ts). The Android app's SyncCoreTest.kt runs the same cases.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSim, sortedCards } from './harness.ts'

export function syncScenarios(cas: boolean) {
  const sim = createSim(cas)
  const casOnly = cas ? {} : { skip: 'needs push_library_items_v2 (compare-and-swap)' }

  test('an edit made twice in a row counts once', async () => {
    sim.reset('A')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A')
    sim.setDeck('A', 'd1', [['x', 2]]); await sim.pass('A')
    sim.setDeck('A', 'd1', [['x', 3]]); await sim.pass('A'); await sim.pass('A')
    assert.equal(sim.show('A'), 'x3')
    assert.equal(sim.server(), 'x3')
  })

  test("another device's edit merges with ours, and ours counts once", async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('A', 'd1', [['x', 2]]); await sim.pass('A')
    sim.setDeck('B', 'd1', [['x', 1], ['y', 1]]); await sim.pass('B')
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x2,y1')
    assert.equal(sim.show('B'), 'x2,y1')
  })

  test('a push that fails after a pull keeps what was pulled', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('B', 'd1', [['x', 1], ['y', 1]]); await sim.pass('B')
    sim.setDeck('A', 'd2', [['q', 1]]) // something for A to push
    sim.hooks.failPush = true; await sim.pass('A')
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x1,y1')
    assert.equal(sim.server(), 'x1,y1')
  })

  test('an edit made while a sync is running is merged with what it pulled', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('B', 'd1', [['x', 1], ['y', 1]]); await sim.pass('B')
    await sim.pass('A', (lib) => ({ ...lib, decks: lib.decks.map((d) => ({ ...d, cards: [...d.cards, { ...d.cards[0], scryfallId: 'z', name: 'z' }] })) }))
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x1,y1,z1')
    assert.equal(sim.show('B'), 'x1,y1,z1')
  })

  test('a commander change survives the server reordering keys', async () => {
    sim.reset('A', 'B')
    const commander = (name: string) => ({ scryfallId: name, name, imageUrl: null, quantity: 1, canBeCommander: true, typeLine: 'Legendary Creature' })
    sim.setDeck('A', 'd1', [['x', 1]], { commander: commander('old') }); await sim.settle('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]], { commander: commander('new') })
    await sim.sleep()
    sim.setDeck('B', 'd1', [['x', 1], ['y', 1]], { commander: sim.library('B').decks[0].commander }); await sim.pass('B')
    await sim.settle('A', 'B')
    assert.equal(sim.library('A').decks[0].commander?.name, 'new')
    assert.equal(sim.library('B').decks[0].commander?.name, 'new')
    assert.equal(sim.show('A'), 'x1,y1')
  })

  test('an edit from a device whose clock is behind still gets through', async () => {
    sim.reset('A', 'B')
    sim.setDeck('B', 'd1', [['x', 1]]); await sim.settle('B', 'A')
    sim.skew.A = -60_000
    sim.setDeck('A', 'd1', [['x', 1], ['z', 1]])
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x1,z1')
    assert.equal(sim.server(), 'x1,z1')
    assert.equal(sim.show('B'), 'x1,z1')
  })

  test('a card removed then added back is not doubled; a deleted deck goes everywhere', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1], ['y', 1]]); await sim.settle('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A')
    sim.setDeck('A', 'd1', [['x', 1], ['y', 1]]); await sim.pass('A')
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x1,y1')
    assert.equal(sim.show('B'), 'x1,y1')
    sim.removeDeck('B', 'd1'); await sim.settle('B', 'A')
    assert.equal(sim.show('A'), '(none)')
    assert.equal(sim.server(), '(deleted)')
  })

  test('a row whose push committed late is still pulled', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('B', 'd2', [['q', 1]]); await sim.pass('B'); await sim.pass('B') // B's cursor moves past everything
    sim.backdate('d1', 3, (row) => {
      row.data = { ...row.data, cards: [...(row.data!.cards as object[]), { scryfallId: 'late', name: 'late', imageUrl: null, quantity: 1 }] }
      row.edited_ms = Date.now()
    })
    await sim.settle('B')
    assert.equal(sim.show('B'), 'x1,late1')
  })

  test('a partly skipped push, then another device building on the part that landed', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); sim.setDeck('A', 'd2', [['q', 1]]); await sim.settle('A', 'B')
    sim.setDeck('A', 'd1', [['x', 2]]); sim.setDeck('A', 'd2', [['q', 1], ['r', 1]])
    sim.recordEdits('A'); await sim.sleep()
    sim.hooks.beforePush = async () => { sim.setDeck('B', 'd2', [['q', 1], ['s', 1]]); await sim.pass('B') }
    await sim.pass('A')
    await sim.pass('B'); sim.setDeck('B', 'd1', [...sim.cards('B'), ['y', 1]]); await sim.pass('B')
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x2,y1')
    assert.equal(sim.server(), 'x2,y1')
    assert.equal(sim.show('A', 'd2'), 'q1,r1,s1')
  })

  test('a lost push answer, then another device building on it: counts once', casOnly, async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('A', 'd1', [['x', 2]]); sim.hooks.loseResponse = true; await sim.pass('A')
    await sim.pass('B'); sim.setDeck('B', 'd1', [...sim.cards('B'), ['y', 1]]); await sim.pass('B')
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x2,y1')
    assert.equal(sim.server(), 'x2,y1')
  })

  test('a lost push answer on a single device counts once', async () => {
    sim.reset('A')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A')
    sim.setDeck('A', 'd1', [['x', 2]]); sim.hooks.loseResponse = true; await sim.pass('A')
    await sim.settle('A')
    assert.equal(sim.show('A'), 'x2')
    assert.equal(sim.server(), 'x2')
  })

  test('two devices syncing the same deck at once keep both edits', casOnly, async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1], ['a', 1]]); sim.setDeck('B', 'd1', [['x', 1], ['b', 1]])
    sim.recordEdits('A'); await sim.sleep(); sim.recordEdits('B')
    const pulledA = await sim.pullPhase('A'); await sim.sleep()
    const pulledB = await sim.pullPhase('B')
    await sim.pushPhase('A', pulledA)
    await sim.pushPhase('B', pulledB)
    await sim.settle('A', 'B')
    assert.equal(sortedCards(sim.show('A')), 'a1,b1,x1')
    assert.equal(sortedCards(sim.server()), 'a1,b1,x1')
  })

  test('two devices merging onto the same timestamp keep both edits', casOnly, async () => {
    sim.reset('A', 'B', 'C')
    sim.setDeck('C', 'd1', [['x', 1]]); await sim.settle('C', 'A', 'B')
    sim.skew.A = -120_000; sim.skew.B = -120_000
    sim.setDeck('A', 'd1', [['x', 1], ['a', 1]]); sim.setDeck('B', 'd1', [['x', 1], ['b', 1]])
    sim.recordEdits('A'); sim.recordEdits('B')
    sim.setDeck('C', 'd1', [['x', 1], ['c', 1]]); await sim.pass('C')
    const pulledB = await sim.pullPhase('B')
    await sim.pass('A')
    await sim.pushPhase('B', pulledB)
    await sim.settle('A', 'B', 'C')
    assert.equal(sortedCards(sim.server()), 'a1,b1,c1,x1')
  })

  test('the same deck already on two devices, synced for the first time at once, keeps both', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1], ['a', 1]]); sim.setDeck('B', 'd1', [['x', 1], ['b', 1]])
    sim.setDeck('B', 'd9', [['z', 1]])
    const pulledB = await sim.pullPhase('B')
    await sim.sleep()
    await sim.pass('A')
    await sim.pushPhase('B', pulledB)
    await sim.settle('A', 'B')
    assert.equal(sortedCards(sim.show('B')), 'a1,b1,x1')
    assert.equal(sortedCards(sim.server()), 'a1,b1,x1')
  })

  test('reading back our own write keeps the card order', async () => {
    sim.reset('A')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A')
    sim.setDeck('A', 'd1', [['x', 1], ['z', 1], ['a', 1]]); await sim.pass('A')
    assert.equal(sim.show('A'), 'x1,z1,a1')
  })

  test('a deletion re-read from the overlap stays deleted', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.removeDeck('B', 'd1'); await sim.pass('B')
    await sim.pass('A'); await sim.pass('A')
    assert.equal(sim.show('A'), '(none)')
    assert.equal(sim.server(), '(deleted)')
  })

  test('a tab closed after applying a pull, before saving it, loses nothing', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('B', 'd1', [['x', 1], ['y', 1]]); await sim.pass('B')
    sim.recordEdits('A')
    const snapshot = sim.library('A')
    const pulled = await sim.cs.pullChanges(snapshot, sim.cs.loadCloudState(), 'u', 't')
    sim.setLibrary('A', sim.cs.applyRemoteChanges(snapshot, snapshot, pulled.remoteChanges)) // ...and the tab closes
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x1,y1')
    assert.equal(sim.show('B'), 'x1,y1')
    assert.equal(sim.server(), 'x1,y1')
  })

  // ---- Signing out and back in ----

  /** A session ending on its own: kept edits captured, then the library and its bookkeeping removed. */
  const sessionEnds = (dev: string) => {
    sim.recordEdits(dev)
    const rescue = sim.cs.captureRescue(sim.library(dev), sim.cs.loadCloudState(), 'u', Date.now())
    sim.cs.clearCloudState()
    sim.setLibrary(dev, { decks: [], collections: [] })
    return rescue
  }
  /** Signing back in: the first pass pulls the account's library, then the kept edits go back in. */
  const signBackIn = async (dev: string, rescue: ReturnType<typeof sessionEnds>) => {
    await sim.pass(dev)
    if (rescue) sim.setLibrary(dev, sim.cs.applyRescue(sim.library(dev), rescue))
    await sim.pass(dev)
  }

  test("an edit that hadn't synced when the session ended is put back on signing in", async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); await sim.settle('A', 'B')
    sim.setDeck('A', 'd1', [['x', 2]]) // not synced yet...
    const rescue = sessionEnds('A') // ...when the server ends the session
    assert.ok(rescue, 'the unsynced edit is kept')
    sim.setDeck('B', 'd1', [['x', 1], ['y', 1]]); await sim.pass('B') // meanwhile, on another device
    await signBackIn('A', rescue)
    await sim.settle('A', 'B')
    assert.equal(sim.show('A'), 'x2,y1')
    assert.equal(sim.show('B'), 'x2,y1')
    assert.equal(sim.server(), 'x2,y1')
  })

  test('a deletion kept through a sign-out goes through, unless the deck changed elsewhere meanwhile', async () => {
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]]); sim.setDeck('A', 'd2', [['q', 1]]); await sim.settle('A', 'B')
    sim.removeDeck('A', 'd1'); sim.removeDeck('A', 'd2')
    const rescue = sessionEnds('A')
    sim.setDeck('B', 'd2', [['q', 1], ['r', 1]]); await sim.pass('B') // d2 edited elsewhere; d1 untouched
    await signBackIn('A', rescue)
    await sim.settle('A', 'B')
    assert.equal(sim.show('A', 'd1'), '(none)')
    assert.equal(sim.server('d1'), '(deleted)')
    assert.equal(sim.show('A', 'd2'), 'q1,r1')
  })

  test('a sign-out cut short (library half-removed) pushes no deletions on signing in again', async () => {
    sim.reset('A')
    sim.setDeck('A', 'd1', [['x', 1]]); sim.setDeck('A', 'd2', [['q', 1]]); await sim.settle('A')
    sim.use('A'); sim.cs.clearCloudState() // bookkeeping goes first...
    sim.removeDeck('A', 'd1') // ...and the tab closes halfway through removing the library
    await sim.settle('A')
    assert.equal(sim.server('d1'), 'x1')
    assert.equal(sim.server('d2'), 'q1')
    assert.equal(sim.show('A', 'd1'), 'x1')
  })

  test('whose library is it', () => {
    assert.equal(sim.cs.libraryIsAnotherAccounts(null, 'u'), false) // never synced: the browser's own
    assert.equal(sim.cs.libraryIsAnotherAccounts('u', 'u'), false)
    assert.equal(sim.cs.libraryIsAnotherAccounts('v', 'u'), true)
    assert.equal(sim.cs.libraryIsAnotherAccounts('v', null), true)
    assert.equal(sim.cs.leftoverFromSignOut(false, 'u', false), true) // nobody signed in, yet an account's library
    assert.equal(sim.cs.leftoverFromSignOut(true, 'u', false), false)
    assert.equal(sim.cs.leftoverFromSignOut(false, null, false), false)
    assert.equal(sim.cs.leftoverFromSignOut(false, 'u', true), false) // waiting on "this browser already has a library"
  })
}

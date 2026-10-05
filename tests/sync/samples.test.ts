// Samples from the welcome flow never reach the account: not on the first sync, not after an edit,
// and removing them isn't a deletion anyone else hears about. The Android app's SyncCoreTest.kt has
// the same case ("samples never go to the account").
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSim } from './harness.ts'
import { withoutSamples } from '../../src/onboarding/onboarding.ts'

for (const cas of [false, true]) {
  test(`samples never go to the account (${cas ? 'compare-and-swap' : 'old'} server)`, async () => {
    const sim = createSim(cas)
    sim.reset('A', 'B')
    sim.setDeck('A', 'd1', [['x', 1]])
    sim.setDeck('A', 's1', [['y', 2]], { sample: true })
    sim.setLibrary('A', { ...sim.library('A'), collections: [{ id: 's2', name: 'Sample binder', entries: [], createdAt: 1, type: 'OWNED', sample: true }] })
    await sim.settle('A', 'B')

    assert.equal(sim.server('d1'), 'x1')
    assert.equal(sim.server('s1'), '(none)')
    assert.equal(sim.collectionRow('s2'), undefined)
    // The sample stays where it was made, and only there.
    assert.equal(sim.show('A', 's1'), 'y2')
    assert.equal(sim.show('B', 's1'), '(none)')
    assert.equal(sim.show('B', 'd1'), 'x1')

    // Played with, it still stays put.
    sim.setDeck('A', 's1', [['y', 3]], { sample: true })
    await sim.settle('A')
    assert.equal(sim.server('s1'), '(none)')
    assert.equal(sim.show('A', 's1'), 'y3')

    // "Remove samples": nothing to push, and the real deck is untouched everywhere.
    sim.setLibrary('A', withoutSamples(sim.library('A')))
    await sim.settle('A', 'B')
    assert.equal(sim.server('s1'), '(none)')
    assert.equal(sim.server('d1'), 'x1')
    assert.equal(sim.show('A', 'd1'), 'x1')
    assert.equal(Object.keys(sim.cloudState('A')?.items ?? {}).some((k) => k.includes('s1') || k.includes('s2')), false)
  })
}

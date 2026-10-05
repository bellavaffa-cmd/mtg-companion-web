// The welcome flow's steps and the sample content. The Android app's OnboardingTest.kt has the same
// cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  firstStepToDo, isSample, libraryFacts, nextStep, parseWelcomeState, pickSamplePrecon, sampleBinderPicks, sampleDeckName,
  shouldOpenWelcome, showGetStarted, stepDone, stepsToDo, syncable, welcomeStateJson, withoutSamples, type WelcomeFacts,
} from '../../src/onboarding/onboarding.ts'
import type { Collection, Deck } from '../../src/types/models.ts'

const facts = (over: Partial<WelcomeFacts> = {}): WelcomeFacts =>
  ({ cards: 0, decks: 0, samples: false, accountsAvailable: true, signedIn: false, hasProfile: false, ...over })

const deck = (id: string, sample = false) =>
  ({ id, name: id, commander: null, partnerCommander: null, cards: [], gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'VIRTUAL', ...(sample ? { sample: true } : {}) }) as Deck
const binder = (id: string, copies: number, extra: Partial<Collection> = {}) =>
  ({ id, name: id, createdAt: 1, type: 'OWNED', entries: copies ? [{ scryfallId: 'x', name: 'X', imageUrl: null, quantity: copies, foilQuantity: 1 }] : [], ...extra }) as Collection

test('each step is done by what the library and account hold', () => {
  assert.equal(stepDone('collection', facts()), false)
  assert.equal(stepDone('collection', facts({ cards: 3 })), true)
  assert.equal(stepDone('deck', facts({ decks: 1 })), true)
  // Signed in is not enough: friends need a username.
  assert.equal(stepDone('account', facts({ signedIn: true })), false)
  assert.equal(stepDone('account', facts({ signedIn: true, hasProfile: true })), true)
  // A build without accounts has nothing to do there.
  assert.equal(stepDone('account', facts({ accountsAvailable: false })), true)
  assert.equal(stepDone('done', facts({ cards: 1, decks: 1, signedIn: true, hasProfile: true })), false)
})

test('the steps still to do, and where a resumed flow opens', () => {
  assert.deepEqual(stepsToDo(facts()), ['collection', 'deck', 'account'])
  assert.deepEqual(stepsToDo(facts({ cards: 5 })), ['deck', 'account'])
  assert.equal(firstStepToDo(facts({ cards: 5 })), 'deck')
  assert.equal(firstStepToDo(facts({ cards: 5, decks: 1, signedIn: true, hasProfile: true })), 'done')
  assert.equal(nextStep('collection'), 'deck')
  assert.equal(nextStep('account'), 'done')
  assert.equal(nextStep('done'), 'done')
})

test('the flow opens by itself only once, on a first open with an empty library', () => {
  const fresh = { finished: null, opened: false } as const
  assert.equal(shouldOpenWelcome(fresh, facts()), true)
  assert.equal(shouldOpenWelcome({ ...fresh, opened: true }, facts()), false)
  assert.equal(shouldOpenWelcome({ ...fresh, finished: 'skipped' }, facts()), false)
  assert.equal(shouldOpenWelcome({ ...fresh, finished: 'done' }, facts()), false)
  // Someone who already has decks or cards (an update, a second device) isn't interrupted…
  assert.equal(shouldOpenWelcome(fresh, facts({ decks: 2 })), false)
  assert.equal(shouldOpenWelcome(fresh, facts({ cards: 1 })), false)
  // …nor is someone signed in whose library hasn't come down yet.
  assert.equal(shouldOpenWelcome(fresh, facts({ signedIn: true })), false)
  // Samples aren't the user's own: Home still offers to get started.
  assert.equal(showGetStarted(facts({ samples: true })), true)
  assert.equal(showGetStarted(facts({ decks: 1 })), false)
})

test('what the flow remembers reads back, and anything else reads as new', () => {
  assert.deepEqual(parseWelcomeState(welcomeStateJson({ finished: 'skipped', opened: true })), { finished: 'skipped', opened: true })
  assert.deepEqual(parseWelcomeState(welcomeStateJson({ finished: 'done', opened: false })), { finished: 'done', opened: false })
  assert.deepEqual(parseWelcomeState(welcomeStateJson({ finished: null, opened: true })), { finished: null, opened: true })
  assert.deepEqual(parseWelcomeState(null), { finished: null, opened: false })
  assert.deepEqual(parseWelcomeState('{not json'), { finished: null, opened: false })
  assert.deepEqual(parseWelcomeState('{"finished":"maybe","opened":"yes"}'), { finished: null, opened: false })
})

test('library facts leave out samples and the Wishlist', () => {
  const decks = [deck('d1'), deck('s1', true)]
  const collections = [
    binder('b1', 2), // 2 + 1 foil
    binder('unsorted', 1), // the pile counts: they're cards the user owns
    binder('wishlist', 4, { type: 'WISHLIST' }),
    binder('s2', 9, { sample: true }),
  ]
  assert.deepEqual(libraryFacts(decks, collections), { cards: 5, decks: 1, samples: true })
  assert.deepEqual(libraryFacts([], [binder('wishlist', 0, { type: 'WISHLIST' })]), { cards: 0, decks: 0, samples: false })
})

test('samples are flagged, removed together, and never synced', () => {
  const lib = { decks: [deck('d1'), deck('s1', true)], collections: [binder('b1', 1), binder('s2', 1, { sample: true })] }
  assert.equal(isSample(lib.decks[1]), true)
  assert.equal(isSample(lib.decks[0]), false)
  assert.deepEqual(withoutSamples(lib).decks.map((d) => d.id), ['d1'])
  assert.deepEqual(withoutSamples(lib).collections.map((c) => c.id), ['b1'])
  assert.deepEqual(syncable(lib.decks).map((d) => d.id), ['d1'])
  assert.deepEqual(syncable(lib.collections).map((c) => c.id), ['b1'])
})

test('the sample precon is a well-known one when it is there, else the newest', () => {
  const list = [{ name: 'Brand New Precon' }, { name: 'Lorehold Legacies' }, { name: 'Elven Empire' }]
  assert.equal(pickSamplePrecon(list)?.name, 'Elven Empire')
  assert.equal(pickSamplePrecon([{ name: 'Brand New Precon' }, { name: 'Lorehold Legacies' }])?.name, 'Lorehold Legacies')
  assert.equal(pickSamplePrecon([{ name: 'Brand New Precon' }, { name: 'Older' }])?.name, 'Brand New Precon')
  assert.equal(pickSamplePrecon([]), null)
  assert.equal(sampleDeckName('Elven Empire'), 'Sample: Elven Empire')
})

test('the sample binder takes different cards, not basics or the commander', () => {
  const cards = [
    { scryfallId: 'c', name: 'Lathril, Blade of the Elves', typeLine: 'Legendary Creature — Elf Noble' },
    { scryfallId: 'f', name: 'Forest', typeLine: 'Basic Land — Forest' },
    { scryfallId: 'g', name: 'Snow-Covered Forest', typeLine: 'Basic Snow Land — Forest' },
    { scryfallId: 'a', name: 'Arcane Signet', typeLine: 'Artifact' },
    { scryfallId: 'a2', name: 'Arcane Signet', typeLine: 'Artifact' },
    { scryfallId: 's', name: 'Sol Ring', typeLine: 'Artifact' },
    { scryfallId: 'e', name: 'Elvish Archdruid', typeLine: 'Creature — Elf Druid' },
  ]
  assert.deepEqual(sampleBinderPicks(cards, ['c']).map((c) => c.scryfallId), ['a', 's', 'e'])
  assert.deepEqual(sampleBinderPicks(cards, ['c'], 2).map((c) => c.scryfallId), ['a', 's'])
})

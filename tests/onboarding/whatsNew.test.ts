import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTourSeen, shouldShowTour, TOUR_ID, TOUR_STEPS, tourEyebrow, tourNextLabel, tourSteps } from '../../src/onboarding/whatsNew.ts'

// The What's new tour: when it opens by itself, and its steps. The Android app has the same cases —
// see WhatsNewTest.kt.

test('shown once, to someone with a collection', () => {
  assert.equal(shouldShowTour(null, { cards: 10, decks: 0 }), true)
  assert.equal(shouldShowTour(null, { cards: 0, decks: 2 }), true)
  assert.equal(shouldShowTour(TOUR_ID, { cards: 10, decks: 2 }), false)
  // An older tour seen: this one is new.
  assert.equal(shouldShowTour('older-tour', { cards: 10, decks: 2 }), true)
  // Nothing yet: the welcome steps come first.
  assert.equal(shouldShowTour(null, { cards: 0, decks: 0 }), false)
})

test('the seen id as stored', () => {
  assert.equal(parseTourSeen(null), null)
  assert.equal(parseTourSeen('  '), null)
  assert.equal(parseTourSeen(TOUR_ID), TOUR_ID)
})

test('steps, their counter and buttons', () => {
  assert.equal(TOUR_STEPS.length, 5)
  assert.equal(tourEyebrow(1, 5), 'New · 2 of 5')
  assert.equal(tourNextLabel(0, 5), 'Next')
  assert.equal(tourNextLabel(4, 5), 'Done')
  assert.equal(tourSteps(false)[1].cta?.label, 'Set it up')
  assert.equal(tourSteps(true)[1].cta, undefined)
  assert.equal(tourSteps(true)[2].cta?.label, 'Try it')
  assert.equal(TOUR_STEPS[1].title, 'Know where every card is')
})

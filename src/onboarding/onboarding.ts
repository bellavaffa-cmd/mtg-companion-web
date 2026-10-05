// The welcome flow and sample content: which steps are still to do, when the flow opens by itself,
// and the sample deck and binder — what they hold, and keeping them out of the sync. No storage or
// network here; WelcomePage and the Home "Get started" card use it. Mirrors the Android app's
// data/Onboarding.kt, and tests/onboarding/onboarding.test.ts has the same cases as its
// OnboardingTest.kt.

import type { Collection, Deck } from '../types/models'

/** The welcome flow's steps, in order. */
export type WelcomeStep = 'collection' | 'deck' | 'account' | 'done'
export const WELCOME_STEPS: WelcomeStep[] = ['collection', 'deck', 'account', 'done']

/** The steps that can be left for later and picked up from Home. */
const RESUMABLE: WelcomeStep[] = ['collection', 'deck', 'account']

/** What the welcome flow remembers on this device. */
export interface WelcomeState {
  /** 'done' once the last step was reached, 'skipped' when the user left it early; null before either. */
  finished: 'done' | 'skipped' | null
  /**
   * It has opened by itself once. It doesn't again — someone who wandered off to scan a card comes
   * back to Home, whose "Get started" card picks up where they were.
   */
  opened: boolean
}

export const WELCOME_NEW: WelcomeState = { finished: null, opened: false }

/** The stored form; anything unreadable reads as never opened. */
export function parseWelcomeState(raw: string | null | undefined): WelcomeState {
  if (!raw) return WELCOME_NEW
  try {
    const value = JSON.parse(raw) as { finished?: unknown; opened?: unknown }
    return {
      finished: value.finished === 'done' || value.finished === 'skipped' ? value.finished : null,
      opened: value.opened === true,
    }
  } catch {
    return WELCOME_NEW
  }
}

export const welcomeStateJson = (state: WelcomeState): string => JSON.stringify({ finished: state.finished, opened: state.opened })

/** What the steps look at: the user's own decks and cards (samples aside) and their account. */
export interface WelcomeFacts {
  /** Copies in the user's binders and the Unsorted pile; not the Wishlist, not samples. */
  cards: number
  /** Decks, not counting samples. */
  decks: number
  /** Whether a sample deck or binder is in the library. */
  samples: boolean
  /** False when this build has no accounts: the account step is then nothing to do. */
  accountsAvailable: boolean
  signedIn: boolean
  /** Signed in with a username picked (the social profile). */
  hasProfile: boolean
}

export const isSample = (item: { sample?: boolean | null }): boolean => item.sample === true

/** The library facts the steps need, from the decks and binders. */
export function libraryFacts(decks: Deck[], collections: Collection[]): Pick<WelcomeFacts, 'cards' | 'decks' | 'samples'> {
  const cards = collections
    .filter((c) => !isSample(c) && c.type !== 'WISHLIST')
    .reduce((n, c) => n + c.entries.reduce((m, e) => m + e.quantity + e.foilQuantity, 0), 0)
  return {
    cards,
    decks: decks.filter((d) => !isSample(d)).length,
    samples: decks.some(isSample) || collections.some(isSample),
  }
}

/** Whether [step] needs nothing more from the user. "Done" is never done: it's where the flow ends. */
export function stepDone(step: WelcomeStep, facts: WelcomeFacts): boolean {
  switch (step) {
    case 'collection': return facts.cards > 0
    case 'deck': return facts.decks > 0
    case 'account': return !facts.accountsAvailable || (facts.signedIn && facts.hasProfile)
    case 'done': return false
  }
}

/** A library with nothing of the user's own in it yet. Samples don't count. */
export const isEmptyLibrary = (facts: Pick<WelcomeFacts, 'cards' | 'decks'>): boolean => facts.cards === 0 && facts.decks === 0

/**
 * Whether the welcome flow opens by itself: once, on a first open, signed out, with nothing in the
 * library. Someone who already has decks or cards, or is signed in (an update, a second device whose
 * library hasn't come down yet), never gets it unasked.
 */
export const shouldOpenWelcome = (state: WelcomeState, facts: WelcomeFacts): boolean =>
  state.finished === null && !state.opened && !facts.signedIn && isEmptyLibrary(facts)

/** Whether Home shows the "Get started" card instead of its empty widgets. */
export const showGetStarted = (facts: WelcomeFacts): boolean => isEmptyLibrary(facts)

/** The steps still to do, in order — what "Get started" offers to pick up. */
export const stepsToDo = (facts: WelcomeFacts): WelcomeStep[] => RESUMABLE.filter((s) => !stepDone(s, facts))

/** Where the flow opens when resumed: the first step not done, or the end. */
export const firstStepToDo = (facts: WelcomeFacts): WelcomeStep => stepsToDo(facts)[0] ?? 'done'

/** The step after [step]; "done" stays put. */
export function nextStep(step: WelcomeStep): WelcomeStep {
  const i = WELCOME_STEPS.indexOf(step)
  return WELCOME_STEPS[Math.min(i + 1, WELCOME_STEPS.length - 1)]
}

// ---- Sample content ----

/**
 * The precons the sample deck is taken from, best first: well-known lists that MTGJSON has. When none
 * of them is there, the newest precon is used.
 */
export const SAMPLE_PRECONS = ['Elven Empire', 'Draconic Dissent', 'Lorehold Legacies']

/** The precon to use from the [list] (newest first, as the precons page lists them); null for an empty list. */
export function pickSamplePrecon<T extends { name: string }>(list: T[]): T | null {
  for (const name of SAMPLE_PRECONS) {
    const found = list.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (found) return found
  }
  return list[0] ?? null
}

/** The sample deck's name: the precon's, clearly marked. */
export const sampleDeckName = (preconName: string): string => `Sample: ${preconName}`
export const SAMPLE_BINDER_NAME = 'Sample binder'
/** How many cards the sample binder holds. */
export const SAMPLE_BINDER_SIZE = 12

const BASIC_LANDS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'])

/**
 * The cards for the sample binder, from the sample deck's: the first [size] different ones that
 * aren't basic lands or the commanders, so it looks like a binder rather than a pile of Forests.
 */
export function sampleBinderPicks<T extends { scryfallId: string; name: string; typeLine?: string | null }>(
  cards: T[], commanderIds: string[] = [], size = SAMPLE_BINDER_SIZE,
): T[] {
  const out: T[] = []
  const names = new Set<string>()
  for (const card of cards) {
    if (out.length >= size) break
    const name = card.name.toLowerCase()
    if (BASIC_LANDS.has(name) || /\bbasic\b.*\bland\b/i.test(card.typeLine ?? '')) continue
    if (commanderIds.includes(card.scryfallId) || names.has(name)) continue
    names.add(name)
    out.push(card)
  }
  return out
}

/** [lib] without its samples. */
export function withoutSamples<L extends { decks: Deck[]; collections: Collection[] }>(lib: L): L {
  return { ...lib, decks: lib.decks.filter((d) => !isSample(d)), collections: lib.collections.filter((c) => !isSample(c)) }
}

/** The items that may go to the account: samples never do. The sync builds what it sends from these. */
export const syncable = <T extends { sample?: boolean | null }>(items: T[]): T[] => items.filter((item) => !isSample(item))

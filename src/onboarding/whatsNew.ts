// The What's new tour: a few spotlight steps over the Collection's home, shown once on a device after
// updating to a version with new collection features (the home, Storage, Find anything…), and again
// from Settings › Getting started. Which steps, their words and whether it's been seen are here, pure;
// WhatsNewTour.tsx draws it. Mirrors the Android app's data/WhatsNew.kt (tests:
// tests/onboarding/whatsNew.test.ts ↔ WhatsNewTest.kt).

/** This tour. A later one gets a new id, and shows once more. */
export const TOUR_ID = 'collection-home-1'

/** The part of the screen a step lights up. */
export type TourTarget = 'home-tiles' | 'home-storage' | 'home-find' | 'home-sealed' | 'home-todo'

/** What a step's call to action does: set up storage, or open Find anything. */
export type TourAction = 'storage-setup' | 'find'

export interface TourStep { target: TourTarget; title: string; body: string; cta?: { label: string; action: TourAction } }

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'home-tiles',
    title: 'Your collection has a home',
    body: "What it's worth, what's where and what needs doing, on one page. Each tile opens its part of the collection.",
  },
  {
    target: 'home-storage',
    title: 'Know where every card is',
    body: 'Make your boxes and binders here, then scan cards as you put them away. Any card page will tell you where it is.',
    cta: { label: 'Set it up', action: 'storage-setup' },
  },
  {
    target: 'home-find',
    title: 'Find anything',
    body: 'One search for your cards, your places and your decks. Each card says where every copy is — the box, the deck, who borrowed it.',
    cta: { label: 'Try it', action: 'find' },
  },
  {
    target: 'home-sealed',
    title: 'Boxes, slabs, loans and sales',
    body: "Sealed product and graded cards have places too, and what's lent out or marked to sell is counted here.",
  },
  {
    target: 'home-todo',
    title: 'A little upkeep',
    body: 'The few things worth doing this week, each with a button that does it. Upkeep has the rest.',
  },
]

/** "New · 2 of 5". */
export const tourEyebrow = (index: number, total: number): string => `New · ${index + 1} of ${total}`

/** The forward button: "Next", and "Done" on the last step. */
export const tourNextLabel = (index: number, total: number): string => (index >= total - 1 ? 'Done' : 'Next')

/**
 * The steps to show, [hasPlaces] deciding Storage's call to action: "Set it up" before there are any
 * places; with places there's nothing to set up.
 */
export function tourSteps(hasPlaces: boolean): TourStep[] {
  return TOUR_STEPS.map((s) => (s.cta?.action === 'storage-setup' && hasPlaces ? { ...s, cta: undefined } : s))
}

/**
 * Whether the tour opens by itself on the Collection's home: not seen on this device yet ([seen]: the
 * id of the last tour seen, null for none), and the library has something of the user's — someone
 * just starting has the welcome steps instead, and the tour waits until there's a collection to show.
 */
export function shouldShowTour(seen: string | null | undefined, library: { cards: number; decks: number }): boolean {
  return seen !== TOUR_ID && (library.cards > 0 || library.decks > 0)
}

/** The stored id of the last tour seen; anything unreadable reads as none. */
export function parseTourSeen(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  return v ? v : null
}

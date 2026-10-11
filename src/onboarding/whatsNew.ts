// The What's new tour: a few spotlight steps over the Collection's tabs, shown once on a device after
// updating to a version with new collection features (the tabs, Storage, Find anything…), and again
// from Settings › Getting started. Which steps, their words and whether it's been seen are here, pure;
// WhatsNewTour.tsx draws it. Mirrors the Android app's data/WhatsNew.kt (tests:
// tests/onboarding/whatsNew.test.ts ↔ WhatsNewTest.kt).

/** This tour. A later one gets a new id, and shows once more. */
export const TOUR_ID = 'collection-tabs-1'

/** The part of the screen a step lights up: the tab row, the Storage and Cards tabs, the search bar, the header. */
export type TourTarget = 'tabs' | 'storage' | 'search' | 'cards' | 'header'

/** What a step's call to action does: set up storage, or open Find anything. */
export type TourAction = 'storage-setup' | 'find'

export interface TourStep { target: TourTarget; title: string; body: string; cta?: { label: string; action: TourAction } }

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'tabs',
    title: 'Your collection in four tabs',
    body: 'Cards, Binders, Storage and Wishlist, always one tap away. The Collection opens on the tab you used last.',
  },
  {
    target: 'storage',
    title: 'Know where every card is',
    body: 'Make your boxes and binders on Storage, then scan cards as you put them away. Sealed product and graded cards live there too.',
    cta: { label: 'Set it up', action: 'storage-setup' },
  },
  {
    target: 'search',
    title: 'One search',
    body: "It searches the tab you're on. Search everywhere, at the bottom, finds your cards, places and decks at once.",
    cta: { label: 'Try it', action: 'find' },
  },
  {
    target: 'cards',
    title: 'Every card says where it is',
    body: "Each card shows its box, deck or who borrowed it. No place yet puts it away. Group by set, binder or place, or show only what's lent out, for sale or graded.",
  },
  {
    target: 'header',
    title: 'A little upkeep',
    body: "What it's worth and whether it's synced, up top. Needs attention shows when something is worth doing this week.",
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

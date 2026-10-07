// Whether this browser has seen the What's new tour (whatsNew.ts). The Android app keeps the same on
// the phone (data/WhatsNew.kt's WhatsNewStore).

import { parseTourSeen, TOUR_ID } from './whatsNew'

const SEEN_KEY = 'mtgweb_whats_new_seen'

/** The id of the last What's new tour seen in this browser (whatsNew.ts); null for none. */
export function tourSeen(): string | null {
  try { return parseTourSeen(localStorage.getItem(SEEN_KEY)) } catch { return null }
}

/** This tour, seen. */
export function markTourSeen() {
  try { localStorage.setItem(SEEN_KEY, TOUR_ID) } catch { /* shown again next time */ }
}

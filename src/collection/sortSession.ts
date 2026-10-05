// Sorting a new pile (sortPiles.ts): the piles' rules, kept on this device for next time, and the
// sort under way, kept for this tab so a reload doesn't lose it. The Android app keeps the same in
// SortSessionStore.kt.

import type { Collection } from '../types/models'
import { defaultPiles, MAX_PILES, pileRule, type PileRule, type SortSession } from './sortPiles'

const RULES_KEY = 'mtgweb_sort_piles'
const SESSION_KEY = 'mtgweb_sort_session'

/** The piles last used here, or the first sort's (defaultPiles). */
export function loadPiles(collections: Collection[]): PileRule[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null') as PileRule[] | null
    if (Array.isArray(raw) && raw.length > 0) return raw.slice(0, MAX_PILES).map(pileRule)
  } catch { /* none kept */ }
  return defaultPiles(collections)
}

export function savePiles(rules: PileRule[]) {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules.map(pileRule))) } catch { /* this visit only */ }
}

export function loadSort(): SortSession | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as SortSession | null
    return raw && Array.isArray(raw.scans) && Array.isArray(raw.rules) ? raw : null
  } catch {
    return null
  }
}

export function saveSort(session: SortSession | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch { /* this visit only */ }
}

/** Each pile's colour on the scanner, by its number (1 to 6). */
export const PILE_COLOURS = ['#e6b45e', '#e2694a', '#5bcb8f', '#6aa8f0', '#c58af0', '#f07fa8']

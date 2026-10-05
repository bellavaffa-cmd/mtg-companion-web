// The check going on now (collection/placeCheck.ts): what's being checked and the cards scanned so far,
// kept in this tab while the scanner runs and the results are open — a reload doesn't lose a
// half-checked box. One at a time; starting a check of another place starts afresh. The Android app
// keeps the same in memory (data/PlaceCheck.kt, CheckSessions).

import type { CheckScan, CheckScope } from './placeCheck'

const KEY = 'mtgweb_check'

export interface CheckSession extends CheckScope { scans: CheckScan[] }

/** The check of [placeId] going on now, or null. */
export function loadCheck(placeId: string): CheckSession | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    const s = raw ? (JSON.parse(raw) as CheckSession) : null
    return s && s.placeId === placeId && Array.isArray(s.scans) ? s : null
  } catch {
    return null
  }
}

export function saveCheck(session: CheckSession): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(session)) } catch { /* out of room: the check carries on in memory */ }
}

export function clearCheck(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing kept */ }
}

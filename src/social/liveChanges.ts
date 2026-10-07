// How many times each social area has changed since the page opened — live pings, the user's own
// changes — for screens that load loans, game nights or households themselves: they key their
// loading on useAreaChanges(area) and reload when it moves. A module store (not SocialContext) so the
// hooks in nights.ts and household.ts can use it without importing the context they're used by.

import { useSyncExternalStore } from 'react'
import type { SocialArea } from './live'

let counts: Readonly<Record<SocialArea, number>> = { trades: 0, friends: 0, loans: 0, nights: 0, household: 0 }
const listeners = new Set<() => void>()

/** Marks [areas] changed. */
export function bumpAreas(...areas: SocialArea[]) {
  if (!areas.length) return
  const next = { ...counts }
  for (const a of areas) next[a] += 1
  counts = next
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** Every area's count; a new object only when one changes. */
export const useAllAreaChanges = () => useSyncExternalStore(subscribe, () => counts, () => counts)

/** [area]'s count. */
export const useAreaChanges = (area: SocialArea) => useSyncExternalStore(subscribe, () => counts[area], () => counts[area])

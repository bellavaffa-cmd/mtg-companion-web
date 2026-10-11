// Each place's search and filters (and the Storage tab's), kept while the app is open — coming back
// to a place finds them as they were — and forgotten on a reload. The rules are placeFilter.ts's;
// the Android app keeps the same in PlaceFilterStore (PlaceFilter.kt).

import { useCallback, useSyncExternalStore } from 'react'
import { filterIn, withFilter, type CardsFilter, type FilterMemory } from './placeFilter'

let memory: FilterMemory = new Map()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** [key]'s filters (a place's id, or STORAGE_FILTER_KEY), and setting them. */
export function usePlaceFilter(key: string): [CardsFilter, (f: CardsFilter) => void] {
  const f = useSyncExternalStore(subscribe, () => filterIn(memory, key))
  const set = useCallback((next: CardsFilter) => {
    memory = withFilter(memory, key, next)
    listeners.forEach((l) => l())
  }, [key])
  return [f, set]
}

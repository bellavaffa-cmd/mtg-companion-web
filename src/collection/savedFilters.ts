// The All cards filters saved by name ("Save as…" on the Advanced filters page), kept in this
// browser. The JSON is the same text the Android app keeps (SettingsRepository's "saved_filters",
// written by AdvancedFilter.kt's savedFiltersToJson); neither app syncs it — settings aren't synced.

import { useSyncExternalStore } from 'react'
import { savedFiltersFromJson, savedFiltersToJson, type SavedFilter } from './advancedFilter'

const KEY = 'mtgweb_saved_filters'

function read(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

let cache: { json: string | null; list: SavedFilter[] } = { json: null, list: [] }
let memory: string | null = null
const listeners = new Set<() => void>()

function current(): SavedFilter[] {
  const json = read() ?? memory
  if (json !== cache.json) cache = { json, list: savedFiltersFromJson(json) }
  return cache.list
}

function save(list: SavedFilter[]) {
  const json = savedFiltersToJson(list)
  memory = json
  try { localStorage.setItem(KEY, json) } catch { /* this visit only */ }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `f${Date.now()}${Math.random().toString(36).slice(2, 8)}`)

/** The saved filters, and saving, renaming and deleting them. */
export function useSavedFilters() {
  const list = useSyncExternalStore(subscribe, current)
  return {
    saved: list,
    /** Saves the filters under [name]; one already called that is replaced. */
    add: (name: string, filter: Omit<SavedFilter, 'id' | 'name'>) => {
      const n = name.trim()
      if (!n) return
      const same = list.find((s) => s.name.toLowerCase() === n.toLowerCase())
      const item: SavedFilter = { id: same?.id ?? newId(), name: n, ...filter }
      save(same ? list.map((s) => (s.id === same.id ? item : s)) : [...list, item])
    },
    rename: (id: string, name: string) => {
      const n = name.trim()
      if (n) save(list.map((s) => (s.id === id ? { ...s, name: n } : s)))
    },
    remove: (id: string) => save(list.filter((s) => s.id !== id)),
  }
}

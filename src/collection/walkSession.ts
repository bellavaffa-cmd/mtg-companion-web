// "Walk this list": the copies a filtered place or the Storage tab found, as a pull list
// (walkPullList) to tick off by hand or with the scanner (/scan?walk=1). One list at a time, kept
// while the app is open — a trip round the shelves — and not across a reload. The Android app's
// WalkSession (PlaceFilter.kt).

import { useSyncExternalStore } from 'react'
import type { PullList } from './pullList'

export interface WalkSession {
  /** What was searched for: "Red box · “goblin”". */
  title: string
  list: PullList
  ticked: ReadonlySet<string>
}

let session: WalkSession | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export const walkSession = (): WalkSession | null => session

/** Starts walking [list]; ticks of an earlier walk are kept for the rows still on it. */
export function startWalk(title: string, list: PullList) {
  const keys = new Set(list.groups.flatMap((g) => g.rows.map((r) => r.key)))
  const kept = session ? [...session.ticked].filter((k) => keys.has(k)) : []
  session = { title, list, ticked: new Set(kept) }
  changed()
}

export function setWalkTicks(ticked: ReadonlySet<string>) {
  if (!session) return
  session = { ...session, ticked }
  changed()
}

export function useWalkSession(): WalkSession | null {
  return useSyncExternalStore(subscribe, walkSession)
}

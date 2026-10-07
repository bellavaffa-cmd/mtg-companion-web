// The copy history log (copyHistory.ts), kept in this browser only — it isn't synced. Writing is
// best effort: storage that's full or blocked just loses the history, never the change itself.
// The Android app keeps its own in CopyHistoryStore.kt.

import { useEffect, useState } from 'react'
import { appendMoves, pruneMoves, type CopyMove } from './copyHistory'

const KEY = 'mtgweb_copy_history'
const listeners = new Set<() => void>()

let log: CopyMove[] | null = null

function load(): CopyMove[] {
  if (log) return log
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    log = pruneMoves(Array.isArray(raw) ? (raw as CopyMove[]) : [], Date.now())
  } catch {
    log = []
  }
  return log
}

/** The log as it is now, oldest first — for a backup (sync/backupFile.ts). */
export const currentMoves = (): CopyMove[] => load()

/** Puts [moves] in place of the log — a restored backup's, put together with this browser's. */
export function replaceMoves(moves: CopyMove[]) {
  log = moves
  try { localStorage.setItem(KEY, JSON.stringify(log)) } catch { /* full or blocked: kept for this visit */ }
  listeners.forEach((l) => l())
}

/** Adds [moves] to the log. */
export function recordMoves(moves: CopyMove[]) {
  if (moves.length === 0) return
  log = appendMoves(load(), moves, Date.now())
  try { localStorage.setItem(KEY, JSON.stringify(log)) } catch { /* full or blocked: kept for this visit */ }
  listeners.forEach((l) => l())
}

/** The log, oldest first, re-rendering when a move is added. */
export function useCopyHistory(): CopyMove[] {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return load()
}

/** Today's calendar day on this device, as copyHistory.moveDay and the loans want it ("2026-10-05"). */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

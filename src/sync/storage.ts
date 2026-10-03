// Writes to this browser's storage that the library depends on: the library itself and the sync's
// bookkeeping. When the browser has no room left, the write fails — but the change being made must
// still happen and show, so instead of throwing, a failed write is reported once (see SyncContext's
// storageFull notice) and the change lives in memory until it's synced to the account.

let full = false
const listeners = new Set<() => void>()

/** Whether [e] is the browser saying its storage for this site is full. */
export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false
  // Firefox has used its own name; old WebKit and Gecko only set the legacy code.
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014
}

/**
 * Saves [value] under [key]; answers whether it was saved. A full storage is reported to
 * [onStorageFull] listeners the first time only, so the user is told once, not on every edit.
 */
export function saveToStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    if (isQuotaError(e) && !full) {
      full = true
      listeners.forEach((fn) => fn())
    }
    return false
  }
}

/** Calls [fn] when storage first runs out. Answers the unsubscribe. */
export function onStorageFull(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Whether a write has already failed for lack of room on this page load. */
export const storageFull = () => full

/** For tests: forget that storage ran out. */
export function resetStorageFull() {
  full = false
}

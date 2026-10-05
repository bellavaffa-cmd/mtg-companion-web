// Anonymous usage counts on this browser: kept in localStorage, sent to the owner's Supabase project
// (record_usage) once a day is over. Best effort and silent — a send that fails (offline, or the
// function not there yet) keeps the counts for tomorrow's try, until they're a week old. The rules
// are in ./usageCounts; Settings › Privacy turns it off.

import { useSyncExternalStore } from 'react'
import { apiHeaders, restUrl, supabaseConfigured } from '../sync/supabaseAuth'
import {
  dayOf, dueBatches, markSent, markTried, newInstallId, optedOut, parseUsage, record, screenEvent, screenOfPath,
  type UsageAction, type UsageState,
} from './usageCounts'

const STATE_KEY = 'mtgweb_usage'
const OFF_KEY = 'mtgweb_usage_off'
const VERSION = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? ''

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* not kept */ }
}

const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export const usageEnabled = () => read(OFF_KEY) !== '1'

/** Settings › Privacy's switch. Off forgets everything kept so far. */
export function setUsageEnabled(on: boolean) {
  write(OFF_KEY, on ? null : '1')
  if (!on) write(STATE_KEY, JSON.stringify(optedOut()))
  for (const l of listeners) l()
}

export function useUsageEnabled(): boolean {
  return useSyncExternalStore(subscribe, usageEnabled)
}

const load = (): UsageState => parseUsage(read(STATE_KEY))
const save = (s: UsageState) => write(STATE_KEY, JSON.stringify(s))
const today = () => dayOf(new Date())

function count(event: string) {
  if (!usageEnabled()) return
  try {
    save(record(load(), event, today(), true, () => newInstallId()))
  } catch { /* never in the way */ }
  void sendDue()
}

/** Counts a feature action. */
export const countAction = (action: UsageAction) => count(action)

/** Counts a screen opened, by its path (ids in it aren't kept). */
export function countScreen(pathname: string) {
  const screen = screenOfPath(pathname)
  if (screen) count(screenEvent(screen))
}

let sending = false

/** Sends finished days, at most one try a day. Called at start and after each count. */
export async function sendDue(): Promise<void> {
  if (sending || !supabaseConfigured || !usageEnabled()) return
  const day = today()
  const batches = dueBatches(load(), day, true)
  if (batches.length === 0) return
  sending = true
  try {
    save(markTried(load(), day))
    for (const b of batches) {
      const res = await fetch(restUrl('/rest/v1/rpc/record_usage'), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ p_install: b.install, p_platform: 'web', p_version: VERSION, p_day: b.day, p_counts: b.counts }),
      })
      if (!res.ok) break
      save(markSent(load(), b))
    }
  } catch {
    // Offline: tomorrow.
  } finally {
    sending = false
  }
}

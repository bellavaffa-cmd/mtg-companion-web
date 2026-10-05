// The events run on this device, kept in this browser so one survives a reload mid-round. Mirrors
// the Android app's ui/tournament/TournamentRepository.kt.

import { useEffect, useState } from 'react'
import { parsePlayoff } from './playoff'
import { withEvent, type Tournament } from './tournament'

const EVENTS_KEY = 'mtgweb_tournaments'
const listeners = new Set<() => void>()
let events: Tournament[] = (() => {
  try {
    // An event saved before playoffs has none; a malformed one is dropped rather than breaking the page.
    return (JSON.parse(localStorage.getItem(EVENTS_KEY) ?? '[]') as Tournament[]).map((e) => ({ ...e, playoff: parsePlayoff(e.playoff) }))
  } catch { return [] }
})()

function setEvents(next: Tournament[]) {
  events = next
  try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)) } catch { /* this visit only */ }
  listeners.forEach((l) => l())
}

export const saveEvent = (t: Tournament) => setEvents(withEvent(events, t))
export const deleteEvent = (id: string) => setEvents(events.filter((e) => e.id !== id))

/** The events on this device, newest first. */
export function useEvents(): Tournament[] {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return events
}

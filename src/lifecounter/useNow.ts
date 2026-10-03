import { useEffect, useState } from 'react'

/** The time, moving on every [everyMs] while [running] — for a clock or a countdown on screen. */
export function useNow(everyMs: number, running = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs, running])
  return now
}

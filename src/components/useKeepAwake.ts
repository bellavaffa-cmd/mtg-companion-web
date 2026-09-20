/**
 * Keeps the screen on while a page needs watching — scanning a pile of cards, where nothing is
 * touched for minutes at a time and the phone would otherwise dim and lock.
 *
 * The lock is let go when the page is hidden (the browser takes it back anyway) and asked for again
 * on return. A browser without the Screen Wake Lock API, or one that refuses (a battery-saving
 * phone), simply doesn't get it: the page works the same, the screen just dims as usual.
 */

import { useEffect } from 'react'

interface WakeLockSentinelish { released: boolean; release: () => Promise<void> }
interface WakeLockish { request: (type: 'screen') => Promise<WakeLockSentinelish> }

export const wakeLockAvailable = () => 'wakeLock' in navigator

export function useKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active) return
    const api = (navigator as Navigator & { wakeLock?: WakeLockish }).wakeLock
    if (!api) return
    let sentinel: WakeLockSentinelish | null = null
    let dropped = false

    const take = async () => {
      if (dropped || document.hidden) return
      try {
        sentinel = await api.request('screen')
      } catch {
        // Refused (battery saver, a background tab): the screen just behaves as it normally would.
      }
    }
    const onVisibility = () => { if (!document.hidden) void take() }

    void take()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      dropped = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}

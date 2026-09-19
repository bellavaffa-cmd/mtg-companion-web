import { useEffect } from 'react'

/** Keeps the screen awake while the life counter (or a remote) is open, where the browser allows it. */
export function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let cancelled = false
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
        if (document.visibilityState === 'visible' && nav.wakeLock) {
          const l = await nav.wakeLock.request('screen')
          if (cancelled) l.release().catch(() => {})
          else lock = l
        }
      } catch {
        // Not allowed (battery saver, unsupported browser): the screen may dim as usual.
      }
    }
    request()
    const onVisible = () => { if (document.visibilityState === 'visible') request() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [])
}

/**
 * Stops a page being left while it holds something unfinished — cards scanned but not put away.
 * A tap on the app's own links (the nav bar, the sidebar) is caught and handed to [ask], which
 * shows whatever the page wants and calls back to go on; closing or reloading the tab gets the
 * browser's own "leave site?" prompt, which is all a page is allowed there.
 *
 * The phone's own back gesture isn't caught: this app's router can't block it without pushing
 * history entries of its own, which goes wrong more often than it helps. The scanner keeps its
 * pile through a reload instead, so nothing is lost that way either.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/** Turns a full URL into a path this app's router understands (the app may live under a base path). */
export function routerPath(href: string, base = import.meta.env.BASE_URL): string | null {
  let url: URL
  try {
    url = new URL(href, window.location.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname
  return (path || '/') + url.search
}

export function useLeaveGuard(active: boolean, ask: (go: () => void) => void) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!active) return

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      // A modified click (new tab, download) is the browser's business, not ours.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const path = routerPath(link.href)
      if (path === null || path === window.location.pathname.replace(/\/$/, '') + window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      ask(() => navigate(path))
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, ask, navigate])
}

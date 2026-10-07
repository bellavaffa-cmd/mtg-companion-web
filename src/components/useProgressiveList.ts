// A long list drawn a screenful at a time: the first [step] rows at once, and more as the end comes
// into view — so a binder or All cards with thousands of cards opens as fast as a short one. The
// Android app's lists are lazy (LazyColumn) the same way. Without IntersectionObserver every row is
// drawn, as before.

import { useEffect, useRef, useState } from 'react'

export const LIST_STEP = 150

/**
 * How many of [total] rows to draw now, and a [ref] for an element after the last one drawn: when it
 * nears the screen, more are drawn. A new [resetKey] (a new search, say) starts again from the top.
 */
export function useProgressiveList(total: number, resetKey: unknown, step = LIST_STEP) {
  const [state, setState] = useState({ key: resetKey, count: step })
  const count = state.key === resetKey ? state.count : step
  const ref = useRef<HTMLDivElement | null>(null)
  const observable = typeof IntersectionObserver !== 'undefined'
  const more = observable && count < total
  useEffect(() => {
    const el = ref.current
    if (!el || !more) return
    const io = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting)) {
        setState((s) => ({ key: resetKey, count: (s.key === resetKey ? s.count : step) + step }))
      }
    }, { rootMargin: '1500px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, count, resetKey, step])
  return { count: observable ? Math.min(count, total) : total, more, ref }
}

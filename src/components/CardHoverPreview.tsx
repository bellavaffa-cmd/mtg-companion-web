import { useEffect, useState } from 'react'
import { biggerImageUrl } from '../types/scryfall'

/**
 * Resting the mouse on a card thumbnail shows the card big, beside it.
 *
 * Mounted once, next to the router. Rather than every grid wiring up its own handlers, this watches
 * the whole page for a thumbnail marked `data-card-preview` — the attribute carries the big picture's
 * address, or is left empty to blow up whatever `<img>` is inside it.
 *
 * Mouse only: a finger has no hover, and on a touchscreen "hover" would fire on the tap that opens
 * the card anyway. A preview never takes the pointer, so it can't swallow a click.
 */

/** How long the mouse has to rest before the card appears — long enough not to flash while passing over a grid. */
const REST_MS = 120
/** The gap between the thumbnail and the preview, and the least room kept to the window's edge. */
const GAP = 12
const EDGE = 8
const WIDTH = 300
/** Magic cards are 488×680 in Scryfall's 'normal' size. */
const RATIO = 680 / 488

interface Shown {
  url: string
  left: number
  top: number
}

/** Where the preview fits beside [rect]: to its right, or its left when the right is too tight. */
function place(rect: DOMRect, width: number, height: number): { left: number; top: number } {
  const room = window.innerWidth - rect.right - GAP - EDGE
  const left = room >= width ? rect.right + GAP : Math.max(EDGE, rect.left - GAP - width)
  // Level with the thumbnail's middle, nudged back inside the window at the top and bottom.
  const wanted = rect.top + rect.height / 2 - height / 2
  const top = Math.min(Math.max(EDGE, wanted), Math.max(EDGE, window.innerHeight - height - EDGE))
  return { left, top }
}

/** The big picture for a marked thumbnail: what it says, else its own `<img>` one size up. */
function pictureFor(el: HTMLElement): string | null {
  const said = el.getAttribute('data-card-preview')
  if (said) return said
  const img = el instanceof HTMLImageElement ? el : el.querySelector('img')
  return img?.getAttribute('src') ? biggerImageUrl(img.getAttribute('src')) : null
}

export function CardHoverPreview() {
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let timer: number | undefined
    let over: HTMLElement | null = null
    const forget = () => {
      window.clearTimeout(timer)
      over = null
      setShown(null)
    }

    const onOver = (e: MouseEvent) => {
      const target = (e.target as Element | null)?.closest?.('[data-card-preview]') as HTMLElement | null
      if (target === over) return
      window.clearTimeout(timer)
      over = target
      if (!target) { setShown(null); return }
      const url = pictureFor(target)
      if (!url) { setShown(null); return }
      timer = window.setTimeout(() => {
        // The grid may have moved or gone while we waited.
        if (!target.isConnected) return
        const height = WIDTH * RATIO
        setShown({ url, ...place(target.getBoundingClientRect(), WIDTH, height) })
      }, REST_MS)
    }

    document.addEventListener('mouseover', onOver)
    // Anything that moves the page out from under the preview takes it away.
    window.addEventListener('scroll', forget, true)
    window.addEventListener('resize', forget)
    document.addEventListener('click', forget, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseover', onOver)
      window.removeEventListener('scroll', forget, true)
      window.removeEventListener('resize', forget)
      document.removeEventListener('click', forget, true)
    }
  }, [])

  if (!shown) return null
  return (
    <img
      className="card-hover-preview"
      src={shown.url}
      alt=""
      aria-hidden
      style={{ left: shown.left, top: shown.top, width: WIDTH }}
    />
  )
}

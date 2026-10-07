import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tourEyebrow, tourNextLabel, type TourAction, type TourStep } from './whatsNew'
import '../collection/collectionHome.css'

interface Rect { top: number; left: number; width: number; height: number }

/**
 * The What's new tour, the Android app's WhatsNewTour: each step lights up a part of the page (the
 * element marked data-tour="<target>") with a card under or over it — "New · 2 of 5", the words, Skip
 * tour, the step's call to action and Next. Seen once it opens (see CollectionsPage).
 */
export function WhatsNewTour({ steps, onAction, onClose }: { steps: TourStep[]; onAction: (action: TourAction) => void; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const step = steps[index]

  useLayoutEffect(() => {
    if (!step) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const measure = () => {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 })
    }
    measure()
    // Smooth scrolling moves it a little while; and the window can change size.
    const timer = window.setInterval(measure, 120)
    const stop = window.setTimeout(() => window.clearInterval(timer), 900)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step])

  useEffect(() => { nextButton.current?.focus() }, [index])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!step) return null
  const below = rect ? rect.top + rect.height + 260 < window.innerHeight : true
  const cardStyle = rect
    ? (below ? { top: rect.top + rect.height + 14 } : { bottom: window.innerHeight - rect.top + 14 })
    : { top: '30%' }

  return (
    <>
      <div className="tour-scrim" onClick={(e) => e.stopPropagation()} style={rect ? undefined : { background: 'rgba(5, 6, 8, 0.62)' }} />
      {rect && <div className="tour-spot" style={rect} />}
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={cardStyle}>
        <span className="tour-eyebrow">{tourEyebrow(index, steps.length)}</span>
        <h2 id="tour-title" className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-buttons">
          <button type="button" className="tour-skip" onClick={onClose}>Skip tour</button>
          <div className="grow" />
          {step.cta && <button type="button" className="btn line" onClick={() => { onClose(); onAction(step.cta!.action) }}>{step.cta.label}</button>}
          <button ref={nextButton} type="button" className="btn gold" onClick={() => (index >= steps.length - 1 ? onClose() : setIndex(index + 1))}>
            {tourNextLabel(index, steps.length)}
          </button>
        </div>
      </div>
    </>
  )
}

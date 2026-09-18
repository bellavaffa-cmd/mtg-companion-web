import { useEffect, useRef, useState } from 'react'
import { useSync, type RefreshResult } from '../sync/SyncContext'
import { Icon } from './Icon'

/** How far (px, after resistance) the page must be pulled before letting go syncs. */
const THRESHOLD = 72
/** The spinner stays up at least this long, so a fast sync still reads as having happened. */
const MIN_SYNC_MS = 900

type Phase = { kind: 'idle' } | { kind: 'syncing' } | { kind: 'done'; result: RefreshResult }

/** Where a pull can't start: dialogs, sheets, zoom, the life counter and text fields. */
const NO_PULL = '.dialog-overlay, .sheet, .scrim, .zoom-overlay, .lc-root, input, textarea, select, [data-no-pull]'

/**
 * Whether something under the finger can still scroll up — a side panel or list scrolled partway
 * down. Dragging down there scrolls it back; only at its top does the drag become a pull.
 */
function insideScrolledContainer(target: Element | null): boolean {
  for (let el = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el.scrollTop > 0) {
      const overflow = getComputedStyle(el).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
  }
  return false
}

function label(result: RefreshResult): { icon: string; text: string; tone: 'ok' | 'bad' | 'muted' } {
  switch (result.kind) {
    case 'signed-out':
      return { icon: 'person', text: 'Sign in under Account to sync', tone: 'muted' }
    case 'failed':
      return { icon: 'cloud_off', text: result.offline ? "You're offline" : result.message, tone: 'bad' }
    case 'ok':
      if (result.pulled > 0) return { icon: 'check_circle', text: `${result.pulled} ${result.pulled === 1 ? 'change' : 'changes'} from your other devices`, tone: 'ok' }
      return { icon: 'check_circle', text: result.pushed > 0 ? 'Synced' : 'Up to date', tone: 'ok' }
  }
}

/**
 * Pull down at the top of a page (touch screens) to sync decks and binders with the account — the
 * same gesture and indicator as the Android app. The sync icon winds up as you pull, spins while
 * syncing, then the pill opens to say how it went.
 */
export function PullToSync() {
  const { refresh, accountsAvailable } = useSync()
  const [pull, setPull] = useState(0) // 0..~1.4, fraction of THRESHOLD
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!accountsAvailable) return
    let startX = 0
    let startY = 0
    let tracking = false
    let pulling = false
    let fraction = 0
    let armed = false

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || phaseRef.current.kind !== 'idle' || window.scrollY > 0) return
      const target = e.target as Element | null
      if (target?.closest?.(NO_PULL) || insideScrolledContainer(target)) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      tracking = true
      pulling = false
      armed = false
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!pulling) {
        // Decide once: a sideways swipe (a card rail) or an upward scroll isn't a pull.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) { tracking = false; return }
        pulling = true
        setDragging(true)
      }
      e.preventDefault()
      // Resistance: the further you pull, the less it moves.
      const distance = Math.max(0, dy) * 0.55
      fraction = distance <= THRESHOLD ? distance / THRESHOLD : 1 + ((distance - THRESHOLD) / THRESHOLD) * 0.4
      setPull(Math.min(fraction, 1.6))
      if (fraction >= 1 && !armed) { armed = true; navigator.vibrate?.(8) }
      if (fraction < 1) armed = false
    }

    const onEnd = () => {
      if (!tracking) return
      tracking = false
      if (!pulling) return
      pulling = false
      setDragging(false)
      if (fraction >= 1) {
        void run()
      } else {
        setPull(0)
      }
      fraction = 0
    }

    const run = async () => {
      setPhase({ kind: 'syncing' })
      setPull(1)
      const started = Date.now()
      const result = await refreshRef.current()
      const elapsed = Date.now() - started
      if (elapsed < MIN_SYNC_MS) await new Promise((r) => setTimeout(r, MIN_SYNC_MS - elapsed))
      setPhase({ kind: 'done', result })
      navigator.vibrate?.(12)
      await new Promise((r) => setTimeout(r, result.kind === 'ok' ? 1200 : 2200))
      setPull(0)
      await new Promise((r) => setTimeout(r, 250))
      setPhase({ kind: 'idle' })
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [accountsAvailable])

  if (!accountsAvailable || (phase.kind === 'idle' && pull === 0 && !dragging)) return null

  const f = Math.min(pull, 1)
  const eased = pull <= 1 ? pull : 1 + (pull - 1) * 0.35
  const armedNow = phase.kind !== 'idle' || pull >= 1
  const done = phase.kind === 'done' ? label(phase.result) : null
  const circumference = 2 * Math.PI * 15

  return (
    <div
      className={`pull-sync${dragging ? ' dragging' : ''}`}
      style={{
        transform: `translate(-50%, ${(eased - 1) * 64}px) scale(${0.6 + 0.4 * f})`,
        opacity: f,
      }}
      role="status"
      aria-live="polite"
    >
      {done ? (
        <div className={`pull-sync-pill tone-${done.tone}`}>
          <Icon name={done.icon} />
          <span>{done.text}</span>
        </div>
      ) : (
        <div className={`pull-sync-ring${armedNow ? ' armed' : ''}${phase.kind === 'syncing' ? ' spinning' : ''}`}>
          <svg viewBox="0 0 36 36" aria-hidden>
            <circle className="track" cx="18" cy="18" r="15" />
            <circle
              className="arc"
              cx="18"
              cy="18"
              r="15"
              style={{
                strokeDasharray: phase.kind === 'syncing' ? `${circumference * 0.3} ${circumference}` : `${circumference * f} ${circumference}`,
              }}
            />
          </svg>
          <Icon name="sync" style={{ transform: phase.kind === 'syncing' ? undefined : `rotate(${-Math.min(pull, 1.4) * 300}deg)` }} />
          <span className="sr-only">{phase.kind === 'syncing' ? 'Syncing' : 'Pull to sync'}</span>
        </div>
      )}
    </div>
  )
}

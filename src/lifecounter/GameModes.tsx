import { useEffect, useState } from 'react'
import { searchCards } from '../api/scryfall'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'

/**
 * Planechase for the life counter, as in the Android app: a shuffled deck of planes and phenomena,
 * the current plane shown to the table, a planar die, and planeswalking to the next one.
 */

export type PlanarFace = 'BLANK' | 'CHAOS' | 'PLANESWALK'

export interface PlanechaseState {
  current: ScryfallCard | null
  deck: ScryfallCard[]
  loading: boolean
  error: string | null
  lastRoll: { face: PlanarFace; n: number } | null
}

const idle: PlanechaseState = { current: null, deck: [], loading: false, error: null, lastRoll: null }

function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function usePlanechase() {
  const [state, setState] = useState<PlanechaseState | null>(null)

  const start = async () => {
    setState({ ...idle, loading: true })
    try {
      const page = await searchCards('t:plane or t:phenomenon')
      const planes = shuffle(page.cards.filter((c) => /Plane|Phenomenon/.test(c.type_line ?? '')))
      if (planes.length === 0) throw new Error("Couldn't find any planes on Scryfall.")
      setState({ ...idle, current: planes[0], deck: planes.slice(1) })
    } catch (e) {
      setState({ ...idle, error: e instanceof Error ? e.message : "Couldn't load planes." })
    }
  }

  /** Move to the next plane, cycling the current one to the bottom of the deck. */
  const planeswalk = () =>
    setState((s) => (s && s.deck.length > 0
      ? { ...s, current: s.deck[0], deck: [...s.deck.slice(1), ...(s.current ? [s.current] : [])] }
      : s))

  /** A real planar die: four blank faces, one Chaos, one Planeswalk (which moves you on). */
  const roll = (): PlanarFace => {
    const n = Math.floor(Math.random() * 6)
    const face: PlanarFace = n === 0 ? 'CHAOS' : n === 1 ? 'PLANESWALK' : 'BLANK'
    setState((s) => (s ? { ...s, lastRoll: { face, n: (s.lastRoll?.n ?? 0) + 1 } } : s))
    if (face === 'PLANESWALK') planeswalk()
    return face
  }

  const stop = () => setState(null)

  return { planechase: state, startPlanechase: start, planeswalk, rollPlanarDie: roll, stopPlanechase: stop }
}

/** The current plane, pinned to the top of the table; tap it for the full card and the die. */
export function PlaneBanner({ state, onOpen }: { state: PlanechaseState; onOpen: () => void }) {
  if (state.loading) return <div className="lc-plane-banner">Shuffling the planes…</div>
  if (state.error) return <button type="button" className="lc-plane-banner" onClick={onOpen}>{state.error}</button>
  if (!state.current) return null
  const art = displayImageUrl(state.current)?.replace('/normal/', '/art_crop/')
  return (
    <button type="button" className="lc-plane-banner" onClick={onOpen} aria-label={`Planechase: ${state.current.name}. Open the plane`}>
      {art && <img src={art} alt="" />}
      <span className="lc-plane-label">Planechase</span>
      <span className="lc-plane-name">{state.current.name}</span>
    </button>
  )
}

const FACE_TEXT: Record<PlanarFace, string> = {
  BLANK: 'Blank — nothing happens',
  CHAOS: 'Chaos! The plane’s chaos ability triggers',
  PLANESWALK: 'Planeswalk — on to the next plane',
}

/** The plane at full size, with the planar die and a way out. */
export function PlaneSheet({
  state, onRoll, onPlaneswalk, onStop, onClose,
}: {
  state: PlanechaseState
  onRoll: () => void
  onPlaneswalk: () => void
  onStop: () => void
  onClose: () => void
}) {
  const [flipKey, setFlipKey] = useState(0)
  useEffect(() => setFlipKey((k) => k + 1), [state.current?.id])
  const image = state.current ? displayImageUrl(state.current) : null
  return (
    <div className="lc-sheet" role="dialog" aria-modal="true" aria-label="Planechase">
      <div className="lc-sheet-head">
        <div>
          <h2>Planechase</h2>
          <p>{state.deck.length} planes left in the deck</p>
        </div>
        <button type="button" className="lc-close" onClick={onClose} aria-label="Close">
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <div className="lc-sheet-body">
        {state.current && (
          <figure className="lc-plane" key={flipKey}>
            {image && <img src={image} alt={state.current.name} />}
            <figcaption>{state.current.name}</figcaption>
          </figure>
        )}
        {state.lastRoll && (
          <div className={`lc-die-result ${state.lastRoll.face.toLowerCase()}`} key={state.lastRoll.n} aria-live="polite">
            {FACE_TEXT[state.lastRoll.face]}
          </div>
        )}
        <div className="lc-dice">
          <button type="button" onClick={onRoll}>Roll the planar die</button>
          <button type="button" onClick={onPlaneswalk} disabled={state.deck.length === 0}>Planeswalk</button>
        </div>
        <button type="button" className="lc-wide-btn" style={{ marginTop: 24 }} onClick={onStop}>End Planechase</button>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { searchCards } from '../api/scryfall'
import {
  cardFace, currentCard, loadingMode, MODE_LABEL, MODE_QUERY, planarFace, planeswalk as walk, revealNextBounty, revealNextScheme, startedMode,
  type GameModeKind, type GameModeState, type PlanarFace,
} from './gameModes'
import { displayName, type Player } from './game'
import { seatStyle } from './PlayerTile'

/**
 * The life counter's game modes, as in the Android app: Planechase (a shuffled deck of planes and
 * phenomena, a planar die, planeswalking), Archenemy (one player against the table, revealing
 * schemes) and Bounty (a bounty to claim, from Outlaws of Thunder Junction Commander). One at a time.
 */
export function useGameMode() {
  const [state, setState] = useState<GameModeState | null>(null)
  const [lastRoll, setLastRoll] = useState<{ face: PlanarFace; n: number } | null>(null)
  // The latest start: cards for a mode that has since been ended or swapped are dropped.
  const starting = useRef(0)

  const start = useCallback(async (mode: GameModeKind, archenemyPlayerId: number | null = null) => {
    const token = ++starting.current
    setLastRoll(null)
    setState(loadingMode(mode, archenemyPlayerId))
    let cards: Awaited<ReturnType<typeof searchCards>>['cards'] = []
    try {
      cards = (await searchCards(MODE_QUERY[mode])).cards
    } catch {
      // Offline: an empty deck, which the sheet explains.
    }
    if (token === starting.current) setState(startedMode(mode, cards, archenemyPlayerId))
  }, [])

  const planeswalk = useCallback(() => setState((s) => (s ? walk(s) : s)), [])

  /** A real planar die: four blank faces, one Chaos, one Planeswalk (which moves you on). */
  const rollPlanarDie = useCallback((): PlanarFace => {
    const face = planarFace(Math.floor(Math.random() * 6))
    setLastRoll((r) => ({ face, n: (r?.n ?? 0) + 1 }))
    if (face === 'PLANESWALK') planeswalk()
    return face
  }, [planeswalk])

  const revealScheme = useCallback(() => setState((s) => (s ? revealNextScheme(s) : s)), [])
  const revealBounty = useCallback(() => setState((s) => (s ? revealNextBounty(s) : s)), [])
  const stop = useCallback(() => {
    starting.current++
    setState(null)
    setLastRoll(null)
  }, [])

  return { gameMode: state, lastRoll, startGameMode: start, planeswalk, rollPlanarDie, revealScheme, revealBounty, stopGameMode: stop }
}

/** The mode's card, pinned to the top of the table; tap it for the full card and what to do next. */
export function ModeBanner({ state, onOpen }: { state: GameModeState; onOpen: () => void }) {
  const card = currentCard(state)
  const face = card ? cardFace(state, card) : null
  const art = face?.imageUrl?.replace('/normal/', '/art_crop/')
  const label = MODE_LABEL[state.mode]
  const what = state.loading ? 'Shuffling' : face ? face.name : 'Tap to draw'
  return (
    <button type="button" className="lc-plane-banner" onClick={onOpen} aria-label={`${label}: ${what}. Open`}>
      {state.loading ? <span className="lc-spinner" aria-hidden /> : art ? <img src={art} alt="" /> : null}
      <span className="lc-plane-label">{label}</span>
      <span className="lc-plane-name">{what}</span>
    </button>
  )
}

const FACE_TEXT: Record<PlanarFace, string> = {
  BLANK: 'Blank — nothing happens',
  CHAOS: 'Chaos! The plane’s chaos ability triggers',
  PLANESWALK: 'Planeswalk — on to the next plane',
}

/** The mode at full size: the card, what to do next, and a way out. */
export function ModeSheet({
  state, lastRoll, onRoll, onPlaneswalk, onRevealScheme, onRevealBounty, onStop, onClose,
}: {
  state: GameModeState
  lastRoll: { face: PlanarFace; n: number } | null
  onRoll: () => void
  onPlaneswalk: () => void
  onRevealScheme: () => void
  onRevealBounty: () => void
  onStop: () => void
  onClose: () => void
}) {
  const [showRules, setShowRules] = useState(false)
  const card = currentCard(state)
  const face = card ? cardFace(state, card) : null
  const title = MODE_LABEL[state.mode]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const subtitle = state.loading ? undefined
    : state.mode === 'PLANECHASE' ? `${state.planeDeck.length} ${state.planeDeck.length === 1 ? 'plane' : 'planes'} left in the deck`
      : state.mode === 'ARCHENEMY' ? `${state.schemeDeck.length} ${state.schemeDeck.length === 1 ? 'scheme' : 'schemes'} left in the deck`
        : undefined
  return (
    <div className="lc-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="lc-sheet-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className="lc-close" onClick={onClose} aria-label="Close">
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <div className="lc-sheet-body">
        {state.loading ? (
          <div className="lc-mode-note"><span className="lc-spinner" aria-hidden />Shuffling</div>
        ) : (
          <>
            {face && card && (
              <figure className={`lc-plane${state.mode === 'BOUNTY' ? ' portrait' : ''}`} key={card.id}>
                {face.imageUrl && <img src={face.imageUrl} alt={face.name} />}
                <figcaption>{face.name}</figcaption>
                {face.text && <p className="lc-mode-text">{face.text}</p>}
              </figure>
            )}
            {state.mode === 'PLANECHASE' && (
              <>
                {!face && <div className="lc-mode-note">Couldn't load planes — check your connection</div>}
                {lastRoll && (
                  <div className={`lc-die-result ${lastRoll.face.toLowerCase()}`} key={lastRoll.n} aria-live="polite">
                    {FACE_TEXT[lastRoll.face]}
                  </div>
                )}
                <div className="lc-dice">
                  <button type="button" onClick={onRoll} disabled={!face}>Roll planar die</button>
                  <button type="button" onClick={onPlaneswalk} disabled={state.planeDeck.length === 0}>Planeswalk</button>
                </div>
              </>
            )}
            {state.mode === 'ARCHENEMY' && (
              <>
                {!face && (
                  <div className="lc-mode-note">
                    {state.schemeDeck.length === 0 ? "Couldn't load schemes — check your connection" : 'Reveal the first scheme to begin'}
                  </div>
                )}
                {state.ongoingSchemes.length > 0 && (
                  <section>
                    <h3>Ongoing</h3>
                    <ul className="lc-ongoing">{state.ongoingSchemes.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
                  </section>
                )}
                <div className="lc-dice">
                  <button type="button" className="accent" onClick={onRevealScheme} disabled={state.schemeDeck.length === 0}>Reveal scheme</button>
                </div>
              </>
            )}
            {state.mode === 'BOUNTY' && (
              <>
                {!face && (
                  <div className="lc-mode-note">
                    {state.bountyDeck.length === 0 ? "Couldn't load bounty cards — check your connection" : "Reveal the first bounty as the starting player's third turn begins"}
                  </div>
                )}
                <div className="lc-dice">
                  <button type="button" className="accent" onClick={onRevealBounty} disabled={state.bountyDeck.length === 0}>
                    {face ? 'Claimed · next bounty' : 'Reveal bounty'}
                  </button>
                </div>
                {state.bountyRules && (
                  <>
                    <button type="button" className="lc-link" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
                      {showRules ? 'Hide rules' : 'How bounty works'}
                    </button>
                    {showRules && <p className="lc-mode-text">{state.bountyRules}</p>}
                  </>
                )}
              </>
            )}
          </>
        )}
        <button type="button" className="lc-wide-btn" style={{ marginTop: 24 }} onClick={() => { onStop(); onClose() }}>End {title}</button>
      </div>
    </div>
  )
}

/** Archenemy is one player against the rest: who it is, before the schemes are shuffled. */
export function ArchenemyPicker({ players, onPick, onClose }: { players: Player[]; onPick: (id: number) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="lc-sheet" role="dialog" aria-modal="true" aria-label="Who's the Archenemy?">
      <div className="lc-sheet-head">
        <div><h2>Who's the Archenemy?</h2></div>
        <button type="button" className="lc-close" onClick={onClose} aria-label="Close">
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <div className="lc-sheet-body">
        <div className="lc-seat-picks">
          {players.map((p, i) => (
            <button key={p.id} type="button" className="lc-seat-pick" style={{ ...seatStyle(p.colorIndex), animationDelay: `${40 * i}ms` }} onClick={() => { onPick(p.id); onClose() }}>
              {displayName(p)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

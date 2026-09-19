import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { displayName, lossReason, PLAYER_PALETTE, seatColor, startingLifeFor, type GameAction, type LifeSettings, type Player } from './game'
import type { SeatFacing } from './tableLayouts'
import { avatarUrl } from '../social/api'

/** How long a "+3"/"−3" tally stays up after the last tap before it clears. */
const FEEDBACK_HOLD_MS = 1500
const LONG_PRESS_MS = 450
const REPEAT_MS = 600

const LOSS_TEXT: Record<string, string> = {
  LIFE: 'Out of life',
  POISON: 'Poisoned out',
  COMMANDER_DAMAGE: 'Commander damage',
  KILLED: 'Out',
}

/** Style for a seat: its colour (P3 where supported, via CSS) and ink. */
export function seatStyle(colorIndex: number): CSSProperties {
  const c = seatColor(colorIndex)
  return { ['--seat' as string]: c.srgb, ['--seat-p3' as string]: c.p3, ['--ink' as string]: c.whiteText ? '#fff' : '#000' }
}

/**
 * Turns content to face the player at [facing]'s edge. The wrapper is a size container, so a
 * sideways face is laid out with the cell's width and height swapped and genuinely fills it.
 */
export function Face({ facing, className = '', children }: { facing: SeatFacing; className?: string; children: React.ReactNode }) {
  return (
    <div className={`lc-face ${className}`}>
      <div className={`lc-face-inner face-${facing.toLowerCase()}`}>{children}</div>
    </div>
  )
}

/**
 * Tap for ±1, hold for ±[longPressAmount] (repeating while held). A hold stops when [active] turns
 * false — the buttons go away (a high roll starting, say) without ever seeing the finger lift.
 */
function useStepper(onStep: (amount: number) => void, longPressAmount: number, active: boolean) {
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])
  useEffect(() => { if (!active) stop() }, [active])
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      held.current = false
      stop()
      const repeat = () => {
        held.current = true
        onStep(longPressAmount)
        timer.current = window.setTimeout(repeat, REPEAT_MS)
      }
      timer.current = window.setTimeout(repeat, LONG_PRESS_MS)
    },
    onPointerUp: () => {
      const wasHeld = held.current
      const pending = timer.current !== null
      stop()
      if (!wasHeld && pending) onStep(1)
    },
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
}

export function PlayerTile({
  player,
  opponents,
  facing,
  settings,
  activeTurn,
  isMonarch,
  hasInitiative,
  highRoll,
  turnNumber,
  onEndTurn,
  dispatch,
  onPanelOpenChange,
  onLinkSeat,
  onUnlink,
}: {
  player: Player
  opponents: Player[]
  facing: SeatFacing
  settings: LifeSettings
  activeTurn: boolean
  isMonarch: boolean
  hasInitiative: boolean
  /** This player's high roll and whether it was the highest, while one is showing. */
  highRoll: { value: number; winner: boolean } | null
  /** Shown on the tile whose turn it is, with the button that ends it. */
  turnNumber: number
  onEndTurn: () => void
  dispatch: (a: GameAction) => void
  /** The page dims the menu button while a panel covers a tile. */
  onPanelOpenChange: (open: boolean) => void
  /** Shows this seat's QR code, for a player to join with their profile. */
  onLinkSeat: () => void
  /** Frees the seat from the profile sitting there. */
  onUnlink: () => void
}) {
  const [pending, setPending] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  // Tell the table while a panel is open — and that it closed when the tile goes away with it open
  // (the table rebuilds its tiles when the device turns), or the menu button would stay hidden.
  const panelOpenChange = useRef(onPanelOpenChange)
  panelOpenChange.current = onPanelOpenChange
  useEffect(() => {
    if (!panelOpen) return
    panelOpenChange.current(true)
    return () => panelOpenChange.current(false)
  }, [panelOpen])
  const [changeCount, setChangeCount] = useState(0)
  const [shake, setShake] = useState(0)

  useEffect(() => {
    if (pending === 0) return
    const t = window.setTimeout(() => setPending(0), FEEDBACK_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [pending, changeCount])

  const change = (delta: number) => {
    dispatch({ type: 'life', id: player.id, delta })
    setChangeCount((c) => c + 1)
    setPending((p) => ((p > 0) === (delta > 0) || p === 0 ? p + delta : delta))
    if (Math.abs(delta) >= settings.longPressAmount) setShake((s) => s + 1)
    navigator.vibrate?.(8)
  }
  const minus = useStepper((n) => change(-n), settings.longPressAmount, !highRoll)
  const plus = useStepper((n) => change(n), settings.longPressAmount, !highRoll)

  const loss = lossReason(player, settings.autoKill)
  const damageTaken = opponents
    .map((o) => ({ o, dmg: player.commanderDamage[o.id] ?? 0 }))
    .filter((x) => x.dmg > 0)

  const label = (sign: 1 | -1) => {
    const active = pending !== 0 && (pending > 0) === (sign > 0)
    return { text: active ? `${pending > 0 ? '+' : '−'}${Math.abs(pending)}` : sign > 0 ? '+' : '−', active }
  }
  const minusLabel = label(-1)
  const plusLabel = label(1)

  return (
    <Face facing={facing} className={`lc-tile${activeTurn ? ' active' : ''}${loss ? ' out' : ''}`}>
      <div className="lc-tile-body" style={seatStyle(player.colorIndex)}>
        <div className="lc-top">
          {isMonarch && (
            <span className="lc-chip lc-token" title="Monarch">
              <span className="material-symbols-rounded" aria-hidden>crown</span>
              <span className="lc-token-label">Monarch</span>
            </span>
          )}
          {hasInitiative && (
            <span className="lc-chip lc-token" title="Initiative">
              <span className="material-symbols-rounded" aria-hidden>swords</span>
              <span className="lc-token-label">Initiative</span>
            </span>
          )}
          <button type="button" className={`lc-name${player.linked ? ' linked' : ''}`} onClick={() => setPanelOpen(true)} aria-label={`${displayName(player)} — commander damage, poison and more`}>
            {player.linked && <SeatAvatar player={player} />}
            <span className="lc-name-text">{displayName(player)}</span>
          </button>
          {damageTaken.length > 0 && (
            <button type="button" className="lc-chip" onClick={() => setPanelOpen(true)} aria-label="Commander damage received">
              <span className="material-symbols-rounded" aria-hidden>local_fire_department</span>
              {damageTaken.map(({ o, dmg }) => (
                <span key={o.id} className="lc-dmg"><i style={seatStyle(o.colorIndex)} />{dmg}</span>
              ))}
            </button>
          )}
          {player.poison > 0 && (
            <button type="button" className="lc-chip" onClick={() => setPanelOpen(true)} aria-label={`${player.poison} poison`}>
              <span className="material-symbols-rounded" aria-hidden>water_drop</span>{player.poison}
            </button>
          )}
        </div>

        <div className="lc-life" key={shake} data-shake={shake > 0 || undefined}>{player.life}</div>
        {loss && !highRoll && <div className="lc-out-note">{LOSS_TEXT[loss]}</div>}

        {/* The corners of the tile whose turn it is: out of the way of the life total in the middle. */}
        {activeTurn && !loss && !highRoll && (
          <>
            <span className="lc-turn-label">Turn {turnNumber}</span>
            <button type="button" className="lc-end-turn" onClick={onEndTurn} aria-label="End turn" title="End turn">
              <span className="material-symbols-rounded" aria-hidden>check</span>
            </button>
          </>
        )}

        {!highRoll && (
          <>
            <button type="button" className="lc-tap minus" aria-label={`Lose life (hold for ${settings.longPressAmount})`} {...minus}>
              <span className={minusLabel.active ? 'on' : ''}>{minusLabel.text}</span>
            </button>
            <button type="button" className="lc-tap plus" aria-label={`Gain life (hold for ${settings.longPressAmount})`} {...plus}>
              <span className={plusLabel.active ? 'on' : ''}>{plusLabel.text}</span>
            </button>
          </>
        )}

        {highRoll && <RollFace value={highRoll.value} winner={highRoll.winner} />}

        {panelOpen && (
          <PlayerPanel
            player={player}
            opponents={opponents}
            settings={settings}
            dispatch={dispatch}
            onClose={() => setPanelOpen(false)}
            onLinkSeat={() => { setPanelOpen(false); onLinkSeat() }}
            onUnlink={onUnlink}
          />
        )}
      </div>
    </Face>
  )
}

const STAR_COLORS = ['#ff005f', '#ffc600', '#4352ff', '#2bd98f', '#fff', '#c79bff']

/**
 * A seat during a high roll: just the roll, big, in the middle. Everyone else's goes dark grey; the
 * winner's turns rainbow with stars twinkling across it.
 */
function RollFace({ value, winner }: { value: number; winner: boolean }) {
  const [stars] = useState(() =>
    Array.from({ length: 18 }, (_, i) => ({
      left: Math.random() * 92,
      top: Math.random() * 92,
      delay: Math.random() * 1.4,
      size: 12 + Math.random() * 14,
      color: STAR_COLORS[i % STAR_COLORS.length],
    })),
  )
  return (
    <div className={`lc-roll-face${winner ? ' win' : ''}`} role="img" aria-label={winner ? `Rolled ${value}, goes first` : `Rolled ${value}`}>
      {winner && stars.map((s, i) => (
        <span key={i} className="lc-star" style={{ left: `${s.left}%`, top: `${s.top}%`, animationDelay: `${s.delay}s`, fontSize: s.size, color: s.color }}>★</span>
      ))}
      <span className="lc-roll-num">{value}</span>
    </div>
  )
}

/** Commander damage, poison, name and colour for one player, drawn inside their own tile (facing them). */
function PlayerPanel({
  player,
  opponents,
  settings,
  dispatch,
  onClose,
  onLinkSeat,
  onUnlink,
}: {
  player: Player
  opponents: Player[]
  settings: LifeSettings
  dispatch: (a: GameAction) => void
  onClose: () => void
  onLinkSeat: () => void
  onUnlink: () => void
}) {
  const [name, setName] = useState(player.name ?? '')
  const loss = lossReason(player, settings.autoKill)
  const commit = () => { if ((player.name ?? '') !== name.trim()) dispatch({ type: 'name', id: player.id, name }) }

  return (
    <div className="lc-panel" onClick={(e) => e.stopPropagation()}>
      <div className="lc-panel-head">
        {player.linked ? (
          <div className="lc-linked">
            <SeatAvatar player={player} />
            <span className="lc-linked-text">
              <b>{player.linked.displayName}</b>
              <span>@{player.linked.username}</span>
            </span>
          </div>
        ) : (
          <input
            className="lc-name-input"
            value={name}
            placeholder={`Player ${player.id}`}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            aria-label="Player name"
          />
        )}
        <button type="button" className="lc-icon-btn" onClick={() => { if (!player.linked) commit(); onClose() }} aria-label="Close">
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <div className="lc-panel-scroll">
        {player.linked ? (
          <button type="button" className="lc-wide-btn lc-link-btn" onClick={onUnlink}>
            <span className="material-symbols-rounded" aria-hidden>link_off</span>Free this seat
          </button>
        ) : (
          <button type="button" className="lc-wide-btn lc-link-btn" onClick={() => { commit(); onLinkSeat() }}>
            <span className="material-symbols-rounded" aria-hidden>qr_code_2</span>Join with a profile
          </button>
        )}
        {opponents.length > 0 && <div className="lc-panel-label">Commander damage taken</div>}
        {opponents.map((o) => (
          <Counter
            key={o.id}
            label={displayName(o)}
            dot={o.colorIndex}
            value={player.commanderDamage[o.id] ?? 0}
            onChange={(delta) => dispatch({ type: 'commanderDamage', id: player.id, from: o.id, delta, costsLife: settings.commanderDamageCostsLife })}
          />
        ))}
        <Counter label="Poison" value={player.poison} onChange={(delta) => dispatch({ type: 'poison', id: player.id, delta })} />

        <div className="lc-panel-label">Colour</div>
        <div className="lc-swatches">
          {PLAYER_PALETTE.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`lc-swatch${i === player.colorIndex ? ' on' : ''}`}
              style={seatStyle(i)}
              onClick={() => dispatch({ type: 'color', id: player.id, colorIndex: i })}
              aria-label={`Colour ${i + 1}`}
              aria-pressed={i === player.colorIndex}
            />
          ))}
        </div>

        <button
          type="button"
          className="lc-wide-btn"
          onClick={() => {
            if (loss) dispatch({ type: 'revive', id: player.id, life: startingLifeFor(settings, opponents.length + 1) })
            else dispatch({ type: 'kill', id: player.id })
          }}
        >
          {loss ? 'Bring back into the game' : 'Knock out'}
        </button>
      </div>
    </div>
  )
}

/** The picture of the profile sitting at a seat (a GIF keeps playing), or their initial. */
function SeatAvatar({ player }: { player: Player }) {
  const url = avatarUrl(player.linked?.avatarPath)
  const [failed, setFailed] = useState(false)
  if (url && !failed) return <img className="lc-avatar" src={url} alt="" onError={() => setFailed(true)} />
  return <span className="lc-avatar initial" aria-hidden>{(player.linked?.displayName.trim()[0] ?? '?').toUpperCase()}</span>
}

function Counter({ label, value, dot, onChange }: { label: string; value: number; dot?: number; onChange: (delta: number) => void }) {
  return (
    <div className="lc-counter">
      <button type="button" className="lc-step" onClick={() => onChange(-1)} aria-label={`${label} minus one`}>−</button>
      <div className="lc-counter-mid">
        <b>{value}</b>
        <span>{dot !== undefined && <i style={seatStyle(dot)} />}{label}</span>
      </div>
      <button type="button" className="lc-step" onClick={() => onChange(1)} aria-label={`${label} plus one`}>+</button>
    </div>
  )
}

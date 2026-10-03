import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  COUNTER_INFO, COUNTER_KINDS, counterOf, damageFrom, defeatMessageFor, displayName, inDanger, lossReason, lowLife, PLAYER_PALETTE, seatColor,
  startingLifeFor, tileCounters, victoryMessageFor,
  type GameAction, type LifeSettings, type Player,
} from './game'
import type { SeatFacing } from './tableLayouts'
import { avatarUrl } from '../social/api'
import { clockElapsed, tokenChipText, tokenLabel, turnTimeLeft, turnTimerText, type GameClock } from './tableExtras'
import { useNow } from './useNow'

/** The turn timer on the active player's tile: it counts itself down on [clock]. */
export interface TileTurnTimer { clock: GameClock; turnStartElapsed: number; minutes: number }

/** How long a "+3"/"−3" tally stays up after the last tap before it clears. */
const FEEDBACK_HOLD_MS = 1500
const LONG_PRESS_MS = 450
const REPEAT_MS = 600

/** The life total, with 6 and 9 underlined (Settings → Underlined 6 and 9) so upside down they can't be misread. */
export function LifeNumber({ value, underline }: { value: number; underline: boolean }) {
  const text = String(value)
  if (!underline || !/[69]/.test(text)) return <>{text}</>
  return <>{[...text].map((ch, i) => (ch === '6' || ch === '9' ? <u key={i}>{ch}</u> : ch))}</>
}

/** Style for a seat: its colour (P3 where supported, via CSS) and ink. */
export function seatStyle(colorIndex: number): CSSProperties {
  const c = seatColor(colorIndex)
  return { ['--seat' as string]: c.srgb, ['--seat-p3' as string]: c.p3, ['--ink' as string]: c.whiteText ? '#fff' : '#000' }
}

/** A picture behind the tile (chosen from the player's remote), darkened so white numbers read on it. */
function tileStyle(player: Player): CSSProperties {
  const base = seatStyle(player.colorIndex)
  if (!player.background) return base
  return {
    ...base,
    ['--ink' as string]: '#fff',
    backgroundImage: `linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.5)), url("${player.background.replace(/"/g, '%22')}")`,
  }
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
 * Tap for ±[tapAmount] (1 unless set), hold for ±[longPressAmount] (repeating while held). A hold stops when [active] turns
 * false — the buttons go away (a high roll starting, say) without ever seeing the finger lift.
 * Enter, Space and a screen reader's activate give one tap too: they fire a click with no pointer
 * behind it (detail 0), while a real tap's click is skipped since its pointer events already counted.
 */
export function useStepper(onStep: (amount: number) => void, longPressAmount: number, active: boolean, tapAmount = 1) {
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
      if (!wasHeld && pending) onStep(tapAmount)
    },
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) onStep(tapAmount)
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
  onPickCommander,
  onPickMe,
  meDeck,
  holding = false,
  targetedBy = null,
  winner = false,
  gameNumber = 0,
  messageTick = 0,
  turnTimer = null,
  reminders = [],
  onDismissReminders,
}: {
  player: Player
  opponents: Player[]
  facing: SeatFacing
  settings: LifeSettings
  activeTurn: boolean
  isMonarch: boolean
  hasInitiative: boolean
  /** This player asked everyone to hold on (from their phone). */
  holding?: boolean
  /** Who is pointing at this player from their phone, for a moment. */
  targetedBy?: string | null
  /** The game is over and this player is the last one standing. */
  winner?: boolean
  /** Which game this is and how far cycling messages have moved, so a drawn message holds steady. */
  gameNumber?: number
  messageTick?: number
  /** This player's high roll and whether it was the highest, while one is showing. */
  highRoll: { value: number; winner: boolean } | null
  /** Shown on the tile whose turn it is, with the button that ends it. */
  turnNumber: number
  /** On the player whose turn it is, with the turn timer on. */
  turnTimer?: TileTurnTimer | null
  /** At the start of their turn: their deck's "at the beginning of your …" cards, one line per step. */
  reminders?: string[]
  onDismissReminders?: () => void
  onEndTurn: () => void
  dispatch: (a: GameAction) => void
  /** The page dims the menu button while a panel covers a tile. */
  onPanelOpenChange: (open: boolean) => void
  /** Shows this seat's QR code, for a player to join with their profile. */
  onLinkSeat: () => void
  /** Frees the seat from the profile sitting there. */
  onUnlink: () => void
  /** Picks the commander played at this seat (for a player without a phone of their own). */
  onPickCommander: () => void
  /** Marks this seat as the table owner's and picks their deck; absent with no decks to save to. */
  onPickMe?: () => void
  /** When this seat is the table owner's: the deck their games here are saved to ('' before one's picked). */
  meDeck?: string | null
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
  const turnLabelOut = useTurnLabelClear(activeTurn)

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
  const minus = useStepper((n) => change(-n), settings.longPressAmount, !highRoll, settings.tapAmount)
  const plus = useStepper((n) => change(n), settings.longPressAmount, !highRoll, settings.tapAmount)

  const loss = lossReason(player, settings.autoKill)
  const defeat = loss ? defeatMessageFor(player, loss, settings, gameNumber, messageTick) : null
  const victory = !loss && winner ? victoryMessageFor(player, settings, gameNumber, messageTick) : null
  const damageTaken = settings.showCommanderDamageOnTile
    ? opponents
      .flatMap((o) => [0, 1].map((slot) => ({ o, slot, dmg: damageFrom(player, o.id, slot) })))
      .filter((x) => x.dmg > 0)
    : []
  const counters = tileCounters(player, settings)
  const casts = (player.commanderCasts ?? 0) + (player.partnerCasts ?? 0)

  const label = (sign: 1 | -1) => {
    const active = pending !== 0 && (pending > 0) === (sign > 0)
    // Minimalist mode: no + and − until a tap shows what it did.
    return { text: active ? `${pending > 0 ? '+' : '−'}${Math.abs(pending)}` : settings.minimalist ? '' : sign > 0 ? '+' : '−', active }
  }
  const minusLabel = label(-1)
  const plusLabel = label(1)

  return (
    <Face
      facing={facing}
      className={`lc-tile${activeTurn ? ' active' : ''}${loss ? ' out' : ''}${!loss && (inDanger(player) || lowLife(player, settings)) ? ' danger' : ''}${targetedBy ? ' targeted' : ''}${settings.verticalTapAreas ? ' vertical-taps' : ''}`}
    >
      <div className={`lc-tile-body${player.background ? ' has-bg' : ''}`} style={tileStyle(player)}>
        {targetedBy && <div className="lc-target-note" key={targetedBy}><span className="material-symbols-rounded" aria-hidden>my_location</span>{targetedBy} points at you</div>}
        <div className="lc-top">
          {holding && (
            <span className="lc-chip lc-token lc-hold" title="Asked everyone to hold on">
              <span className="material-symbols-rounded" aria-hidden>pan_tool</span>
              <span className="lc-token-label">Hold on</span>
            </span>
          )}
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
          {/* Without names on the cards the button stays, as a plain handle to the player's panel. */}
          <button type="button" className={`lc-name${player.linked ? ' linked' : ''}${settings.playerNamesOnTile ? '' : ' bare'}`} onClick={() => setPanelOpen(true)} aria-label={`${displayName(player)} — commander damage, poison and more`}>
            {player.linked && <SeatAvatar player={player} />}
            {settings.playerNamesOnTile
              ? <span className="lc-name-text">{displayName(player)}</span>
              : !player.linked && <span className="material-symbols-rounded" aria-hidden>more_horiz</span>}
          </button>
          {damageTaken.length > 0 && (
            <button type="button" className="lc-chip" onClick={() => setPanelOpen(true)} aria-label="Commander damage received">
              <span className="material-symbols-rounded" aria-hidden>local_fire_department</span>
              {damageTaken.map(({ o, slot, dmg }) => (
                <span key={`${o.id}-${slot}`} className="lc-dmg" title={slot === 1 ? `${displayName(o)}'s partner` : undefined}>
                  <i style={seatStyle(o.colorIndex)} />{slot === 1 ? 'P' : ''}{dmg}
                </span>
              ))}
            </button>
          )}
          {counters.map((k) => k === 'poison' ? (
            <button key={k} type="button" className="lc-chip" onClick={() => setPanelOpen(true)} aria-label={`${player.poison} poison`}>
              <span className="material-symbols-rounded" aria-hidden>water_drop</span>{player.poison}
            </button>
          ) : (
            <button key={k} type="button" className="lc-chip" onClick={() => setPanelOpen(true)} aria-label={`${COUNTER_INFO[k].label} ${counterOf(player, k)}`}>
              <span className="material-symbols-rounded" aria-hidden>{COUNTER_INFO[k].icon}</span>{counterOf(player, k)}
            </button>
          ))}
          {settings.countersOnTile && casts > 0 && (
            <span
              className="lc-chip"
              title={`Cast their commander ${player.commanderCasts ?? 0} times${player.hasPartner ? `, their partner ${player.partnerCasts ?? 0}` : ''}`}
              aria-label={`Commander tax ${2 * (player.commanderCasts ?? 0)}${player.hasPartner ? `, partner tax ${2 * (player.partnerCasts ?? 0)}` : ''}`}
            >
              <span className="material-symbols-rounded" aria-hidden>add_circle</span>
              Tax {2 * (player.commanderCasts ?? 0)}{player.hasPartner ? ` / ${2 * (player.partnerCasts ?? 0)}` : ''}
            </span>
          )}
        </div>

        <div className="lc-life" key={shake} data-shake={shake > 0 || undefined}><LifeNumber value={player.life} underline={settings.underlineSixNine} /></div>
        {defeat && !highRoll && <div className="lc-outcome defeat" role="status">{defeat}</div>}
        {victory && !highRoll && <div className="lc-outcome victory" role="status">{victory}</div>}

        {/* The corners of the tile whose turn it is: out of the way of the life total in the middle. */}
        {activeTurn && !loss && !highRoll && (
          <>
            <span className={`lc-turn-label${turnLabelOut.flip ? ' flip' : ''}`} ref={turnLabelOut.ref}>Turn {turnNumber}{turnTimer && <TurnTimerLabel timer={turnTimer} />}</span>
            <button type="button" className="lc-end-turn" onClick={onEndTurn} aria-label="End turn" title="End turn">
              <span className="material-symbols-rounded" aria-hidden>check</span>
            </button>
          </>
        )}

        {!highRoll && (
          <>
            <button type="button" className="lc-tap minus" aria-label={`Lose ${settings.tapAmount} life, ${displayName(player)} (hold for ${settings.longPressAmount})`} {...minus}>
              <span className={minusLabel.active ? 'on' : ''}>{minusLabel.text}</span>
            </button>
            <button type="button" className="lc-tap plus" aria-label={`Gain ${settings.tapAmount} life, ${displayName(player)} (hold for ${settings.longPressAmount})`} {...plus}>
              <span className={plusLabel.active ? 'on' : ''}>{plusLabel.text}</span>
            </button>
          </>
        )}

        {!loss && !highRoll && reminders.length > 0 && (
          <button
            type="button"
            className="lc-reminder"
            onClick={onDismissReminders}
            aria-label={`Trigger reminder: ${reminders.join('. ')}. Tap to dismiss.`}
          >
            <span className="lc-reminder-lines">{reminders.slice(0, 4).map((line) => <span key={line}>{line}</span>)}</span>
            <span className="lc-reminder-x" aria-hidden>✕</span>
          </button>
        )}
        {!loss && !highRoll && (player.deckInfo?.tokens.length ?? 0) > 0 && (
          <div className={`lc-deck-tokens${activeTurn ? ' beside-end-turn' : ''}`}>
            {player.deckInfo!.tokens.map((t) => {
              const count = player.tokenCounts?.[t.id] ?? 0
              return (
                <span key={t.id} className={`lc-deck-token${count > 0 ? ' out' : ''}`}>
                  {count > 0 && (
                    <button type="button" className="lc-deck-token-minus" onClick={() => dispatch({ type: 'token', id: player.id, tokenId: t.id, delta: -1 })} aria-label={`One fewer ${tokenLabel(t)}`}>−</button>
                  )}
                  <button type="button" className="lc-deck-token-plus" onClick={() => dispatch({ type: 'token', id: player.id, tokenId: t.id, delta: 1 })} aria-label={`One more ${tokenLabel(t)}, ${count} out`}>
                    {tokenChipText(t, count)}
                  </button>
                </span>
              )
            })}
          </div>
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
            onPickCommander={() => { setPanelOpen(false); onPickCommander() }}
            onPickMe={onPickMe && (() => { setPanelOpen(false); onPickMe() })}
            meDeck={meDeck}
          />
        )}
      </div>
    </Face>
  )
}

/** The turn's time left, ticking; red and counting up once it has run over. */
/**
 * Keeps the whose-turn label (with its turn timer) clear of the table's centre menu button. The
 * label sits in its tile's top-left corner; on a sideways tile that corner can land at the middle of
 * the table — a 4-player phone layout, say — under the button. Then it moves to the top-right
 * corner, which is the tile's other end. Measured as the tile grows and the device turns.
 */
function useTurnLabelClear(active: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  const [flip, setFlip] = useState(false)
  useLayoutEffect(() => {
    const label = ref.current
    if (!active || !label) return
    const measure = () => {
      const menu = document.querySelector('.lc-menu-btn')
      if (!menu) return setFlip(false)
      // Where the label sits in its usual corner, whichever corner it shows in now.
      const flipped = label.classList.contains('flip')
      label.classList.remove('flip')
      const a = label.getBoundingClientRect()
      if (flipped) label.classList.add('flip')
      const m = menu.getBoundingClientRect()
      setFlip(a.left < m.right && a.right > m.left && a.top < m.bottom && a.bottom > m.top)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(label)
    if (label.parentElement) observer.observe(label.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [active])
  return { ref, flip }
}

function TurnTimerLabel({ timer }: { timer: TileTurnTimer }) {
  const now = useNow(500, timer.clock.pausedAt === null)
  const left = turnTimeLeft(timer.minutes, timer.turnStartElapsed, clockElapsed(timer.clock, now))
  if (left === null) return null
  return <span className={`lc-turn-timer${left <= 0 ? ' over' : ''}`}>{left <= 0 ? `Time! ${turnTimerText(left)}` : turnTimerText(left)}</span>
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
  onPickCommander,
  onPickMe,
  meDeck,
}: {
  player: Player
  opponents: Player[]
  settings: LifeSettings
  dispatch: (a: GameAction) => void
  onClose: () => void
  onLinkSeat: () => void
  onUnlink: () => void
  onPickCommander: () => void
  onPickMe?: () => void
  meDeck?: string | null
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
          <>
            <button type="button" className="lc-wide-btn lc-link-btn" onClick={() => { commit(); onLinkSeat() }}>
              <span className="material-symbols-rounded" aria-hidden>qr_code_2</span>Join with a profile
            </button>
            {/* For a player without a phone: what they're playing, for everyone's game records. */}
            <button type="button" className="lc-wide-btn" onClick={() => { commit(); onPickCommander() }}>
              <span className="material-symbols-rounded" aria-hidden>swords</span>{player.commander ?? 'Set commander'}
            </button>
            {onPickMe && (
              <button type="button" className={`lc-wide-btn${meDeck != null ? ' lc-me' : ''}`} onClick={() => { commit(); onPickMe() }}>
                <span className="material-symbols-rounded" aria-hidden>person</span>
                {meDeck == null ? 'This is me' : meDeck === '' ? 'Me · pick a deck' : `Me · saving to ${meDeck}`}
              </button>
            )}
          </>
        )}
        {player.linked && player.commander && <div className="lc-panel-label">Playing {player.commander}</div>}
        <button
          type="button"
          className={`lc-wide-btn${player.hasPartner ? ' lc-me' : ''}`}
          aria-pressed={!!player.hasPartner}
          onClick={() => dispatch({ type: 'partner', id: player.id, on: !player.hasPartner })}
        >
          <span className="material-symbols-rounded" aria-hidden>group</span>{player.hasPartner ? 'Partners ✓' : 'Partners'}
        </button>
        {opponents.length > 0 && <div className="lc-panel-label">Commander damage taken</div>}
        {/* Each of an opponent's partners on its own row: 21 from either one is lethal, not both together. */}
        {opponents.flatMap((o) => (o.hasPartner ? [0, 1] : [0]).map((slot) => (
          <Counter
            key={`${o.id}-${slot}`}
            label={`${displayName(o)}${o.hasPartner ? (slot === 0 ? ' · commander' : ' · partner') : ''}`}
            dot={o.colorIndex}
            value={damageFrom(player, o.id, slot)}
            onChange={(delta) => dispatch({ type: 'commanderDamage', id: player.id, from: o.id, delta, costsLife: settings.commanderDamageCostsLife, slot })}
          />
        )))}
        <div className="lc-panel-label">Commander tax</div>
        <Counter
          label={`${player.hasPartner ? 'Commander' : 'Casts'} · tax ${2 * (player.commanderCasts ?? 0)}`}
          value={player.commanderCasts ?? 0}
          onChange={(delta) => dispatch({ type: 'commanderCast', id: player.id, delta })}
        />
        {player.hasPartner && (
          <Counter
            label={`Partner · tax ${2 * (player.partnerCasts ?? 0)}`}
            value={player.partnerCasts ?? 0}
            onChange={(delta) => dispatch({ type: 'commanderCast', id: player.id, delta, slot: 1 })}
          />
        )}
        <Counter label="Poison" value={player.poison} onChange={(delta) => dispatch({ type: 'poison', id: player.id, delta })} />
        {!!player.deckInfo?.tokens.length && (
          <>
            <div className="lc-panel-label">{player.deckInfo.deck ? `Tokens · ${player.deckInfo.deck}` : 'Deck tokens'}</div>
            {player.deckInfo.tokens.map((t) => (
              <Counter key={t.id} label={tokenLabel(t)} value={player.tokenCounts?.[t.id] ?? 0} onChange={(delta) => dispatch({ type: 'token', id: player.id, tokenId: t.id, delta })} />
            ))}
          </>
        )}
        <div className="lc-panel-label">Counters</div>
        {COUNTER_KINDS.map((k) => (
          <Counter key={k} label={COUNTER_INFO[k].label} value={counterOf(player, k)} onChange={(delta) => dispatch({ type: 'counter', id: player.id, counter: k, delta })} />
        ))}
        <div className="lc-panel-label">My victory message</div>
        <MessageField value={player.victoryMessage ?? ''} label="My victory message" onCommit={(v) => dispatch({ type: 'messages', id: player.id, victory: v })} />
        <div className="lc-panel-label">My defeat message</div>
        <MessageField value={player.defeatMessage ?? ''} label="My defeat message" onCommit={(v) => dispatch({ type: 'messages', id: player.id, defeat: v })} />
        {player.background && (
          <button type="button" className="lc-wide-btn" onClick={() => dispatch({ type: 'background', id: player.id, url: null })}>
            <span className="material-symbols-rounded" aria-hidden>hide_image</span>Remove the tile picture
          </button>
        )}

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

/** A player's own message; empty uses the table's lists. Saved when the field is left. */
function MessageField({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  return (
    <input
      className="lc-name-input lc-message-input"
      value={text}
      placeholder="Use the table's messages"
      maxLength={60}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== value) onCommit(text) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

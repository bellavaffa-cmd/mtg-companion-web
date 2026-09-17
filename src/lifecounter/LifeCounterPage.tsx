import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { displayName, formatElapsed, highRoll, useLifeCounter, type Game, type GameAction, type LifeSettings } from './game'
import { PlayerTile, seatStyle } from './PlayerTile'
import {
  layoutById, layoutDescription, playerCount, sections, TABLE_LAYOUTS, turned,
  type SeatCell, type TableLayout,
} from './tableLayouts'
import './lifecounter.css'

type Overlay = null | 'seating' | 'settings' | 'restart' | 'dice'

/**
 * Whether the screen is wider than tall, and — when it is — whether the device was turned
 * clockwise from portrait (screen orientation "landscape-secondary"), so each player's tile can
 * stay on their side of the table whichever way the tablet or phone was turned.
 */
function useTableOrientation() {
  const read = () => ({
    landscape: window.innerWidth > window.innerHeight,
    clockwise: screen.orientation?.type === 'landscape-secondary',
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    const update = () => setState(read())
    window.addEventListener('resize', update)
    screen.orientation?.addEventListener?.('change', update)
    return () => {
      window.removeEventListener('resize', update)
      screen.orientation?.removeEventListener?.('change', update)
    }
  }, [])
  return state
}

/** Keeps the screen awake while the life counter is open, where the browser allows it. */
function useWakeLock() {
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

export function LifeCounterPage() {
  const navigate = useNavigate()
  const lc = useLifeCounter()
  const { settings, game, dispatch, showStrip } = lc
  const layout = layoutById(game.layoutId)
  const { landscape, clockwise } = useTableOrientation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [roll, setRoll] = useState<ReturnType<typeof highRoll> | null>(null)
  useWakeLock()

  useEffect(() => {
    document.title = 'Life counter · MTG Companion'
    return () => { document.title = 'MTG Companion' }
  }, [])

  // High-roll dice stay on the tiles for a few seconds, then the winner takes the first turn.
  useEffect(() => {
    if (!roll) return
    const t = window.setTimeout(() => {
      dispatch({ type: 'firstPlayer', id: roll.winnerId })
      setRoll(null)
    }, 3500)
    return () => window.clearTimeout(t)
  }, [roll, dispatch])

  const closeAll = () => { setMenuOpen(false); setOverlay(null) }
  const open = (o: Overlay) => { setMenuOpen(false); setOverlay(o) }

  const seat = (cell: SeatCell, key: string) => {
    const player = cell.seat === null ? undefined : game.players.find((p) => p.id === cell.seat)
    if (!player) return <div key={key} className="lc-cell lc-empty" />
    return (
      <div key={key} className="lc-cell">
        <PlayerTile
          player={player}
          opponents={game.players.filter((p) => p.id !== player.id)}
          facing={cell.facing}
          settings={settings}
          activeTurn={settings.turnTracker && game.turnPlayerId === player.id && game.players.length > 1}
          highRoll={roll ? { rolls: roll.rolls[player.id] ?? [], winner: roll.winnerId === player.id } : null}
          dispatch={dispatch}
        />
      </div>
    )
  }

  const bar = (vertical: boolean) => (
    <CentreBar key="bar" vertical={vertical} showStrip={showStrip}>
      {showStrip && <TurnStrip game={game} settings={settings} dispatch={dispatch} />}
      <MenuButton open={menuOpen} onClick={() => (overlay ? closeAll() : setMenuOpen((m) => !m))} />
      {menuOpen && (
        <RadialMenu
          onRestart={() => open('restart')}
          onHighRoll={() => { setMenuOpen(false); setRoll(highRoll(game.players.map((p) => p.id))) }}
          onSeating={() => open('seating')}
          onSettings={() => open('settings')}
          onDice={() => open('dice')}
          onExit={() => navigate('/')}
        />
      )}
    </CentreBar>
  )

  return (
    <div className="lc-root">
      <TableSurface layout={layout} landscape={landscape} clockwise={clockwise} seat={seat} bar={bar} />
      {menuOpen && <button type="button" className="lc-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      {overlay === 'restart' && (
        <Confirm text="Start a new game?" confirm="New game" onConfirm={() => { lc.restart(); closeAll() }} onCancel={closeAll} />
      )}
      {overlay === 'seating' && (
        <SeatingOverlay current={game.layoutId} onPick={(id) => { lc.selectLayout(id); closeAll() }} onClose={closeAll} />
      )}
      {overlay === 'settings' && <SettingsOverlay lc={lc} onClose={closeAll} />}
      {overlay === 'dice' && <DiceOverlay onClose={closeAll} />}
    </div>
  )
}

/**
 * Lays the seats out around the centre bar. Portrait (or a table with no facing pairs): end seats
 * above and below, pairs side by side with the bar running down between them. Landscape: the same
 * table turned a quarter turn with the device, bar running across.
 */
function TableSurface({
  layout, landscape, clockwise, seat, bar,
}: {
  layout: TableLayout
  landscape: boolean
  clockwise: boolean
  seat: (cell: SeatCell, key: string) => ReactNode
  bar: (vertical: boolean) => ReactNode
}) {
  const secs = sections(layout)
  const hasPairs = secs.some((s) => s.kind === 'pairs')

  if (!landscape || !hasPairs) {
    // Without pairs the bar goes between the end seats (or above a lone seat).
    const barAfter = hasPairs ? -1 : Math.floor(secs.length / 2) - 1
    return (
      <div className="lc-table lc-vert">
        {!hasPairs && barAfter < 0 && bar(false)}
        {secs.map((section, i) => (
          <Fragment key={i}>
            {section.kind === 'end' ? (
              <div className="lc-grow" style={{ flexGrow: 1 }}>{seat(section.cell, `e${i}`)}</div>
            ) : (
              <div className="lc-grow lc-horz" style={{ flexGrow: section.rows.length }}>
                <div className="lc-col">{section.rows.map((row, r) => seat(row.cells[0], `l${i}-${r}`))}</div>
                {bar(true)}
                <div className="lc-col">{section.rows.map((row, r) => seat(row.cells[1], `r${i}-${r}`))}</div>
              </div>
            )}
            {i === barAfter && bar(false)}
          </Fragment>
        ))}
      </div>
    )
  }

  const ordered = clockwise ? [...secs].reverse() : secs
  return (
    <div className="lc-table lc-horz">
      {ordered.map((section, i) => {
        if (section.kind === 'end') {
          return (
            <div key={i} className="lc-grow" style={{ flexGrow: 1 }}>
              {seat({ ...section.cell, facing: turned(section.cell.facing, clockwise) }, `e${i}`)}
            </div>
          )
        }
        const cols = clockwise ? [...section.rows].reverse() : section.rows
        const top = clockwise ? 0 : 1
        return (
          <div key={i} className="lc-grow lc-vert" style={{ flexGrow: section.rows.length }}>
            <div className="lc-row">
              {cols.map((row, r) => seat({ ...row.cells[top], facing: turned(row.cells[top].facing, clockwise) }, `t${i}-${r}`))}
            </div>
            {bar(false)}
            <div className="lc-row">
              {cols.map((row, r) => seat({ ...row.cells[1 - top], facing: turned(row.cells[1 - top].facing, clockwise) }, `b${i}-${r}`))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The bar between facing players; the turn strip (when on) reads along it. The menu sits at its middle. */
function CentreBar({ vertical, showStrip, children }: { vertical: boolean; showStrip: boolean; children: ReactNode }) {
  return <div className={`lc-bar ${vertical ? 'vertical' : 'horizontal'}${showStrip ? ' lc-has-strip' : ''}`}>{children}</div>
}

function TurnStrip({ game, settings, dispatch }: { game: Game; settings: LifeSettings; dispatch: (a: GameAction) => void }) {
  const current = game.players.find((p) => p.id === game.turnPlayerId)
  return (
    <div className="lc-strip-wrap">
      <div className="lc-strip">
        <div className="lc-strip-side">
          {settings.turnTracker && current && (
            <>
              <i className="lc-dot" style={seatStyle(current.colorIndex)} />
              <span className="lc-strip-long">Turn {game.turnNumber} · {displayName(current)}</span>
              <span className="lc-strip-short">T{game.turnNumber} · {displayName(current)}</span>
            </>
          )}
        </div>
        <div className="lc-menu-slot" />
        <div className="lc-strip-side end">
          {settings.gameTimer && (
            <button
              type="button"
              className={`lc-timer${game.timerRunning ? '' : ' paused'}`}
              onClick={() => dispatch({ type: 'toggleTimer' })}
              aria-label={game.timerRunning ? 'Pause timer' : 'Resume timer'}
            >
              <span className="lc-strip-long">{formatElapsed(game.turnSeconds)} / {formatElapsed(game.matchSeconds)}</span>
              <span className="lc-strip-short">{formatElapsed(game.turnSeconds)}</span>
              <span className="material-symbols-rounded lc-strip-long">{game.timerRunning ? 'pause' : 'play_arrow'}</span>
            </button>
          )}
          {settings.turnTracker && (
            <button type="button" className="lc-next" onClick={() => dispatch({ type: 'nextTurn' })}>
              <span className="lc-strip-long">Next turn</span>
              <span className="lc-strip-short">Next</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MenuButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`lc-menu-btn${open ? ' open' : ''}`} onClick={onClick} aria-label={open ? 'Close game menu' : 'Game menu'} aria-expanded={open}>
      <span className="ring" />
      <span className="core" />
      <span className="bars"><i /><i /><i /></span>
    </button>
  )
}

function RadialMenu(props: {
  onRestart: () => void; onHighRoll: () => void; onSeating: () => void; onSettings: () => void; onDice: () => void; onExit: () => void
}) {
  const items: [string, string, () => void][] = [
    ['Exit', 'exit', props.onExit],
    ['Restart', 'restart', props.onRestart],
    ['High roll', 'highroll', props.onHighRoll],
    ['Seating', 'seating', props.onSeating],
    ['Settings', 'settings', props.onSettings],
    ['Dice', 'dice', props.onDice],
  ]
  return (
    <div className="lc-radial" role="menu">
      {items.map(([label, cls, onClick], i) => (
        <button key={cls} type="button" role="menuitem" className={`lc-pill ${cls}`} style={{ ['--i' as string]: i }} onClick={onClick}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
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
      <div className="lc-sheet-body">{children}</div>
    </div>
  )
}

function Confirm({ text, confirm, onConfirm, onCancel }: { text: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="lc-confirm" role="alertdialog" aria-label={text}>
      <p>{text}</p>
      <div>
        <button type="button" className="cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="ok" onClick={onConfirm}>{confirm}</button>
      </div>
    </div>
  )
}

function SeatingOverlay({ current, onPick, onClose }: { current: string; onPick: (id: string) => void; onClose: () => void }) {
  const [pending, setPending] = useState<string | null>(null)
  const groups = new Map<number, TableLayout[]>()
  for (const l of TABLE_LAYOUTS) groups.set(playerCount(l), [...(groups.get(playerCount(l)) ?? []), l])
  return (
    <>
      <Sheet title="Seating" subtitle="Each tile faces whoever sits at that edge of the screen" onClose={onClose}>
        {[...groups.entries()].map(([count, layouts]) => (
          <section key={count}>
            <h3>{count === 1 ? '1 player' : `${count} players`}</h3>
            <div className="lc-thumbs">
              {layouts.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`lc-thumb${l.id === current ? ' on' : ''}`}
                  aria-label={layoutDescription(l)}
                  aria-pressed={l.id === current}
                  onClick={() => { if (l.id !== current) setPending(l.id) }}
                >
                  {l.rows.map((row, r) => (
                    <span key={r} className="lc-thumb-row">
                      {row.cells.map((c, ci) => <i key={ci} className={c.seat === null ? 'gap' : ''} />)}
                    </span>
                  ))}
                </button>
              ))}
            </div>
          </section>
        ))}
      </Sheet>
      {pending && (
        <Confirm text="Start a new game with this seating?" confirm="New game" onConfirm={() => onPick(pending)} onCancel={() => setPending(null)} />
      )}
    </>
  )
}

const LIFE_CHOICES = [20, 25, 30, 40]

function SettingsOverlay({ lc, onClose }: { lc: ReturnType<typeof useLifeCounter>; onClose: () => void }) {
  const { settings, updateSettings, setStartingLife } = lc
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  return (
    <Sheet title="Settings" onClose={onClose}>
      <section>
        <h3>Starting life</h3>
        <div className="lc-setting-row">
          <span>Two players</span>
          <div className="lc-choices">
            {LIFE_CHOICES.map((n) => (
              <button key={n} type="button" aria-pressed={settings.twoPlayerStartingLife === n} onClick={() => setStartingLife(true, n)}>{n}</button>
            ))}
          </div>
        </div>
        <div className="lc-setting-row">
          <span>Three or more</span>
          <div className="lc-choices">
            {LIFE_CHOICES.map((n) => (
              <button key={n} type="button" aria-pressed={settings.multiplayerStartingLife === n} onClick={() => setStartingLife(false, n)}>{n}</button>
            ))}
          </div>
        </div>
        <p className="lc-hint">A new starting life applies straight away to a game nobody has touched, otherwise from the next restart.</p>
      </section>
      <section>
        <h3>Table</h3>
        <Toggle label="Turn tracker" detail="Whose turn it is, with a Next turn button" on={settings.turnTracker} onChange={(v) => updateSettings({ turnTracker: v })} />
        <Toggle label="Game timer" detail="Time this turn and the whole game" on={settings.gameTimer} onChange={(v) => updateSettings({ gameTimer: v })} />
        <Toggle label="Knock players out automatically" detail="At 0 life, 10 poison or 21 damage from one commander" on={settings.autoKill} onChange={(v) => updateSettings({ autoKill: v })} />
        <Toggle label="Commander damage costs life" detail="Off if your table tracks life and commander damage separately" on={settings.commanderDamageCostsLife} onChange={(v) => updateSettings({ commanderDamageCostsLife: v })} />
        {typeof document.documentElement.requestFullscreen === 'function' && (
          <Toggle label="Full screen" detail="Hide the browser's toolbars" on={fullscreen} onChange={toggleFullscreen} />
        )}
      </section>
    </Sheet>
  )
}

function Toggle({ label, detail, on, onChange }: { label: string; detail: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="lc-toggle" onClick={() => onChange(!on)}>
      <span className="txt"><b>{label}</b><span>{detail}</span></span>
      <span className={`sw${on ? ' on' : ''}`}><i /></span>
    </button>
  )
}

function DiceOverlay({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<{ label: string; value: string; n: number } | null>(null)
  const roll = (sides: number) => {
    const v = 1 + Math.floor(Math.random() * sides)
    setResult((r) => ({ label: `d${sides}`, value: String(v), n: (r?.n ?? 0) + 1 }))
  }
  const flip = () => setResult((r) => ({ label: 'Coin', value: Math.random() < 0.5 ? 'Heads' : 'Tails', n: (r?.n ?? 0) + 1 }))
  return (
    <Sheet title="Dice" onClose={onClose}>
      <div className="lc-dice-result" aria-live="polite">
        {result ? (
          <>
            <span className="lc-dice-lbl">{result.label}</span>
            <span className="lc-dice-val" key={result.n}>{result.value}</span>
          </>
        ) : (
          <span className="lc-dice-lbl">Pick something to roll</span>
        )}
      </div>
      <div className="lc-dice">
        {[4, 6, 8, 10, 12, 20].map((s) => <button key={s} type="button" onClick={() => roll(s)}>d{s}</button>)}
        <button type="button" onClick={flip}>Coin</button>
      </div>
    </Sheet>
  )
}

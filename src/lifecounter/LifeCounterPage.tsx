import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { canUndo, displayName, gameOver, highRoll, lossReason, useLifeCounter, type Game, type GameAction, type ShownCard } from './game'
import { PlayerTile, seatStyle } from './PlayerTile'
import { PlaneBanner, PlaneSheet, usePlanechase } from './Planechase'
import {
  layoutById, layoutDescription, playerCount, sections, TABLE_LAYOUTS, turned,
  type SeatCell, type TableLayout,
} from './tableLayouts'
import { SeatCodeSheet, useSeatLinks } from './LinkSeat'
import { useRemoteHost } from './remote'
import { useWakeLock } from './wakeLock'
import { useSync } from '../sync/SyncContext'
import { clearTableGames, deleteTableGame, meResultOf, recordTableGame, tableGameOf, useTableGames } from './tableGames'
import { CommanderSheet, MeSheet, TableGamesSheet } from './TableSheets'
import './lifecounter.css'

type Overlay = null | 'seating' | 'settings' | 'restart' | 'dice' | 'history' | 'table' | 'plane' | 'games'

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

export function LifeCounterPage() {
  const navigate = useNavigate()
  const lc = useLifeCounter()
  const { settings, game, dispatch } = lc
  const layout = layoutById(game.layoutId)
  const { landscape, clockwise } = useTableOrientation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [roll, setRoll] = useState<ReturnType<typeof highRoll> | null>(null)
  // A panel covering a tile would sit under the menu button, so the button steps aside.
  const [panelsOpen, setPanelsOpen] = useState(0)
  const { planechase, startPlanechase, planeswalk, rollPlanarDie, stopPlanechase } = usePlanechase()
  const links = useSeatLinks(game, dispatch)
  useRemoteHost(game, settings, dispatch, links.signedIn)
  useWakeLock()
  const { decks, addGameResult, removeGameResult } = useSync()
  const tableGames = useTableGames()
  const [commanderFor, setCommanderFor] = useState<number | null>(null)
  const [meFor, setMeFor] = useState<number | null>(null)

  /**
   * Losing on your own turn used to leave the turn there: a player who is out has no End turn
   * control, on the table or on their phone, so nobody could pass it on. The turn moves itself now.
   * It stops at the last player standing, where the game is over and the turn no longer matters.
   */
  const passedOn = useRef<string | null>(null)
  useEffect(() => {
    if (!settings.turnTracker || game.players.length < 2) return
    if (gameOver(game, settings.autoKill)) return
    const active = game.players.find((p) => p.id === game.turnPlayerId)
    if (!active || !lossReason(active, settings.autoKill)) return
    // Once per stuck turn: the effect runs twice in development, and passing twice would skip
    // somebody who is still playing.
    const key = `${game.gameId}:${game.turnPlayerId}`
    if (passedOn.current === key) return
    passedOn.current = key
    dispatch({ type: 'nextTurn', autoKill: settings.autoKill })
  }, [game, settings.turnTracker, settings.autoKill, dispatch])

  // A game that's over goes into the table's games — once, or again if an undo changed how it
  // ended (it replaces itself). The owner's seat is saved to their deck only while no phone has
  // joined it: a phone that joins saves the result itself.
  const recorded = useRef<string | null>(null)
  useEffect(() => {
    const over = gameOver(game, settings.autoKill)
    if (!over) return
    const outcome = `${game.gameId}:${over.winnerId}:${game.players.map((p) => `${p.id}=${lossReason(p, settings.autoKill)}`).join(',')}`
    if (outcome === recorded.current) return
    recorded.current = outcome
    const record = tableGameOf(game, settings, over.winnerId)
    // A finished game still on the table after a reload is noted already.
    const kept = tableGames.find((g) => g.id === record.id)
    if (kept && kept.winnerSeat === record.winnerSeat && kept.players.every((p, i) => p.out === record.players[i]?.out)) return
    recordTableGame(record)
    const deck = decks.find((d) => d.id === settings.meDeckId)
    const seatLinked = !!game.players.find((p) => p.id === settings.meSeat)?.linked
    const result = deck ? meResultOf(record, settings.meSeat, seatLinked) : null
    if (deck && result) {
      removeGameResult(deck.id, result.id)
      addGameResult(deck.id, result)
    }
  }, [game, settings, decks, tableGames, addGameResult, removeGameResult])

  useEffect(() => {
    document.title = 'Life counter · Manabind'
    return () => { document.title = 'Manabind' }
  }, [])

  // A high roll stays on the tiles until the centre button (or Escape) closes it; closing starts
  // the game with its winner.
  const closeRoll = () => {
    if (roll) dispatch({ type: 'firstPlayer', id: roll.winnerId })
    setRoll(null)
  }
  useEffect(() => {
    if (!roll) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'firstPlayer', id: roll.winnerId })
        setRoll(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [roll, dispatch])
  // Whose turn it is — their tile grows — unless the tracker's off or a high roll is showing.
  const activeSeat = settings.turnTracker && !roll && game.players.length > 1 ? game.turnPlayerId : null

  const closeAll = () => { setMenuOpen(false); setOverlay(null) }
  const open = (o: Overlay) => { setMenuOpen(false); setOverlay(o) }

  const seat = (cell: SeatCell, key: string, grow = 1) => {
    const player = cell.seat === null ? undefined : game.players.find((p) => p.id === cell.seat)
    if (!player) return <div key={key} className="lc-cell lc-empty" style={{ flexGrow: grow }} />
    return (
      <div key={key} className="lc-cell" style={{ flexGrow: grow }}>
        <PlayerTile
          player={player}
          opponents={game.players.filter((p) => p.id !== player.id)}
          facing={cell.facing}
          settings={settings}
          activeTurn={player.id === activeSeat}
          turnNumber={game.turnNumber}
          onEndTurn={() => dispatch({ type: 'nextTurn', autoKill: settings.autoKill })}
          isMonarch={game.monarchId === player.id}
          hasInitiative={game.initiativeId === player.id}
          highRoll={roll ? { value: roll.rolls[player.id], winner: roll.winnerId === player.id } : null}
          dispatch={dispatch}
          onPanelOpenChange={(open) => setPanelsOpen((n) => Math.max(0, n + (open ? 1 : -1)))}
          onLinkSeat={() => void links.showCode(player.id)}
          onUnlink={() => links.unlink(player.id)}
          onPickCommander={() => setCommanderFor(player.id)}
          onPickMe={decks.length ? () => setMeFor(player.id) : undefined}
          meDeck={settings.meSeat === player.id ? decks.find((d) => d.id === settings.meDeckId)?.name ?? '' : null}
        />
      </div>
    )
  }

  const bar = (vertical: boolean) => (
    <CentreBar key="bar" vertical={vertical}>
      {game.dayNight && (
        <span className={`lc-daynight ${game.dayNight.toLowerCase()}`} title={game.dayNight === 'DAY' ? 'Day' : 'Night'}>
          <span className="material-symbols-rounded" aria-hidden>{game.dayNight === 'DAY' ? 'wb_sunny' : 'bedtime'}</span>
        </span>
      )}
      {/* While a high roll shows, the centre button closes it. */}
      <MenuButton
        open={menuOpen || !!roll}
        hidden={panelsOpen > 0}
        label={roll ? 'Close the high roll and start' : undefined}
        onClick={() => (roll ? closeRoll() : overlay ? closeAll() : setMenuOpen((m) => !m))}
      />
      {menuOpen && (
        <RadialMenu
          onRestart={() => open('restart')}
          onHighRoll={() => { setMenuOpen(false); setRoll(highRoll(game.players.map((p) => p.id))) }}
          onSeating={() => open('seating')}
          onSettings={() => open('settings')}
          onDice={() => open('dice')}
          onTable={() => open('table')}
          onHistory={() => open('history')}
          onGames={() => open('games')}
          canUndo={canUndo(game)}
          onUndo={() => dispatch({ type: 'undo' })}
          onPlanechase={() => {
            if (!planechase) void startPlanechase()
            open('plane')
          }}
          onExit={() => navigate('/')}
        />
      )}
    </CentreBar>
  )

  return (
    <div className={`lc-root${panelsOpen > 0 ? ' lc-panel-open' : ''}`}>
      <TableSurface layout={layout} landscape={landscape} clockwise={clockwise} seat={seat} bar={bar} activeSeat={activeSeat} />
      {menuOpen && <button type="button" className="lc-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      {overlay === 'restart' && (
        <Confirm text="Start a new game?" confirm="New game" onConfirm={() => { lc.restart(); closeAll() }} onCancel={closeAll} />
      )}
      {overlay === 'seating' && (
        <SeatingOverlay current={game.layoutId} onPick={(id) => { lc.selectLayout(id); closeAll() }} onClose={closeAll} />
      )}
      {overlay === 'settings' && <SettingsOverlay lc={lc} onClose={closeAll} />}
      {overlay === 'dice' && <DiceOverlay onClose={closeAll} />}
      {overlay === 'history' && <HistoryOverlay game={game} onClear={() => dispatch({ type: 'clearHistory' })} onClose={closeAll} />}
      {overlay === 'table' && <TableOverlay game={game} dispatch={dispatch} onClose={closeAll} />}
      {overlay === 'games' && <TableGamesSheet games={tableGames} onDelete={deleteTableGame} onClear={clearTableGames} onClose={closeAll} Sheet={Sheet} />}
      {commanderFor !== null && (
        <CommanderSheet
          playerName={(() => { const p = game.players.find((x) => x.id === commanderFor); return p ? displayName(p) : `Player ${commanderFor}` })()}
          current={game.players.find((p) => p.id === commanderFor)?.commander}
          onPick={(name, art) => { dispatch({ type: 'seatCommander', id: commanderFor, name, art }); setCommanderFor(null) }}
          onClose={() => setCommanderFor(null)}
          Sheet={Sheet}
        />
      )}
      {meFor !== null && (
        <MeSheet
          decks={decks}
          currentDeckId={settings.meDeckId}
          isMe={settings.meSeat === meFor}
          onPick={(deckId) => { lc.updateSettings({ meSeat: meFor, meDeckId: deckId }); setMeFor(null) }}
          onNotMe={() => { lc.updateSettings({ meSeat: null, meDeckId: null }); setMeFor(null) }}
          onClose={() => setMeFor(null)}
          Sheet={Sheet}
        />
      )}
      {links.showing !== null && <SeatCodeSheet game={game} seat={links.showing} links={links} onClose={links.close} Sheet={Sheet} />}
      {game.shownCard && <ShownCardOverlay card={game.shownCard} game={game} onClose={() => dispatch({ type: 'hideCard' })} />}
      {planechase && overlay !== 'plane' && <PlaneBanner state={planechase} onOpen={() => open('plane')} />}
      {overlay === 'plane' && planechase && (
        <PlaneSheet
          state={planechase}
          onRoll={() => rollPlanarDie()}
          onPlaneswalk={planeswalk}
          onStop={() => { stopPlanechase(); closeAll() }}
          onClose={closeAll}
        />
      )}
    </div>
  )
}

/**
 * Lays the seats out around the centre bar. Portrait (or a table with no facing pairs): end seats
 * above and below, pairs side by side with the bar running down between them. Landscape: the same
 * table turned a quarter turn with the device, bar running across.
 */
function TableSurface({
  layout, landscape, clockwise, seat, bar, activeSeat,
}: {
  layout: TableLayout
  landscape: boolean
  clockwise: boolean
  seat: (cell: SeatCell, key: string, grow?: number) => ReactNode
  bar: (vertical: boolean) => ReactNode
  /** Whose turn it is: their seat, their side of the table and their band of pairs grow. */
  activeSeat: number | null
}) {
  const secs = sections(layout)
  const hasPairs = secs.some((s) => s.kind === 'pairs')
  const hasEnds = secs.some((s) => s.kind === 'end')
  const isActive = (cell: SeatCell) => cell.seat !== null && cell.seat === activeSeat
  const seatGrow = (cell: SeatCell) => (isActive(cell) ? SEAT_GROW : 1)
  const sideGrow = (rows: { cells: SeatCell[] }[], side: number) => (rows.some((r) => isActive(r.cells[side])) ? SIDE_GROW : 1)
  const bandGrow = (rows: { cells: SeatCell[] }[]) =>
    rows.length * (hasEnds && rows.some((r) => isActive(r.cells[0]) || isActive(r.cells[1])) ? BAND_GROW : 1)

  if (!landscape || !hasPairs) {
    // Without pairs the bar goes between the end seats (or above a lone seat).
    const barAfter = hasPairs ? -1 : Math.floor(secs.length / 2) - 1
    return (
      <div className="lc-table lc-vert">
        {!hasPairs && barAfter < 0 && bar(false)}
        {secs.map((section, i) => (
          <Fragment key={i}>
            {section.kind === 'end' ? (
              <div className="lc-grow" style={{ flexGrow: seatGrow(section.cell) }}>{seat(section.cell, `e${i}`)}</div>
            ) : (
              <div className="lc-grow lc-horz" style={{ flexGrow: bandGrow(section.rows) }}>
                <div className="lc-col" style={{ flexGrow: sideGrow(section.rows, 0) }}>
                  {section.rows.map((row, r) => seat(row.cells[0], `l${i}-${r}`, seatGrow(row.cells[0])))}
                </div>
                {bar(true)}
                <div className="lc-col" style={{ flexGrow: sideGrow(section.rows, 1) }}>
                  {section.rows.map((row, r) => seat(row.cells[1], `r${i}-${r}`, seatGrow(row.cells[1])))}
                </div>
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
            <div key={i} className="lc-grow" style={{ flexGrow: seatGrow(section.cell) }}>
              {seat({ ...section.cell, facing: turned(section.cell.facing, clockwise) }, `e${i}`)}
            </div>
          )
        }
        const cols = clockwise ? [...section.rows].reverse() : section.rows
        const top = clockwise ? 0 : 1
        return (
          <div key={i} className="lc-grow lc-vert" style={{ flexGrow: bandGrow(section.rows) }}>
            <div className="lc-row" style={{ flexGrow: sideGrow(section.rows, top) }}>
              {cols.map((row, r) => seat({ ...row.cells[top], facing: turned(row.cells[top].facing, clockwise) }, `t${i}-${r}`, seatGrow(row.cells[top])))}
            </div>
            {bar(false)}
            <div className="lc-row" style={{ flexGrow: sideGrow(section.rows, 1 - top) }}>
              {cols.map((row, r) => seat({ ...row.cells[1 - top], facing: turned(row.cells[1 - top].facing, clockwise) }, `b${i}-${r}`, seatGrow(row.cells[1 - top])))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// How much more room the player whose turn it is gets: their seat, their side of the table (a
// column of pairs), and — at a table with seats at the ends — the band of pairs they sit in.
const SEAT_GROW = 1.7
const SIDE_GROW = 1.3
const BAND_GROW = 1.45

/** The seam between facing players. It takes no room; the menu button floats at its middle. */
function CentreBar({ vertical, children }: { vertical: boolean; children: ReactNode }) {
  return <div className={`lc-bar ${vertical ? 'vertical' : 'horizontal'}`}>{children}</div>
}

/** [hidden]: a player's panel is covering its tile, and the button would sit on top of it. */
function MenuButton({ open, hidden, onClick, label }: { open: boolean; hidden: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className={`lc-menu-btn${open ? ' open' : ''}`}
      style={hidden ? { opacity: 0.12, pointerEvents: 'none' } : undefined}
      onClick={onClick}
      aria-label={label ?? (open ? 'Close game menu' : 'Game menu')}
      aria-expanded={open}
      aria-hidden={hidden}
    >
      <span className="ring" />
      <span className="core" />
      <span className="bars"><i /><i /><i /></span>
    </button>
  )
}

function RadialMenu(props: {
  onRestart: () => void; onHighRoll: () => void; onSeating: () => void; onSettings: () => void
  onDice: () => void; onTable: () => void; onHistory: () => void; onGames: () => void; onPlanechase: () => void; onExit: () => void
  canUndo: boolean; onUndo: () => void
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
      <div className="lc-menu-row">
        <button type="button" role="menuitem" className="lc-menu-chip" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo the last change">
          <span className="material-symbols-rounded" aria-hidden>undo</span>Undo
        </button>
        <button type="button" role="menuitem" className="lc-menu-chip" onClick={props.onTable}>
          <span className="material-symbols-rounded" aria-hidden>crown</span>Table
        </button>
        <button type="button" role="menuitem" className="lc-menu-chip" onClick={props.onHistory}>
          <span className="material-symbols-rounded" aria-hidden>history</span>History
        </button>
        <button type="button" role="menuitem" className="lc-menu-chip" onClick={props.onGames}>
          <span className="material-symbols-rounded" aria-hidden>emoji_events</span>Games
        </button>
        <button type="button" role="menuitem" className="lc-menu-chip" onClick={props.onPlanechase}>
          <span className="material-symbols-rounded" aria-hidden>public</span>Planechase
        </button>
      </div>
    </div>
  )
}

/** A card a player is showing the table from their remote. Tap anywhere to put it away. */
function ShownCardOverlay({ card, game, onClose }: { card: ShownCard; game: Game; onClose: () => void }) {
  const by = game.players.find((p) => p.id === card.seat)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <button type="button" className="lc-shown-card" onClick={onClose} aria-label={`${card.name} — tap to close`}>
      {by && <span className="lc-shown-by">{displayName(by)} is showing</span>}
      <img src={card.imageUrl} alt={card.name} />
      <span className="lc-shown-hint">Tap to close</span>
    </button>
  )
}

/** Who holds the monarch and the initiative, and whether it's day or night. */
function TableOverlay({ game, dispatch, onClose }: { game: Game; dispatch: (a: GameAction) => void; onClose: () => void }) {
  const holders = (current: number | null, action: 'monarch' | 'initiative') => (
    <div className="lc-holders">
      {game.players.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`lc-holder${current === p.id ? ' on' : ''}`}
          style={seatStyle(p.colorIndex)}
          aria-pressed={current === p.id}
          onClick={() => dispatch({ type: action, id: current === p.id ? null : p.id })}
        >
          {displayName(p)}
        </button>
      ))}
    </div>
  )
  return (
    <Sheet title="Table" subtitle="Who holds what, and whether it's day or night" onClose={onClose}>
      <section>
        <h3>Monarch</h3>
        {holders(game.monarchId, 'monarch')}
      </section>
      <section>
        <h3>Initiative</h3>
        {holders(game.initiativeId, 'initiative')}
      </section>
      <section>
        <h3>Day and night</h3>
        <div className="lc-choices">
          <button type="button" aria-pressed={game.dayNight === 'DAY'} onClick={() => dispatch({ type: 'dayNight', value: 'DAY' })}>Day</button>
          <button type="button" aria-pressed={game.dayNight === 'NIGHT'} onClick={() => dispatch({ type: 'dayNight', value: 'NIGHT' })}>Night</button>
          <button type="button" aria-pressed={game.dayNight === null} onClick={() => dispatch({ type: 'dayNight', value: null })}>Neither</button>
        </div>
        <p className="lc-hint">It always becomes day first. Tap the other one when a card turns it over.</p>
      </section>
    </Sheet>
  )
}

/** Everything that has happened this game, newest first. */
function HistoryOverlay({ game, onClear, onClose }: { game: Game; onClear: () => void; onClose: () => void }) {
  return (
    <Sheet title="History" subtitle={`Game ${game.turnNumber > 1 ? `· turn ${game.turnNumber}` : ''}`} onClose={onClose}>
      {game.history.length === 0 ? (
        <p className="lc-hint">Nothing has happened yet.</p>
      ) : (
        <>
          <ul className="lc-history">
            {game.history.map((entry) => {
              const player = game.players.find((p) => p.id === entry.playerId)
              return (
                <li key={entry.id}>
                  <i style={player ? seatStyle(player.colorIndex) : undefined} className={player ? '' : 'table-wide'} />
                  <span className="lc-history-who">{player ? displayName(player) : 'Table'}</span>
                  <span className="lc-history-what">{entry.text}</span>
                  <span className="lc-history-when">{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              )
            })}
          </ul>
          <button type="button" className="lc-wide-btn" onClick={onClear}>Clear history</button>
        </>
      )}
    </Sheet>
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
        <Toggle label="Knock players out automatically" detail="At 0 life, 10 poison or 21 damage from one commander" on={settings.autoKill} onChange={(v) => updateSettings({ autoKill: v })} />
        <Toggle label="Commander damage costs life" detail="Off if your table tracks life and commander damage separately" on={settings.commanderDamageCostsLife} onChange={(v) => updateSettings({ commanderDamageCostsLife: v })} />
        <Toggle label="Phones as remotes" detail="Players who joined a seat by QR code can change their own life and counters from their phone" on={settings.remotes} onChange={(v) => updateSettings({ remotes: v })} />
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

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { GameChart } from './GameChart'
import { IconButton, PageHeader, SectionHeader, rise, useLayoutSize } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { playgroupStats } from '../decks/playgroupStats'
import { useEvents } from '../tournament/events'
import { playoffChampion } from '../tournament/playoff'
import { savedLifeSettings, startingLifeFor } from './game'
import { NIGHT_STALE_MS } from './gameNight'
import { useGameNight } from './gameNightStore'
import { layoutById, playerCount } from './tableLayouts'
import { RECENT_SHOWN, eventsStatus, gameNightStatus, lastPlayersLine, playgroupStatus, startGameLine } from './playHub'
import { rememberedSeat, remotePath } from './seat'
import { chartSeats, useTableGames, type TableGame } from './tableGames'
import './play.css'

/**
 * The Play tab, in three parts. Play now: start a game here (the table it starts with, and who
 * played last), join someone else's table with your phone as the remote for your seat, or go back
 * to the seat you're in. Your group: Game night, Playgroup and Events, each with a line on where it
 * stands. Recent games, each opening its life chart. Rules sits in the header. The Android app's
 * twin is ui/lifecounter/PlayScreen.kt; the status lines are playHub.ts (PlayHub.kt).
 */
export function PlayPage() {
  const navigate = useNavigate()
  const wide = useLayoutSize() !== 'phone'
  const games = useTableGames()
  const seat = rememberedSeat()
  const [allGames, setAllGames] = useState(false)

  const settings = useMemo(() => savedLifeSettings(), [])
  const players = playerCount(layoutById(settings.layoutId))
  const lastPlayers = games[0] ? lastPlayersLine(games[0].players.map((p) => p.name)) : null

  const { night } = useGameNight()
  const nightLine = gameNightStatus(night.players.length, night.pods.length, Date.now() - night.createdAt > NIGHT_STALE_MS)
  const { decks } = useSync()
  const stats = useMemo(() => playgroupStats(decks), [decks])
  const events = useEvents()
  const running = events.filter((e) => !e.finished || (e.playoff != null && playoffChampion(e) == null)).length

  const shown = allGames ? games : games.slice(0, RECENT_SHOWN)
  return (
    <>
      <PageHeader title="Play" actions={<IconButton icon="menu_book" label="Rules" onClick={() => navigate('/rules')} />} />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        <div className="play">
          <SectionHeader title="Play now" />
          <button type="button" className="play-start press rise" style={rise(1)} onClick={() => navigate('/life')}>
            {/* The life counter's own colour blocks, so the button looks like what it opens. */}
            <span className="play-seats" aria-hidden><i /><i /><i /><i /></span>
            <b>Start a game</b>
            <span>{startGameLine(players, startingLifeFor(settings, players))}{lastPlayers ? ` · ${lastPlayers}` : ''}</span>
          </button>
          {seat && (
            <PlayRow icon="event_seat" title={`Back to seat ${seat.seat}`} subtitle="You're still at a table — open your remote" highlight onClick={() => navigate(remotePath(seat))} />
          )}
          <PlayRow icon="qr_code_scanner" title="Join a table" subtitle="Scan a seat's QR code: your phone becomes your remote" onClick={() => navigate('/scan')} />

          <SectionHeader title="Your group" />
          <div className="play-tiles">
            <PlayTile icon="groups" title="Game night" status={nightLine} onClick={() => navigate('/play/night')} />
            <PlayTile icon="leaderboard" title="Playgroup" status={playgroupStatus(stats.games, stats.nemesis?.name ?? null)} onClick={() => navigate('/play/playgroup')} />
            <PlayTile icon="emoji_events" title="Events" status={eventsStatus(running, events.length)} onClick={() => navigate('/play/events')} />
          </div>

          <SectionHeader
            title="Recent games"
            action={games.length > RECENT_SHOWN ? (allGames ? 'Fewer' : 'All games') : undefined}
            onAction={() => setAllGames((v) => !v)}
          />
          {games.length === 0 && <p className="muted play-empty">Games played on this device's life counter show up here.</p>}
          {shown.map((g, i) => <RecentGameRow key={g.id} game={g} index={i} />)}
        </div>
      </div>
    </>
  )
}

function PlayRow({ icon, title, subtitle, highlight, onClick }: { icon: string; title: string; subtitle: string; highlight?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`play-row press rise${highlight ? ' highlight' : ''}`} style={rise(2)} onClick={onClick}>
      <Icon name={icon} className="play-row-icon" />
      <span className="play-row-text"><b>{title}</b><span>{subtitle}</span></span>
      <Icon name="chevron_right" className="play-row-chev" />
    </button>
  )
}

/** One of Your group's three: an icon, its name and a line on where it stands. */
function PlayTile({ icon, title, status, onClick }: { icon: string; title: string; status: string; onClick: () => void }) {
  return (
    <button type="button" className="play-tile press rise" style={rise(3)} onClick={onClick}>
      <Icon name={icon} className="play-row-icon" />
      <b>{title}</b>
      <span>{status}</span>
    </button>
  )
}

function RecentGameRow({ game, index }: { game: TableGame; index: number }) {
  const winner = game.players.find((p) => p.seat === game.winnerSeat)
  const [chart, setChart] = useState(false)
  const Row = game.log ? 'button' : 'div'
  return (
    <>
    <Row
      {...(game.log ? { type: 'button' as const, onClick: () => setChart(true), 'aria-label': `${winner ? `${winner.name} won` : 'Nobody left standing'} — life chart and recap` } : {})}
      className={`play-game rise${game.log ? ' press' : ''}`}
      style={rise(Math.min(4 + index, 10))}
    >
      <Icon name="emoji_events" className={`play-game-icon${winner ? ' won' : ''}`} />
      <span className="play-row-text">
        <b>{winner ? `${winner.name} won` : 'Nobody left standing'}</b>
        <span className="play-game-players">{game.players.map((p) => p.name + (p.commander ? ` (${p.commander})` : '')).join(' · ')}</span>
      </span>
      <span className="play-game-when">
        <b>{game.minutes} min</b>
        {/* "3 Oct" — the day a game ended. */}
        <span>{new Date(game.endedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        {game.log && <span className="play-game-chart">Life chart</span>}
      </span>
    </Row>
    {chart && game.log && (
      <Dialog title={winner ? `${winner.name} won` : 'Nobody left standing'} onDismiss={() => setChart(false)} actions={<button type="button" className="btn line" onClick={() => setChart(false)}>Close</button>}>
        <GameChart log={game.log} seats={chartSeats(game)} />
      </Dialog>
    )}
    </>
  )
}

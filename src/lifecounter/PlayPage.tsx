import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader, SectionHeader, rise, useLayoutSize } from '../components/kit'
import { rememberedSeat, remotePath } from './seat'
import { useTableGames, type TableGame } from './tableGames'
import './play.css'

/**
 * The Play tab: start a life counter game here, join someone else's table with your phone as the
 * remote for your seat (or go back to the seat you're in), and the games played here. The Android
 * app's PlayScreen.
 */
export function PlayPage() {
  const navigate = useNavigate()
  const wide = useLayoutSize() !== 'phone'
  const games = useTableGames()
  const seat = rememberedSeat()
  return (
    <>
      <PageHeader title="Play" />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        <div className="play">
          <button type="button" className="play-start press rise" style={rise(1)} onClick={() => navigate('/life')}>
            {/* The life counter's own colour blocks, so the button looks like what it opens. */}
            <span className="play-seats" aria-hidden><i /><i /><i /><i /></span>
            <b>Life counter</b>
            <span>Start a game here · up to 8 players, turn timer, deck tokens</span>
          </button>
          {seat && (
            <PlayRow icon="event_seat" title={`Back to seat ${seat.seat}`} subtitle="You're still at a table — open your remote" highlight onClick={() => navigate(remotePath(seat))} />
          )}
          <PlayRow icon="qr_code_scanner" title="Join a table" subtitle="Scan a seat's QR code: your phone becomes your remote" onClick={() => navigate('/scan')} />
          <PlayRow icon="emoji_events" title="Events" subtitle="Run a Swiss or Commander pod event: pairings, round clock, standings" onClick={() => navigate('/play/events')} />
          <PlayRow icon="menu_book" title="Rules" subtitle="Look up a rule or a card's rulings" onClick={() => navigate('/rules')} />
          <SectionHeader title="Recent games" />
          {games.length === 0 && <p className="muted play-empty">Games played on this device's life counter show up here.</p>}
          {games.slice(0, 20).map((g, i) => <RecentGameRow key={g.id} game={g} index={i} />)}
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

function RecentGameRow({ game, index }: { game: TableGame; index: number }) {
  const winner = game.players.find((p) => p.seat === game.winnerSeat)
  return (
    <div className="play-game rise" style={rise(Math.min(3 + index, 10))}>
      <Icon name="emoji_events" className={`play-game-icon${winner ? ' won' : ''}`} />
      <span className="play-row-text">
        <b>{winner ? `${winner.name} won` : 'Nobody left standing'}</b>
        <span className="play-game-players">{game.players.map((p) => p.name + (p.commander ? ` (${p.commander})` : '')).join(' · ')}</span>
      </span>
      <span className="play-game-when">
        <b>{game.minutes} min</b>
        {/* "3 Oct" — the day a game ended. */}
        <span>{new Date(game.endedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      </span>
    </div>
  )
}

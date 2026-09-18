import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import * as api from '../social/api'
import { QrCode } from '../social/ui'
import { displayName, type Game, type GameAction, type LinkedPlayer } from './game'

/** While a seat's QR code is up, how often to check whether someone has sat down. */
const WATCH_MS = 2_000
/** Otherwise, while a table is open: someone may still join a seat, or leave one. */
const IDLE_MS = 20_000

const toLinked = (p: api.Profile): LinkedPlayer => ({ userId: p.user_id, username: p.username, displayName: p.display_name, avatarPath: p.avatar_path })

/**
 * Players joining the life counter from their own phones. The host shows a seat's QR code; the player
 * scans it and their account takes the seat, so the counter shows their name and picture. The table
 * lives on the server (start_match / join_match); this keeps the game's seats in step with it.
 */
export function useSeatLinks(game: Game, dispatch: (a: GameAction) => void) {
  const { account } = useSync()
  const [showing, setShowing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const match = game.match ?? null
  const gameRef = useRef(game)
  gameRef.current = game

  // A table the game has moved on from (new seating, or signed out) can't be joined any more.
  const previous = useRef(match?.id ?? null)
  useEffect(() => {
    const was = previous.current
    previous.current = match?.id ?? null
    if (was && was !== match?.id) void api.endMatch(was).catch(() => {})
  }, [match?.id])
  useEffect(() => {
    if (!account && gameRef.current.match) dispatch({ type: 'match', match: null })
  }, [account, dispatch])

  const sync = useCallback(async (matchId: string) => {
    const seats = await api.matchSeats(matchId)
    const g = gameRef.current
    if (g.match?.id !== matchId) return
    for (const p of g.players) {
      const seated = seats.find((s) => s.seat === p.id)?.profile ?? null
      const next = seated ? toLinked(seated) : null
      if (JSON.stringify(next) !== JSON.stringify(p.linked ?? null)) dispatch({ type: 'link', id: p.id, player: next })
    }
    return seats
  }, [dispatch])

  // Watching the table: quickly while a code is up, slowly otherwise, never while the page is hidden.
  useEffect(() => {
    if (!match || !account) return
    let stopped = false
    let timer: number | undefined
    const tick = async () => {
      if (stopped) return
      if (!document.hidden) {
        try {
          const seats = await sync(match.id)
          if (stopped) return
          if (showing !== null && seats?.some((s) => s.seat === showing)) setShowing(null)
        } catch {
          // Offline for a moment: keep what's shown, try again next time.
        }
      }
      if (!stopped) timer = window.setTimeout(tick, showing !== null ? WATCH_MS : IDLE_MS)
    }
    void tick()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [match, account, showing, sync])

  /** Shows the QR code for [seat], opening a table on the server first if there isn't one yet. */
  const showCode = useCallback(async (seat: number) => {
    setError(null)
    setShowing(seat)
    if (gameRef.current.match) return
    setStarting(true)
    try {
      const m = await api.startMatch(gameRef.current.players.length)
      dispatch({ type: 'match', match: { id: m.id, code: m.code } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setStarting(false)
    }
  }, [dispatch])

  /** Frees a seat: the player goes back to a plain named seat. */
  const unlink = useCallback((seat: number) => {
    const m = gameRef.current.match
    dispatch({ type: 'link', id: seat, player: null })
    if (m) void api.clearMatchSeat(m.id, seat).catch(() => {})
  }, [dispatch])

  return { showing, showCode, close: () => setShowing(null), unlink, error, starting, signedIn: !!account }
}

/** The sheet with one seat's QR code. */
export function SeatCodeSheet({
  game, seat, links, onClose, Sheet,
}: {
  game: Game
  seat: number
  links: ReturnType<typeof useSeatLinks>
  onClose: () => void
  Sheet: (props: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) => React.ReactElement
}) {
  const navigate = useNavigate()
  const player = game.players.find((p) => p.id === seat)
  const match = game.match
  const needsProfile = links.error === 'Make your profile first.'
  return (
    <Sheet title={`Seat ${seat}${player ? ` · ${displayName(player)}` : ''}`} subtitle="Scan with your phone to sit here with your profile" onClose={onClose}>
      <div className="lc-qr">
        {!links.signedIn ? (
          <>
            <p className="lc-hint">Sign in on this device to let players join with their profiles.</p>
            <button type="button" className="lc-wide-btn" onClick={() => navigate('/account')}>Sign in</button>
          </>
        ) : links.error ? (
          <>
            <p className="lc-hint">{links.error}</p>
            {needsProfile && <button type="button" className="lc-wide-btn" onClick={() => navigate('/friends')}>Make my profile</button>}
          </>
        ) : !match || links.starting ? (
          <p className="lc-hint">Opening the table…</p>
        ) : (
          <>
            <div className="lc-qr-code"><QrCode text={api.seatLink(match.code, seat)} size={260} label={`QR code to sit at seat ${seat}`} /></div>
            <p className="lc-hint">Open the phone's camera (or the Android app's Scan QR code) and point it here. Waiting for them to join…</p>
          </>
        )}
      </div>
    </Sheet>
  )
}

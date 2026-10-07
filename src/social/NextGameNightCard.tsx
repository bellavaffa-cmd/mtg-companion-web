import { useNavigate } from 'react-router-dom'
import { useOverview } from './SocialContext'
import { useGameNights } from './nights'
import { dateTile, myAnswer, nextNight, nightDay, playLine, rsvpLine } from './nightsLogic'
import './nights.css'

/**
 * The next game night the user is invited to, as a card that opens its invite (GameNightInvitePage):
 * on People ([variant] 'people') the date tile, "Game night at Priya's", "4 going · Sam maybe · you
 * haven't answered" and Going?; on Play ('play') one line, "Next game night · Fri 10 Oct" over
 * "Priya's · you're going · Season 2". [podId]: that pod's next night only. Shows nothing when signed
 * out, before the server has invites, or with no night coming. The Android app's NextGameNightCard.kt.
 */
export function NextGameNightCard({ variant = 'people', podId = null, className = '' }: { variant?: 'people' | 'play'; podId?: string | null; className?: string }) {
  const navigate = useNavigate()
  const { overview } = useOverview()
  const { nights } = useGameNights(podId)
  const me = overview?.me?.user_id
  if (!me || !nights) return null
  const night = nextNight(nights, Date.now(), podId)
  if (!night) return null
  const open = () => navigate(`/play/nights/${night.id}`)

  if (variant === 'play') {
    return (
      <button type="button" className={`gn-card gn-card-play press ${className}`} onClick={open}>
        <span className="gn-card-main">
          <b>Next game night · {nightDay(night.startsAt)}</b>
          <span className="gn-card-sub">{playLine(night, me)}</span>
        </span>
        <span className="gn-card-open">Open</span>
      </button>
    )
  }

  const tile = dateTile(night.startsAt)
  const answered = myAnswer(night, me) !== null
  return (
    <button type="button" className={`gn-card press ${className}`} onClick={open}>
      <span className="gn-tile" aria-hidden><span>{tile.weekday}</span><b>{tile.day}</b></span>
      <span className="gn-card-main">
        <b>Game night at {night.place}</b>
        <span className="gn-card-sub">{rsvpLine(night, me)}</span>
      </span>
      <span className={answered ? 'gn-card-open' : 'gn-going'}>{answered ? 'Open' : 'Going?'}</span>
    </button>
  )
}

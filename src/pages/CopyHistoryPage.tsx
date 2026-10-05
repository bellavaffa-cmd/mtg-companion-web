import { useSearchParams } from 'react-router-dom'
import { PageHeader, useBack } from '../components/kit'
import { Icon } from '../components/Icon'
import { movesOfCard, moveDay, type CopyMove } from '../collection/copyHistory'
import { dayOf, useCopyHistory } from '../collection/copyHistoryStore'
import '../collection/loans.css'

/**
 * A card's history: every move of its copies made on this device — added, put away, moved, pulled
 * into a deck, put back, lent, back, checked — newest first, kept for a year. The log is
 * collection/copyHistory.ts. Mirrors the Android app's CopyHistoryScreen.kt. At /history?card=<name>.
 */
export function CopyHistoryPage() {
  const [params] = useSearchParams()
  const name = params.get('card') ?? ''
  const back = useBack(`/card/${encodeURIComponent(name)}`)
  const moves = movesOfCard(useCopyHistory(), name)
  return (
    <>
      <PageHeader title="History" eyebrow={name} onBack={back} />
      <div className="content-scroll">
        {moves.length === 0
          ? <div className="empty-state"><Icon name="history" /><div>No moves yet. Putting it away, moving it, lending it — each shows here.</div></div>
          : <MoveList moves={moves} />}
        <div className="loan-card dim" style={{ marginTop: 18, fontSize: 13, maxWidth: 560 }}>
          Kept on this device for a year. Also on each place’s page: “Recent moves”.
        </div>
      </div>
    </>
  )
}

/** Moves as a timeline, newest first; [named]: with each card's name (a place's Recent moves). */
export function MoveList({ moves, named = false }: { moves: CopyMove[]; named?: boolean }) {
  const today = dayOf(Date.now())
  return (
    <ol className="move-list">
      {moves.map((m, i) => (
        <li key={`${m.at}:${i}`} className={i === 0 ? 'first' : ''}>
          <span className="when">{moveDay(dayOf(m.at), today)}</span>
          <b>{named ? `${m.name}: ` : ''}{m.title}</b>
          {m.detail && <span className="dim">{m.detail}</span>}
        </li>
      ))}
    </ol>
  )
}

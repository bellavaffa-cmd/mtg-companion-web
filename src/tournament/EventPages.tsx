import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { IconButton, PillChip, SegmentedTabs, rise, useBack } from '../components/kit'
import { TopBar } from '../components/TopBar'
import { useKeepAwake } from '../components/useKeepAwake'
import { useNow } from '../lifecounter/useNow'
import { useOverview } from '../social/SocialContext'
import type { Profile } from '../social/api'
import { deleteEvent, saveEvent, useEvents } from './events'
import {
  MAX_PLAYERS, RESET_TIMER, canFinish, canPairNext, clockText, currentRound, defaultRoundMinutes, extraTurnsText,
  formatLabel, matchChoices, newTournament, oneDecimal, pairNextRound, pauseTimer, percentText, playerName, playersProblem,
  podResult, recordText, resultText, sameResult, standings, standingsText, startTimer, statusText, suggestedRounds,
  timeLeft, timerRunning, withDropped, withResult, withTimer, type EventFormat, type EventTable, type TableResult,
  type Tournament,
} from './tournament'
import {
  canCut, cutLabel, cutSizes, matchWinner, playoffChampion, playoffChoices, playoffEditable, playoffRoundName, playoffStatus,
  seedOrder, startPlayoff, withPlayoffResult, type PlayoffMatch,
} from './playoff'
import './tournament.css'

// Small tournaments run from this device: the events list, a new event, and an event's rounds,
// standings and players. The logic is tournament.ts. The Android app's ui/tournament/TournamentScreens.kt.

/** "5 Oct" — the day an event was made. */
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** The events on this device, newest first, and a way to start one. */
export function EventsPage() {
  const navigate = useNavigate()
  const back = useBack('/play')
  const events = useEvents()
  const [deleting, setDeleting] = useState<Tournament | null>(null)
  return (
    <>
      <TopBar title="Events" onBack={back} />
      <div className="content-scroll events">
        <p className="dim rise" style={rise(0)}>Run a small Swiss or Commander pod event from this device: pairings, a round clock and standings.</p>
        <button type="button" className="btn gold rise" style={rise(1)} onClick={() => navigate('/play/events/new')}>
          <Icon name="add" />New event
        </button>
        {events.length === 0 && <p className="muted events-empty">Events you run show up here.</p>}
        {events.map((e, i) => (
          <div key={e.id} className="event-row rise" style={rise(Math.min(2 + i, 10))}>
            <button type="button" className="event-row-main press" onClick={() => navigate(`/play/events/${e.id}`)}>
              <Icon name="emoji_events" className={`event-row-icon${e.finished ? ' done' : ''}`} />
              <span className="event-row-text">
                <b>{e.name}</b>
                <span>{formatLabel(e)} · {e.players.length} players</span>
              </span>
              <span className="event-row-when">
                <b>{playoffStatus(e, (id) => playerName(e, id)) ?? statusText(e)}</b>
                <span>{day(e.createdAt)}</span>
              </span>
            </button>
            <IconButton icon="delete" label={`Delete ${e.name}`} onClick={() => setDeleting(e)} />
          </div>
        ))}
      </div>
      {deleting && (
        <Dialog
          title="Delete event?"
          onDismiss={() => setDeleting(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { deleteEvent(deleting.id); setDeleting(null) }}>Delete</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>{deleting.name}, its pairings and standings go for good.</p>
        </Dialog>
      )}
    </>
  )
}

interface Entrant { name: string; userId: string | null }

/** A number with − and + either side. */
function Stepper({ label, value, unit, hint, min, max, step = 1, onChange }: {
  label: string; value: number; unit?: string; hint?: string; min: number; max: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <div className="event-stepper">
      <span className="event-stepper-text"><b>{label}</b>{hint && <span>{hint}</span>}</span>
      <IconButton icon="remove" label={`Fewer ${label.toLowerCase()}`} onClick={() => onChange(Math.max(min, value - step))} />
      <span className="event-stepper-value">{value}{unit && <small>{unit}</small>}</span>
      <IconButton icon="add" label={`More ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, value + step))} />
    </div>
  )
}

/** A new event: its name, format, players (typed, or picked from friends), rounds and round length. */
export function NewEventPage() {
  const navigate = useNavigate()
  const back = useBack('/play/events')
  const { overview } = useOverview()
  const [name, setName] = useState(() => `Event ${day(Date.now())}`)
  const [format, setFormat] = useState<EventFormat>('SWISS')
  const [bestOf, setBestOf] = useState(3)
  const [players, setPlayers] = useState<Entrant[]>([])
  const [typed, setTyped] = useState('')
  // Rounds follow the suggestion for the player count until they're changed by hand.
  const [rounds, setRounds] = useState<number | null>(null)
  const [minutes, setMinutes] = useState<number | null>(null)

  const suggested = suggestedRounds(format, Math.max(players.length, 2))
  const roundCount = rounds ?? suggested
  const roundMinutes = minutes ?? defaultRoundMinutes(format)
  const taken = new Set(players.map((p) => p.name.trim().toLowerCase()))
  const friends = (overview?.friends ?? [])
    .filter((f) => f.status === 'accepted')
    .map((f) => overview?.people[f.user_id])
    .filter((p): p is Profile => !!p && !players.some((e) => e.userId === p.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  const problem = playersProblem(players.map((p) => p.name)) ?? (name.trim() ? null : 'Give the event a name')

  const add = (entrant: Entrant) => {
    if (!entrant.name.trim() || players.length >= MAX_PLAYERS || taken.has(entrant.name.trim().toLowerCase())) return
    setPlayers([...players, { ...entrant, name: entrant.name.trim() }])
  }
  const addTyped = () => {
    add({ name: typed, userId: null })
    setTyped('')
  }
  const create = () => {
    if (problem) return
    const t = newTournament({
      id: crypto.randomUUID(), name, format, bestOf, roundCount, roundMinutes,
      seed: Math.floor(Math.random() * 2 ** 31), createdAt: Date.now(), players,
    })
    saveEvent(t)
    navigate(`/play/events/${t.id}`, { replace: true })
  }

  return (
    <>
      <TopBar title="New event" onBack={back} />
      <div className="content-scroll events">
        <div className="field-label">Name</div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Event name" />

        <div className="field-label event-gap">Format</div>
        <SegmentedTabs labels={['1v1 Swiss', 'Commander pods']} selected={format === 'SWISS' ? 0 : 1} onSelect={(i) => setFormat(i === 0 ? 'SWISS' : 'PODS')} />
        {format === 'SWISS' ? (
          <div className="event-chips">
            <PillChip label="Best of 1" selected={bestOf === 1} onClick={() => setBestOf(1)} />
            <PillChip label="Best of 3" selected={bestOf === 3} onClick={() => setBestOf(3)} />
          </div>
        ) : (
          <p className="dim event-note">Pods of 4 (3s where the numbers don't fit). A pod win is 3 points, a draw 1 each.</p>
        )}

        <div className="field-label event-gap">Players · {players.length}</div>
        <div className="event-add">
          <input
            className="input"
            value={typed}
            placeholder="Name"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTyped()}
            aria-label="Player name"
          />
          <button type="button" className="btn" disabled={!typed.trim() || taken.has(typed.trim().toLowerCase()) || players.length >= MAX_PLAYERS} onClick={addTyped}>
            <Icon name="person_add" />Add
          </button>
        </div>
        {friends.length > 0 && (
          <div className="event-chips">
            {friends.map((f) => (
              <PillChip key={f.user_id} icon="add" label={f.display_name} onClick={() => add({ name: f.display_name, userId: f.user_id })} />
            ))}
          </div>
        )}
        {players.length > 0 && (
          <div className="event-entrants">
            {players.map((p, i) => (
              <span key={p.name} className="event-entrant">
                {i + 1}. {p.name}
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPlayers(players.filter((x) => x !== p))}><Icon name="close" /></button>
              </span>
            ))}
          </div>
        )}

        <div className="event-gap">
          <Stepper label="Rounds" hint={`Suggested for ${players.length} players: ${suggested}`} value={roundCount} min={1} max={15} onChange={setRounds} />
          <Stepper label="Round length" unit=" min" value={roundMinutes} min={5} max={180} step={5} onChange={setMinutes} />
        </div>

        {problem && <p className="dim event-note">{problem}</p>}
        <button type="button" className="btn gold block event-gap" disabled={!!problem} onClick={create}>
          <Icon name="emoji_events" />Start event
        </button>
      </div>
    </>
  )
}

type Tab = 'round' | 'standings' | 'players' | 'playoff'

/** One event: the current round (clock, tables, results), the standings and the players. */
export function EventPage() {
  const { id } = useParams()
  const back = useBack('/play/events')
  const event = useEvents().find((e) => e.id === id)
  const [tab, setTab] = useState<Tab | null>(null)
  if (!event) {
    return (
      <>
        <TopBar title="Event" onBack={back} />
        <div className="content-scroll events"><p className="muted">This event isn't on this device any more.</p></div>
      </>
    )
  }
  const tabs: Tab[] = event.playoff ? ['round', 'standings', 'playoff', 'players'] : ['round', 'standings', 'players']
  const shown: Tab = tab && tabs.includes(tab) ? tab : event.playoff ? 'playoff' : event.finished ? 'standings' : 'round'
  const labels: Record<Tab, string> = { round: 'Round', standings: 'Standings', players: 'Players', playoff: event.format === 'PODS' ? 'Final' : 'Top cut' }
  return (
    <>
      <TopBar title={event.name} onBack={back} />
      <div className="content-scroll events">
        <p className="dim event-sub">{formatLabel(event)} · {event.players.length} players · {playoffStatus(event, (id) => playerName(event, id)) ?? statusText(event)}</p>
        <SegmentedTabs labels={tabs.map((t) => labels[t])} selected={tabs.indexOf(shown)} onSelect={(i) => setTab(tabs[i])} />
        {shown === 'round' && <RoundTab event={event} onStandings={() => setTab('standings')} />}
        {shown === 'standings' && <StandingsTab event={event} onPlayoff={() => setTab('playoff')} />}
        {shown === 'playoff' && <PlayoffTab event={event} />}
        {shown === 'players' && <PlayersTab event={event} />}
      </div>
    </>
  )
}

function RoundTab({ event, onStandings }: { event: Tournament; onStandings: () => void }) {
  const round = currentRound(event)
  const next = event.rounds.length + 1
  const finish = () => { saveEvent({ ...event, finished: true }); onStandings() }
  return (
    <>
      {round && !event.finished && <RoundClock event={event} />}
      {round && <div className="field-label event-gap">Round {round.number} of {event.roundCount}</div>}
      {!round && <p className="dim event-note">{event.players.length} players. Pair round 1 once everyone's here — seats are drawn at random.</p>}
      {round?.tables.map((table, i) => <TableCard key={i} event={event} table={table} index={i} />)}
      {!event.finished && (
        <div className="event-actions">
          {canPairNext(event) && (
            <button type="button" className="btn gold block" onClick={() => saveEvent(pairNextRound(event))}>
              <Icon name="shuffle" />Pair round {next}
            </button>
          )}
          {canFinish(event) && (
            <button type="button" className={`btn block ${canPairNext(event) ? 'line' : 'gold'}`} onClick={finish}>
              <Icon name="flag" />{canPairNext(event) ? 'Finish now' : 'Finish event'}
            </button>
          )}
          {round && !canFinish(event) && <p className="dim event-note">Tap each table's result. Results can change until the next round is paired.</p>}
        </div>
      )}
    </>
  )
}

/** The one clock for the room: time left, large, and what to do once it's run out. */
function RoundClock({ event }: { event: Tournament }) {
  const round = currentRound(event)!
  const running = timerRunning(round.timer)
  const now = useNow(500, running)
  useKeepAwake(running)
  const left = timeLeft(round.timer, event.roundMinutes, now)
  const over = left <= 0
  const set = (timer: Tournament['rounds'][number]['timer']) => saveEvent(withTimer(event, timer))
  return (
    <div className={`event-clock${over ? ' over' : ''}`}>
      {over ? (
        <>
          <b className="event-clock-time">Extra turns</b>
          <span>{extraTurnsText(event.format)} · {clockText(left)} over time</span>
        </>
      ) : (
        <>
          <b className="event-clock-time">{clockText(left)}</b>
          <span>{running ? 'Time left in the round' : round.timer.leftMs == null ? `${event.roundMinutes} minutes, not started` : 'Paused'}</span>
        </>
      )}
      <div className="event-clock-buttons">
        {running ? (
          <button type="button" className="btn" onClick={() => set(pauseTimer(round.timer, event.roundMinutes, Date.now()))}><Icon name="pause" />Pause</button>
        ) : (
          <button type="button" className="btn gold" onClick={() => set(startTimer(round.timer, event.roundMinutes, Date.now()))}><Icon name="play_arrow" />Start</button>
        )}
        {(running || round.timer.leftMs != null) && (
          <button type="button" className="btn line" onClick={() => set(RESET_TIMER)}><Icon name="replay" />Reset</button>
        )}
      </div>
    </div>
  )
}

/** One table: who's sitting there and their result, tapped in; tap it again to clear it. */
function TableCard({ event, table, index }: { event: Tournament; table: EventTable; index: number }) {
  const editable = !event.finished
  const set = (r: TableResult) => editable && saveEvent(withResult(event, index, sameResult(table.result, r) ? null : r))
  const names = table.players.map((p) => playerName(event, p))
  if (table.players.length === 1) {
    return (
      <div className="event-table">
        <div className="event-table-head"><b>{names[0]}</b><span>Bye · {event.format === 'SWISS' ? '2–0 win' : 'counts as a win'}</span></div>
      </div>
    )
  }
  const done = resultText(event, table)
  return (
    <div className="event-table">
      <div className="event-table-head">
        <b>{event.format === 'SWISS' ? names.join(' vs ') : names.join(' · ')}</b>
        <span>Table {index + 1}{done ? ` · ${done}` : ''}</span>
      </div>
      <div className="event-chips">
        {event.format === 'SWISS'
          ? matchChoices(event.bestOf).map((c) => (
            <PillChip key={c.label} label={c.label} selected={sameResult(table.result, { wins: c.wins, draws: c.draws })} onClick={() => set({ wins: c.wins, draws: c.draws })} />
          ))
          : [
            ...table.players.map((p, i) => {
              const r = podResult(table.players, p)
              return <PillChip key={p} label={names[i]} icon="emoji_events" selected={sameResult(table.result, r)} onClick={() => set(r)} />
            }),
            <PillChip key="draw" label="Draw" selected={sameResult(table.result, podResult(table.players, null))} onClick={() => set(podResult(table.players, null))} />,
          ]}
      </div>
      {event.format === 'SWISS' && <p className="dim event-table-hint">From {names[0]}'s side</p>}
    </div>
  )
}

function StandingsTab({ event, onPlayoff }: { event: Tournament; onPlayoff: () => void }) {
  const rows = standings(event)
  const [copied, setCopied] = useState(false)
  const champion = playoffChampion(event)
  const text = standingsText(event) + (champion ? `\n\nChampion: ${playerName(event, champion)}` : '')
  const canShare = typeof navigator.share === 'function'
  return (
    <>
      <div className="field-label event-gap">
        {event.finished ? 'Final standings' : event.rounds.length === 0 ? 'Standings' : `Standings after round ${event.rounds.length}`}
      </div>
      {rows.map((s, i) => (
        <div key={s.id} className={`event-standing${s.dropped ? ' dropped' : ''}`}>
          <span className="event-rank">{i + 1}</span>
          <span className="event-standing-text">
            <b>{s.name}{s.dropped && <small> · dropped</small>}</b>
            <span>
              {recordText(s)}
              {event.format === 'SWISS'
                ? ` · OMW ${percentText(s.omw)} · GW ${percentText(s.gw)} · OGW ${percentText(s.ogw)}`
                : ` · Opp. avg ${oneDecimal(s.oppPoints)}`}
            </span>
          </span>
          <span className="event-points">{s.points}<small>pts</small></span>
        </div>
      ))}
      {canCut(event) && <CutButtons event={event} onCut={onPlayoff} />}
      <p className="dim event-note">
        {event.format === 'SWISS'
          ? 'Match win 3, draw 1. Ties go to opponents’ match-win %, then game-win %, then opponents’ game-win % (each at least 33%).'
          : 'Pod win 3, draw 1 each. Ties go to the average points of everyone you shared a pod with.'}
      </p>
      <div className="event-actions row">
        <button type="button" className="btn" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)) }}>
          <Icon name={copied ? 'check' : 'content_copy'} />{copied ? 'Copied' : 'Copy'}
        </button>
        {canShare && (
          <button type="button" className="btn" onClick={() => { void navigator.share({ title: event.name, text }).catch(() => {}) }}>
            <Icon name="share" />Share
          </button>
        )}
      </div>
    </>
  )
}

function PlayersTab({ event }: { event: Tournament }) {
  return (
    <>
      <p className="dim event-note">A dropped player isn't paired again; their results still count for everyone they played.</p>
      {event.players.map((p) => (
        <div key={p.id} className={`event-standing${p.dropped ? ' dropped' : ''}`}>
          <Icon name={p.userId ? 'person' : 'person_outline'} className="event-player-icon" />
          <span className="event-standing-text"><b>{p.name}</b>{p.dropped && <span>Dropped</span>}</span>
          {!event.finished && (
            <button type="button" className="btn sm line" onClick={() => saveEvent(withDropped(event, p.id, !p.dropped))}>
              {p.dropped ? 'Bring back' : 'Drop'}
            </button>
          )}
        </div>
      ))}
    </>
  )
}

/** After the Swiss: cut to a top 8 / 4 / 2 (1v1) or a final table of the top 4 (pods). */
function CutButtons({ event, onCut }: { event: Tournament; onCut: () => void }) {
  const sizes = cutSizes(event)
  if (sizes.length === 0) return null
  return (
    <div className="event-cut">
      <div className="field-label">{event.format === 'PODS' ? 'Final table' : 'Top cut'}</div>
      <p className="dim event-note">
        {event.format === 'PODS'
          ? 'The top players by the standings play one last game; its winner takes the event.'
          : 'Single elimination, seeded by the standings: 1 plays 8, 4 plays 5, 2 plays 7, 3 plays 6.'}
      </p>
      <div className="event-chips">
        {sizes.map((n) => (
          <PillChip key={n} icon="account_tree" label={cutLabel(event.format, n)} onClick={() => { saveEvent(startPlayoff(event, n)); onCut() }} />
        ))}
      </div>
    </div>
  )
}

/** The bracket (or the final table), round by round, each match's result tapped in, and the champion. */
function PlayoffTab({ event }: { event: Tournament }) {
  const p = event.playoff!
  const champion = playoffChampion(event)
  // Each player's seed: where they sit in the first round, in bracket order.
  const order = seedOrder(p.size)
  const seedOf = new Map(p.rounds[0].flatMap((m) => m.players).map((id, i) => [id, order[i]]))
  const seedNumber = (id: string | null) => (id == null || p.kind !== 'BRACKET' ? null : seedOf.get(id) ?? null)
  return (
    <>
      {champion && (
        <div className="event-champion" role="status">
          <Icon name="emoji_events" />
          <span><small>Champion</small><b>{playerName(event, champion)}</b></span>
        </div>
      )}
      <div className="event-bracket">
        {p.rounds.map((round, r) => (
          <section key={r} className="event-bracket-round" aria-label={playoffRoundName(p, r)}>
            <div className="field-label">{playoffRoundName(p, r)}</div>
            {round.map((m, i) => <PlayoffCard key={i} event={event} match={m} round={r} index={i} seedNumber={seedNumber} />)}
          </section>
        ))}
      </div>
      {!champion && <p className="dim event-note">Tap each match's result. A result can change until the next match is played.</p>}
    </>
  )
}

function PlayoffCard({ event, match, round, index, seedNumber }: {
  event: Tournament; match: PlayoffMatch; round: number; index: number; seedNumber: (id: string | null) => number | null
}) {
  const p = event.playoff!
  const editable = playoffEditable(p, round, index)
  const winner = matchWinner(match)
  const set = (r: TableResult) => editable && saveEvent(withPlayoffResult(event, round, index, sameResult(match.result, r) ? null : r))
  const ids = match.players
  return (
    <div className={`event-table event-match${winner ? ' done' : ''}`}>
      {ids.map((id, i) => (
        <div key={i} className={`event-match-player${id != null && id === winner ? ' won' : ''}${id == null ? ' waiting' : ''}`}>
          {seedNumber(id) != null && <span className="event-seed">{seedNumber(id)}</span>}
          <b>{id == null ? 'Waiting' : playerName(event, id)}</b>
          {id != null && id === winner && <Icon name="check" />}
        </div>
      ))}
      {editable && (
        <div className="event-chips">
          {p.kind === 'FINAL_TABLE'
            ? ids.map((id, i) => {
              const r = podResult(ids as string[], id)
              return <PillChip key={i} label={playerName(event, id!)} icon="emoji_events" selected={sameResult(match.result, r)} onClick={() => set(r)} />
            })
            : playoffChoices(event.bestOf).map((c) => (
              <PillChip key={c.label} label={c.label} selected={sameResult(match.result, { wins: c.wins, draws: c.draws })} onClick={() => set({ wins: c.wins, draws: c.draws })} />
            ))}
        </div>
      )}
      {editable && p.kind === 'BRACKET' && <p className="dim event-table-hint">From {playerName(event, ids[0]!)}'s side</p>}
    </div>
  )
}

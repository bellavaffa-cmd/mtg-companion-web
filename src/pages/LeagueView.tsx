import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PillChip, rise } from '../components/kit'
import * as api from '../social/api'
import { shortDay } from '../collection/loans'
import type { PodGame } from '../decks/podStats'
import {
  LEAGUE_PRESETS, LEAGUE_UNAVAILABLE, MAX_RULE_POINTS, PRESET_CUSTOM,
  canManageSeason, championLine, championNames, nextSeasonName, rulesSummary, runningSeason, seasonDays, seasonEndedAt,
  seasonProblem, seasonStatus, seasonTable, todayDay, winRate,
  type LeagueRules, type LeagueStanding, type Season,
} from '../decks/league'
import './league.css'

// League mode on a pod's Playgroup page: the running season's table (points, games, wins, win rate,
// streak), its points per game night, its champion once it's over, and the past seasons with their
// final tables. The scoring is decks/league.ts. Mirrors the Android app's LeagueView.kt.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The league's part of a pod's page. [seasons]: null while loading; [onChanged] loads them again. */
export function LeagueSection({ pod, me, games, seasons, unavailable, loadError, nameOf, onChanged }: {
  pod: api.Pod
  me: api.Profile
  games: PodGame[]
  seasons: Season[] | null
  unavailable: boolean
  loadError: string | null
  nameOf: (p: { userId: string | null; name: string }) => string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<Season | null>(null)
  const [creating, setCreating] = useState(false)
  const [ending, setEnding] = useState<Season | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openPast, setOpenPast] = useState<string | null>(null)
  const [showNights, setShowNights] = useState(false)
  // Seasons this device already tried to close, so a refusal doesn't repeat forever.
  const autoEnded = useRef(new Set<string>())

  const today = todayDay()
  const running = seasons ? runningSeason(seasons) : null
  const status = running ? seasonStatus(running, games, today) : null
  const table = useMemo(() => (running ? seasonTable(running, games) : null), [running, games])
  const canManage = !!running && canManageSeason(running, me.user_id, pod.owner)
  const resolved = (list: LeagueStanding[]) => list.map((s) => ({ ...s, name: nameOf(s) }))

  const end = async (season: Season, endedAt: number) => {
    const standings = resolved(seasonTable(season, games).standings)
    try {
      await api.endPodSeason(season.id, endedAt, championNames(standings.filter((s) => s.rank === 1)), standings)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
    onChanged()
  }

  // A season over by its own rules (its last day or last game night has passed) is closed by whoever
  // may close it, the first time they look: its table is kept as it ended.
  useEffect(() => {
    if (running && status === 'OVER' && canManage && !autoEnded.current.has(running.id)) {
      autoEnded.current.add(running.id)
      void end(running, seasonEndedAt(running, seasonTable(running, games), Date.now()))
    }
    // end() reads the latest games each time; the season, its status and who may end it decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.id, status, canManage])

  if (unavailable) {
    return (
      <div className="panel match-panel rise" style={rise(1)}>
        <div className="p-h"><h3>League</h3></div>
        <div className="dim">{LEAGUE_UNAVAILABLE}.</div>
      </div>
    )
  }
  if (!seasons) return loadError ? <div className="notice warn" style={{ marginBottom: 10 }}>{loadError}</div> : null

  const past = seasons.filter((s) => s.endedAt != null)
  const champion = running && table && status === 'OVER' ? championLine(running.name, championNames(resolved(table.champions))) : null

  return (
    <>
      {error && <div className="notice warn" style={{ marginBottom: 10 }}>{error}</div>}
      {!running || !table || !status ? (
        <div className="panel match-panel rise" style={rise(1)}>
          <div className="p-h"><h3>League</h3></div>
          <div className="dim" style={{ marginBottom: 10 }}>Run a season: points for wins, one table everyone in the pod sees, and a champion at the end.</div>
          <button type="button" className="btn gold" onClick={() => setCreating(true)}><Icon name="emoji_events" aria-hidden />Start {nextSeasonName(seasons)}</button>
        </div>
      ) : (
        <div className="panel match-panel rise" style={rise(1)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{running.name}</div>
              <div className={`league-status${status === 'RUNNING' ? ' on' : ''}`}>
                {status === 'UPCOMING'
                  ? `Starts ${shortDay(running.startsOn)}`
                  : status === 'OVER'
                    ? `Over · ${plural(table.nights.length, 'game night')}`
                    : `Running · ${plural(table.nights.length, 'game night')}${running.maxNights != null ? ` of ${running.maxNights}` : ''}`}
              </div>
            </div>
            {canManage && <button type="button" className="btn line sm" onClick={() => setEditing(running)}>Edit</button>}
          </div>
          <div className="league-rules">{seasonDays(running)} · {rulesSummary(running.rules)}</div>
          {champion && <div className="league-champion"><Icon name="emoji_events" aria-hidden />{champion}</div>}
          {table.standings.length === 0 ? (
            <div className="dim">
              {status === 'UPCOMING' ? `Games recorded from ${shortDay(running.startsOn)} count.` : 'No games in this season yet. Record a game and it counts.'}
            </div>
          ) : (
            <>
              <StandingsTable rows={table.standings} nameOf={nameOf} me={me.user_id} />
              {table.perNight.length > 0 && (
                <button type="button" className="league-link" aria-expanded={showNights} onClick={() => setShowNights((v) => !v)}>
                  {showNights ? 'Hide points per game night' : 'Points per game night'}
                </button>
              )}
              {showNights && table.perNight.map((n) => (
                <div key={n.night} className="league-night">
                  <div className="dim">{shortDay(n.night)} · {plural(n.games, 'game')}</div>
                  <div>{n.scores.map((s) => `${nameOf(s)} ${s.points}`).join(' · ')}</div>
                </div>
              ))}
            </>
          )}
          {canManage && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn line" onClick={() => setEnding(running)}>End season</button>
            </div>
          )}
        </div>
      )}

      {past.length > 0 && (
        <div className="panel match-panel rise" style={rise(2)}>
          <div className="p-h"><h3>Past seasons</h3></div>
          {past.map((s) => {
            const open = openPast === s.id
            const final = open ? s.standings ?? seasonTable(s, games).standings : []
            return (
              <div key={s.id}>
                <button type="button" className="league-past" aria-expanded={open} onClick={() => setOpenPast(open ? null : s.id)}>
                  {s.name}
                  <span className={s.champion ? 'won' : 'dim'}>{championLine(s.name, s.champion) ?? 'No games were played.'}</span>
                  <span className="dim">{seasonDays(s)}</span>
                </button>
                {open && final.length > 0 && <StandingsTable rows={final} nameOf={nameOf} me={me.user_id} />}
              </div>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <SeasonDialog
          pod={pod}
          season={editing}
          suggestedName={nextSeasonName(seasons)}
          onSaved={() => { setCreating(false); setEditing(null); onChanged() }}
          onDismiss={() => { setCreating(false); setEditing(null) }}
        />
      )}
      {ending && (
        <EndSeasonDialog
          season={ending}
          champion={championNames(resolved(seasonTable(ending, games).champions))}
          onEnd={() => { const s = ending; setEnding(null); void end(s, Date.now()) }}
          onDismiss={() => setEnding(null)}
        />
      )}
    </>
  )
}

/** The table: rank, player, points, games, wins, win rate and streak. */
function StandingsTable({ rows, nameOf, me }: { rows: LeagueStanding[]; nameOf: (p: { userId: string | null; name: string }) => string; me: string }) {
  return (
    <table className="league-table">
      <thead>
        <tr>
          <th className="rank"><span className="sr-only">Rank</span></th>
          <th>Player</th>
          <th className="pts">Pts</th>
          <th className="n" title="Games">G</th>
          <th className="n" title="Wins">W</th>
          <th className="rate">Win %</th>
          <th className="streak">Streak</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.key} className={s.rank === 1 ? 'first' : undefined}>
            <td className="rank">{s.rank}</td>
            <td className="name">{nameOf(s)}{s.userId === me ? ' (you)' : ''}</td>
            <td className="pts">{s.points}</td>
            <td className="n">{s.games}</td>
            <td className="n">{s.wins}</td>
            <td className="rate">{winRate(s)}%</td>
            <td className={`streak${s.streak.startsWith('W') ? ' up' : ''}`}>{s.streak || '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EndSeasonDialog({ season, champion, onEnd, onDismiss }: { season: Season; champion: string | null; onEnd: () => void; onDismiss: () => void }) {
  return (
    <Dialog
      title={`End ${season.name}?`}
      onDismiss={onDismiss}
      actions={(
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" onClick={onEnd}>End season</button>
        </>
      )}
    >
      <p style={{ marginTop: 0 }}>
        The table is kept as it is now{champion ? `, and ${champion} ${champion.includes(' & ') ? 'share the title' : 'is champion'}.` : '.'} Games recorded after this don't count for it.
      </p>
    </Dialog>
  )
}

type EndBy = 'DATE' | 'NIGHTS' | 'NONE'

const addMonths = (day: string, months: number) => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(y, m - 1 + months, d)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** Starting a season, or changing the running one ([season]). */
function SeasonDialog({ pod, season, suggestedName, onSaved, onDismiss }: {
  pod: api.Pod
  season: Season | null
  suggestedName: string
  onSaved: () => void
  onDismiss: () => void
}) {
  const [name, setName] = useState(season?.name ?? suggestedName)
  const [startsOn, setStartsOn] = useState(season?.startsOn ?? todayDay())
  const [endBy, setEndBy] = useState<EndBy>(!season ? 'NIGHTS' : season.endsOn != null ? 'DATE' : season.maxNights != null ? 'NIGHTS' : 'NONE')
  const [endsOn, setEndsOn] = useState(season?.endsOn ?? addMonths(todayDay(), 3))
  const [nights, setNights] = useState(String(season?.maxNights ?? 8))
  const [rules, setRules] = useState<LeagueRules>(season?.rules ?? LEAGUE_PRESETS[0].rules)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRule = (key: Exclude<keyof LeagueRules, 'preset'>, value: number) =>
    setRules((r) => ({ ...r, preset: PRESET_CUSTOM, [key]: Math.min(MAX_RULE_POINTS, Math.max(0, value)) }))

  const save = async () => {
    const end = endBy === 'DATE' ? endsOn : null
    const max = endBy === 'NIGHTS' ? parseInt(nights, 10) || 0 : null
    const problem = seasonProblem(name, startsOn, end, max)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError(null)
    const fields = { name, startsOn, endsOn: end, maxNights: max, rules }
    try {
      if (season) await api.updatePodSeason(season.id, fields)
      else await api.createPodSeason(pod.id, fields)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
      return
    }
    onSaved()
  }

  const steppers: [Exclude<keyof LeagueRules, 'preset'>, string][] = [
    ['win', 'A win'], ['second', 'Second place'], ['draw', 'A draw'], ['played', 'Playing a game'], ['firstBlood', 'First blood'], ['newDeckWin', 'Winning with a new deck'],
  ]

  return (
    <Dialog
      title={season ? `Change ${season.name}` : 'Start a season'}
      onDismiss={onDismiss}
      actions={(
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : season ? 'Save' : 'Start'}</button>
        </>
      )}
    >
      <label className="field-label" htmlFor="season-name" style={{ display: 'block' }}>Name</label>
      <input id="season-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />

      <label className="field-label" htmlFor="season-starts" style={{ display: 'block', marginTop: 14 }}>Starts</label>
      <input id="season-starts" className="input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />

      <div className="field-label" style={{ marginTop: 14 }}>Ends</div>
      <div className="chips wrap">
        <PillChip label="After game nights" selected={endBy === 'NIGHTS'} onClick={() => setEndBy('NIGHTS')} />
        <PillChip label="On a date" selected={endBy === 'DATE'} onClick={() => setEndBy('DATE')} />
        <PillChip label="When we end it" selected={endBy === 'NONE'} onClick={() => setEndBy('NONE')} />
      </div>
      {endBy === 'DATE' && (
        <input className="input" type="date" aria-label="Ends on" style={{ marginTop: 8 }} value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
      )}
      {endBy === 'NIGHTS' && (
        <>
          <label className="field-label" htmlFor="season-nights" style={{ display: 'block', marginTop: 8 }}>Game nights</label>
          <input id="season-nights" className="input" inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </>
      )}
      {endBy === 'NONE' && <div className="dim" style={{ marginTop: 8 }}>It runs until whoever started it, or the pod's owner, ends it.</div>}

      <div className="field-label" style={{ marginTop: 14 }}>Points</div>
      <div className="chips wrap">
        {LEAGUE_PRESETS.map((p) => <PillChip key={p.id} label={p.label} selected={rules.preset === p.id} onClick={() => setRules(p.rules)} />)}
        <PillChip label="Custom" selected={rules.preset === PRESET_CUSTOM} onClick={() => setRules((r) => ({ ...r, preset: PRESET_CUSTOM }))} />
      </div>
      <div style={{ marginTop: 6 }}>
        {steppers.map(([key, label]) => (
          <div key={key} className="league-rule">
            <span>{label}</span>
            <button type="button" className="btn line sm" aria-label={`Fewer points for ${label}`} disabled={rules[key] <= 0} onClick={() => setRule(key, rules[key] - 1)}><Icon name="remove" aria-hidden /></button>
            <b>{rules[key]}</b>
            <button type="button" className="btn line sm" aria-label={`More points for ${label}`} disabled={rules[key] >= MAX_RULE_POINTS} onClick={() => setRule(key, rules[key] + 1)}><Icon name="add" aria-hidden /></button>
          </div>
        ))}
      </div>
      <div className="dim" style={{ marginTop: 6 }}>
        Second place and first blood count when they're picked as a game is recorded. A new deck is one its player hasn't played in this pod before.
      </div>
      <div className="dim" style={{ marginTop: 6 }}>Every pod game played on the season's days counts. Everyone in the pod sees the same table.</div>
      {error && <div className="notice warn" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

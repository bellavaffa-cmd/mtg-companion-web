import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PillChip, rise } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import * as api from '../social/api'
import { ShareSwitch } from '../social/ShareDialog'
import { useSocial } from '../social/SocialContext'
import { matchupRecord } from '../decks/gameStats'
import { MIN_GAMES } from '../decks/playgroupStats'
import {
  canDeletePodGame, deckResultOf, podGameProblem, podStats,
  type CommanderRecord, type PodGame, type PodPlayer, type PodResult,
} from '../decks/podStats'
import { runningSeason, type LeagueRules, type Season } from '../decks/league'
import { LeagueSection } from './LeagueView'
import { PodNightAndChat } from '../social/PodNightAndChat'
import { GAME_MODE_LABELS, GAME_MODES, type Deck, type GameMode } from '../types/models'

// A pod's shared games on the Playgroup page: the group's table, commanders, nemeses and latest
// games, and recording a new one. Mirrors the Android app's PodGames.kt (ui/lifecounter).

/** How many commanders each list shows. */
const COMMANDERS_SHOWN = 5
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const record = (r: { wins: number; losses: number; draws: number }) => `${r.wins}–${r.losses}${r.draws > 0 ? `–${r.draws}` : ''}`
const formatLabel = (f: string) => GAME_MODE_LABELS[f as GameMode] ?? (f ? f.charAt(0) + f.slice(1).toLowerCase() : '')
const commanderOf = (d: Deck) => [d.commander?.name, d.partnerCommander?.name].filter(Boolean).join(' & ')

export function PodView({ pod, me }: { pod: api.Pod; me: api.Profile }) {
  const people = usePeople()
  const [games, setGames] = useState<PodGame[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [deleting, setDeleting] = useState<PodGame | null>(null)
  // The pod's league seasons (LeagueView.tsx): null while loading.
  const [seasons, setSeasons] = useState<Season[] | null>(null)
  const [leagueUnavailable, setLeagueUnavailable] = useState(false)
  const [leagueError, setLeagueError] = useState<string | null>(null)
  // Answers for a pod that's no longer shown must not land.
  const current = useRef(pod.id)
  current.current = pod.id

  const loadSeasons = useCallback(async () => {
    const id = pod.id
    try {
      const s = await api.podSeasons(id)
      if (current.current === id) { setSeasons(s); setLeagueError(null) }
    } catch (e) {
      if (current.current !== id) return
      if (e instanceof api.SocialError && e.code === 'unavailable') setLeagueUnavailable(true)
      else setLeagueError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }, [pod.id])
  useEffect(() => {
    setSeasons(null)
    setLeagueUnavailable(false)
    setLeagueError(null)
    void loadSeasons()
  }, [loadSeasons])

  const load = useCallback(async () => {
    const id = pod.id
    setLoading(true)
    setError(null)
    try {
      const g = await api.podGames(id)
      if (current.current === id) setGames(g)
    } catch (e) {
      if (current.current === id) setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      if (current.current === id) setLoading(false)
    }
  }, [pod.id])
  useEffect(() => {
    setGames(null)
    void load()
  }, [load])

  const stats = useMemo(() => (games ? podStats(games) : null), [games])
  const nameOf = (p: Pick<PodPlayer, 'userId' | 'name'>) => (p.userId ? people(p.userId)?.display_name ?? p.name : p.name)
  const length = stats ? [stats.averageMinutes != null ? `${stats.averageMinutes} min` : null, stats.averageTurns != null ? `${stats.averageTurns} turns` : null].filter(Boolean) : []

  return (
    <>
      <div className="rise" style={{ ...rise(0), display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div className="grow" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{pod.name}</div>
          <div className="dim">{plural(pod.members.length, 'person', 'people')}{stats ? ` · ${plural(stats.games, 'game')}` : ''}</div>
        </div>
        <button type="button" className="btn gold" onClick={() => setRecording(true)}><Icon name="add" aria-hidden />Record a game</button>
      </div>
      {/* For now the way into the pod's chat and game nights; the lead wires them into Friends and Play. */}
      <PodNightAndChat podId={pod.id} />

      {games && (
        <LeagueSection
          pod={pod}
          me={me}
          games={games}
          seasons={seasons}
          unavailable={leagueUnavailable}
          loadError={leagueError}
          nameOf={nameOf}
          onChanged={() => void loadSeasons()}
        />
      )}

      {!games ? (
        error ? (
          <div className="empty-state">
            <Icon name="cloud_off" />
            <div>{error}</div>
            <button type="button" className="btn line" disabled={loading} onClick={() => void load()}>Try again</button>
          </div>
        ) : (
          <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
        )
      ) : !stats || stats.games === 0 ? (
        <div className="empty-state rise" style={rise(1)}>
          <Icon name="groups" />
          <div>No games recorded in this pod yet. Record one after you play — everyone in the pod sees the same games.</div>
        </div>
      ) : (
        <>
          {error && <div className="notice warn" style={{ marginBottom: 10 }}>{error}</div>}
          <div className="panel match-panel rise" style={rise(1)}>
            <div className="p-h"><h3>Players</h3></div>
            {stats.players.map((p) => (
              <div key={p.key} className="matchup">
                <span className="grow matchup-name">{nameOf(p)}{p.userId === me.user_id ? ' (you)' : ''}</span>
                <span className="dim">{p.winRate}% · {plural(p.games, 'game')}</span>
                <b className={p.wins > p.losses ? 'up' : p.wins < p.losses ? 'down' : ''}>{record(p)}</b>
              </div>
            ))}
            {length.length > 0 && <div className="dim match-length" style={{ marginTop: 6 }}>A game takes about {length.join(' · ')}</div>}
          </div>

          {stats.nemeses.length > 0 && (
            <div className="panel match-panel rise" style={rise(2)}>
              <div className="p-h"><h3>Nemeses</h3></div>
              {stats.nemeses.map(({ player, nemesis }) => (
                <div key={player.key} className="matchup">
                  <span className="grow matchup-name">{nameOf(player)} <span className="dim">→</span> {nemesis.name}</span>
                  <span className="dim">{plural(nemesis.games, 'game')}</span>
                  <b className="down">{matchupRecord(nemesis)}</b>
                </div>
              ))}
              <div className="dim" style={{ marginTop: 6 }}>Who each player does worst against, out of those they've played {MIN_GAMES} or more times.</div>
            </div>
          )}

          {stats.mostPlayed.length > 0 && (
            <div className="panel match-panel rise" style={rise(3)}>
              <div className="p-h"><h3>Commanders</h3></div>
              <div className="match-sub">Most played</div>
              {stats.mostPlayed.slice(0, COMMANDERS_SHOWN).map((c) => <CommanderRow key={c.name} c={c} />)}
              <div className="match-sub">Best win rate</div>
              {stats.best.slice(0, COMMANDERS_SHOWN).map((c) => <CommanderRow key={c.name} c={c} />)}
              <div className="dim" style={{ marginTop: 6 }}>Commanders played {MIN_GAMES} or more times.</div>
            </div>
          )}

          <div className="panel match-panel rise" style={rise(4)}>
            <div className="p-h"><h3>Latest games</h3></div>
            {stats.latest.map((g) => (
              <GameRow key={g.id} game={g} nameOf={nameOf} onDelete={canDeletePodGame(g, me.user_id, pod.owner) ? () => setDeleting(g) : undefined} />
            ))}
          </div>
        </>
      )}

      {recording && (
        <RecordGameDialog
          pod={pod}
          me={me}
          league={seasons ? runningSeason(seasons)?.rules ?? null : null}
          onRecorded={() => { setRecording(false); void load() }}
          onDismiss={() => setRecording(false)}
        />
      )}
      {deleting && (
        <DeleteGameDialog
          game={deleting}
          onDeleted={() => { setDeleting(null); void load() }}
          onDismiss={() => setDeleting(null)}
        />
      )}
    </>
  )
}

/** Display names for pod members, from the social overview. */
const usePeople = () => useSocial().person

function CommanderRow({ c }: { c: CommanderRecord }) {
  return (
    <div className="matchup">
      <span className="grow matchup-name">{c.name}</span>
      <span className="dim">{c.winRate}% · {plural(c.games, 'game')}</span>
      <b className={c.wins * 2 > c.games ? 'up' : ''}>{plural(c.wins, 'win')}</b>
    </div>
  )
}

function GameRow({ game, nameOf, onDelete }: { game: PodGame; nameOf: (p: PodPlayer) => string; onDelete?: () => void }) {
  const draw = game.players.every((p) => p.result === 'DRAW')
  const facts = [
    new Date(game.playedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    formatLabel(game.format),
    game.turns ? plural(game.turns, 'turn') : null,
    game.minutes ? `${game.minutes} min` : null,
    draw ? 'Draw' : null,
  ].filter(Boolean)
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--g2)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="dim">{facts.join(' · ')}</div>
        <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
          {game.players.map((p, i) => (
            <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.result === 'WIN' ? <b style={{ color: 'var(--gold)' }}><Icon name="emoji_events" aria-label="Winner" style={{ fontSize: 15, verticalAlign: -2, marginRight: 3 }} />{nameOf(p)}</b> : <span>{nameOf(p)}</span>}
              {p.commander && <span className="dim"> · {p.commander}</span>}
            </div>
          ))}
        </div>
      </div>
      {onDelete && (
        <button type="button" className="btn line sm danger-text" onClick={onDelete} aria-label="Delete this game"><Icon name="delete" aria-hidden /></button>
      )}
    </div>
  )
}

function DeleteGameDialog({ game, onDeleted, onDismiss }: { game: PodGame; onDeleted: () => void; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.deletePodGame(game.id)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Delete this game?"
      onDismiss={onDismiss}
      actions={(
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>Delete</button>
        </>
      )}
    >
      <p style={{ marginTop: 0 }}>It comes out of the pod's games for everyone. A deck's own record keeps it.</p>
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

/** One seat in the form. [deckId]: the user's own deck, for their own seat. */
interface Seat {
  id: string
  userId: string | null
  name: string
  commander: string
  deck: string
  deckId: string | null
}

const DRAW = 'draw'

/**
 * Recording a game. [league]: the running season's rules — when they give points for second place
 * or first blood, those can be picked.
 */
function RecordGameDialog({ pod, me, league, onRecorded, onDismiss }: { pod: api.Pod; me: api.Profile; league: LeagueRules | null; onRecorded: () => void; onDismiss: () => void }) {
  const { decks, addGameResult } = useSync()
  const people = usePeople()
  const memberName = (id: string) => (id === me.user_id ? me.display_name : people(id)?.display_name ?? 'Someone')
  const seatOf = (userId: string | null, name: string): Seat => ({ id: crypto.randomUUID(), userId, name, commander: '', deck: '', deckId: null })
  const [seats, setSeats] = useState<Seat[]>(() => [seatOf(me.user_id, me.display_name)])
  const [guest, setGuest] = useState('')
  // A seat's id, or DRAW.
  const [winner, setWinner] = useState('')
  // Seat ids, or '' for nobody.
  const [second, setSecond] = useState('')
  const [firstBlood, setFirstBlood] = useState('')
  const [format, setFormat] = useState<GameMode>('COMMANDER')
  const [turns, setTurns] = useState('')
  const [minutes, setMinutes] = useState('')
  const [toDeck, setToDeck] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Kept for retries, so a game that did reach the server isn't stored twice.
  const [clientId] = useState(() => crypto.randomUUID())
  const [playedAt] = useState(() => Date.now())

  const myDecks = useMemo(() => [...decks].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())), [decks])
  const members = [me.user_id, ...pod.members.filter((m) => m !== me.user_id)]
  const mySeat = seats.find((s) => s.userId === me.user_id)
  const update = (id: string, change: Partial<Seat>) => setSeats((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)))
  const toggleMember = (userId: string) => {
    const seat = seats.find((s) => s.userId === userId)
    if (seat) {
      setSeats((list) => list.filter((s) => s.id !== seat.id))
      if (winner === seat.id) setWinner('')
      if (second === seat.id) setSecond('')
      if (firstBlood === seat.id) setFirstBlood('')
    } else {
      setSeats((list) => [...list, seatOf(userId, memberName(userId))])
    }
  }
  const addGuest = () => {
    const name = guest.trim()
    if (!name) return
    setSeats((list) => [...list, seatOf(null, name)])
    setGuest('')
  }
  const pickDeck = (seat: Seat, deckId: string) => {
    const deck = decks.find((d) => d.id === deckId)
    update(seat.id, { deckId: deck?.id ?? null, deck: deck?.name ?? '', commander: deck && !seat.commander.trim() ? commanderOf(deck) : seat.commander })
  }

  const count = (text: string) => {
    const n = parseInt(text, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const save = async () => {
    const result = (s: Seat): PodResult => (winner === DRAW ? 'DRAW' : winner === s.id ? 'WIN' : 'LOSS')
    const players: PodPlayer[] = seats.map((s) => ({
      userId: s.userId,
      name: s.name.trim(),
      commander: s.commander.trim() || null,
      deck: s.deck.trim() || null,
      result: result(s),
      place: winner === DRAW ? null : winner === s.id ? (second ? 1 : null) : second === s.id ? 2 : null,
      firstBlood: firstBlood === s.id,
    }))
    const problem = !winner ? 'Pick who won, or Draw.' : podGameProblem(players)
    if (problem) { setError(problem); return }
    const game = { playedAt, format, turns: count(turns), minutes: count(minutes), players }
    setBusy(true)
    setError(null)
    try {
      await api.recordPodGame(pod.id, clientId, game)
    } catch (e) {
      // Offline or refused: the form stays filled, to try again.
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
      return
    }
    if (toDeck && mySeat?.deckId) {
      const own = deckResultOf(game, me.user_id, clientId)
      if (own) addGameResult(mySeat.deckId, own)
    }
    onRecorded()
  }

  return (
    <Dialog
      title="Record a game"
      onDismiss={onDismiss}
      actions={(
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Record'}</button>
        </>
      )}
    >
      <div className="field-label">Who played</div>
      <div className="chips wrap">
        {members.map((id) => (
          <PillChip key={id} label={id === me.user_id ? `${memberName(id)} (you)` : memberName(id)} selected={seats.some((s) => s.userId === id)} onClick={() => toggleMember(id)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={guest}
          maxLength={40}
          onChange={(e) => setGuest(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addGuest() } }}
          placeholder="A guest's name"
          aria-label="A guest's name"
        />
        <button type="button" className="btn line" disabled={!guest.trim()} onClick={addGuest}>Add guest</button>
      </div>

      {seats.map((s) => (
        <div key={s.id} className="panel" style={{ marginTop: 10, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <b style={{ flex: 1, minWidth: 0 }}>{s.name}{s.userId === me.user_id ? ' (you)' : s.userId ? '' : ' · guest'}</b>
            <button type="button" className="btn line sm" aria-label={`Remove ${s.name}`} onClick={() => {
              if (s.userId) { toggleMember(s.userId); return }
              setSeats((list) => list.filter((x) => x.id !== s.id))
              if (winner === s.id) setWinner('')
              if (second === s.id) setSecond('')
              if (firstBlood === s.id) setFirstBlood('')
            }}><Icon name="close" aria-hidden /></button>
          </div>
          {s.userId === me.user_id ? (
            <select className="input" aria-label="Your deck" value={s.deckId ?? ''} onChange={(e) => pickDeck(s, e.target.value)}>
              <option value="">No deck</option>
              {myDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : (
            <input className="input" value={s.deck} maxLength={80} onChange={(e) => update(s.id, { deck: e.target.value })} placeholder="Deck (optional)" aria-label={`${s.name}'s deck`} />
          )}
          <input className="input" style={{ marginTop: 6 }} value={s.commander} maxLength={120} onChange={(e) => update(s.id, { commander: e.target.value })} placeholder="Commander (optional)" aria-label={`${s.name}'s commander`} />
        </div>
      ))}

      <label className="field-label" htmlFor="pod-winner" style={{ display: 'block', marginTop: 14 }}>Who won</label>
      <select id="pod-winner" className="input" value={winner} onChange={(e) => { setWinner(e.target.value); if (second === e.target.value) setSecond('') }}>
        <option value="" disabled>Pick the winner</option>
        {seats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value={DRAW}>Draw</option>
      </select>

      {/* Only asked for while the pod's running season gives points for them. */}
      {league && league.second > 0 && winner && winner !== DRAW && (
        <>
          <label className="field-label" htmlFor="pod-second" style={{ display: 'block', marginTop: 14 }}>Second place (optional)</label>
          <select id="pod-second" className="input" value={second} onChange={(e) => setSecond(e.target.value)}>
            <option value="">Not recorded</option>
            {seats.filter((s) => s.id !== winner).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}
      {league && league.firstBlood > 0 && (
        <>
          <label className="field-label" htmlFor="pod-first-blood" style={{ display: 'block', marginTop: 14 }}>First blood (optional)</label>
          <select id="pod-first-blood" className="input" value={firstBlood} onChange={(e) => setFirstBlood(e.target.value)}>
            <option value="">Not recorded</option>
            {seats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}

      <label className="field-label" htmlFor="pod-format" style={{ display: 'block', marginTop: 14 }}>Format</label>
      <select id="pod-format" className="input" value={format} onChange={(e) => setFormat(e.target.value as GameMode)}>
        {GAME_MODES.map((m) => <option key={m} value={m}>{GAME_MODE_LABELS[m]}</option>)}
      </select>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="pod-turns" style={{ display: 'block' }}>Turns (optional)</label>
          <input id="pod-turns" className="input" inputMode="numeric" value={turns} onChange={(e) => setTurns(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="pod-minutes" style={{ display: 'block' }}>Minutes (optional)</label>
          <input id="pod-minutes" className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 5))} />
        </div>
      </div>

      {mySeat?.deckId && (
        <div style={{ marginTop: 12 }}>
          <ShareSwitch label="Add to my deck's record too" detail={`${mySeat.deck} — so it counts in your own stats`} on={toDeck} onChange={setToDeck} />
        </div>
      )}
      {error && <div className="notice warn" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

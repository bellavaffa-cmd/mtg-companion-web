import { useEffect, useMemo, useState } from 'react'
import { autocomplete } from '../api/scryfall'
import { useSync } from '../sync/SyncContext'
import type { Deck, GameResult } from '../types/models'
import { gameStats, matchupRecord, type Matchup } from '../decks/gameStats'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { rise } from './kit'

// A deck's games on its Stats: the record and recent form, how long its games run, and how it does
// against each commander and each person it has faced — then the latest games. Mirrors the
// Android app's MatchRecordPanel.

const LATEST = 5
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function MatchRecordPanel({ deck }: { deck: Deck }) {
  const { addGameResult, removeGameResult } = useSync()
  const stats = useMemo(() => gameStats(deck.gameResults), [deck.gameResults])
  const [logging, setLogging] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const newest = useMemo(() => [...deck.gameResults].sort((a, b) => b.playedAt - a.playedAt), [deck.gameResults])
  const length = [stats.averageMinutes != null ? `${stats.averageMinutes} min` : null, stats.averageTurns != null ? `${stats.averageTurns} turns` : null].filter(Boolean)

  return (
    <div className="panel match-panel rise" style={rise(0)}>
      <div className="p-h">
        <h3>Match record</h3>
        <button type="button" className="link" onClick={() => setLogging(true)}>Log result</button>
      </div>
      {stats.games === 0 ? (
        <div className="dim">No games logged yet. Games you play with your phone as a remote at a life counter table are saved here by themselves.</div>
      ) : (
        <>
          <div className="match-head">
            <span className="match-score">{stats.wins}–{stats.losses}{stats.draws > 0 ? `–${stats.draws}` : ''}</span>
            <span className="match-rate">{stats.winRate}% win rate over {plural(stats.games, 'game')}</span>
          </div>
          <div className="match-form" aria-label="Recent results, newest first">
            {stats.recent.map((r, i) => <span key={i} className={`form-chip ${r.toLowerCase()}`} title={r}>{r[0]}</span>)}
            {stats.streak && <span className="dim">{stats.streak.count} {stats.streak.result === 'WIN' ? 'wins' : stats.streak.result === 'LOSS' ? 'losses' : 'draws'} in a row</span>}
          </div>
          {length.length > 0 && <div className="dim match-length">A game takes about {length.join(' · ')}</div>}
          {stats.commanders.length > 0 && <MatchupList title="Commanders faced" rows={stats.commanders} />}
          {stats.opponents.length > 0 && <MatchupList title="Against" rows={stats.opponents} />}
          <div className="match-sub">Latest games</div>
          <div className="match-games">
            {(showAll ? newest : newest.slice(0, LATEST)).map((g) => (
              <div key={g.id} className="match-game">
                <span className={`match-result ${g.result.toLowerCase()}`}>{g.result}</span>
                <span className="dim match-detail">
                  {[g.opponent ? `vs ${g.opponent}` : null, g.commanders?.length ? g.commanders.join(', ') : null, g.turns ? `${g.turns} turns` : null].filter(Boolean).join(' · ') || '—'}
                </span>
                <button type="button" className="match-remove" aria-label="Remove this result" onClick={() => removeGameResult(deck.id, g.id)}>
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
          {newest.length > LATEST && (
            <button type="button" className="link" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${newest.length}`}</button>
          )}
        </>
      )}
      {logging && (
        <LogResultDialog
          onLog={(g) => { addGameResult(deck.id, { id: crypto.randomUUID(), playedAt: Date.now(), ...g }); setLogging(false) }}
          onDismiss={() => setLogging(false)}
        />
      )}
    </div>
  )
}

function MatchupList({ title, rows }: { title: string; rows: Matchup[] }) {
  return (
    <>
      <div className="match-sub">{title}</div>
      {rows.map((m) => (
        <div key={m.name} className="matchup">
          <span className="grow matchup-name">{m.name}</span>
          <span className="dim">{plural(m.games, 'game')}</span>
          <b className={m.wins > m.losses ? 'up' : m.wins < m.losses ? 'down' : ''}>{matchupRecord(m)}</b>
        </div>
      ))}
    </>
  )
}

function LogResultDialog({ onLog, onDismiss }: { onLog: (g: Pick<GameResult, 'result' | 'opponent' | 'commanders'>) => void; onDismiss: () => void }) {
  const [result, setResult] = useState<GameResult['result']>('WIN')
  const [opponent, setOpponent] = useState('')
  const [commanders, setCommanders] = useState<string[]>([])
  // Commander names have commas in them ("Krenko, Mob Boss"), so they're picked one at a time.
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setSuggestions([]); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void autocomplete(q).then((names) => { if (!cancelled) setSuggestions(names.slice(0, 6)) })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])
  const withCommander = (list: string[], name: string) => {
    const n = name.trim()
    return n && !list.some((c) => c.toLowerCase() === n.toLowerCase()) ? [...list, n] : list
  }
  const add = (name: string) => {
    setCommanders((list) => withCommander(list, name))
    setQuery('')
    setSuggestions([])
  }
  // Whatever's still typed in counts too.
  const log = () => onLog({ result, opponent: opponent.trim() || null, commanders: withCommander(commanders, query) })
  return (
    <Dialog
      title="Log game result"
      onDismiss={onDismiss}
      actions={(
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" onClick={log}>Log</button>
        </>
      )}
    >
      <div className="seg-choice" role="radiogroup" aria-label="Result">
        {(['WIN', 'LOSS', 'DRAW'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={result === r} className={result === r ? 'on' : ''} onClick={() => setResult(r)}>
            {r === 'WIN' ? 'Win' : r === 'LOSS' ? 'Loss' : 'Draw'}
          </button>
        ))}
      </div>
      <label className="field-label" htmlFor="log-opponents" style={{ marginTop: 14 }}>Opponents (optional)</label>
      <input id="log-opponents" className="input" value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g. Bob, Carol" />
      <label className="field-label" htmlFor="log-commanders" style={{ marginTop: 10 }}>Their commanders (optional)</label>
      {commanders.length > 0 && (
        <div className="cmd-chips">
          {commanders.map((c) => (
            <span key={c} className="cmd-chip">
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => setCommanders((list) => list.filter((x) => x !== c))}><Icon name="close" /></button>
            </span>
          ))}
        </div>
      )}
      <input
        id="log-commanders"
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={commanders.length ? 'Add another' : 'e.g. Atraxa'}
        onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) { e.preventDefault(); add(suggestions[0] ?? query) } }}
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <div className="cmd-suggestions" role="listbox" aria-label="Commander names">
          {suggestions.map((name) => (
            <button key={name} type="button" role="option" aria-selected={false} onClick={() => add(name)}>{name}</button>
          ))}
        </div>
      )}
    </Dialog>
  )
}

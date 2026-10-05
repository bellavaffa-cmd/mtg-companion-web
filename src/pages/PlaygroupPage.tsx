import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { PillChip, rise, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { useOverview } from '../social/SocialContext'
import { PodView } from './PodGames'
import { matchupRecord, type Matchup } from '../decks/gameStats'
import { MIN_GAMES, playgroupStats, type DeckRecord } from '../decks/playgroupStats'
import { mulliganSummary } from '../decks/mulligans'

// The playgroup: every deck's games together — your record, who you play most and how you do
// against them, your nemesis, which decks win most, and your streaks. Above it, a switch to each
// pod's shared games (PodGames.tsx). Mirrors the Android app's PlaygroupScreen
// (ui/lifecounter/PlaygroupScreen.kt).

/** How many people and commanders show before "Show all". */
const SHOWN = 8
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const record = (r: { wins: number; losses: number; draws: number }) => `${r.wins}–${r.losses}${r.draws > 0 ? `–${r.draws}` : ''}`

/** The switcher's entry for pods while there are none to list (signed out, loading, no pods). */
const PODS = 'pods'

export function PlaygroupPage() {
  const back = useBack('/play')
  const navigate = useNavigate()
  const { account, accountsAvailable } = useSync()
  const { overview, error, loading, refresh } = useOverview()
  // "Just me", or a pod; kept in the address so Back lands on the same one.
  const [params, setParams] = useSearchParams()
  const chosen = params.get('pod')
  const me = account ? overview?.me ?? null : null
  const pods = me ? overview?.pods ?? [] : []
  const pod = pods.find((p) => p.id === chosen) ?? null
  const choose = (id: string | null) => setParams(id ? { pod: id } : {}, { replace: true })

  let podsState: ReactNode = null
  if (chosen && !pod) {
    podsState = !accountsAvailable ? (
      <div className="notice">Accounts aren't set up in this build.</div>
    ) : !account ? (
      <div className="empty-state rise" style={rise(0)}>
        <Icon name="groups" />
        <div>Sign in to see your pods' games.</div>
        <button type="button" className="btn gold" onClick={() => navigate('/account')}>Sign in</button>
      </div>
    ) : !overview ? (
      error ? (
        <div className="empty-state">
          <Icon name="cloud_off" />
          <div>{error}</div>
          <button type="button" className="btn line" disabled={loading} onClick={() => void refresh()}>Try again</button>
        </div>
      ) : (
        <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
      )
    ) : !me ? (
      <div className="empty-state rise" style={rise(0)}>
        <Icon name="groups" />
        <div>Make your profile on Friends first — then your pods' games show here.</div>
        <button type="button" className="btn gold" onClick={() => navigate('/friends?tab=profile')}>Make your profile</button>
      </div>
    ) : (
      <div className="empty-state rise" style={rise(0)}>
        <Icon name="groups" />
        <div>{chosen === PODS ? "You're not in a pod yet." : "You're not in that pod any more."} A pod is a group of friends — make one on Friends, and everyone in it can record games here.</div>
        <button type="button" className="btn line" onClick={() => navigate('/friends')}>Friends</button>
      </div>
    )
  }

  return (
    <>
      <TopBar title="Playgroup" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <div className="chips" aria-label="Whose games" style={{ paddingTop: 4 }}>
            <PillChip label="Just me" selected={!chosen} onClick={() => choose(null)} />
            {pods.map((p) => <PillChip key={p.id} label={p.name} selected={pod?.id === p.id} onClick={() => choose(p.id)} />)}
            {pods.length === 0 && accountsAvailable && <PillChip label="Pods" icon="groups" selected={!!chosen} onClick={() => choose(PODS)} />}
          </div>
          {pod && me ? <PodView key={pod.id} pod={pod} me={me} /> : podsState ?? <JustMe />}
        </div>
      </div>
    </>
  )
}

/** The round-A view: every one of the user's own decks' games together. */
function JustMe() {
  const navigate = useNavigate()
  const { decks } = useSync()
  const stats = useMemo(() => playgroupStats(decks), [decks])
  const length = [stats.averageMinutes != null ? `${stats.averageMinutes} min` : null, stats.averageTurns != null ? `${stats.averageTurns} turns` : null].filter(Boolean)
  // A deck opens on its Stats, where its match record is (desktop shows them beside the cards).
  const openDeck = (id: string) => navigate(`/decks/${id}`, { state: { tab: 'Stats' } })

  return (
    <>
      {stats.games === 0 ? (
        <EmptyState
          className="rise"
          style={rise(0)}
          icon="groups"
          text="No games yet. Play at the life counter, or log a result on a deck’s Stats, and every game shows here."
          actions={[{ label: 'Start a game', icon: 'favorite', to: '/life' }, { label: 'Your decks', icon: 'style', to: '/decks' }]}
        />
      ) : (
        <>
          <div className="panel match-panel rise" style={rise(0)}>
            <div className="match-head">
              <span className="match-score">{record(stats)}</span>
              <span className="match-rate">{stats.winRate}% win rate over {plural(stats.games, 'game')}</span>
            </div>
            <div className="dim match-length">
              {[
                stats.streak ? `${stats.streak.count} ${stats.streak.result === 'WIN' ? 'wins' : stats.streak.result === 'LOSS' ? 'losses' : 'draws'} in a row now` : null,
                stats.longestWinStreak > 1 ? `Longest win streak ${stats.longestWinStreak}` : null,
              ].filter(Boolean).join(' · ') || `Across ${plural(decks.filter((d) => d.gameResults?.length).length, 'deck')}`}
            </div>
            {length.length > 0 && <div className="dim match-length">A game takes about {length.join(' · ')}</div>}
            {mulliganSummary(stats.mulligans) && <div className="dim match-length">{mulliganSummary(stats.mulligans)}</div>}
          </div>

          {(stats.nemesis || stats.nemesisCommander) && (
            <div className="panel match-panel rise" style={rise(1)}>
              <div className="p-h"><h3>Nemesis</h3></div>
              {stats.nemesis && <MatchupRow label="Player" m={stats.nemesis} />}
              {stats.nemesisCommander && <MatchupRow label="Commander" m={stats.nemesisCommander} />}
              <div className="dim" style={{ marginTop: 6 }}>Who you do worst against, out of those you've played {MIN_GAMES} or more times.</div>
            </div>
          )}

          {stats.ranked.length + stats.unranked.length > 0 && (
            <div className="panel match-panel rise" style={rise(2)}>
              <div className="p-h"><h3>Decks</h3></div>
              {stats.ranked.map((r, i) => <DeckRow key={r.deckId} rank={i + 1} r={r} onOpen={() => openDeck(r.deckId)} />)}
              {stats.unranked.length > 0 && (
                <>
                  <div className="match-sub">Fewer than {MIN_GAMES} games</div>
                  {stats.unranked.map((r) => <DeckRow key={r.deckId} r={r} onOpen={() => openDeck(r.deckId)} />)}
                </>
              )}
            </div>
          )}

          {stats.opponents.length > 0 && <MatchupPanel title="Against" rows={stats.opponents} index={3} />}
          {stats.commanders.length > 0 && <MatchupPanel title="Commanders faced" rows={stats.commanders} index={4} />}
        </>
      )}
    </>
  )
}

function MatchupRow({ label, m }: { label: string; m: Matchup }) {
  return (
    <div className="matchup">
      <span className="dim" style={{ width: 78, flex: 'none' }}>{label}</span>
      <span className="grow matchup-name">{m.name}</span>
      <span className="dim">{plural(m.games, 'game')}</span>
      <b className="down">{matchupRecord(m)}</b>
    </div>
  )
}

function MatchupPanel({ title, rows, index }: { title: string; rows: Matchup[]; index: number }) {
  const [all, setAll] = useState(false)
  return (
    <div className="panel match-panel rise" style={rise(index)}>
      <div className="p-h"><h3>{title}</h3></div>
      {(all ? rows : rows.slice(0, SHOWN)).map((m) => (
        <div key={m.name} className="matchup">
          <span className="grow matchup-name">{m.name}</span>
          <span className="dim">{plural(m.games, 'game')}</span>
          <b className={m.wins > m.losses ? 'up' : m.wins < m.losses ? 'down' : ''}>{matchupRecord(m)}</b>
        </div>
      ))}
      {rows.length > SHOWN && (
        <button type="button" className="link" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
      )}
    </div>
  )
}

function DeckRow({ rank, r, onOpen }: { rank?: number; r: DeckRecord; onOpen: () => void }) {
  return (
    <button type="button" className="matchup press" style={{ width: '100%', border: 0, background: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }} onClick={onOpen}>
      {rank != null && <span className="dim" style={{ width: 18, flex: 'none' }}>{rank}</span>}
      <span className="grow matchup-name">{r.name}</span>
      <span className="dim">{rank != null ? `${r.winRate}% · ` : ''}{plural(r.games, 'game')}</span>
      <b className={r.wins > r.losses ? 'up' : r.wins < r.losses ? 'down' : ''}>{record(r)}</b>
    </button>
  )
}

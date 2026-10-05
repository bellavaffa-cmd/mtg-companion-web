import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { TopBar } from '../components/TopBar'
import { IconButton, SectionHeader, SegmentedTabs, rise, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { useOverview } from '../social/SocialContext'
import type { Deck } from '../types/models'
import {
  deckFitsFormat, movePlayer, newSeed, nextSuggestion, nightResultId, nightResultOf, pairingsOf, playerKey, podPower, podWinner, repeatsIn,
  suggestedDecks, tableSeedOf, unseated, withPods, withoutPlayer,
  type DeckChoice, type GameNight, type NightPlayer, type NightPod,
} from './gameNight'
import { estimateDeckBracket, knownBracket, newPlayerId, saveNight, startNewNight, updateNight, useGameNight } from './gameNightStore'
import { useTableGames } from './tableGames'
import './play.css'
import './gameNight.css'

/**
 * Game night: who's here and what they're playing, fair pods by power bracket (not last night's
 * pairings, where that can be helped), and each pod's game started on the life counter with its
 * players seated — the user's game saving to the deck they picked. Reached from the Play tab. The
 * Android app's GameNightScreen.kt.
 */
export function GameNightPage() {
  const back = useBack('/play')
  const navigate = useNavigate()
  const { night, previous } = useGameNight()
  const { decks, addGameResult, removeGameResult } = useSync()
  const { overview, person } = useOverview()
  const tableGames = useTableGames()
  const [guest, setGuest] = useState('')
  const [suggesting, setSuggesting] = useState(false)

  const me = night.players.find((p) => p.kind === 'ME')
  const friends = (overview?.friends ?? [])
    .filter((f) => f.status === 'accepted')
    .map((f) => person(f.user_id))
    .filter((p) => p !== null)
    .filter((p) => !night.players.some((x) => x.userId === p.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  const previousPairs = pairingsOf(previous)

  const add = (p: Omit<NightPlayer, 'id' | 'deck' | 'commander' | 'bracket'>) =>
    updateNight((n) => ({ ...n, players: [...n.players, { id: newPlayerId(), deck: null, commander: null, bracket: null, ...p }] }))
  const addGuest = () => {
    const name = guest.trim()
    if (!name) return
    add({ name, kind: 'GUEST' })
    setGuest('')
  }
  const setPlayer = (id: string, patch: Partial<NightPlayer>) =>
    updateNight((n) => ({ ...n, players: n.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))

  /** The user's deck, its commander and bracket (estimated once its cards are looked up). */
  const pickDeck = (player: NightPlayer, deck: Deck | null) => {
    if (!deck) { setPlayer(player.id, { deckId: null, deck: null, commander: null, bracket: null }); return }
    const commander = [deck.commander?.name, deck.partnerCommander?.name].filter(Boolean).join(' & ') || null
    setPlayer(player.id, { deckId: deck.id, deck: deck.name, commander, bracket: knownBracket(deck) })
    void estimateDeckBracket(deck).then((bracket) => {
      if (bracket != null) updateNight((n) => ({ ...n, players: n.players.map((p) => (p.id === player.id && p.deckId === deck.id ? { ...p, bracket } : p)) }))
    })
  }

  /** A deck close in power to everyone else's, played longest ago — another one each time it's asked. */
  const suggest = async (player: NightPlayer) => {
    setSuggesting(true)
    try {
      const fitting = decks.filter((d) => deckFitsFormat(d.gameMode, night.format))
      const choices: DeckChoice[] = []
      // Only the decks that could be picked are looked up (once each).
      for (const d of fitting.length > 0 ? fitting : decks) {
        const bracket = knownBracket(d) ?? (night.players.length > 1 ? await estimateDeckBracket(d) : null)
        choices.push({ id: d.id, name: d.name, gameMode: d.gameMode, bracket, lastPlayed: Math.max(0, ...d.gameResults.map((r) => r.playedAt)) })
      }
      const others = night.players.filter((p) => p.id !== player.id).map((p) => p.bracket)
      const next = nextSuggestion(suggestedDecks(choices, night.format, others), player.deckId)
      if (next) pickDeck(player, decks.find((d) => d.id === next.id) ?? null)
    } finally {
      setSuggesting(false)
    }
  }

  const makePods = () => saveNight(withPods(night, newSeed(), previous))
  const setFormat = (format: GameNight['format']) => saveNight({ ...night, format, pods: [] })
  const setPods = (pods: NightPod[]) => saveNight({ ...night, pods })

  const start = (pod: NightPod) => {
    setPods(night.pods.map((p) => (p.id === pod.id ? { ...p, startedAt: Date.now(), winnerId: null } : p)))
    navigate('/life', { state: { tableSeed: tableSeedOf(pod, night.players) } })
  }

  /** A winner tapped (again: taken back). The user's game goes onto their deck. */
  const tapWinner = (pod: NightPod, winnerId: string) => {
    const next = pod.winnerId === winnerId ? null : winnerId
    setPods(night.pods.map((p) => (p.id === pod.id ? { ...p, winnerId: next } : p)))
    const saved = nightResultOf(night.id, pod, night.players, next ?? '', Date.now())
    if (!saved) return
    removeGameResult(saved.deckId, nightResultId(night.id, pod.id))
    if (next) addGameResult(saved.deckId, saved.result)
  }

  const waiting = unseated(night)
  const podCount = night.pods.length

  return (
    <>
      <TopBar title="Game night" onBack={back} />
      <div className="content-scroll">
        <div className="play night">
          <p className="muted night-intro rise" style={rise(0)}>
            Who's here and what they're playing, split into fair pods by power bracket. Start a pod's game on the life counter; your result saves to your deck.
          </p>
          <SegmentedTabs labels={['Commander', '1v1']} selected={night.format === 'DUEL' ? 1 : 0} onSelect={(i) => setFormat(i === 1 ? 'DUEL' : 'COMMANDER')} />

          <SectionHeader title={`Who's here · ${night.players.length}`} action={night.pods.length > 0 ? 'New night' : undefined} onAction={startNewNight} />
          {night.players.map((p, i) => (
            <PlayerCard
              key={p.id}
              player={p}
              index={i}
              decks={decks}
              sharedDecks={p.userId ? (overview?.shared_with_me ?? []).filter((s) => s.kind === 'deck' && s.owner === p.userId) : []}
              suggesting={suggesting}
              onPickDeck={(d) => pickDeck(p, d)}
              onSuggest={() => void suggest(p)}
              onChange={(patch) => setPlayer(p.id, patch)}
              onRemove={() => saveNight(withoutPlayer(night, p.id))}
            />
          ))}
          <div className="night-add rise" style={rise(2)}>
            {!me && <button type="button" className="chip" onClick={() => add({ name: overview?.me?.display_name || 'Me', kind: 'ME' })}><Icon name="person" />Me</button>}
            {friends.map((f) => (
              <button key={f.user_id} type="button" className="chip" onClick={() => add({ name: f.display_name || f.username, kind: 'FRIEND', userId: f.user_id })}>
                <Icon name="person_add" />{f.display_name || f.username}
              </button>
            ))}
          </div>
          <form className="night-guest rise" style={rise(2)} onSubmit={(e) => { e.preventDefault(); addGuest() }}>
            <input className="input" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Add a guest by name" />
            <button type="submit" className="btn line" disabled={!guest.trim()}>Add</button>
          </form>

          <SectionHeader title="Pods" action={podCount > 0 ? 'Reshuffle' : undefined} onAction={makePods} />
          {podCount === 0 ? (
            <>
              <p className="muted play-empty">
                {night.format === 'DUEL' ? 'Pairs' : 'Pods of 3–4'}, players close in power together, and not the same tables as last night where that can be helped.
              </p>
              <button type="button" className="btn gold" disabled={night.players.length < 2} onClick={makePods}><Icon name="shuffle" />Make pods</button>
            </>
          ) : (
            night.pods.map((pod, i) => (
              <PodCard
                key={pod.id}
                pod={pod}
                index={i}
                night={night}
                repeats={repeatsIn(pod.playerIds.map((id) => night.players.find((p) => p.id === id)).filter((p) => !!p).map(playerKey), previousPairs)}
                result={podWinner(pod, night.players, tableGames)}
                onMove={(playerId, to) => setPods(movePlayer(night.pods, playerId, to, `${night.seed}-${Date.now()}`))}
                onStart={() => start(pod)}
                onWinner={(id) => tapWinner(pod, id)}
              />
            ))
          )}
          {podCount > 0 && waiting.length > 0 && (
            <div className="night-pod rise" style={rise(4)}>
              <b>Not in a pod yet</b>
              {waiting.map((p) => (
                <div key={p.id} className="night-seat">
                  <span className="night-seat-name">{p.name}</span>
                  <MoveTo podCount={podCount} current={-1} onMove={(to) => setPods(movePlayer(night.pods, p.id, to, `${night.seed}-${Date.now()}`))} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const KIND_LABEL: Record<NightPlayer['kind'], string> = { ME: 'You', FRIEND: 'Friend', GUEST: 'Guest' }

function PlayerCard({ player, index, decks, sharedDecks, suggesting, onPickDeck, onSuggest, onChange, onRemove }: {
  player: NightPlayer
  index: number
  decks: Deck[]
  sharedDecks: { item_id: string; name: string | null }[]
  suggesting: boolean
  onPickDeck: (deck: Deck | null) => void
  onSuggest: () => void
  onChange: (patch: Partial<NightPlayer>) => void
  onRemove: () => void
}) {
  const sorted = [...decks].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="night-player rise" style={rise(Math.min(1 + index, 8))}>
      <div className="night-player-head">
        <b>{player.name}</b>
        <span className="night-kind">{KIND_LABEL[player.kind]}</span>
        <IconButton icon="close" label={`Remove ${player.name}`} onClick={onRemove} />
      </div>
      {player.kind === 'ME' ? (
        <div className="night-deck">
          <select className="input" value={player.deckId ?? ''} onChange={(e) => onPickDeck(decks.find((d) => d.id === e.target.value) ?? null)}>
            <option value="">No deck</option>
            {sorted.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button type="button" className="btn line sm" disabled={suggesting || decks.length === 0} onClick={onSuggest}>
            <Icon name="auto_awesome" />{suggesting ? 'Looking…' : 'Suggest'}
          </button>
        </div>
      ) : (
        <>
          {sharedDecks.length > 0 && (
            <select
              className="input"
              value={player.sharedDeckId ?? ''}
              onChange={(e) => {
                const shared = sharedDecks.find((s) => s.item_id === e.target.value)
                onChange({ sharedDeckId: shared?.item_id ?? null, deck: shared?.name ?? null })
              }}
            >
              <option value="">Not one they share</option>
              {sharedDecks.map((s) => <option key={s.item_id} value={s.item_id}>{s.name ?? 'Untitled deck'}</option>)}
            </select>
          )}
          <div className="night-deck">
            {!player.sharedDeckId && <input className="input" value={player.deck ?? ''} onChange={(e) => onChange({ deck: e.target.value || null })} placeholder="Deck" />}
            <input className="input" value={player.commander ?? ''} onChange={(e) => onChange({ commander: e.target.value || null })} placeholder="Commander" />
          </div>
        </>
      )}
      {player.kind === 'ME' && player.commander && <span className="night-commander">{player.commander}</span>}
      <div className="night-bracket" role="group" aria-label="Power bracket">
        <span>Bracket</span>
        {[null, 1, 2, 3, 4, 5].map((b) => (
          <button key={b ?? 'unknown'} type="button" className="chip on-g2" aria-pressed={player.bracket === b} onClick={() => onChange({ bracket: b })} title={b === null ? 'Not known: counts as 3' : undefined}>
            {b ?? '?'}
          </button>
        ))}
      </div>
    </div>
  )
}

function PodCard({ pod, index, night, repeats, result, onMove, onStart, onWinner }: {
  pod: NightPod
  index: number
  night: GameNight
  repeats: number
  result: ReturnType<typeof podWinner>
  onMove: (playerId: string, to: number) => void
  onStart: () => void
  onWinner: (playerId: string) => void
}) {
  const seated = pod.playerIds.map((id) => night.players.find((p) => p.id === id)).filter((p): p is NightPlayer => !!p)
  const winner = result?.winnerId ? seated.find((p) => p.id === result.winnerId) : undefined
  const me = seated.find((p) => p.kind === 'ME')
  return (
    <div className="night-pod rise" style={rise(Math.min(3 + index, 10))}>
      <div className="night-pod-head">
        <b>Pod {index + 1}</b>
        <span className="muted">bracket {podPower(pod, night.players)}{repeats > 0 ? ` · ${repeats === 1 ? '1 pairing' : `${repeats} pairings`} from last time` : ''}</span>
      </div>
      {seated.map((p) => (
        <div key={p.id} className="night-seat">
          <span className="night-seat-name">
            <b>{p.name}</b>
            <span>{[p.commander ?? p.deck, p.bracket ? `bracket ${p.bracket}` : null].filter(Boolean).join(' · ') || 'No deck yet'}</span>
          </span>
          <MoveTo podCount={night.pods.length} current={index} onMove={(to) => onMove(p.id, to)} />
        </div>
      ))}
      {result?.fromTable ? (
        <div className="night-result"><Icon name="emoji_events" className={winner ? 'won' : ''} />{winner ? `${winner.name} won` : 'Nobody left standing'}</div>
      ) : (
        <div className="night-result">
          <span>{winner ? `${winner.name} won` : pod.startedAt ? 'Who won?' : 'Winner'}</span>
          {seated.map((p) => (
            <button key={p.id} type="button" className="chip on-g2" aria-pressed={pod.winnerId === p.id} onClick={() => onWinner(p.id)}>{p.name}</button>
          ))}
        </div>
      )}
      {me?.deckId && <span className="muted night-saves">Your game saves to {me.deck}</span>}
      <button type="button" className="btn gold" onClick={onStart}><Icon name="play_arrow" />{pod.startedAt ? 'Start again' : 'Start'}</button>
    </div>
  )
}

/** "Move to" another pod, or a new one. */
function MoveTo({ podCount, current, onMove }: { podCount: number; current: number; onMove: (to: number) => void }) {
  return (
    <select className="input night-move" value={current} aria-label="Move to pod" onChange={(e) => onMove(Number(e.target.value))}>
      {current < 0 && <option value={-1}>Seat in…</option>}
      {Array.from({ length: podCount }, (_, i) => <option key={i} value={i}>Pod {i + 1}</option>)}
      <option value={podCount}>New pod</option>
    </select>
  )
}

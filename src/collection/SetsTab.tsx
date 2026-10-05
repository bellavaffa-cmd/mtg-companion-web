// The Collection's Sets page: every set the user owns a card from, how much of it they have (owned
// printings / the set's size, from Scryfall), sorted by how complete, by name or newest first. A set
// opens its cards, owned and missing. Mirrors the Android app's ui/collection/SetsTab.kt.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { getSets } from '../api/scryfall'
import { PillChip, SearchPill, rise } from '../components/kit'
import { EmptyState } from '../components/EmptyState'
import { allCardsOf } from './allCards'
import { useCardData } from './cardData'
import {
  SET_SORT_LABELS, SET_SORTS, setComplete, setFraction, setPercent, setProgress, sortedSets, type SetInfo, type SetProgress, type SetSort,
} from './setCompletion'

export function SetsTab() {
  const { collections, decks } = useSync()
  const navigate = useNavigate()
  const cards = useMemo(() => allCardsOf(collections, decks).filter((c) => c.total - c.proxies > 0), [collections, decks])
  const cardsById = useCardData(cards.map((c) => c.scryfallId))
  const [sets, setSets] = useState<Map<string, SetInfo> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [sort, setSort] = useState<SetSort>('PERCENT')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    getSets()
      .then((s) => { if (!cancelled) { if (s.size === 0) setFailed(true); else setSets(s) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [attempt])

  // Printings whose set hasn't been looked up yet wait; a set Scryfall's list lacks shows with its size unknown.
  const list = useMemo(() => {
    if (!sets || !cardsById) return null
    const owned = new Map<string, string>()
    for (const c of cards) {
      const set = cardsById.get(c.scryfallId)?.set
      if (set) owned.set(c.scryfallId, set)
    }
    return setProgress(owned, sets)
  }, [sets, cardsById, cards])

  const message = (text: string) => <div className="empty-state rise" style={rise(1)}>{text}</div>
  if (cards.length === 0) {
    return (
      <EmptyState
        className="rise"
        style={rise(1)}
        icon="layers"
        text="No cards yet. Once you have some, each set shows how much of it you own."
        actions={[{ label: 'Bring in your cards', icon: 'playlist_add', to: '/welcome?step=collection' }, { label: 'Scan cards', icon: 'photo_camera', to: '/scan' }]}
      />
    )
  }
  if (failed && !list) {
    return (
      <div className="empty-state rise" style={rise(1)}>
        <div>Couldn't fetch the sets from Scryfall. Check the connection and try again.</div>
        <button type="button" className="btn line" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
      </div>
    )
  }
  if (!list) return message(sets ? 'Looking up which sets your cards are from…' : 'Looking up sets…')
  if (list.length === 0) return message('Looking up which sets your cards are from…')

  const q = query.trim().toLowerCase()
  const shown = sortedSets(q ? list.filter((p) => p.set.name.toLowerCase().includes(q) || p.set.code === q) : list, sort)
  const complete = list.filter(setComplete).length

  return (
    <div className="sets-tab">
      <div className="rise" style={{ ...rise(1), maxWidth: 560 }}>
        <SearchPill value={query} onChange={setQuery} placeholder="Set name or code" />
      </div>
      <div className="chips rise" style={{ ...rise(2), marginTop: 10 }}>
        {SET_SORTS.map((s) => <PillChip key={s} label={SET_SORT_LABELS[s]} selected={s === sort} onClick={() => setSort(s)} />)}
      </div>
      <div className="dim search-note">
        {list.length} {list.length === 1 ? 'set' : 'sets'}{complete > 0 ? ` · ${complete} complete` : ''}
      </div>
      <div className="set-list">
        {shown.map((p, i) => <SetRow key={p.set.code} progress={p} index={i} onOpen={() => navigate(`/collections/set/${p.set.code}`)} />)}
      </div>
    </div>
  )
}

function SetRow({ progress: p, index, onOpen }: { progress: SetProgress; index: number; onOpen: () => void }) {
  const done = setComplete(p)
  const total = p.set.cardCount
  return (
    <button type="button" className={`set-row press rise${done ? ' complete' : ''}`} style={rise(Math.min(index, 8) + 3)} onClick={onOpen}>
      <span className="set-icon" aria-hidden>
        {p.set.iconSvgUri
          ? <span className="set-symbol" style={{ maskImage: `url("${p.set.iconSvgUri}")`, WebkitMaskImage: `url("${p.set.iconSvgUri}")` }} />
          : <span className="set-code">{p.set.code.toUpperCase()}</span>}
      </span>
      <span className="set-main">
        <span className="set-top">
          <span className="set-name">{p.set.name}</span>
          <b className="set-percent">{total > 0 ? `${setPercent(p)}%` : '—'}</b>
        </span>
        <span className="set-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={setPercent(p)} aria-label={`${p.set.name}: ${setPercent(p)}%`}>
          <span style={{ width: `${setFraction(p) * 100}%` }} />
        </span>
        <span className="set-meta dim">
          {[total > 0 ? `${p.owned} / ${total} cards` : `${p.owned} cards · size unknown`, p.set.code.toUpperCase(), p.set.releasedAt?.slice(0, 4)].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  )
}

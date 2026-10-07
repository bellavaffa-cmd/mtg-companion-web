// The Friends page's Activity tab: what friends have shared, built, put up for trade or for sale,
// league news from the user's pods, and comments on their decks. The Android app's twin is
// ActivityList in ui/social/SocialMoreUi.kt (with ui/social/ActivityFeed.kt).

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { Dialog } from '../components/Dialog'
import { ArtImage, toArtCrop } from '../components/kit'
import { seasonTable } from '../decks/league'
import * as api from './api'
import * as more from './more'
import * as activity from './activity'
import { askCards, commentsPath, feedDeck, feedLine, sellingAsk, type FeedItem, type LeagueSnapshot, type SellingCard } from './activityLogic'
import { timeAgo } from './moreLogic'
import { Avatar } from './ui'
import './more.css'

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

export function ActivityList() {
  const available = more.useSocialMore()
  const richer = activity.useActivityComments()
  const navigate = useNavigate()
  const [items, setItems] = useState<FeedItem[] | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  // Running seasons' tables, by season id (null: couldn't be worked out).
  const [tables, setTables] = useState<Record<string, LeagueSnapshot | null>>({})
  const [selling, setSelling] = useState<FeedItem | null>(null)
  const PAGE = 30

  const load = async (before: number | null) => {
    setBusy(true)
    try {
      const page = await activity.feed(before, PAGE)
      setItems((list) => (before === null ? page : [...(list ?? []), ...page]))
      setHasMore(page.length >= PAGE)
      setError(null)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { if (available && richer !== null) void load(null) }, [available, richer]) // eslint-disable-line react-hooks/exhaustive-deps

  // League news names the leader: the table comes from the pod's games, as on the league screen.
  useEffect(() => {
    const running = (items ?? []).filter((i) => i.kind === 'league' && !i.ended && i.season_id && i.pod_id && !(i.season_id in tables))
    const pods = [...new Set(running.map((i) => i.pod_id!))]
    if (pods.length === 0) return
    let cancelled = false
    for (const pod of pods) {
      Promise.all([api.podSeasons(pod), api.podGames(pod)])
        .then(([seasons, games]) => {
          if (cancelled) return
          const found: Record<string, LeagueSnapshot | null> = {}
          for (const i of running.filter((r) => r.pod_id === pod)) {
            const season = seasons.find((s) => s.id === i.season_id)
            if (!season) { found[i.season_id!] = null; continue }
            const t = seasonTable(season, games)
            found[i.season_id!] = { standings: t.standings, nights: t.nights.length }
          }
          setTables((m) => ({ ...m, ...found }))
        })
        .catch(() => {
          if (!cancelled) setTables((m) => ({ ...m, ...Object.fromEntries(running.filter((r) => r.pod_id === pod).map((r) => [r.season_id!, null])) }))
        })
    }
    return () => { cancelled = true }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  if (available === false) return <div className="empty-state"><Icon name="dynamic_feed" />Not available yet.</div>
  if (error && !items) return <div className="empty-state"><Icon name="cloud_off" />{error}<button type="button" className="btn line" onClick={() => void load(null)}>Try again</button></div>
  if (!items) return <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>

  const ask = async (item: FeedItem) => {
    const owner = item.actor?.user_id
    if (!owner) return
    const list = await more.forTradeList(owner).catch(() => null)
    navigate(`/trades/new?to=${owner}`, { state: { want: askCards(list ?? [], item.wanted ?? []) } })
  }
  const act = (item: FeedItem, kind: 'comments' | 'ask' | 'selling') => {
    const deck = feedDeck(item)
    if (kind === 'comments' && deck) navigate(commentsPath(deck.owner, deck.deckId))
    else if (kind === 'ask') void ask(item)
    else if (kind === 'selling') setSelling(item)
  }
  const open = (item: FeedItem) => {
    const owner = item.actor?.user_id
    const deck = feedDeck(item)
    if (item.kind === 'comment' && deck) navigate(commentsPath(deck.owner, deck.deckId))
    else if (item.kind === 'selling') setSelling(item)
    else if (item.kind === 'league' || item.kind === 'pod_game') navigate('/play/playgroup')
    else if ((item.kind === 'shared' || item.kind === 'deck_updated') && owner && item.item_id && item.item_kind) navigate(`/shared/${owner}/${item.item_kind}/${encodeURIComponent(item.item_id)}`)
    else if (item.kind === 'shared' && owner) navigate(`/shared/${owner}`)
    else if (owner) navigate(`/friends/${owner}`)
  }

  return (
    <>
      {items.length === 0 ? (
        <EmptyState icon="dynamic_feed" text="Nothing from friends yet. When they share a deck, record a game or put cards up for trade, it shows here." actions={[{ label: 'Your friends', icon: 'group', to: '/friends' }]} />
      ) : (
        <div className="list">
          {items.map((item, i) => {
            const line = feedLine(item, item.season_id ? tables[item.season_id] ?? null : null)
            const when = timeAgo(item.at, now)
            return (
              <div key={`${item.kind}:${item.actor?.user_id ?? item.pod_id}:${item.at}:${i}`} className="activity-card">
                {item.actor
                  ? <Avatar profile={{ display_name: item.actor.display_name, avatar_path: item.actor.avatar_path ?? null }} size={36} />
                  : <span className="activity-trophy" aria-hidden><Icon name="emoji_events" /></span>}
                <div className="activity-body">
                  <button type="button" className="activity-text press" onClick={() => open(item)}>
                    {line.parts.map((p, j) => (p.bold ? <b key={j}>{p.text}</b> : <span key={j}>{p.text}</span>))}
                  </button>
                  <span className="dim activity-sub">{line.sub ? `${line.sub} · ${when}` : when}</span>
                  {line.action && (
                    <button type="button" className="activity-action" onClick={() => act(item, line.action!.kind)}>{line.action.label}</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {hasMore && items.length > 0 && (
        <button type="button" className="btn line block" style={{ marginTop: 12 }} disabled={busy} onClick={() => void load(items[items.length - 1]?.at ?? null)}>
          {busy ? 'Loading…' : 'Show older'}
        </button>
      )}
      {richer && (
        <p className="dim activity-note">
          Only friends see your activity. Choose what's shared in <Link to="/settings/privacy">Settings › Privacy</Link>.
        </p>
      )}
      {selling?.actor && <SellingDialog owner={selling.actor} onClose={() => setSelling(null)} />}
    </>
  )
}

/** "See them": a friend's To sell list, the cards on the user's wishlists first. */
function SellingDialog({ owner, onClose }: { owner: { user_id: string; display_name: string }; onClose: () => void }) {
  const navigate = useNavigate()
  const [list, setList] = useState<SellingCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    activity.sellingList(owner.user_id)
      .then((l) => { if (!cancelled) { if (l) setList(l); else setError("They're not showing their To sell list any more.") } })
      .catch((e: unknown) => { if (!cancelled) setError(message(e)) })
    return () => { cancelled = true }
  }, [owner.user_id])
  const wanted = list ? sellingAsk(list) : []
  return (
    <Dialog
      title={`${owner.display_name} is selling`}
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="btn line" onClick={onClose}>Close</button>
          {list && (
            <button type="button" className="btn gold" onClick={() => navigate(`/trades/new?to=${owner.user_id}`, { state: { want: wanted } })}>
              {wanted.length > 0 ? `Ask ${owner.display_name} for them` : 'Propose a trade'}
            </button>
          )}
        </>
      }
    >
      {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : !list ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : (
        <div className="list selling-list">
          {list.map((c) => (
            <div key={`${c.item_id}:${c.scryfall_id}`} className="selling-row">
              <ArtImage className="thumb" src={toArtCrop(c.image_url ?? null)} seed={c.name} />
              <span className="person-main">
                <span>{c.name}</span>
                <span className="dim">{c.for_sale} to sell{c.item_name ? ` · ${c.item_name}` : ''}</span>
              </span>
              {c.wanted && <span className="badge gold">On your wishlist</span>}
            </div>
          ))}
          {list.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing on it right now.</p>}
        </div>
      )}
    </Dialog>
  )
}

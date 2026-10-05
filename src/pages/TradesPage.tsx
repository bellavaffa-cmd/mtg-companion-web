import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PillChip, rise, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import * as api from '../social/api'
import { TradeCardList } from '../social/CardPicker'
import { TradeValue } from '../social/TradeValue'
import { useOverview } from '../social/SocialContext'
import { appliedByMe, awaitingMyUpdate, cardTotal, shouldMoveCards, tradeChanges, tradeSides, type CollectionChange } from '../social/tradeLogic'
import { Avatar } from '../social/ui'
import { SocialGate } from './FriendsPage'
import * as more from '../social/more'
import { BlockReportButton, RateTrade } from '../social/MoreUi'

type Filter = 'waiting' | 'sent' | 'done'

/** Trades with friends: the ones waiting on the user, the ones they sent, and finished ones. */
export function TradesPage() {
  const back = useBack('/friends')
  return (
    <>
      <TopBar title="Trades" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{(overview) => <TradeList overview={overview} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

/** The trades themselves, filtered — on this page and on Friends' Trades tab. */
export function TradeList({ overview }: { overview: api.Overview }) {
  const navigate = useNavigate()
  const me = overview.me!.user_id
  const available = more.useSocialMore()
  // People the user blocked are left out, and the user's thumbs up/down on finished trades shown.
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [ratings, setRatings] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!available) return
    let cancelled = false
    more.blockedUsers().then((l) => { if (!cancelled) setBlocked(new Set(l.map((p) => p.user_id))) }).catch(() => {})
    more.myTradeRatings().then((r) => { if (!cancelled) setRatings(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [available, overview])
  const trades = overview.trades.filter((t) => !blocked.has(t.from_user === me ? t.to_user : t.from_user))
  const waiting = trades.filter((t) => (t.status === 'open' && t.to_user === me) || awaitingMyUpdate(t, me))
  const sent = trades.filter((t) => t.status === 'open' && t.from_user === me)
  const done = trades.filter((t) => !waiting.includes(t) && !sent.includes(t))
  const [filter, setFilter] = useState<Filter>(waiting.length > 0 || sent.length === 0 ? 'waiting' : 'sent')
  const shown = filter === 'waiting' ? waiting : filter === 'sent' ? sent : done
  const friends = overview.friends.filter((f) => f.status === 'accepted')

  return (
    <>
      <div className="chips rise" style={rise(0)}>
        <PillChip label="Waiting on you" count={waiting.length} selected={filter === 'waiting'} onClick={() => setFilter('waiting')} />
        <PillChip label="Sent" count={sent.length} selected={filter === 'sent'} onClick={() => setFilter('sent')} />
        <PillChip label="Done" count={done.length} selected={filter === 'done'} onClick={() => setFilter('done')} />
      </div>
      {shown.length === 0 ? (
        <div className="empty-state">
          <Icon name="swap_horiz" />
          <div>
            {filter === 'waiting' ? 'Nothing needs your answer.' : filter === 'sent' ? 'No trade requests waiting for an answer.' : 'No finished trades yet.'}
            {friends.length > 0 && filter !== 'done' && ' To start one, open a friend’s shared binder.'}
          </div>
          {friends.length === 0 && <button type="button" className="btn line" onClick={() => navigate('/friends')}>Add friends</button>}
        </div>
      ) : (
        <div className="list" style={{ marginTop: 12 }}>
          {shown.map((t) => (
            <TradeCardView
              key={t.id}
              trade={t}
              overview={overview}
              more={!!available}
              rating={ratings[t.id]}
              onRated={(positive) => setRatings((r) => ({ ...r, [t.id]: positive }))}
            />
          ))}
        </div>
      )}
    </>
  )
}

const STATUS: Record<api.TradeStatus, string> = {
  open: 'Waiting for an answer',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  countered: 'Countered',
}

function TradeCardView({ trade, overview, more: withMore, rating, onRated }: {
  trade: api.Trade
  overview: api.Overview
  /** The server has messages, ratings and blocking (social_more). */
  more: boolean
  rating: boolean | undefined
  onRated: (positive: boolean) => void
}) {
  const navigate = useNavigate()
  const { refresh } = useOverview()
  const me = overview.me!.user_id
  const { give, get, other } = tradeSides(trade, me)
  const them = overview.people[other] ?? null
  const theirName = them?.display_name ?? 'Someone'
  const incoming = trade.to_user === me
  const [answering, setAnswering] = useState<'accept' | 'decline' | null>(null)
  const [updating, setUpdating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const status = trade.status === 'open'
    ? incoming ? `${theirName} asks you` : `Waiting for ${theirName}`
    : trade.status === 'accepted'
      ? awaitingMyUpdate(trade, me) ? 'Accepted — update your binders' : (trade.from_user === me ? trade.to_applied : trade.from_applied) ? 'Done' : `Accepted — ${theirName} is updating their binders`
      : STATUS[trade.status]

  return (
    <div className="trade panel">
      <div className="trade-head">
        <Avatar profile={them} size={38} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="person-name">{theirName}</div>
          <div className={`trade-status ${trade.status}`}>{status}</div>
        </div>
        <span className="dim" style={{ fontSize: 12 }}>{new Date(trade.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        {withMore && overview.friends.some((f) => f.user_id === other && f.status === 'accepted') && (
          <button type="button" className="ib" aria-label={`Message ${theirName}`} title="Message" onClick={() => navigate(`/messages/${other}`)}><Icon name="chat" /></button>
        )}
        <BlockReportButton compact userId={other} name={theirName} item={{ kind: 'trade', id: trade.id }} />
      </div>

      <div className="trade-sides">
        <div>
          <div className="trade-side-title">You give{give.length ? ` · ${cardTotal(give)}` : ''}</div>
          <TradeCardList cards={give} empty="Nothing" />
        </div>
        <div>
          <div className="trade-side-title">You get{get.length ? ` · ${cardTotal(get)}` : ''}</div>
          <TradeCardList cards={get} empty="Nothing" />
        </div>
      </div>
      {trade.status === 'open' && <TradeValue get={get} give={give} />}

      {trade.message && <div className="trade-message"><b>{trade.from_user === me ? 'You' : theirName}:</b> {trade.message}</div>}
      {trade.reply && <div className="trade-message"><b>{trade.to_user === me ? 'You' : theirName}:</b> {trade.reply}</div>}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}

      {trade.status === 'open' && incoming && (
        <div className="trade-actions">
          <button type="button" className="btn line sm" disabled={busy} onClick={() => setAnswering('decline')}>Decline</button>
          <button type="button" className="btn line sm" disabled={busy} onClick={() => navigate(`/trades/new?to=${other}&reply=${trade.id}`)}>Counter</button>
          <button type="button" className="btn gold sm" disabled={busy} onClick={() => setAnswering('accept')}>Accept</button>
        </div>
      )}
      {trade.status === 'open' && !incoming && (
        <div className="trade-actions">
          <button type="button" className="btn line sm" disabled={busy} onClick={() => void run(() => api.respondTrade(trade.id, 'cancel'))}>Cancel request</button>
        </div>
      )}
      {withMore && <RateTrade trade={trade} me={me} rating={rating} name={theirName} onRated={onRated} />}
      {awaitingMyUpdate(trade, me) && (
        <div className="trade-actions">
          <button type="button" className="btn gold sm" disabled={busy} onClick={() => setUpdating(true)}><Icon name="inventory_2" aria-hidden />Update my binders</button>
        </div>
      )}

      {answering && (
        <AnswerDialog
          accept={answering === 'accept'}
          name={theirName}
          onCancel={() => setAnswering(null)}
          onSend={(reply) => { setAnswering(null); void run(() => api.respondTrade(trade.id, answering, reply)) }}
        />
      )}
      {updating && <UpdateBindersDialog trade={trade} me={me} theirName={theirName} onClose={() => setUpdating(false)} />}
    </div>
  )
}

function AnswerDialog({ accept, name, onCancel, onSend }: { accept: boolean; name: string; onCancel: () => void; onSend: (reply: string) => void }) {
  const [reply, setReply] = useState('')
  return (
    <Dialog
      title={accept ? `Accept ${name}'s trade?` : `Decline ${name}'s trade?`}
      onDismiss={onCancel}
      actions={
        <>
          <button type="button" className="btn line" onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn ${accept ? 'gold' : 'danger'}`} onClick={() => onSend(reply.trim())}>{accept ? 'Accept' : 'Decline'}</button>
        </>
      }
    >
      {accept && <p className="muted" style={{ marginTop: 0 }}>Once you've swapped the cards, each of you taps Update my binders.</p>}
      <label className="field-label" htmlFor="trade-reply">Message (optional)</label>
      <textarea id="trade-reply" className="input" rows={2} maxLength={500} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={accept ? 'e.g. See you Friday' : 'e.g. Not trading that one, sorry'} />
    </Dialog>
  )
}

/**
 * Applies the user's side of an accepted trade to their own binders: the cards they give come out
 * of the binders they were in, the cards they get go into the binder they pick.
 */
function UpdateBindersDialog({ trade, me, theirName, onClose }: { trade: api.Trade; me: string; theirName: string; onClose: () => void }) {
  const { collections, changeCollections } = useSync()
  const { refresh } = useOverview()
  const owned = collections.filter((c) => c.type !== 'WISHLIST')
  const { give, get } = tradeSides(trade, me)
  const givenFrom = give.map((c) => c.collectionId).find((id) => owned.some((b) => b.id === id))
  const [into, setInto] = useState(givenFrom ?? owned[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [short, setShort] = useState<CollectionChange[] | null>(null)
  const [alreadyDone, setAlreadyDone] = useState(false)

  const apply = async () => {
    // This trade already shows our side done (another tab or device): moving the cards again would
    // apply it twice.
    if (appliedByMe(trade, me)) {
      setAlreadyDone(true)
      void refresh().catch(() => {})
      return
    }
    setBusy(true)
    setError(null)
    let missing: CollectionChange[]
    try {
      // Marked first: if that fails (offline), nothing has changed and the user can simply try again.
      const marked = await api.markTradeApplied(trade.id)
      if (!shouldMoveCards(marked)) {
        setAlreadyDone(true)
        await refresh().catch(() => {})
        return
      }
      missing = changeCollections(tradeChanges(trade, me, into, givenFrom ?? null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      return
    } finally {
      setBusy(false)
    }
    // The cards have moved, so the job is done even if the refresh fails — offering to try again
    // here would move them a second time. The trade list catches up on its next refresh.
    await refresh().catch(() => {})
    if (missing.length > 0) setShort(missing)
    else onClose()
  }

  if (alreadyDone) {
    return (
      <Dialog title="Already updated" onDismiss={onClose} actions={<button type="button" className="btn gold" onClick={onClose}>OK</button>}>
        <p className="muted" style={{ marginTop: 0 }}>Your binders were already updated for this trade.</p>
      </Dialog>
    )
  }

  if (short) {
    return (
      <Dialog title="Binders updated" onDismiss={onClose} actions={<button type="button" className="btn gold" onClick={onClose}>OK</button>}>
        <p className="muted" style={{ marginTop: 0 }}>Some cards you gave weren't in your binder any more (or not as many), so they were left as they were:</p>
        <ul className="short-list">{short.map((c) => <li key={`${c.collectionId}:${c.card.scryfallId}`}>{c.card.name}</li>)}</ul>
      </Dialog>
    )
  }

  return (
    <Dialog
      title="Update my binders"
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="btn line" onClick={onClose}>Cancel</button>
          <button type="button" className="btn gold" disabled={busy || (get.length > 0 && !into)} onClick={() => void apply()}>Update binders</button>
        </>
      }
    >
      {give.length > 0 && <p className="muted" style={{ marginTop: 0 }}>{cardTotal(give)} {cardTotal(give) === 1 ? 'card goes' : 'cards go'} to {theirName} and come out of your binders.</p>}
      {get.length > 0 && (
        owned.length === 0 ? (
          <div className="notice warn">Make a binder first for the cards you get.</div>
        ) : (
          <>
            <label className="field-label" htmlFor="trade-into">Put the {cardTotal(get)} {cardTotal(get) === 1 ? 'card' : 'cards'} you get into</label>
            <select id="trade-into" className="input" value={into} onChange={(e) => setInto(e.target.value)}>
              {owned.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>
        )
      )}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

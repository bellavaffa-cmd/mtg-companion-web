import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { SectionHeader, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import type { CollectionEntry } from '../types/models'
import * as api from '../social/api'
import { BinderPicker, PickerSheet, TradeCardList, tradeKey } from '../social/CardPicker'
import { useOverview } from '../social/SocialContext'
import { cardTotal } from '../social/tradeLogic'
import { Avatar, handle } from '../social/ui'
import { SocialGate } from './FriendsPage'
import { TradeValue } from '../social/TradeValue'

interface TheirBinder { id: string; name: string; entries: CollectionEntry[] }

/**
 * Proposes a trade to a friend: cards from their shared binders, and optionally cards from the
 * user's own binders in return. With ?reply=<trade>, it counters a trade they sent: it starts from
 * that trade turned around, and sending it closes theirs.
 */
export function TradeComposerPage() {
  const back = useBack('/trades')
  return (
    <>
      <TopBar title="Propose a trade" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{(overview) => <Composer overview={overview} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

function Composer({ overview }: { overview: api.Overview }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { collections } = useSync()
  const { refresh } = useOverview()
  const to = params.get('to') ?? ''
  const replyTo = overview.trades.find((t) => t.id === params.get('reply') && t.status === 'open' && t.to_user === overview.me?.user_id) ?? null
  const friend = overview.people[to] ?? null
  const isFriend = overview.friends.some((f) => f.user_id === to && f.status === 'accepted')

  // A counter starts from their trade turned around: what they offered is what the user asks for.
  const [want, setWant] = useState<api.TradeCard[]>(() => replyTo?.give ?? (location.state as { want?: api.TradeCard[] } | null)?.want ?? [])
  const [give, setGive] = useState<api.TradeCard[]>(() => replyTo?.want ?? (location.state as { give?: api.TradeCard[] } | null)?.give ?? [])
  const [message, setMessage] = useState('')
  const [picking, setPicking] = useState<'theirs' | 'mine' | null>(null)
  const [theirBinders, setTheirBinders] = useState<TheirBinder[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sharedBinders = overview.shared_with_me.filter((s) => s.owner === to && s.kind === 'collection')
  const sharedIds = sharedBinders.map((s) => s.item_id).join(',')
  // Their binders are loaded the first time the user opens the picker.
  useEffect(() => {
    if (picking !== 'theirs' || theirBinders) return
    let cancelled = false
    const ids = sharedIds ? sharedIds.split(',') : []
    Promise.all(ids.map((id) => api.getSharedItem(to, 'collection', id).catch(() => null)))
      .then((items) => {
        if (cancelled) return
        setTheirBinders(items.flatMap((item, i) => {
          const entries = item?.data.entries
          return item && Array.isArray(entries) ? [{ id: ids[i], name: String(item.data.name ?? 'Binder'), entries: entries as CollectionEntry[] }] : []
        }))
      })
    return () => { cancelled = true }
  }, [picking, theirBinders, sharedIds, to])

  if (!friend || !isFriend) return <div className="empty-state"><Icon name="person_off" />You can only trade with friends.</div>

  const myBinders = collections.filter((c) => c.type !== 'WISHLIST')
  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.proposeTrade(to, want, give, message.trim(), replyTo?.id ?? null)
      await refresh()
      navigate('/trades', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  const remove = (list: api.TradeCard[], c: api.TradeCard) => list.filter((x) => tradeKey(x) !== tradeKey(c))

  return (
    <>
      <div className="person-row" style={{ marginTop: 4 }}>
        <Avatar profile={friend} size={44} />
        <span className="person-main">
          <span className="person-name">{replyTo ? `Counter ${friend.display_name}'s offer` : `Trade with ${friend.display_name}`}</span>
          <span className="dim">{handle(friend)}</span>
        </span>
      </div>

      <SectionHeader title={`You ask for${want.length ? ` · ${cardTotal(want)}` : ''}`} action="Pick cards" onAction={() => setPicking('theirs')} />
      <TradeCardList cards={want} empty={`Nothing yet — pick from ${friend.display_name}'s shared binders.`} onRemove={(c) => setWant((l) => remove(l, c))} />

      <SectionHeader title={`You offer${give.length ? ` · ${cardTotal(give)}` : ''}`} action="Pick cards" onAction={() => setPicking('mine')} />
      <TradeCardList cards={give} empty="Nothing — or pick cards from your binders to offer." onRemove={(c) => setGive((l) => remove(l, c))} />

      <TradeValue get={want} give={give} />

      <label className="field-label" htmlFor="trade-message" style={{ marginTop: 18 }}>Message (optional)</label>
      <textarea id="trade-message" className="input" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Can bring them on Friday" />

      {error && <div className="notice warn" style={{ marginTop: 12 }}>{error}</div>}
      <button type="button" className="btn gold block" style={{ marginTop: 16 }} disabled={busy || want.length + give.length === 0} onClick={() => void send()}>
        <Icon name="send" aria-hidden />{busy ? 'Sending…' : replyTo ? 'Send counter-offer' : 'Send trade request'}
      </button>
      <p className="dim" style={{ fontSize: 12.5, textAlign: 'center' }}>Nothing moves until you both agree — then each of you updates your own binders.</p>

      {picking === 'theirs' && (
        <PickerSheet title={`${friend.display_name}'s binders`} subtitle="Pick what you'd like" onClose={() => setPicking(null)}>
          {sharedBinders.length === 0 ? (
            <div className="notice">{friend.display_name} hasn't shared a binder with you.</div>
          ) : !theirBinders ? (
            <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
          ) : theirBinders.map((b) => (
            <div key={b.id} className="picker-group">
              <div className="picker-group-title">{b.name}</div>
              <BinderPicker collectionId={b.id} entries={b.entries} picked={want} onChange={setWant} emptyText="This binder is empty." />
            </div>
          ))}
        </PickerSheet>
      )}
      {picking === 'mine' && (
        <PickerSheet title="Your binders" subtitle="Pick what to offer" onClose={() => setPicking(null)}>
          {myBinders.length === 0 ? (
            <div className="notice">You have no binders yet.</div>
          ) : myBinders.map((b) => (
            <div key={b.id} className="picker-group">
              <div className="picker-group-title">{b.name}</div>
              <BinderPicker collectionId={b.id} entries={b.entries} picked={give} onChange={setGive} emptyText="This binder is empty." />
            </div>
          ))}
        </PickerSheet>
      )}
    </>
  )
}

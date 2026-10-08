import { countAction } from '../usage/usage'
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
import * as more from '../social/more'
import { matchSentence } from '../social/moreLogic'
import { communityRules } from '../social/communityRules'
import { withTradeStatus } from '../social/live'
import { proposeNightTrade } from '../social/tradeNightsApi'
import type { NightCard } from '../social/tradeNights'

interface TheirBinder { id: string; name: string; entries: CollectionEntry[] }

/**
 * Proposes a trade to a friend: cards from their shared binders, and optionally cards from the
 * user's own binders in return. With ?reply=<trade>, it counters a trade they sent: it starts from
 * that trade turned around, and sending it closes theirs. With ?night=<game night>, from the night's
 * Suggested trades: to anyone going (a friend or not), picking from what they bring, and the trade is
 * tied to the night (its Trade table).
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
  const { mutate } = useOverview()
  const to = params.get('to') ?? ''
  const replyTo = overview.trades.find((t) => t.id === params.get('reply') && t.status === 'open' && t.to_user === overview.me?.user_id) ?? null
  const isFriend = overview.friends.some((f) => f.user_id === to && f.status === 'accepted')
  // A trade at a game night: to someone going, who may not be a friend.
  const night = params.get('night')
  const started = location.state as { want?: api.TradeCard[]; give?: api.TradeCard[]; toName?: string | null; theirCards?: NightCard[] } | null
  const friend = overview.people[to] ?? (night && started?.toName ? { user_id: to, username: '', display_name: started.toName, avatar_path: null } : null)
  const nightBinders = nightCardsAsBinders(started?.theirCards ?? [])

  // A counter starts from their trade turned around: what they offered is what the user asks for —
  // or from the lists it was opened with (a counter with a card added to even it out).
  const [want, setWant] = useState<api.TradeCard[]>(() => started?.want ?? replyTo?.give ?? [])
  const [give, setGive] = useState<api.TradeCard[]>(() => started?.give ?? replyTo?.want ?? [])
  const [message, setMessage] = useState('')
  const [picking, setPicking] = useState<'theirs' | 'mine' | null>(null)
  const [theirBinders, setTheirBinders] = useState<TheirBinder[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cards they've marked for trade (seen by all friends), and matches either way to start from.
  const available = more.useSocialMore()
  const [forTrade, setForTrade] = useState<more.ForTradeCard[]>([])
  const [match, setMatch] = useState<more.TradeMatch | null>(null)
  const startedWith = !!replyTo || !!(location.state as { want?: unknown } | null)?.want
  useEffect(() => {
    if (!available || !to) return
    let cancelled = false
    more.forTradeList(to).then((l) => { if (!cancelled) setForTrade(l ?? []) }).catch(() => {})
    if (!startedWith) more.tradeMatches().then((m) => { if (!cancelled) setMatch(m.find((x) => x.friend === to) ?? null) }).catch(() => {})
    return () => { cancelled = true }
  }, [available, to, startedWith])
  const forTradeBinders = [...new Set(forTrade.map((c) => c.item_id))].map((binderId) => {
    const cards = forTrade.filter((c) => c.item_id === binderId)
    return {
      id: binderId,
      name: cards[0]?.item_name ?? 'Binder',
      entries: cards.map((c): CollectionEntry => {
        const plain = Math.min(c.for_trade, Math.max(0, c.quantity))
        return { scryfallId: c.scryfall_id, name: c.name, imageUrl: c.image_url ?? null, quantity: plain, foilQuantity: c.for_trade - plain, ...(c.condition ? { condition: c.condition } : {}) }
      }),
    }
  })
  const addMatch = (m: more.TradeMatch) => {
    const add = (list: api.TradeCard[], cards: more.MatchCard[]) => {
      const keys = new Set(list.map(tradeKey))
      return [...list, ...cards.map(more.matchAsTrade).filter((c) => !keys.has(tradeKey(c)))]
    }
    setWant((l) => add(l, m.they_have))
    setGive((l) => add(l, m.they_want))
    setMatch(null)
  }

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

  if (!friend || (!isFriend && !night)) return <div className="empty-state"><Icon name="person_off" />You can only trade with friends.</div>

  const myBinders = collections.filter((c) => c.type !== 'WISHLIST')
  // A first trade request (and its message) waits for the community rules, once.
  const send = () => communityRules.require(() => void sendNow())
  const sendNow = async () => {
    setBusy(true)
    setError(null)
    try {
      // A counter-offer closes the trade it answers at once.
      if (night && !replyTo) {
        await mutate(() => proposeNightTrade(night, to, want, give, message.trim()), { areas: ['trades', 'nights'] })
        countAction('trade_proposed')
        navigate(`/play/nights/${night}`, { replace: true })
        return
      }
      await mutate(() => api.proposeTrade(to, want, give, message.trim(), replyTo?.id ?? null), {
        optimistic: replyTo ? (o) => withTradeStatus(o, replyTo.id, 'countered') : undefined,
        areas: ['trades'],
      })
      countAction('trade_proposed')
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
          <span className="dim">{night && !replyTo ? 'At game night' : handle(friend)}</span>
        </span>
      </div>

      {match && (match.they_have.length > 0 || match.they_want.length > 0) && (
        <div className="banner" style={{ marginTop: 12 }}>
          <Icon name="auto_awesome" />
          <span style={{ flex: 1 }}>{matchSentence(friend.display_name, match.they_have.length, match.they_want.length)}.</span>
          <button type="button" className="btn gold sm" onClick={() => addMatch(match)}>Add them</button>
        </div>
      )}

      <SectionHeader title={`You ask for${want.length ? ` · ${cardTotal(want)}` : ''}`} action="Pick cards" onAction={() => setPicking('theirs')} />
      <TradeCardList cards={want} empty={`Nothing yet — pick from ${friend.display_name}'s shared binders.`} onRemove={(c) => setWant((l) => remove(l, c))} />

      <SectionHeader title={`You offer${give.length ? ` · ${cardTotal(give)}` : ''}`} action="Pick cards" onAction={() => setPicking('mine')} />
      <TradeCardList cards={give} empty="Nothing — or pick cards from your binders to offer." onRemove={(c) => setGive((l) => remove(l, c))} />

      <TradeValue
        get={want}
        give={give}
        friend={to}
        friendName={friend.display_name}
        onAdd={(side, card) => {
          const add = (l: api.TradeCard[]) => (l.some((x) => tradeKey(x) === tradeKey(card)) ? l : [...l, card])
          if (side === 'want') setWant(add)
          else setGive(add)
        }}
      />

      <label className="field-label" htmlFor="trade-message" style={{ marginTop: 18 }}>Message (optional)</label>
      <textarea id="trade-message" className="input" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Can bring them on Friday" />

      {error && <div className="notice warn" style={{ marginTop: 12 }}>{error}</div>}
      <button type="button" className="btn gold block" style={{ marginTop: 16 }} disabled={busy || want.length + give.length === 0} onClick={() => void send()}>
        <Icon name="send" aria-hidden />{busy ? 'Sending…' : replyTo ? 'Send counter-offer' : 'Send trade request'}
      </button>
      <p className="dim" style={{ fontSize: 12.5, textAlign: 'center' }}>Nothing moves until you both agree — then each of you updates your own binders.</p>

      {picking === 'theirs' && (
        <PickerSheet title={`${friend.display_name}'s binders`} subtitle="Pick what you'd like" onClose={() => setPicking(null)}>
          {nightBinders.map((b) => (
            <div key={`night:${b.id}`} className="picker-group">
              <div className="picker-group-title">Bringing tonight</div>
              <BinderPicker collectionId={b.id} entries={b.entries} picked={want} onChange={setWant} emptyText="Nothing here." />
            </div>
          ))}
          {forTradeBinders.map((b) => (
            <div key={`ft:${b.id}`} className="picker-group">
              <div className="picker-group-title">For trade · {b.name}</div>
              <BinderPicker collectionId={b.id} entries={b.entries} picked={want} onChange={setWant} emptyText="Nothing here." />
            </div>
          ))}
          {sharedBinders.length === 0 ? (
            forTradeBinders.length === 0 && nightBinders.length === 0 && <div className="notice">{friend.display_name} hasn't shared a binder with you or marked cards for trade.</div>
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

/** What someone brings to a game night, as binders to pick from (a binder per collection they came out of). */
function nightCardsAsBinders(cards: NightCard[]): TheirBinder[] {
  const byBinder = new Map<string, CollectionEntry[]>()
  for (const c of cards) {
    const id = c.collectionId ?? 'night'
    const entries = byBinder.get(id) ?? []
    const e = entries.find((x) => x.scryfallId === c.scryfallId)
    const plain = c.foil ? 0 : c.quantity
    const foil = c.foil ? c.quantity : 0
    if (e) { e.quantity += plain; e.foilQuantity += foil } else entries.push({ scryfallId: c.scryfallId, name: c.name, imageUrl: c.imageUrl ?? null, quantity: plain, foilQuantity: foil, ...(c.condition ? { condition: c.condition } : {}) })
    byBinder.set(id, entries)
  }
  return [...byBinder].map(([id, entries]) => ({ id, name: 'Bringing tonight', entries: entries.sort((a, b) => a.name.localeCompare(b.name)) }))
}

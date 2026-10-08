import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { UpdateBindersDialog } from '../pages/TradesPage'
import type { Trade, TradeCard } from './api'
import { useAreaChanges } from './liveChanges'
import { useOverview } from './SocialContext'
import { useTradePrices } from './tradePrices'
import {
  asNightList, BAG_SOURCE_NAME, bagNamesOf, bringCards, defaultSources, nightDecksUse, nightWantsOf, priceIdsNeeded, suggestedTrades, nightTableLine,
  theyWantFromYou, tradeTable, wantedHere, WANT_DECK, WANT_WISHLIST,
  type NightList, type NightSource, type TradeNight,
} from './tradeNights'
import { setTradeNightList, stopTradeNightList, tradeNight, useTradeNightsAvailable } from './tradeNightsApi'

// "Trades" on a game night (social/tradeNights.ts): for someone who answered Going — Bring for trades
// (binders or the event bag, shared with the others going only when they say so), Wanted here, They
// want from you, Suggested trades (a fair bundle per person; Propose opens the trade composer filled
// in, tied to the night) and the Trade table (the night's trades; "Swapped" updates the binders the
// usual way). Nothing until the server has trade nights (20261008100000_trade_nights.sql). The
// Android app's TradeNightSection.kt.

const sameSources = (a: NightSource[], b: NightSource[]) =>
  JSON.stringify(a.map((s) => (s.kind === 'binder' ? `b:${s.id}` : 'bag')).sort()) === JSON.stringify(b.map((s) => (s.kind === 'binder' ? `b:${s.id}` : 'bag')).sort())

const wantLabel = (w: number) => (w >= WANT_WISHLIST ? 'Wishlist' : w >= WANT_DECK ? 'A deck needs it' : 'Goal')
const names = (cards: { name: string }[]) => cards.map((c) => c.name).join(', ')

export function TradeNightSection({ nightId, me, going }: { nightId: string; me: string; going: boolean }) {
  const available = useTradeNightsAvailable()
  const navigate = useNavigate()
  const money = useMoney()
  const { collections, decks } = useSync()
  const { overview } = useOverview()
  const [data, setData] = useState<TradeNight | null | undefined>(undefined)
  const [picked, setPicked] = useState<NightSource[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<Trade | null>(null)

  const load = useCallback(() => {
    tradeNight(nightId).then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
  }, [nightId])
  // Lists change live (a 'night' ping), trades too (a 'trade' ping).
  const nightChanges = useAreaChanges('nights')
  const tradeChanges = useAreaChanges('trades')
  useEffect(() => { if (available) load() }, [available, load, nightChanges, tradeChanges, going])

  const binders = useMemo(() => collections.filter((c) => c.type !== 'WISHLIST'), [collections])
  const bagNames = useMemo(() => bagNamesOf(decks), [decks])
  const decksUse = useMemo(() => nightDecksUse(decks), [decks])
  const wants = useMemo(() => nightWantsOf(collections, decks), [collections, decks])
  // What's picked: the user's choice here, else what they shared, else their trade binder.
  const sources = picked ?? data?.mine?.sources ?? defaultSources(collections)
  const myCards = useMemo(() => bringCards(collections, sources, bagNames, decksUse), [collections, sources, bagNames, decksUse])
  const meList: NightList = useMemo(() => ({ userId: me, name: 'You', cards: myCards, wants }), [me, myCards, wants])
  const others = useMemo(() => (data?.others ?? []).map(asNightList), [data])
  const ids = useMemo(() => priceIdsNeeded(meList, others), [meList, others])
  const priceCards = useMemo(() => ids.map((id): TradeCard => ({ scryfallId: id, name: '', foil: false, quantity: 1 })), [ids])
  const prices = useTradePrices(priceCards)
  const suggestions = useMemo(() => (prices ? suggestedTrades(meList, others, prices) : []), [meList, others, prices])

  if (!available || !data) return null
  const table = tradeTable(data.trades, me)
  if (!data.going && table.length === 0) return null
  const shared = !!data.mine
  const here = wantedHere(wants, others)
  const theyWant = theyWantFromYou(myCards, others)
  const nameOf = (id: string) => data.others.find((o) => o.user.user_id === id)?.user.display_name ?? overview?.people[id]?.display_name ?? 'Someone'

  const toggle = (s: NightSource) => {
    const on = sources.some((x) => (x.kind === 'bag' ? s.kind === 'bag' : s.kind === 'binder' && x.id === s.id))
    setPicked(on ? sources.filter((x) => !(x.kind === 'bag' ? s.kind === 'bag' : s.kind === 'binder' && x.id === s.id)) : [...sources, s])
  }
  const share = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await setTradeNightList(nightId, sources, myCards, wants)
      if (next) setData(next)
      setPicked(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    setBusy(true)
    setError(null)
    try {
      await stopTradeNightList(nightId)
      setPicked(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  const propose = (to: string, want: TradeCard[], give: TradeCard[]) => {
    const theirs = data.others.find((o) => o.user.user_id === to)
    navigate(`/trades/new?to=${encodeURIComponent(to)}&night=${encodeURIComponent(nightId)}`, {
      state: { want, give, toName: theirs?.user.display_name ?? null, theirCards: theirs?.cards ?? [] },
    })
  }
  const changed = shared && (!sameSources(sources, data.mine!.sources) || data.mine!.cards.length !== myCards.length)

  return (
    <section className="gn-ready tn" aria-labelledby="tn-h">
      <h2 id="tn-h">Trades</h2>
      {data.going && data.open && (
        <>
          <div className="tn-label">Bring for trades</div>
          <span className="muted">
            {shared ? `Shared with the people going · ${data.mine!.cards.length} ${data.mine!.cards.length === 1 ? 'line' : 'lines'}` : 'Pick what to show the others going. Nothing is shared until you do.'}
          </span>
          <div className="tn-sources">
            {binders.map((b) => (
              <label key={b.id} className="tn-check">
                <input type="checkbox" checked={sources.some((s) => s.kind === 'binder' && s.id === b.id)} onChange={() => toggle({ kind: 'binder', id: b.id, name: b.name })} />
                <span>{b.name}</span>
              </label>
            ))}
            {bagNames.length > 0 && (
              <label className="tn-check">
                <input type="checkbox" checked={sources.some((s) => s.kind === 'bag')} onChange={() => toggle({ kind: 'bag', name: BAG_SOURCE_NAME })} />
                <span>{BAG_SOURCE_NAME} · {bagNames.length} {bagNames.length === 1 ? 'card' : 'cards'} to bring</span>
              </label>
            )}
          </div>
          <div className="friend-want-actions">
            <button type="button" className="btn gold" disabled={busy || myCards.length + wants.length === 0 || (shared && !changed && picked === null)} onClick={() => void share()}>
              {shared ? 'Update what I bring' : `Share ${myCards.length} ${myCards.length === 1 ? 'line' : 'lines'} with the table`}
            </button>
            {shared && <button type="button" className="btn line" disabled={busy} onClick={() => void stop()}>Stop sharing</button>}
          </div>
          <p className="friend-want-note">Only the people going to this night see it, and only until the night is over. Your wants (Wishlist, cards your decks are missing, goals) go with it.</p>
          {error && <div className="notice warn">{error}</div>}

          <div className="tn-label">Wanted here</div>
          {here.length === 0 ? <p className="friend-want-note">{others.length === 0 ? 'Nobody going has shared their cards yet.' : "Nothing you want is coming tonight."}</p> : here.map((w) => (
            <div key={w.name} className="friend-want-card">
              <span className="nm">{w.name}</span>
              <span className="where">{w.from.map((f) => f.name).join(', ')} · {wantLabel(w.weight)}</span>
            </div>
          ))}

          <div className="tn-label">They want from you</div>
          {theyWant.length === 0 ? <p className="friend-want-note">Nobody going wants what you're bringing yet.</p> : theyWant.map((t) => (
            <div key={t.userId} className="friend-want-card">
              <span className="nm">{t.name}</span>
              <span className="where">{names(t.cards.map((c) => c.card))}</span>
            </div>
          ))}

          <div className="tn-label">Suggested trades</div>
          {prices === undefined && ids.length > 0 ? <p className="friend-want-note">Looking up prices…</p>
            : prices === null ? <p className="friend-want-note">Couldn't load prices.</p>
              : suggestions.length === 0 ? <p className="friend-want-note">No fair trade to suggest yet — fair means within $2 or a tenth either way.</p>
                : suggestions.map((s) => (
                  <div key={s.userId} className="friend-want">
                    <div className="friend-want-h"><h4>{s.name}</h4><span>{money.format(s.getValue)} ⇄ {money.format(s.giveValue)}</span></div>
                    <div className="friend-want-has">You get: {names(s.get)}</div>
                    <div className="friend-want-has">You give: {names(s.give)}</div>
                    <div className="friend-want-actions">
                      <button type="button" className="btn gold" onClick={() => propose(s.userId, s.get, s.give)}>Propose this trade</button>
                    </div>
                  </div>
                ))}
        </>
      )}
      {!data.open && data.going && <p className="friend-want-note">Lists are closed — the night is over or called off.</p>}

      {table.length > 0 && (
        <>
          <div className="tn-label">Trade table · {nightTableLine(table)}</div>
          {table.map((r) => {
            const mineGive = r.trade.from_user === me ? r.trade.give : r.trade.want
            const mineGet = r.trade.from_user === me ? r.trade.want : r.trade.give
            return (
              <div key={r.trade.id} className={`tn-row tn-${r.state}`}>
                <span className="tn-tick" aria-hidden>{r.state === 'done' ? '✓' : ''}</span>
                <span className="tn-main">
                  <b>{nameOf(r.other)}</b>
                  <span className="muted">You give {names(mineGive) || 'nothing'} · you get {names(mineGet) || 'nothing'}</span>
                </span>
                {r.state === 'agreed' && <button type="button" className="btn gold sm" onClick={() => setUpdating(r.trade)}>Swapped — update binders</button>}
                {r.state === 'waiting' && <button type="button" className="btn line sm" onClick={() => navigate('/trades')}>Waiting</button>}
                {r.state === 'done' && <span className="muted">Done</span>}
              </div>
            )
          })}
        </>
      )}
      {updating && <UpdateBindersDialog trade={updating} me={me} theirName={nameOf(updating.from_user === me ? updating.to_user : updating.from_user)} onClose={() => { setUpdating(null); load() }} />}
    </section>
  )
}

import { useRef, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { ArtImage, SectionHeader, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import type { TradeCard } from '../social/api'
import { BinderPicker, PickerSheet } from '../social/CardPicker'
import * as more from '../social/more'
import { forTradeLines, forTradePicks, forTradeOf, setForTrade } from '../social/moreLogic'
import { SocialGate } from './FriendsPage'

// The user's cards for trade (/for-trade): copies in their own binders they offer to friends. A
// binder card's "forTrade" count, so it syncs with the binder; friends see the list on the user's
// profile and in trade matches. The Android app's twin is ui/social/ForTradeScreen.kt.

export function ForTradePage() {
  const back = useBack('/friends')
  return (
    <>
      <TopBar title="Cards for trade" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{() => <ForTradeList />}</SocialGate>
        </div>
      </div>
    </>
  )
}

function ForTradeList() {
  const { collections, changeStorage } = useSync()
  const available = more.useSocialMore()
  const [picking, setPicking] = useState(false)
  // Counts when the picker opened, so closing it can tell friends' feeds what's newly for trade.
  const before = useRef<Map<string, number>>(new Map())
  const lines = forTradeLines(collections)
  const owned = collections.filter((c) => c.type !== 'WISHLIST')

  const set = (collectionId: string, scryfallId: string, n: number) =>
    changeStorage((cols) => setForTrade(cols, collectionId, scryfallId, n))

  const openPicker = () => {
    before.current = new Map(lines.map((l) => [`${l.collectionId}:${l.entry.scryfallId}`, l.count]))
    setPicking(true)
  }
  const closePicker = () => {
    setPicking(false)
    const added = forTradeLines(collections)
      .filter((l) => l.count > (before.current.get(`${l.collectionId}:${l.entry.scryfallId}`) ?? 0))
      .map((l) => ({ name: l.entry.name, imageUrl: l.entry.imageUrl }))
    if (available) void more.noteForTrade(added)
  }
  /** The picker changed one binder's picks: each card's new count is its picks added up. */
  const onPicked = (collectionId: string, next: TradeCard[]) => {
    const binder = collections.find((c) => c.id === collectionId)
    if (!binder) return
    const totals = new Map<string, number>()
    for (const p of next) totals.set(p.scryfallId, (totals.get(p.scryfallId) ?? 0) + p.quantity)
    changeStorage((cols) => binder.entries.reduce((acc, e) => {
      const want = totals.get(e.scryfallId) ?? 0
      return want === forTradeOf(e) ? acc : setForTrade(acc, collectionId, e.scryfallId, want)
    }, cols))
  }

  const total = lines.reduce((n, l) => n + l.count, 0)
  return (
    <>
      <p className="muted" style={{ marginTop: 4 }}>
        Mark copies you'd trade away. All your friends can see this list — even from binders you don't share — and it shows in trade matches.
        {available === false && ' Friends will see it once this is ready on the server.'}
      </p>
      <button type="button" className="btn gold block" onClick={openPicker} disabled={owned.length === 0}>
        <Icon name="add" aria-hidden />Choose cards from your binders
      </button>
      <SectionHeader title={total ? `For trade · ${total}` : 'For trade'} />
      {lines.length === 0 ? (
        <div className="notice">Nothing marked for trade yet.</div>
      ) : (
        <div className="list wide-list">
          {lines.map((l) => {
            const max = l.entry.quantity + l.entry.foilQuantity
            return (
              <div key={`${l.collectionId}:${l.entry.scryfallId}`} className="crow read-only">
                <ArtImage className="thumb" src={toArtCrop(l.entry.imageUrl)} seed={l.entry.name} />
                <div className="cmain">
                  <div className="cname">{l.entry.name}</div>
                  <div className="cmeta"><span className="dim">{l.binder} · {l.count} of {max}</span></div>
                </div>
                <span className="mini-stepper on">
                  <button type="button" onClick={() => set(l.collectionId, l.entry.scryfallId, l.count - 1)} aria-label={`One fewer ${l.entry.name} for trade`}>−</button>
                  <b aria-live="polite">{l.count}</b>
                  <button type="button" disabled={l.count >= max} onClick={() => set(l.collectionId, l.entry.scryfallId, l.count + 1)} aria-label={`One more ${l.entry.name} for trade`}>+</button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {picking && (
        <PickerSheet title="Your binders" subtitle="How many of each you'd trade" onClose={closePicker}>
          {owned.map((b) => (
            <div key={b.id} className="picker-group">
              <div className="picker-group-title">{b.name}</div>
              <BinderPicker collectionId={b.id} entries={b.entries} picked={forTradePicks(b)} onChange={(next) => onPicked(b.id, next)} emptyText="This binder is empty." />
            </div>
          ))}
        </PickerSheet>
      )}
    </>
  )
}

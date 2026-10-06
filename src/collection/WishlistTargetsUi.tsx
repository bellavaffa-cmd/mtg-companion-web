// The Wishlist's price targets on screen: the "Under your price" box, the target sheet ("Tell me
// when it's cheaper") and "Set targets for all…". The rules are wishlistTargets.ts. Mirrors the
// Android app's ui/collection/WishlistTargetsUi.kt.

import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PillChip } from '../components/kit'
import { useModalFocus } from '../components/useModalFocus'
import { useMoney } from '../money/currency'
import { buyCardUrl, buyListUrl } from '../api/buy'
import type { CollectionEntry } from '../types/models'
import type { AlertHit } from './priceAlertRules'
import { epochDay } from './cardPriceHistory'
import { usePriceTrack } from './priceHistoryStore'
import { shortPrice, TARGET_PERCENTS, targetFromPercent, targetLine, weekDrop, yearLow } from './wishlistTargets'

/** Cards under their target now, with a way to buy them and "Got it" to put the box away until the next drop. */
export function UnderYourPriceBox({ hits, onGotIt }: { hits: AlertHit[]; onGotIt: () => void }) {
  const money = useMoney()
  if (hits.length === 0) return null
  const url = hits.length === 1
    ? buyCardUrl(null, hits[0].watch.entry.name)
    : buyListUrl(hits.map((h) => ({ name: h.watch.entry.name, quantity: Math.max(1, h.watch.entry.quantity + h.watch.entry.foilQuantity) })))
  return (
    <section className="under-price rise" role="status" aria-labelledby="under-price-title">
      <div className="under-price-head">
        <Icon name="notifications" aria-hidden />
        <h2 id="under-price-title">Under your price</h2>
      </div>
      {hits.slice(0, 4).map((h) => (
        <div key={h.watch.entry.scryfallId} className="under-price-line">
          {h.watch.entry.name} is <b>{money.format(h.price)}</b>, below your {shortPrice(h.watch.target, (v, w) => money.format(v, w))}.
        </div>
      ))}
      {hits.length > 4 && <div className="under-price-line dim">and {hits.length - 4} more</div>}
      <div className="under-price-actions">
        {url && <a className="btn gold sm" href={url} target="_blank" rel="noopener noreferrer">Buy at TCGplayer</a>}
        <button type="button" className="btn line sm" onClick={onGotIt}>Got it</button>
      </div>
    </section>
  )
}

/** A wishlist row's line under the name: "Target $70 · dropped 12% this week", "$3.40 to go"… */
export function TargetLineText({ entry, price }: { entry: CollectionEntry; price: number | null | undefined }) {
  const money = useMoney()
  const track = usePriceTrack(entry.scryfallId)
  const target = entry.priceAlert ?? null
  const hit = target != null && price != null && price <= target
  const dropped = hit ? weekDrop(track, !!entry.alertFoilOnly, epochDay()) : null
  return <span className={`target-line${hit ? ' hit' : ''}`}>{targetLine(target, price, dropped, (v, w) => money.format(v, w))}</span>
}

/**
 * The target sheet: "Tell me when it's cheaper". [now]: the card's price now, plain and foil (US
 * dollars). Saves the target with its options, or takes it off ([onSave] with null).
 */
export function TargetSheet({ entry, now, onSave, onClose }: {
  entry: CollectionEntry
  now: [number | null, number | null] | undefined
  onSave: (usd: number | null, options: { anyPrinting: boolean; foilOnly: boolean }) => void
  onClose: () => void
}) {
  const money = useMoney()
  const decimals = money.currency.decimals ?? 2
  const box = useRef<HTMLDivElement>(null)
  const keepFocusIn = useModalFocus(box, onClose)
  const track = usePriceTrack(entry.scryfallId)
  // A new target: any printing counts, as the sheet offers it; one set before keeps what it had.
  const [anyPrinting, setAnyPrinting] = useState(entry.priceAlert ? !!entry.alertAnyPrinting : entry.alertAnyPrinting ?? true)
  const [foilOnly, setFoilOnly] = useState(!!entry.alertFoilOnly)
  const price = (foil: boolean) => (foil ? now?.[1] : now?.[0]) ?? null
  const local = (usd: number | null) => (usd == null ? '' : money.toLocal(usd).toFixed(decimals))
  const [text, setText] = useState(() => local(entry.priceAlert ?? targetFromPercent(price(foilOnly), 10)))
  const current = price(foilOnly)
  const low = yearLow(track, foilOnly)
  const value = Number(text) > 0 ? Math.round(money.toUsd(Number(text)) * 10_000) / 10_000 : null
  const sameAs = (usd: number | null) => usd != null && text === local(usd)
  const options = { anyPrinting, foilOnly }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={box} className="sheet target-sheet" role="dialog" aria-modal="true" aria-labelledby="target-title" onKeyDown={keepFocusIn}>
        <div className="grab" />
        <h2 className="sheet-title" id="target-title">Tell me when it's cheaper</h2>
        <div className="dim target-now">
          {[entry.name, current != null ? `now ${money.format(current)}` : null, low != null ? `lowest this year ${money.format(low)}` : null].filter(Boolean).join(' · ')}
        </div>
        <label htmlFor="target-price" className="target-label">ALERT ME UNDER</label>
        <div className="target-field">
          {!money.currency.after && <span aria-hidden>{money.currency.symbol}</span>}
          <input
            id="target-price"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ''))}
            autoFocus
          />
          {money.currency.after && <span aria-hidden>{money.currency.symbol}</span>}
        </div>
        <div className="chips wrap">
          {TARGET_PERCENTS.map((p) => {
            const t = targetFromPercent(current, p)
            return t == null ? null : <PillChip key={p} label={`${p}% off`} selected={sameAs(t)} onClick={() => setText(local(t))} />
          })}
          {low != null && <PillChip label="Year's low" selected={sameAs(low)} onClick={() => setText(local(low))} />}
        </div>
        <label className="target-check">
          <input type="checkbox" checked={anyPrinting} onChange={(e) => setAnyPrinting(e.target.checked)} />
          <span>Any printing counts</span>
        </label>
        <label className="target-check">
          <input type="checkbox" checked={foilOnly} onChange={(e) => setFoilOnly(e.target.checked)} />
          <span>Foil only</span>
        </label>
        <p className="dim target-note">Prices are checked when you open the app, like your price alerts. You get one notification when it goes under, then it waits for the next drop.</p>
        <div className="target-actions">
          {entry.priceAlert
            ? <button type="button" className="btn line" onClick={() => onSave(null, options)}>Remove</button>
            : <button type="button" className="btn line" onClick={onClose}>Cancel</button>}
          <button type="button" className="btn gold" disabled={value == null} onClick={() => value != null && onSave(value, options)}>
            {value != null ? `Alert me under ${shortPrice(value, (v, w) => money.format(v, w))}` : 'Alert me under…'}
          </button>
        </div>
      </div>
    </>
  )
}

/** "Set targets for all…": so much off today's price, for every card without a target. [count]: how many that'd set, by percent. */
export function SetTargetsForAllDialog({ count, onSet, onClose }: { count: (percent: number) => number; onSet: (percent: number) => void; onClose: () => void }) {
  const [percent, setPercent] = useState(TARGET_PERCENTS[0])
  const n = count(percent)
  return (
    <Dialog
      title="Set targets for all"
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="btn line" onClick={onClose}>Cancel</button>
          <button type="button" className="btn gold" disabled={n === 0} onClick={() => onSet(percent)}>
            {n === 1 ? 'Set 1 target' : `Set ${n} targets`}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>Tell me when each card without a target is this much under today's price:</p>
      <div className="chips wrap">
        {TARGET_PERCENTS.map((p) => <PillChip key={p} label={`${p}% off`} selected={percent === p} onClick={() => setPercent(p)} />)}
      </div>
      <p className="dim" style={{ marginBottom: 0 }}>
        {n === 0 ? 'Every card with a price already has a target.' : 'Any printing counts. You can change each one after.'}
      </p>
    </Dialog>
  )
}

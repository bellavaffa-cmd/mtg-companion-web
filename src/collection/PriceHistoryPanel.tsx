// A card's price over time as this browser has noted it (see cardPriceHistory.ts): the range, how
// much it moved, and a line of steps. Mirrors the Android app's PriceHistoryPanel (CopyDetailsUi.kt),
// "on this device" where the phone says "on this phone".

import { useId, useState } from 'react'
import { PillChip } from '../components/kit'
import { useMoney } from '../money/currency'
import { kindsIn, priceMove, priceSeries, PRICE_KIND_LABELS, type PriceKind } from './cardPriceHistory'
import { usePriceTrack } from './priceHistoryStore'

const dayLabel = (day: number, withYear: boolean) =>
  new Date(day * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })

const yearOf = (day: number) => new Date(day * 86_400_000).getUTCFullYear()

/** [preferFoil]: start on the foil price, for copies that are all foil. */
export function PriceHistoryPanel({ scryfallId, preferFoil = false }: { scryfallId: string; preferFoil?: boolean }) {
  const money = useMoney()
  const track = usePriceTrack(scryfallId)
  const [picked, setPicked] = useState<PriceKind | null>(null)
  // Cardmarket's prices are in euros whatever the chosen currency; the rest are dollars, shown in it.
  const format = (kind: PriceKind, v: number) => (kind === 'eur' ? `€${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : money.format(v))

  const body = (() => {
    if (track === undefined) return <div className="dim">Loading…</div>
    const kinds = track ? kindsIn(track) : []
    if (!track || kinds.length === 0) {
      return <div className="dim">Nothing yet. This device notes the card's price each day it checks your cards' prices, so the chart fills in day by day.</div>
    }
    const start: PriceKind = preferFoil && kinds.includes('usdFoil') ? 'usdFoil' : kinds[0]
    const kind = picked && kinds.includes(picked) ? picked : start
    const series = priceSeries(track, kind)
    const move = priceMove(series)
    const chips = kinds.length > 1 && (
      <div className="chips">
        {kinds.map((k) => <PillChip key={k} label={PRICE_KIND_LABELS[k]} selected={k === kind} onClick={() => setPicked(k)} className="on-g2" />)}
      </div>
    )
    if (!move || series.length < 2 || move.fromDay === move.toDay) {
      const price = series[series.length - 1]?.[1]
      return (
        <>
          {chips}
          <div className="dim">{price != null ? `${format(kind, price)} on ${dayLabel(track.lastDay, false)}. ` : ''}One day noted so far — the chart fills in day by day.</div>
        </>
      )
    }
    const withYear = yearOf(move.fromDay) !== yearOf(move.toDay)
    const tone = Math.abs(move.change) < 0.005 ? '' : move.change >= 0 ? ' up' : ' down'
    return (
      <>
        {chips}
        <div className="price-history-head">
          <span className="dim">{dayLabel(move.fromDay, withYear)} – {dayLabel(move.toDay, withYear)}</span>
          <b className={`price-history-move${tone}`}>
            {format(kind, move.from)} → {format(kind, move.to)}
            {move.percent != null && ` (${move.change >= 0 ? '+' : '−'}${Math.abs(move.percent).toFixed(1)}%)`}
          </b>
        </div>
        <PriceStepChart series={series} label={`${PRICE_KIND_LABELS[kind]} price over time`} />
      </>
    )
  })()

  return (
    <div className="price-history">
      <div className="p-h" style={{ margin: 0 }}><h3>Price history (on this device)</h3></div>
      {body}
    </div>
  )
}

const W = 600
const H = 110

/** Prices as steps — each holds until the next one noted — over a soft fill, spaced by day. */
function PriceStepChart({ series, label }: { series: [number, number][]; label: string }) {
  const fillId = `ph-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const first = series[0][0]
  const span = Math.max(1, series[series.length - 1][0] - first)
  const values = series.map(([, v]) => v)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const range = hi - lo > 0 ? hi - lo : Math.max(hi * 0.1, 0.5)
  const bottom = lo - range * 0.12
  const top = hi + range * 0.12
  const x = (day: number) => ((day - first) / span) * W
  const y = (v: number) => H * (1 - (v - bottom) / (top - bottom))
  const line = series.map(([day, v], i) => (i === 0 ? `M${x(day).toFixed(1)},${y(v).toFixed(1)}` : `L${x(day).toFixed(1)},${y(series[i - 1][1]).toFixed(1)} L${x(day).toFixed(1)},${y(v).toFixed(1)}`)).join(' ')
  const [lastDay, lastValue] = series[series.length - 1]
  return (
    <div className="price-history-chart">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gold)" stopOpacity="0.25" />
          <stop offset="1" stopColor="var(--gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2].map((g) => <line key={g} x1="0" x2={W} y1={(H * g) / 2} y2={(H * g) / 2} className="value-grid" vectorEffect="non-scaling-stroke" />)}
      <path d={`${line} L${x(lastDay).toFixed(1)},${H} L0,${H} Z`} fill={`url(#${fillId})`} />
      <path d={line} className="price-history-line" vectorEffect="non-scaling-stroke" />
    </svg>
    {/* The latest price, round whatever the chart's stretched to. */}
    <span className="price-history-dot" style={{ left: `${(x(lastDay) / W) * 100}%`, top: `${(y(lastValue) / H) * 100}%` }} />
    </div>
  )
}

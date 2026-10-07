import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { ArtImage, PillChip, rise, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { EmptyState } from '../components/EmptyState'
import { libraryFacts } from '../onboarding/onboarding'
import { useMoney, type Money } from '../money/currency'
import { useCollectionValue } from '../collection/valueHistory'
import { usePriceHistory } from '../collection/priceHistoryStore'
import { epochDay } from '../collection/cardPriceHistory'
import {
  BUCKET_LABELS, SERIES_RANGES, binderValues, holdingsOf, likeForLike, trendSummary, valueMovers, valueSeries,
  type SeriesPoint, type SeriesRangeId, type ValueMover,
} from '../collection/valueSeries'

// The collection's value over time, worked out from each card's own price history (valueSeries.ts):
// the cards owned now at the prices this browser saved, by day, week or month over the last month,
// six months, year or all of it — where the history starts, never before. Below it, the cards that
// rose and fell most over the same stretch, and each binder's value. Mirrors the Android app's
// ValueHistoryScreen.

/** An epoch day as "12 Sep 2026" (or "12 Sep" with [short]). */
const day = (d: number, short = false) =>
  new Date(d * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(short ? {} : { year: 'numeric' }), timeZone: 'UTC' })

/** "+₱1,234 (+5.2%)" / "−$3 (−0.4%)". */
function signed(money: Money, usd: number, percent: number | null): string {
  const sign = usd < 0 ? '−' : '+'
  return sign + money.format(Math.abs(usd), Math.abs(money.toLocal(usd)) >= 100) + (percent != null ? ` (${sign}${Math.abs(percent).toFixed(1)}%)` : '')
}

export function ValueHistoryPage() {
  const back = useBack('/')
  const money = useMoney()
  const navigate = useNavigate()
  const { collections } = useSync()
  // Opening this page works out (and saves) today's prices too.
  useCollectionValue(collections)
  const tracks = usePriceHistory()
  const holdings = useMemo(() => holdingsOf(collections), [collections])
  const [range, setRange] = useState<SeriesRangeId>('6M')
  const [picked, setPicked] = useState<SeriesPoint | null>(null)
  const series = useMemo(() => (tracks ? valueSeries(tracks, holdings, range, epochDay()) : null), [tracks, holdings, range])
  const points = series?.points ?? []
  const first = points[0]
  const last = points[points.length - 1]
  const change = useMemo(() => (tracks && first && last && first.day !== last.day ? likeForLike(tracks, holdings, first.day, last.day) : null), [tracks, holdings, first, last])
  const movers = useMemo(() => (tracks && first && last ? valueMovers(tracks, holdings, first.day, last.day) : null), [tracks, holdings, first, last])
  const binders = useMemo(() => (tracks && first && last ? binderValues(tracks, holdings, first.day, last.day) : []), [tracks, holdings, first, last])
  const shown = picked ?? last ?? null
  const summary = points.length > 0 ? trendSummary(points, (v) => money.format(v), (d) => day(d)) : ''

  return (
    <>
      <TopBar title="Collection value" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width value-page rise" style={rise(0)}>
          {!series && libraryFacts([], collections).cards === 0 ? (
            <EmptyState icon="show_chart" text="No value yet. Once your binders have cards, their prices are saved here once a day." actions={[{ label: 'Bring in your cards', icon: 'playlist_add', to: '/welcome?step=collection' }]} />
          ) : !series || !shown ? (
            <>
              <div className="value-now dim">—</div>
              <p className="muted">{tracks ? "Your cards' prices are saved once a day, when Home works out their value. The chart starts once the first day's prices are saved." : 'Reading the prices saved in this browser…'}</p>
            </>
          ) : (
            <>
              <div className="value-now">{money.format(shown.usd)}</div>
              <div className={`value-change${picked || !change ? '' : change.change > 0 ? ' up' : change.change < 0 ? ' down' : ''}`}>
                {picked
                  ? `${day(shown.day)} · ${shown.priced.toLocaleString()} of ${shown.copies.toLocaleString()} cards priced`
                  : change ? `${signed(money, change.change, change.percent)} since ${day(first.day)}` : `${shown.priced.toLocaleString()} cards · saved ${day(shown.day)}`}
              </div>
              <div className="chip-row" style={{ marginTop: 18 }}>
                {SERIES_RANGES.map((r) => <PillChip key={r.id} label={r.id} selected={range === r.id} onClick={() => { setRange(r.id); setPicked(null) }} />)}
              </div>
              {points.length < 2 ? (
                <p className="muted" style={{ marginTop: 24 }}>Prices are saved once a day. Come back tomorrow to see the value change.</p>
              ) : (
                <>
                  <ValueChart points={points} summary={summary} onPick={setPicked} />
                  <div className="value-axis dim" aria-hidden="true"><span>{day(first.day)}</span><span>{BUCKET_LABELS[series.bucket]}</span><span>{day(last.day)}</span></div>
                  <p className="sr-only">{summary}</p>
                  <div className="value-figures">
                    {([['Low', points.reduce((a, b) => (b.usd < a.usd ? b : a))], ['High', points.reduce((a, b) => (b.usd > a.usd ? b : a))]] as const).map(([label, p]) => (
                      <div key={label} className="panel">
                        <div className="dim">{label}</div>
                        <div className="value-figure">{money.format(p.usd)}</div>
                        <div className="dim" style={{ fontSize: 12 }}>{day(p.day)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <p className="dim value-note">
                Value history starts {day(series.historyStart, true)}, when this device began saving prices.
                {series.lateCards > 0 && ` ${series.lateCards.toLocaleString()} ${series.lateCards === 1 ? 'card counts' : 'cards count'} from the day ${series.lateCards === 1 ? 'its' : 'their'} price was first saved.`}
                {series.unpriced > 0 && ` ${series.unpriced.toLocaleString()} ${series.unpriced === 1 ? 'copy has' : 'copies have'} no saved price yet and ${series.unpriced === 1 ? "isn't" : "aren't"} counted.`}
              </p>
              {movers && (
                <section className="movers">
                  <div className="movers-head"><h3>Risers and fallers</h3></div>
                  <div className="dim" style={{ fontSize: 12 }}>Since {day(first.day)}</div>
                  {movers.risers.length === 0 && movers.fallers.length === 0 && <p className="muted">None of your cards changed price.</p>}
                  {movers.risers.length > 0 && <MoverList title="Up" movers={movers.risers} money={money} onOpen={(m) => navigate(`/card/${encodeURIComponent(m.name)}?id=${m.id}`)} />}
                  {movers.fallers.length > 0 && <MoverList title="Down" movers={movers.fallers} money={money} onOpen={(m) => navigate(`/card/${encodeURIComponent(m.name)}?id=${m.id}`)} />}
                </section>
              )}
              {binders.length > 1 && (
                <section className="movers">
                  <div className="movers-head"><h3>By binder</h3></div>
                  <div className="list" style={{ marginTop: 8 }}>
                    {binders.map((b) => (
                      <button key={b.id} type="button" className="crow read-only press value-binder" onClick={() => navigate(`/collections/${b.id}`)}>
                        <div className="cmain">
                          <div className="cname">{b.name}</div>
                          <div className="cmeta"><span className="dim">{b.change === 0 ? 'No change' : `${signed(money, b.change, null)} since ${day(first.day, true)}`}</span></div>
                        </div>
                        <b className="mover-change">{money.format(b.usd, b.usd >= 100)}</b>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          <p className="dim" style={{ fontSize: 12.5, marginTop: 20 }}>
            The cards in your binders now (not wishlists) at TCGplayer's market prices on each day
            {money.isUsd ? '' : `, in ${money.currency.code} at today's exchange rate`}. Prices are saved in this browser, once a day; nothing is filled in for days before that.
          </p>
        </div>
      </div>
    </>
  )
}

function MoverList({ title, movers, money, onOpen }: { title: string; movers: ValueMover[]; money: Money; onOpen: (m: ValueMover) => void }) {
  return (
    <>
      <div className="movers-sub">{title}</div>
      <div className="list">
        {movers.map((m) => (
          <button key={m.id} type="button" className="crow read-only press mover" onClick={() => onOpen(m)}>
            <ArtImage className="thumb" src={toArtCrop(m.imageUrl)} seed={m.name} />
            <div className="cmain">
              <div className="cname">{m.name}</div>
              <div className="cmeta">
                <span className="dim">
                  {money.format(m.from)} → {money.format(m.to)}{m.percent != null ? ` (${m.percent >= 0 ? '+' : '−'}${Math.abs(m.percent).toFixed(0)}%)` : ''}{m.copies > 1 ? ` · ×${m.copies}` : ''}
                </span>
              </div>
            </div>
            <b className={`mover-change ${m.change > 0 ? 'up' : 'down'}`}>{m.change > 0 ? '+' : '−'}{money.format(Math.abs(m.change))}</b>
          </button>
        ))}
      </div>
    </>
  )
}

const W = 600
const H = 220

/** The values as a line over a soft fill, spaced by date. Pointing at it picks the nearest point. */
function ValueChart({ points, summary, onPick }: { points: SeriesPoint[]; summary: string; onPick: (p: SeriesPoint | null) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const [index, setIndex] = useState<number | null>(null)
  const span = Math.max(1, points[points.length - 1].day - points[0].day)
  const lo = Math.min(...points.map((p) => p.usd))
  const hi = Math.max(...points.map((p) => p.usd))
  const pad = (hi - lo || Math.max(hi * 0.1, 1)) * 0.1
  const bottom = lo - pad
  const top = hi + pad
  const x = (i: number) => ((points[i].day - points[0].day) / span) * W
  const y = (v: number) => H * (1 - (v - bottom) / (top - bottom))
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.usd).toFixed(1)}`).join(' ')

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const px = ((clientX - box.left) / box.width) * W
    let best = 0
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i })
    setIndex(best)
    onPick(points[best])
  }
  const clear = () => { setIndex(null); onPick(null) }

  return (
    <svg
      ref={ref}
      className="value-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={clear}
      onPointerUp={(e) => { if (e.pointerType !== 'mouse') clear() }}
    >
      <defs>
        <linearGradient id="value-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gold)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((g) => <line key={g} x1="0" x2={W} y1={(H * g) / 3} y2={(H * g) / 3} className="value-grid" />)}
      <path d={`${line} L${x(points.length - 1)},${H} L0,${H} Z`} fill="url(#value-fill)" />
      <path d={line} className="value-line" vectorEffect="non-scaling-stroke" />
      {index != null && (
        <>
          <line x1={x(index)} x2={x(index)} y1="0" y2={H} className="value-cursor" vectorEffect="non-scaling-stroke" />
          <circle cx={x(index)} cy={y(points[index].usd)} r="5" className="value-dot" />
        </>
      )}
    </svg>
  )
}

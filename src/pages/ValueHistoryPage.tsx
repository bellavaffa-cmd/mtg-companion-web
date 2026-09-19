import { useMemo, useRef, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { PillChip, rise, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { useMoney, type Money } from '../money/currency'
import { VALUE_RANGES, changeOf, pointsIn, useCollectionValue, useValueHistory, type ValuePoint, type ValueRangeId } from '../collection/valueHistory'

// The collection's value over time: a line of the daily values Home has noted, over the last month,
// three months, year or all of it — and how much it moved. Mirrors the Android app's
// ValueHistoryScreen.

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** "+₱1,234 (+5.2%)" / "−$3 (−0.4%)". */
function signed(money: Money, usd: number, percent: number | null): string {
  const sign = usd < 0 ? '−' : '+'
  return sign + money.format(Math.abs(usd), Math.abs(money.toLocal(usd)) >= 100) + (percent != null ? ` (${sign}${Math.abs(percent).toFixed(1)}%)` : '')
}

export function ValueHistoryPage() {
  const back = useBack('/')
  const money = useMoney()
  const { collections } = useSync()
  // Opening this page works out (and notes) today's value too.
  useCollectionValue(collections)
  const all = useValueHistory()
  const [range, setRange] = useState<ValueRangeId>('3M')
  const [picked, setPicked] = useState<ValuePoint | null>(null)
  const points = useMemo(() => pointsIn(all, range), [all, range])
  const change = changeOf(points)
  const shown = picked ?? all[all.length - 1] ?? null

  return (
    <>
      <TopBar title="Collection value" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width value-page rise" style={rise(0)}>
          {!shown ? (
            <>
              <div className="value-now dim">—</div>
              <p className="muted">Your binders' value is noted once a day, when Home works it out. The first one appears once their prices have loaded.</p>
            </>
          ) : (
            <>
              <div className="value-now">{money.format(shown.usd)}</div>
              <div className={`value-change${picked || !change ? '' : change.usd > 0 ? ' up' : change.usd < 0 ? ' down' : ''}`}>
                {picked
                  ? `${day(shown.date)} · ${shown.cards.toLocaleString()} cards`
                  : change ? `${signed(money, change.usd, change.percent)} since ${day(change.from.date)}` : `${shown.cards.toLocaleString()} cards · noted ${day(shown.date)}`}
              </div>
              <div className="chip-row" style={{ marginTop: 18 }}>
                {VALUE_RANGES.map((r) => <PillChip key={r.id} label={r.id} selected={range === r.id} onClick={() => { setRange(r.id); setPicked(null) }} />)}
              </div>
              {points.length < 2 ? (
                <p className="muted" style={{ marginTop: 24 }}>A value is noted once a day. Come back tomorrow to see it change.</p>
              ) : (
                <>
                  <ValueChart points={points} onPick={setPicked} />
                  <div className="value-axis dim"><span>{day(points[0].date)}</span><span>{day(points[points.length - 1].date)}</span></div>
                  <div className="value-figures">
                    {[['Low', points.reduce((a, b) => (b.usd < a.usd ? b : a))], ['High', points.reduce((a, b) => (b.usd > a.usd ? b : a))]].map(([label, p]) => (
                      <div key={label as string} className="panel">
                        <div className="dim">{label as string}</div>
                        <div className="value-figure">{money.format((p as ValuePoint).usd)}</div>
                        <div className="dim" style={{ fontSize: 12 }}>{day((p as ValuePoint).date)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <p className="dim" style={{ fontSize: 12.5, marginTop: 20 }}>
            The value of your binders (not wishlists) at TCGplayer's market prices
            {money.isUsd ? '' : `, in ${money.currency.code} at today's exchange rate`}. It's noted in this browser, once a day.
          </p>
        </div>
      </div>
    </>
  )
}

const W = 600
const H = 220

/** The values as a line over a soft fill, spaced by date. Pointing at it picks the nearest day. */
function ValueChart({ points, onPick }: { points: ValuePoint[]; onPick: (p: ValuePoint | null) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const [index, setIndex] = useState<number | null>(null)
  const days = points.map((p) => Date.parse(`${p.date}T00:00:00Z`) / 86_400_000)
  const span = Math.max(1, days[days.length - 1] - days[0])
  const lo = Math.min(...points.map((p) => p.usd))
  const hi = Math.max(...points.map((p) => p.usd))
  const pad = (hi - lo || Math.max(hi * 0.1, 1)) * 0.1
  const bottom = lo - pad
  const top = hi + pad
  const x = (i: number) => ((days[i] - days[0]) / span) * W
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
      aria-label="Collection value over time"
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

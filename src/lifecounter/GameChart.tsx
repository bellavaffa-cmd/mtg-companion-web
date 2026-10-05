import { useState } from 'react'
import { durationText, gameRecap, lifeChart, recapLines, type ChartSeat, type GameLog } from './lifeChart'
import { seatColor } from './game'
import './gameChart.css'

// A finished game's life chart (drawn by hand in SVG) and its recap, by round or by time. Shown from
// the table's games and the Play tab's recent games, so it takes the page's theme: lines in the seats'
// colours, everything else in the theme's ink. The Android app's ui/lifecounter/GameChartView.kt.

const W = 320
const H = 180
const PAD = { left: 30, right: 10, top: 10, bottom: 24 }

/** About four tidy steps from [min] to [max]. */
function ticks(min: number, max: number): number[] {
  const span = Math.max(1, max - min)
  const raw = span / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

export function GameChart({ log, seats }: { log: GameLog; seats: ChartSeat[] }) {
  const [byTurn, setByTurn] = useState(true)
  const chart = lifeChart(log, byTurn ? 'turn' : 'time')
  const nameOf = (seat: number) => seats.find((s) => s.seat === seat)?.name ?? `Player ${seat}`
  const colorOf = (seat: number) => seatColor(seats.find((s) => s.seat === seat)?.colorIndex ?? seat - 1).srgb
  const x = (v: number) => PAD.left + (v / Math.max(1, chart.xMax)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + ((chart.yMax - v) / Math.max(1, chart.yMax - chart.yMin)) * (H - PAD.top - PAD.bottom)
  const xTicks = byTurn
    ? ticks(0, chart.xMax).filter((t) => Number.isInteger(t))
    : ticks(0, chart.xMax / 60_000).map((m) => m * 60_000)
  const lines = recapLines(gameRecap(log), nameOf)
  const lastTurn = byTurn ? chart.xMax : 0

  const path = (points: { x: number; life: number }[]) =>
    points.map((p, i) => {
      if (i === 0) return `M${x(p.x).toFixed(1)},${y(p.life).toFixed(1)}`
      // By time, life holds until the next change: a step, not a slope.
      return byTurn ? `L${x(p.x).toFixed(1)},${y(p.life).toFixed(1)}` : `H${x(p.x).toFixed(1)}V${y(p.life).toFixed(1)}`
    }).join('')

  const summary = chart.series
    .map((s) => `${nameOf(s.seat)}: ${s.points[0].life} to ${s.points[s.points.length - 1].life}`)
    .join('; ')

  return (
    <div className="gc">
      <div className="gc-switch" role="group" aria-label="Chart by">
        <button type="button" className={byTurn ? 'on' : ''} aria-pressed={byTurn} onClick={() => setByTurn(true)}>By round</button>
        <button type="button" className={byTurn ? '' : 'on'} aria-pressed={!byTurn} onClick={() => setByTurn(false)}>By time</button>
      </div>
      <svg className="gc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Life totals ${byTurn ? 'by round' : 'over time'}. ${summary}`}>
        {ticks(chart.yMin, chart.yMax).map((t) => (
          <g key={`y${t}`}>
            <line className={t === 0 ? 'gc-zero' : 'gc-grid'} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="gc-label" x={PAD.left - 4} y={y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} className="gc-label" x={x(t)} y={H - 8} textAnchor="middle">
            {byTurn ? (t === 0 ? 'Start' : t) : `${Math.round(t / 60_000)}m`}
          </text>
        ))}
        {chart.series.map((s) => (
          <g key={s.seat}>
            <path className="gc-line" d={path(s.points)} stroke={colorOf(s.seat)} />
            {byTurn && s.points.map((p) => <circle key={p.x} className="gc-dot" cx={x(p.x)} cy={y(p.life)} r={2.4} fill={colorOf(s.seat)} />)}
            {log.outs.some((o) => o.seat === s.seat) && (
              <text className="gc-out" x={x(s.points[s.points.length - 1].x)} y={y(s.points[s.points.length - 1].life) - 5} textAnchor="middle" aria-hidden>✕</text>
            )}
          </g>
        ))}
      </svg>
      <ul className="gc-legend">
        {chart.series.map((s) => (
          <li key={s.seat}>
            <i style={{ background: colorOf(s.seat) }} aria-hidden />
            {nameOf(s.seat)} <span>{s.points[s.points.length - 1].life}</span>
            {/* The ✕ on the chart, in words: the line's colour alone doesn't say who went out. */}
            {log.outs.some((o) => o.seat === s.seat) && <span className="gc-out-word"> · out</span>}
          </li>
        ))}
      </ul>
      {/* The same numbers for a screen reader, a row a player. */}
      {byTurn && (
        <table className="sr-only">
          <caption>Life at the end of each round</caption>
          <thead><tr><th scope="col">Player</th>{Array.from({ length: lastTurn + 1 }, (_, k) => <th key={k} scope="col">{k === 0 ? 'Start' : `Round ${k}`}</th>)}</tr></thead>
          <tbody>
            {chart.series.map((s) => (
              <tr key={s.seat}><th scope="row">{nameOf(s.seat)}</th>{s.points.map((p) => <td key={p.x}>{p.life}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
      {lines.length > 0 && (
        <ul className="gc-recap">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {!byTurn && <p className="gc-note">{durationText(log.endMs)} on the game clock; time paused doesn't count.</p>}
    </div>
  )
}

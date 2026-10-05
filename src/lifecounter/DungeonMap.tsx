import { dungeonById, dungeonDone, dungeonLayout, inDungeon, roomOf, ventureOptions, type DungeonState } from './dungeons'
import './dungeonMap.css'

// A player's dungeon: the card as a small map with their room marked, the rooms they can move to,
// and the dungeons they can start. Used on the table's player panel and on a player's remote. The
// logic is dungeons.ts; the Android app's ui/lifecounter/DungeonViews.kt.

const W = 300
const ROW_H = 44

/** The dungeon card as a map: rooms by row, lines down to the rooms each leads to, [state]'s room marked. */
export function DungeonMap({ state }: { state: DungeonState }) {
  const dungeon = dungeonById(state.dungeon)
  if (!dungeon) return null
  const spots = dungeonLayout(dungeon)
  const at = (id: string) => spots.find((s) => s.id === id)!
  const rows = Math.max(...spots.map((s) => s.row)) + 1
  const h = rows * ROW_H
  const px = (id: string) => ({ x: 14 + at(id).x * (W - 28), y: ROW_H / 2 + at(id).row * ROW_H - 8 })
  const here = roomOf(state)
  const next = new Set(inDungeon(state) ? here!.next : [])
  return (
    <svg className="dg-map" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${dungeon.name}: in ${here?.name ?? 'no room'}`}>
      {dungeon.rooms.flatMap((r) => r.next.map((n) => {
        const a = px(r.id)
        const b = px(n)
        return <line key={`${r.id}-${n}`} className={`dg-link${r.id === state.room ? ' open' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      }))}
      {dungeon.rooms.map((r) => {
        const p = px(r.id)
        const cls = r.id === state.room ? ' here' : next.has(r.id) ? ' next' : ''
        return (
          <g key={r.id} className={`dg-room${cls}`}>
            <title>{`${r.name}: ${r.text}`}</title>
            <circle cx={p.x} cy={p.y} r={r.id === state.room ? 8 : 6} />
            <text x={p.x} y={p.y + 19} textAnchor="middle">{r.name}</text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Venturing for one player: where they are and what it does, the rooms they can go to next, or the
 * dungeons they can start — Undercity when they have the initiative (taking it, and each upkeep
 * while they hold it, ventures into Undercity).
 */
export function VenturePanel({ dungeon, completed, hasInitiative, onVenture, onLeave, onCompleted }: {
  dungeon: DungeonState | null | undefined
  completed: number
  hasInitiative: boolean
  onVenture: (to: string, undercity: boolean) => void
  onLeave: () => void
  onCompleted?: (delta: number) => void
}) {
  const here = roomOf(dungeon)
  const going = inDungeon(dungeon)
  const options = ventureOptions(dungeon, false)
  const name = dungeonById(dungeon?.dungeon)?.name
  return (
    <div className="dg">
      {dungeon && here && (
        <>
          <div className="dg-where">
            <b>{name}{dungeonDone(dungeon) ? ' · completed' : ''}</b>
            <span>{here.name}: {here.text}</span>
          </div>
          <DungeonMap state={dungeon} />
        </>
      )}
      <div className="dg-label">{going ? 'Venture into the dungeon: go to' : dungeon ? 'Venture into a new dungeon' : 'Venture into the dungeon'}</div>
      <div className="dg-options">
        {options.map((id) => {
          const room = going ? dungeonById(dungeon!.dungeon)?.rooms.find((r) => r.id === id) : null
          return (
            <button key={id} type="button" className="dg-option" onClick={() => onVenture(id, false)}>
              <b>{room ? room.name : dungeonById(id)?.name}</b>
              {room && <span>{room.text}</span>}
            </button>
          )
        })}
        {!going && hasInitiative && (
          <button type="button" className="dg-option initiative" onClick={() => onVenture('undercity', true)}>
            <b>Undercity</b><span>Venture into Undercity — for the initiative</span>
          </button>
        )}
      </div>
      {going && hasInitiative && <p className="dg-hint">With the initiative, venturing into Undercity moves on in this dungeon.</p>}
      <div className="dg-foot">
        <span>Dungeons completed: <b>{completed}</b></span>
        {onCompleted && (
          <>
            <button type="button" className="dg-small" onClick={() => onCompleted(-1)} aria-label="One fewer completed">−</button>
            <button type="button" className="dg-small" onClick={() => onCompleted(1)} aria-label="One more completed">+</button>
          </>
        )}
        {going && <button type="button" className="dg-small wide" onClick={onLeave}>Leave the dungeon</button>}
      </div>
    </div>
  )
}

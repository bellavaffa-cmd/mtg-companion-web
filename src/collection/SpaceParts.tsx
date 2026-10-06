// Box space's pieces, shared by the Space page and a place's page: a place's bar ("96% full · 612 of
// 640", "Room for about 28 more" with Split into two boxes and Change size), the split's sections
// each way, and the Change size dialog. The logic is boxSpace.ts. Mirrors the Android app's
// SpaceScreen.kt (SpaceCard, SplitSection, SizeDialog).

import { useState } from 'react'
import { Dialog } from '../components/Dialog'
import type { StoragePlace } from '../types/models'
import { nearlyFull, nextBoxName, roomLine, sizeSetting, spaceLabel, splitSideLabel, type Space, type SplitPlan } from './boxSpace'
import { pocketsOf } from './storagePlaces'
import './inventory.css'

/** One place's space: its name, "96% full · 612 of 640", the bar, and — open — the room left with Split and Change size. */
export function SpaceCard({ place, space, lastPile, open, canSplit, onClick, onOpen, onSplit, onSize }: {
  place: StoragePlace; space: Space; lastPile: number | null; open: boolean; canSplit: boolean
  onClick?: () => void; onOpen?: () => void; onSplit: () => void; onSize: () => void
}) {
  const full = nearlyFull(space)
  const width = `${Math.min(100, Math.round((space.used / Math.max(1, space.size)) * 100))}%`
  return (
    <div className={`space-card${full ? ' full' : ''}${open ? ' open' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined}>
      <div className="space-h">
        {onOpen ? <b><button type="button" className="link" style={{ padding: 0, font: 'inherit', color: 'inherit' }} onClick={(e) => { e.stopPropagation(); onOpen() }}>{place.name}</button></b> : <b>{place.name}</b>}
        <span>{spaceLabel(place, space)}</span>
      </div>
      <div className="space-bar"><div style={{ width }} /></div>
      {open && (
        <>
          <div className="space-room">{roomLine(space, lastPile)}</div>
          <div className="space-actions">
            {canSplit && <button type="button" className="btn gold" onClick={(e) => { e.stopPropagation(); onSplit() }}>Split into two boxes</button>}
            <button type="button" className="btn line" onClick={(e) => { e.stopPropagation(); onSize() }}>Change size</button>
          </div>
        </>
      )}
    </div>
  )
}

const sectionWord = (place: StoragePlace) =>
  place.sortRule === 'COLOUR' ? 'colour' : place.sortRule === 'TYPE' ? 'type' : place.sortRule === 'SET' ? 'set' : 'section'

/** "Split Red box": what stays, what goes to the new box, and that nothing inside a section moves. */
export function SplitSection({ place, plan, places }: { place: StoragePlace; plan: SplitPlan; places: StoragePlace[] }) {
  return (
    <section className="split-box">
      <h2>Split {place.name}</h2>
      <div className="split-line"><span>{place.name}</span><span>{splitSideLabel(plan.stay, plan.stayCopies)}</span></div>
      <div className="split-line new"><span>New: {nextBoxName(places, place.name)}</span><span>{splitSideLabel(plan.go, plan.goCopies)}</span></div>
      <div className="dim" style={{ fontSize: 12 }}>Splits on whole sections, so nothing inside a {sectionWord(place)} moves.</div>
    </section>
  )
}

/** Change size: a binder's pages, anything else's cards; Remove size takes it off. */
export function SizeDialog({ place, onDismiss, onSave }: { place: StoragePlace; onDismiss: () => void; onSave: (n: number) => void }) {
  const binder = place.kind === 'BINDER'
  const [text, setText] = useState(String(sizeSetting(place) ?? ''))
  const n = Number(text) > 0 ? Math.round(Number(text)) : null
  return (
    <Dialog
      title={`Size of ${place.name}`}
      onDismiss={onDismiss}
      actions={
        <>
          {sizeSetting(place) !== null && <button type="button" className="btn danger" onClick={() => onSave(0)}>Remove size</button>}
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={n === null} onClick={() => n !== null && onSave(n)}>Save</button>
        </>
      }
    >
      <div className="field-label">{binder ? 'Pages' : 'Cards it holds'}</div>
      <input className="input" inputMode="numeric" value={text} autoFocus onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 5))} onKeyDown={(e) => e.key === 'Enter' && n !== null && onSave(n)} />
      <div className="dim" style={{ marginTop: 6 }}>
        {binder
          ? `${n !== null ? `${n * pocketsOf(place)} pockets · ` : ''}${pocketsOf(place)} pockets a page. Count both sides of a sheet as pages.`
          : 'About how many cards fit: an 800-count box holds about 800 without sleeves.'}
      </div>
    </Dialog>
  )
}

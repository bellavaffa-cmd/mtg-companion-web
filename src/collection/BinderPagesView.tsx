import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ArtImage, toArtCrop } from '../components/kit'
import type { Collection, StoragePlace } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import {
  binderPockets, factsFrom, pageCount, printingLine, pageGrid, pageSummary, pocketAt, pocketIndex, relocate, reorderMoves, sideLabel, swapMoves,
  type PocketMove,
} from './binderPages'
import { cardsIn, moveCopies, placesOf, pocketLabel, pocketsOf, suggestSpot, type CardFacts, type PlacedCard } from './storagePlaces'
import { PlacePicker } from './StorageTab'

/**
 * A binder one page at a time, as it sits on the shelf: the page's pockets (empty ones dashed), arrows
 * and swiping to turn the page, "Page 3 · Front of sheet 2 · DMU 12–98" over it. Tapping a card shows
 * its pocket, printing and finish with Move; Edit lets pockets be dragged about the page or swapped
 * two at a time (collection/binderPages.ts). [preview]: the binder as a plan would leave it, read
 * only, with the [marked] pockets picked out. The Android app's BinderPagesView.kt.
 */
export function BinderPagesView({ place, collections, data, page, onPage, preview = false, marked }: {
  place: StoragePlace
  collections: Collection[]
  data: Map<string, ScryfallCard> | undefined
  page: number
  onPage: (page: number) => void
  preview?: boolean
  marked?: Set<number>
}) {
  const { changeStorage } = useSync()
  const navigate = useNavigate()
  const pockets = pocketsOf(place)
  const cards = useMemo(() => cardsIn(collections, place.id), [collections, place.id])
  const inUse = useMemo(() => binderPockets(place, cards), [place, cards])
  const byIndex = useMemo(() => new Map(inUse.map((p) => [p.index, p.cards])), [inUse])
  // A page past the last one used is shown too, empty, so cards can be moved onto it.
  const pages = pageCount(place, inUse) + (preview ? 0 : 1)
  const shown = Math.min(Math.max(1, page), pages)
  const { cols } = pageGrid(pockets)
  const first = pocketIndex(shown, 1, pockets)
  const slots = Array.from({ length: pockets }, (_, i) => first + i)
  const facts = factsFrom(data)
  const summary = pageSummary(place.sortRule, slots.flatMap((i) => (byIndex.get(i)?.[0] ? [facts(byIndex.get(i)![0])] : [])))
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState<PlacedCard | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const dragged = useRef(false)

  const apply = (moves: PocketMove[]) => { if (moves.length > 0) changeStorage((c) => relocate(c, place, moves)) }
  const turn = (to: number) => { setSelected(null); onPage(Math.min(Math.max(1, to), pages)) }
  const occupied = new Set(inUse.map((p) => p.index))
  const tapInEdit = (i: number) => {
    if (selected === null) { if (occupied.has(i)) setSelected(i); return }
    apply(swapMoves(selected, i, occupied))
    setSelected(null)
  }
  const pocketUnder = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pocket]')
    return el ? Number(el.dataset.pocket) : null
  }
  const down = (i: number) => (e: ReactPointerEvent) => {
    if (!editing || !occupied.has(i)) return
    drag.current = { from: i, x: e.clientX, y: e.clientY, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true
    if (d.moved) setOver(pocketUnder(e.clientX, e.clientY))
  }
  const up = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    setOver(null)
    if (!d?.moved) return
    // The click that follows a drag isn't a tap.
    dragged.current = true
    const to = pocketUnder(e.clientX, e.clientY)
    // Within the page: dragging is for putting a page in order.
    if (to !== null && to !== d.from && to >= first && to < first + pockets) apply(reorderMoves(d.from, to, occupied))
    setSelected(null)
  }

  const chosen = !editing && selected !== null ? byIndex.get(selected)?.[0] ?? null : null
  const chosenCard = chosen ? data?.get(chosen.entry.scryfallId) : undefined

  return (
    <div className="binder-view">
      {!preview && (
        <div className="binder-edit-row">
          <span className="dim">{editing ? 'Tap two pockets to swap them, or drag a card to another pocket on the page.' : ''}</span>
          <button type="button" className={`pull-chip${editing ? ' on' : ''}`} onClick={() => { setEditing((v) => !v); setSelected(null) }}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      )}
      <div className="binder-nav">
        <button type="button" className="ib round" aria-label="Previous page" disabled={shown <= 1} onClick={() => turn(shown - 1)}><Icon name="chevron_left" /></button>
        <div className="binder-title">
          <span className="pg">Page {shown}</span>
          <span className="sub">{sideLabel(shown)} · {summary}</span>
        </div>
        <button type="button" className="ib round" aria-label="Next page" disabled={shown >= pages} onClick={() => turn(shown + 1)}><Icon name="chevron_right" /></button>
      </div>
      <div
        className={`binder-sheet${editing ? ' editing' : ''}`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        onTouchStart={(e) => { if (!editing) swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
        onTouchEnd={(e) => {
          const s = swipe.current
          swipe.current = null
          if (!s) return
          const dx = e.changedTouches[0].clientX - s.x
          const dy = e.changedTouches[0].clientY - s.y
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? shown + 1 : shown - 1)
        }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { drag.current = null; setOver(null) }}
      >
        {slots.map((i) => {
          const here = byIndex.get(i) ?? []
          const card = here[0]
          const n = here.reduce((s, c) => s + c.line.qty, 0)
          const slot = pocketAt(i, pockets).slot
          const cls = ['binder-pocket', card ? '' : 'empty', selected === i ? 'picked' : '', over === i ? 'over' : '', marked?.has(i) ? 'marked' : ''].filter(Boolean).join(' ')
          return (
            <button
              key={i}
              type="button"
              data-pocket={i}
              className={cls}
              aria-label={card ? `${card.entry.name} — ${pocketLabel(shown, slot)}` : `${pocketLabel(shown, slot)}: empty`}
              disabled={preview || (!card && !(editing && selected !== null))}
              onPointerDown={down(i)}
              onClick={() => {
                if (preview) return
                if (dragged.current) { dragged.current = false; return }
                if (editing) tapInEdit(i)
                else setSelected(selected === i ? null : card ? i : null)
              }}
            >
              {card ? (
                card.entry.imageUrl ? <img src={card.entry.imageUrl} alt="" loading="lazy" draggable={false} /> : <ArtImage src={null} seed={card.entry.name} />
              ) : <span className="empty-word">Empty</span>}
              {card && n > 1 && <span className="n">×{n}</span>}
              <span className="slot">{slot}</span>
            </button>
          )
        })}
      </div>
      {chosen && selected !== null && (
        <div className="binder-chosen">
          <ArtImage className="thumb" src={toArtCrop(chosen.entry.imageUrl)} seed={chosen.entry.name} />
          <button type="button" className="storage-text link-like" onClick={() => navigate(`/card/${encodeURIComponent(chosen.entry.name)}?id=${chosen.entry.scryfallId}`)}>
            <b>{chosen.entry.name}</b>
            <span>{[pocketLabel(shown, pocketAt(selected, pockets).slot), printingLine(chosenCard, !!chosen.line.foil)].filter(Boolean).join(' · ')}</span>
          </button>
          <button type="button" className="btn line" onClick={() => setMoving(chosen)}>Move</button>
        </div>
      )}
      {moving && selected !== null && (
        <MoveDialog
          place={place}
          card={moving}
          from={selected}
          occupied={occupied}
          nameAt={(i) => byIndex.get(i)?.[0]?.entry.name ?? null}
          facts={facts(moving)}
          onDone={(page) => { setMoving(null); setSelected(null); if (page) onPage(page) }}
        />
      )}
    </div>
  )
}

/** Move a card to another pocket of the binder (swapping with what's there) or to another place. */
function MoveDialog({ place, card, from, occupied, nameAt, facts, onDone }: {
  place: StoragePlace; card: PlacedCard; from: number; occupied: Set<number>; nameAt: (i: number) => string | null; facts: CardFacts
  onDone: (page: number | null) => void
}) {
  const { changeStorage, collections } = useSync()
  const pockets = pocketsOf(place)
  const now = pocketAt(from, pockets)
  const [page, setPage] = useState(String(now.page))
  const [slot, setSlot] = useState(String(now.slot))
  const [picking, setPicking] = useState(false)
  const p = Number(page)
  const s = Number(slot)
  const valid = p >= 1 && s >= 1 && s <= pockets
  const to = valid ? pocketIndex(p, s, pockets) : null
  const there = to !== null && to !== from ? nameAt(to) : null
  const moveHere = () => {
    if (to === null || to === from) return onDone(null)
    changeStorage((c) => relocate(c, place, swapMoves(from, to, occupied)))
    onDone(p)
  }
  const toPlace = (id: string) => {
    const target = placesOf(collections).find((x) => x.id === id)
    if (!target) return
    changeStorage((c) => {
      const spot = suggestSpot(target, facts, c).spot
      return c.map((col) => (col.id !== card.collectionId ? col : {
        ...col,
        entries: col.entries.map((e) => (e.scryfallId === card.entry.scryfallId ? moveCopies(e, card.line, spot, card.line.qty).entry : e)),
      }))
    })
    onDone(null)
  }
  if (picking) return <PlacePicker title={`Move ${card.entry.name} to…`} without={place.id} onPick={toPlace} onClose={() => setPicking(false)} />
  return (
    <Dialog
      title={`Move ${card.entry.name}`}
      onDismiss={() => onDone(null)}
      actions={
        <>
          <button type="button" className="btn line" onClick={() => setPicking(true)}>Another place…</button>
          <button type="button" className="btn gold" disabled={!valid} onClick={moveHere}>{there ? 'Swap' : 'Move here'}</button>
        </>
      }
    >
      <p className="muted" style={{ margin: '0 0 10px' }}>Now in {pocketLabel(now.page, now.slot)}. Where to?</p>
      <div className="binder-move-fields">
        <label><span className="field-label">Page</span><input className="input" inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ''))} /></label>
        <label><span className="field-label">Slot</span><input className="input" inputMode="numeric" value={slot} onChange={(e) => setSlot(e.target.value.replace(/\D/g, ''))} /></label>
      </div>
      {!valid && <p className="dim" style={{ marginTop: 8 }}>A page from 1, and a slot from 1 to {pockets}.</p>}
      {there && <p className="dim" style={{ marginTop: 8 }}>{there} is there now — they swap pockets.</p>}
    </Dialog>
  )
}

/** The binder as a list, pocket by pocket, with the cards not in a pocket yet after. */
export function BinderList({ place, cards, onCard }: { place: StoragePlace; cards: PlacedCard[]; onCard: (c: PlacedCard) => void }) {
  const pockets = pocketsOf(place)
  const inUse = binderPockets(place, cards)
  const inPockets = new Set(inUse.flatMap((p) => p.cards))
  const loose = cards.filter((c) => !inPockets.has(c))
  const row = (c: PlacedCard, where: string, key: string) => (
    <button key={key} type="button" className="place-card" onClick={() => onCard(c)}>
      <ArtImage className="thumb" src={toArtCrop(c.entry.imageUrl)} seed={c.entry.name} />
      <span className="nm">{c.entry.name}{c.line.foil ? ' · foil' : ''}{c.line.qty > 1 ? ` ×${c.line.qty}` : ''}</span>
      <span className="q">{where}</span>
    </button>
  )
  return (
    <div className="place-section open">
      <div className="place-cards" style={{ marginTop: 0 }}>
        {inUse.flatMap((p) => p.cards.map((c, j) => {
          const { page, slot } = pocketAt(p.index, pockets)
          return row(c, pocketLabel(page, slot), `${p.index}:${j}`)
        }))}
        {loose.map((c, j) => row(c, 'Not in a pocket yet', `loose:${j}`))}
      </div>
    </div>
  )
}

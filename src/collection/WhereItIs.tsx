// "Where it is" on a card's page: every copy of the card, by where it's physically kept — a place
// (and its section or pocket), a deck box, lent out (a loan each), or no place yet — with "Move a
// copy", "Give it a place", "Lend" (LendPage.tsx) and "History" (CopyHistoryPage.tsx). The logic is whereItIs() in storagePlaces.ts. Mirrors the Android app's WhereItIs.kt
// (ui/detail/WhereItIs.kt).

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import type { ScryfallCard } from '../types/scryfall'
import type { CopyPlace } from '../types/models'
import { PLACE_ICONS, PlacePicker } from './StorageTab'
import { cardFactsOf, moveCopies, placeTree, placesOf, placeUnplaced, suggestSpot, whereItIs, type WhereLine } from './storagePlaces'
import { movedMove, putAwayMove } from './copyHistory'
import { recordMoves } from './copyHistoryStore'
import { sellCountsByName, setForSaleByName } from './selling'
import { noteSelling } from '../social/activity'
import { gradedWhere } from './graded'
import { useMoney } from '../money/currency'
import './storage.css'
import './inventory.css'

const ICONS: Record<WhereLine['kind'], string> = { place: 'inventory_2', deck: 'style', lent: 'handshake', none: 'error' }

export function WhereItIs({ name, card }: { name: string; card: ScryfallCard | null }) {
  const { collections, decks, changeStorage } = useSync()
  const navigate = useNavigate()
  const places = placesOf(collections)
  const { lines, total } = useMemo(() => whereItIs(collections, decks, name), [collections, decks, name])
  const [giving, setGiving] = useState(false)
  const [moving, setMoving] = useState(false)
  const [selling, setSelling] = useState(false)
  const money = useMoney()
  // Graded copies (graded.ts): kept apart from the raw ones, each with its slab and value.
  const graded = useMemo(() => gradedWhere(collections, name), [collections, name])
  if (total === 0 && graded.length === 0) return null
  // Selling (selling.ts) and photos of a copy (copyPhotos.ts): binder copies only.
  const sale = sellCountsByName(collections, name)
  const unplaced = lines.find((l) => l.kind === 'none')?.qty ?? 0
  const placeLines = lines.filter((l): l is Extract<WhereLine, { kind: 'place' }> => l.kind === 'place')

  const give = (placeId: string) => {
    const place = places.find((p) => p.id === placeId)
    if (!place) return
    let moved = 0
    changeStorage((c) => { const out = placeUnplaced(c, name, card?.id ?? null, suggestSpot(place, card ? cardFactsOf(card) : { name }, c).spot, 1); moved = out.moved; return out.collections })
    if (moved > 0) recordMoves([putAwayMove(Date.now(), { name, scryfallId: card?.id }, moved, { id: place.id, name: place.name }, null)])
  }

  return (
    <div className="panel">
      <div className="p-h"><h3>Where it is</h3><span className="dim">{total} {total === 1 ? 'copy' : 'copies'}{graded.length > 0 ? ` · ${graded.length} graded` : ''}</span></div>
      <div className="where-list">
        {lines.map((l, i) => {
          const icon = l.kind === 'place' ? PLACE_ICONS[places.find((p) => p.id === l.placeId)?.kind ?? 'OTHER'] : ICONS[l.kind]
          const go = l.kind === 'place' ? () => navigate(`/collections/place/${l.placeId}`)
            : l.kind === 'deck' ? () => navigate(`/decks/${l.deckId}`)
              : l.kind === 'lent' ? () => navigate('/loans') : null
          const body = (
            <>
              <Icon name={icon} />
              <div className="storage-text"><b>{l.title}</b>{l.detail && <span>{l.detail}</span>}</div>
              <b>×{l.qty}</b>
            </>
          )
          return go
            ? <button key={i} type="button" className="where-row press" onClick={go}>{body}</button>
            : <div key={i} className={`where-row${l.kind === 'none' ? ' none' : ''}`}>{body}</div>
        })}
        {graded.map((g) => (
          <button key={g.id} type="button" className="where-row press" onClick={() => navigate(`/collections/graded?id=${encodeURIComponent(g.id)}`)}>
            <Icon name="verified" />
            <div className="storage-text"><b>{g.title}<span className="graded-tag">Graded</span></b><span>{g.detail}</span></div>
            <b>{g.valueUsd !== null ? money.format(g.valueUsd, true) : '×1'}</b>
          </button>
        ))}
        {places.length > 0 && (placeLines.length > 0 || unplaced > 0) && (
          <div className="where-actions">
            <button type="button" className="btn soft" onClick={() => setMoving(true)}>Move a copy</button>
            <button type="button" className="btn line" disabled={unplaced === 0} onClick={() => setGiving(true)}>Give it a place</button>
          </div>
        )}
        <div className="where-actions">
          <button type="button" className="btn line" disabled={!lines.some((l) => l.kind === 'place' || l.kind === 'deck' || l.kind === 'none')} onClick={() => navigate(`/loans/lend?card=${encodeURIComponent(name)}`)}>
            <Icon name="handshake" aria-hidden />Lend
          </button>
          <button type="button" className="btn line" onClick={() => navigate(`/history?card=${encodeURIComponent(name)}`)}><Icon name="history" aria-hidden />History</button>
        </div>
        <div className="where-actions">
          <button type="button" className="btn line" onClick={() => navigate(`/collections/graded?card=${encodeURIComponent(name)}`)}><Icon name="verified" aria-hidden />Mark a copy as graded</button>
        </div>
        {sale.copies > 0 && (
          <div className="where-actions">
            <button type="button" className="btn line" onClick={() => setSelling(true)}><Icon name="sell" aria-hidden />{sale.toSell > 0 ? `To sell: ${sale.toSell}` : 'Sell…'}</button>
            <button type="button" className="btn line" onClick={() => navigate(`/collections/photos?card=${encodeURIComponent(name)}`)}><Icon name="photo_camera" aria-hidden />Photos</button>
          </div>
        )}
      </div>
      {giving && <PlacePicker title={`Give ${name} a place`} onPick={give} onClose={() => setGiving(false)} />}
      {moving && <MoveCopyDialog name={name} card={card} lines={placeLines} unplaced={unplaced} onDismiss={() => setMoving(false)} />}
      {selling && <SellDialog name={name} copies={sale.copies} toSell={sale.toSell} onDismiss={() => setSelling(false)} />}
    </div>
  )
}

/** Moves copies from one place (or from none) to another place (or to none). */
function MoveCopyDialog({ name, card, lines, unplaced, onDismiss }: {
  name: string; card: ScryfallCard | null; lines: Extract<WhereLine, { kind: 'place' }>[]; unplaced: number; onDismiss: () => void
}) {
  const { collections, changeStorage } = useSync()
  const places = placesOf(collections)
  const sources = [...lines.map((l, i) => ({ key: String(i), label: `${l.title}${l.detail ? ` (${l.detail})` : ''}`, qty: l.qty, line: l as typeof l | null })),
    ...(unplaced > 0 ? [{ key: 'none', label: 'No place yet', qty: unplaced, line: null }] : [])]
  const [from, setFrom] = useState(sources[0]?.key ?? '')
  const [to, setTo] = useState('')
  const [count, setCount] = useState(1)
  const source = sources.find((s) => s.key === from)
  const max = source?.qty ?? 0

  const move = () => {
    if (!source) return
    const target = places.find((p) => p.id === to)
    const from = source.line ? places.find((p) => p.id === source.line!.placeId) : undefined
    recordMoves([movedMove(Date.now(), { name, scryfallId: card?.id }, count, from ? { id: from.id, name: source.line!.title } : null, target ? { id: target.id, name: target.name } : null)])
    changeStorage((c) => {
      const spot = target ? suggestSpot(target, card ? cardFactsOf(card) : { name }, c).spot : null
      if (!source.line) return spot ? placeUnplaced(c, name, card?.id ?? null, spot, count).collections : c
      const { collectionId, scryfallId, line } = source.line
      return c.map((col) => (col.id !== collectionId ? col : {
        ...col,
        entries: col.entries.map((e) => (e.scryfallId === scryfallId ? moveCopies(e, line as CopyPlace, spot, count).entry : e)),
      }))
    })
    onDismiss()
  }

  return (
    <Dialog
      title="Move a copy"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!source || (to === '' && !source.line)} onClick={move}>Move</button>
        </>
      }
    >
      <div className="field-label">From</div>
      <select className="input" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setCount(1) }}>
        {sources.map((s) => <option key={s.key} value={s.key}>{s.label} — {s.qty}</option>)}
      </select>
      <div className="field-label" style={{ marginTop: 12 }}>To</div>
      <select className="input" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">No place</option>
        {placeTree(places).map((n) => <option key={n.place.id} value={n.place.id}>{`${' '.repeat(n.depth)}${n.place.name}`}</option>)}
      </select>
      {max > 1 && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>How many</div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button type="button" className="ib" aria-label="One fewer" disabled={count <= 1} onClick={() => setCount((n) => Math.max(1, n - 1))}><Icon name="remove" /></button>
            <b>{count}</b>
            <button type="button" className="ib" aria-label="One more" disabled={count >= max} onClick={() => setCount((n) => Math.min(max, n + 1))}><Icon name="add" /></button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/** Sell…: how many of the card's copies go on the To sell list (setForSaleByName, selling.ts). */
function SellDialog({ name, copies, toSell, onDismiss }: { name: string; copies: number; toSell: number; onDismiss: () => void }) {
  const { changeStorage } = useSync()
  const [count, setCount] = useState(Math.min(copies, Math.max(1, toSell)))
  return (
    <Dialog
      title={`Sell ${name}`}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" onClick={() => { changeStorage((c) => setForSaleByName(c, name, count)); if (count > 0) noteSelling(); onDismiss() }}>Save</button>
        </>
      }
    >
      <p className="muted" style={{ margin: '0 0 10px' }}>Copies go on the Storage tab's To sell list, with where they are.</p>
      <div className="field-label">Copies to sell</div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="ib" aria-label="One fewer" disabled={count <= 0} onClick={() => setCount((n) => Math.max(0, n - 1))}><Icon name="remove" /></button>
        <b>{count} of {copies}</b>
        <button type="button" className="ib" aria-label="One more" disabled={count >= copies} onClick={() => setCount((n) => Math.min(copies, n + 1))}><Icon name="add" /></button>
      </div>
    </Dialog>
  )
}

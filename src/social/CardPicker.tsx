import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { ArtImage, SearchPill, toArtCrop } from '../components/kit'
import type { CollectionEntry } from '../types/models'
import type { TradeCard } from './api'

/** The same card, finish and binder are one line of a trade. */
export const tradeKey = (c: Pick<TradeCard, 'scryfallId' | 'foil' | 'collectionId'>) => `${c.collectionId ?? ''}:${c.scryfallId}:${c.foil ? 'f' : 'n'}`

/** Sets how many of [card] are in [list] (0 removes it). */
export function withQuantity(list: TradeCard[], card: TradeCard, quantity: number): TradeCard[] {
  const key = tradeKey(card)
  const rest = list.filter((c) => tradeKey(c) !== key)
  if (quantity <= 0) return rest
  const i = list.findIndex((c) => tradeKey(c) === key)
  const next = { ...card, quantity }
  return i === -1 ? [...list, next] : list.map((c) => (tradeKey(c) === key ? next : c))
}

/** A binder's cards, each with a regular and a foil stepper — up to what the binder holds. */
export function BinderPicker({
  collectionId, entries, picked, onChange, emptyText,
}: {
  collectionId: string
  entries: CollectionEntry[]
  picked: TradeCard[]
  onChange: (next: TradeCard[]) => void
  emptyText: string
}) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const shown = entries
    .filter((e) => e.quantity + e.foilQuantity > 0 && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const count = (e: CollectionEntry, foil: boolean) =>
    picked.find((c) => tradeKey(c) === tradeKey({ scryfallId: e.scryfallId, foil, collectionId }))?.quantity ?? 0
  const set = (e: CollectionEntry, foil: boolean, quantity: number) =>
    onChange(withQuantity(picked, { scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, foil, quantity: 0, collectionId }, quantity))

  if (entries.length === 0) return <div className="notice">{emptyText}</div>
  return (
    <>
      {entries.length > 8 && <div style={{ marginBottom: 10 }}><SearchPill value={filter} onChange={setFilter} placeholder="Find a card" /></div>}
      <div className="list">
        {shown.map((e) => (
          <div key={e.scryfallId} className={`pick-row${count(e, false) + count(e, true) > 0 ? ' on' : ''}`}>
            <ArtImage className="thumb" src={toArtCrop(e.imageUrl)} seed={e.name} />
            <div className="cmain">
              <div className="cname">{e.name}</div>
              <div className="pick-steppers">
                {e.quantity > 0 && <MiniStepper label="Regular" max={e.quantity} value={count(e, false)} onChange={(n) => set(e, false, n)} name={e.name} />}
                {e.foilQuantity > 0 && <MiniStepper label="Foil" max={e.foilQuantity} value={count(e, true)} onChange={(n) => set(e, true, n)} name={e.name} foil />}
              </div>
            </div>
          </div>
        ))}
        {shown.length === 0 && <div className="empty-state">Nothing matches “{filter}”.</div>}
      </div>
    </>
  )
}

function MiniStepper({ label, max, value, onChange, name, foil }: { label: string; max: number; value: number; onChange: (n: number) => void; name: string; foil?: boolean }) {
  return (
    <span className={`mini-stepper${value > 0 ? ' on' : ''}`}>
      <span className="ms-label">{foil && <Icon name="auto_awesome" aria-hidden />}{label} <span className="dim">of {max}</span></span>
      <button type="button" disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label={`One fewer ${foil ? 'foil ' : ''}${name}`}>−</button>
      <b aria-live="polite">{value}</b>
      <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`One more ${foil ? 'foil ' : ''}${name}`}>+</button>
    </span>
  )
}

/** The cards on one side of a trade, as a compact list. */
export function TradeCardList({ cards, empty, onRemove }: { cards: TradeCard[]; empty: string; onRemove?: (c: TradeCard) => void }) {
  if (cards.length === 0) return <div className="dim trade-empty">{empty}</div>
  return (
    <div className="trade-cards">
      {cards.map((c) => (
        <div key={tradeKey(c)} className="trade-card">
          <ArtImage className="thumb sm" src={toArtCrop(c.imageUrl)} seed={c.name} />
          <span className="tc-qty">{c.quantity}×</span>
          <span className="tc-name">{c.name}</span>
          {c.foil && <span className="badge gold"><Icon name="auto_awesome" aria-hidden />Foil</span>}
          {onRemove && (
            <button type="button" className="tc-remove" onClick={() => onRemove(c)} aria-label={`Remove ${c.name}`}><Icon name="close" /></button>
          )}
        </div>
      ))}
    </div>
  )
}

/** A full-height sheet for picking cards, with a Done button. */
export function PickerSheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet picker-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        <div className="picker-head">
          <div style={{ minWidth: 0 }}>
            <div className="sheet-title">{title}</div>
            {subtitle && <div className="sheet-sub">{subtitle}</div>}
          </div>
          <button type="button" className="btn gold sm" onClick={onClose}>Done</button>
        </div>
        <div className="picker-body">{children}</div>
      </div>
    </>
  )
}

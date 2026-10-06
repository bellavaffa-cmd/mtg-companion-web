import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney, type Money } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ActionSheet } from '../components/ActionSheet'
import { PageHeader, useBack } from '../components/kit'
import { getSets } from '../api/scryfall'
import { listCommanderPrecons, type PreconInfo } from '../api/mtgjson'
import { importPreconDeck } from '../decks/preconImport'
import { placeTree, placesOf } from '../collection/storagePlaces'
import { loadPiles, loadSort, saveSort } from '../collection/sortSession'
import {
  changeLabel, isPrecon, newSealed, openableBoxes, openablePrecons, openSealed, preconDeckName, removeSealed, saveSealed, sealedChange, sealedLine,
  sealedOf, sealedOptions, sealedTotalUsd, sortForOpened, SEALED_KIND_LABELS, type SealedOption, type SealedSet,
} from '../collection/sealed'
import type { SealedProduct } from '../types/models'
import '../collection/storage.css'
import '../collection/inventory.css'

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`)

/**
 * Sealed product, the Android app's SealedScreen: each box, bundle or precon with how many, where it's
 * kept, what was paid each and what it's worth now each (the value the user entered — there are no
 * prices for sealed product), with the change; the total at the top. "Open a booster box" takes one
 * off and starts sorting a new pile (the scanner's sort mode); "Open the precon" makes it a deck with
 * its list filled in. The logic is collection/sealed.ts. At /collections/sealed.
 */
export function SealedPage() {
  const { collections, changeStorage, createDeckWithCards } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const money = useMoney()
  const list = sealedOf(collections)
  const total = sealedTotalUsd(list)
  const [editing, setEditing] = useState<{ product: SealedProduct; isNew: boolean } | null>(null)
  const [adding, setAdding] = useState(false)
  const [choosing, setChoosing] = useState<'box' | 'precon' | null>(null)
  const [opening, setOpening] = useState<SealedProduct | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const boxes = openableBoxes(list)
  const precons = openablePrecons(list)

  const openBox = (p: SealedProduct) => {
    changeStorage((c) => openSealed(c, p.id).collections)
    saveSort(sortForOpened(loadSort(), p, loadPiles(collections)))
    navigate('/scan?sort')
  }
  const openPrecon = async (p: SealedProduct) => {
    if (!p.preconFile) return
    setBusy(true)
    setMessage(null)
    try {
      const deck = await importPreconDeck(p.preconFile, preconDeckName(p), createDeckWithCards)
      changeStorage((c) => openSealed(c, p.id).collections)
      navigate(`/decks/${deck.id}`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't make the deck.")
    } finally {
      setBusy(false)
      setOpening(null)
    }
  }
  const open = (p: SealedProduct) => (isPrecon(p) && p.preconFile ? void openPrecon(p) : openBox(p))
  const choose = (kind: 'box' | 'precon') => {
    const from = kind === 'box' ? boxes : precons
    if (from.length === 1) setOpening(from[0])
    else setChoosing(kind)
  }

  return (
    <>
      <PageHeader title="Sealed" onBack={back} actions={list.length > 0 ? <span className="sell-total">{money.format(total, true)}</span> : undefined} />
      <div className="content-scroll sealed-page">
        {list.length > 0 && <div className="dim" style={{ fontSize: 12 }}>Values are the ones you entered — there are no prices for sealed product.</div>}
        {message && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gold-light)' }} role="status">{message}</div>}
        {list.length === 0 && (
          <div className="empty-state"><Icon name="inventory_2" /><div>No sealed product yet. Add booster boxes, bundles and precons you keep sealed, with what you paid and what they're worth.</div></div>
        )}
        <div className="sealed-rows">
          {list.map((p) => <SealedRow key={p.id} product={p} money={money} line={sealedLine(p, collections, (usd) => money.format(usd, true))} onClick={() => setEditing({ product: p, isNew: false })} />)}
        </div>
        {list.length > 0 && (
          <section className="sell-list-them">
            <h2>Opening one?</h2>
            <div className="sealed-why">"Open" takes it off the sealed list and starts a pile to sort, so every card lands in the right place. A precon becomes a deck with its list filled in.</div>
            <div className="row">
              <button type="button" className="btn gold" disabled={boxes.length === 0 || busy} onClick={() => choose('box')}>Open a booster box</button>
              <button type="button" className="btn line" disabled={precons.length === 0 || busy} onClick={() => choose('precon')}>{busy ? 'Making the deck…' : 'Open the precon'}</button>
            </div>
          </section>
        )}
      </div>
      <div className="pull-bar">
        <button type="button" className="btn gold" onClick={() => setAdding(true)}>+ Add sealed product</button>
      </div>

      {adding && <AddSealedDialog onDismiss={() => setAdding(false)} onPick={(o) => { setAdding(false); setEditing({ product: newSealed(o, newId(), Date.now()), isNew: true }) }} />}
      {editing && (
        <SealedDialog
          product={editing.product}
          isNew={editing.isNew}
          money={money}
          onDismiss={() => setEditing(null)}
          onSave={(p) => { changeStorage((c) => saveSealed(c, p)); setEditing(null) }}
          onDelete={() => { changeStorage((c) => removeSealed(c, editing.product.id)); setEditing(null) }}
          onOpen={() => { const p = editing.product; setEditing(null); setOpening(p) }}
        />
      )}
      {choosing && (
        <ActionSheet
          title={choosing === 'box' ? 'Open which one?' : 'Open which precon?'}
          actions={(choosing === 'box' ? boxes : precons).map((p) => ({
            label: p.name, icon: 'inventory_2', detail: `×${p.count}`, onClick: () => { setChoosing(null); setOpening(p) },
          }))}
          onClose={() => setChoosing(null)}
        />
      )}
      {opening && (
        <Dialog
          title={`Open ${opening.name}?`}
          onDismiss={() => setOpening(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setOpening(null)}>Cancel</button>
              <button type="button" className="btn gold" disabled={busy} onClick={() => open(opening)}>{busy ? 'Making the deck…' : 'Open it'}</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {isPrecon(opening) && opening.preconFile
              ? 'One comes off the sealed list and becomes a deck with its list filled in.'
              : 'One comes off the sealed list, and the scanner starts a pile to sort: scan each card and it says which pile it goes in.'}
          </p>
        </Dialog>
      )}
    </>
  )
}

/** One product: its name, count, place and price paid, and its value now with the change. */
function SealedRow({ product: p, money, line, onClick }: { product: SealedProduct; money: Money; line: string; onClick: () => void }) {
  const pct = sealedChange(p)
  return (
    <button type="button" className="sealed-row press" onClick={onClick}>
      <span className="sealed-thumb" aria-hidden><Icon name={isPrecon(p) ? 'style' : 'inventory_2'} /></span>
      <span className="what"><b>{p.name}</b><span>{line}</span></span>
      <span className="worth">
        <b>{p.valueUsd !== undefined ? money.format(p.valueUsd, true) : '—'}</b>
        {pct !== null
          ? <span className={pct > 0 ? 'up' : pct < 0 ? 'down' : ''}>{changeLabel(pct)}</span>
          : <span>{p.valueUsd !== undefined ? 'value you entered' : 'Add a value'}</span>}
      </span>
    </button>
  )
}

/** "+ Add sealed product": search Scryfall's sets and MTGJSON's precons, or name your own. */
function AddSealedDialog({ onPick, onDismiss }: { onPick: (o: SealedOption) => void; onDismiss: () => void }) {
  const [query, setQuery] = useState('')
  const [sets, setSets] = useState<SealedSet[]>([])
  const [precons, setPrecons] = useState<PreconInfo[]>([])
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let cancelled = false
    getSets().then((m) => { if (!cancelled) setSets([...m.values()]) }).catch(() => { if (!cancelled) setOffline(true) })
    listCommanderPrecons().then((l) => { if (!cancelled) setPrecons(l) }).catch(() => { if (!cancelled) setOffline(true) })
    return () => { cancelled = true }
  }, [])
  const options = useMemo(() => sealedOptions(query, sets, precons), [query, sets, precons])
  return (
    <Dialog title="Add sealed product" onDismiss={onDismiss} actions={<button type="button" className="btn line" onClick={onDismiss}>Cancel</button>}>
      <input className="input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Set or product name (Duskmourn, Blame Game)" aria-label="Set or product name" />
      {offline && <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Couldn't reach the set list — you can still add a product by name.</div>}
      <div className="sealed-options">
        {options.map((o) => (
          <button key={o.key} type="button" className="sealed-option press" onClick={() => onPick(o)}>
            <b>{o.kind === 'OTHER' ? `“${o.name}”` : o.name}</b><span>{o.detail}</span>
          </button>
        ))}
        {query.trim() === '' && <div className="dim" style={{ fontSize: 13 }}>Booster boxes, collector boxes, bundles and precons by their set; anything else by name.</div>}
      </div>
    </Dialog>
  )
}

/** A product's details: name, how many, where, paid each, value now each — and Open one, Delete. */
function SealedDialog({ product, isNew, money, onSave, onDelete, onOpen, onDismiss }: {
  product: SealedProduct; isNew: boolean; money: Money; onSave: (p: SealedProduct) => void; onDelete: () => void; onOpen: () => void; onDismiss: () => void
}) {
  const { collections } = useSync()
  const places = placesOf(collections)
  const local = (usd: number | undefined) => (usd === undefined ? '' : String(Math.round(money.toLocal(usd) * 100) / 100))
  const [name, setName] = useState(product.name)
  const [count, setCount] = useState(Math.max(1, product.count))
  const [placeId, setPlaceId] = useState(product.placeId ?? '')
  const [paid, setPaid] = useState(local(product.paidUsd))
  const [value, setValue] = useState(local(product.valueUsd))
  const usd = (text: string) => { const n = Number(text.replace(',', '.')); return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? money.toUsd(n) : undefined }
  const valueUsd = usd(value)
  const save = () => {
    const changed = valueUsd === undefined ? undefined : Math.round(valueUsd * 100) !== Math.round((product.valueUsd ?? -1) * 100)
    onSave({
      ...product, name: name.trim() || product.name, count, placeId: placeId || undefined, paidUsd: usd(paid), valueUsd,
      valueAt: valueUsd === undefined ? undefined : changed ? Date.now() : product.valueAt ?? Date.now(),
    })
  }
  return (
    <Dialog
      title={isNew ? 'Add sealed product' : product.name}
      onDismiss={onDismiss}
      actions={
        <>
          {!isNew && <button type="button" className="btn line" onClick={onDelete}>Delete</button>}
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!name.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <div className="field-label">Name</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{SEALED_KIND_LABELS[product.kind]}</div>
      <div className="field-label" style={{ marginTop: 12 }}>How many</div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="ib" aria-label="One fewer" disabled={count <= 1} onClick={() => setCount((n) => Math.max(1, n - 1))}><Icon name="remove" /></button>
        <b>{count}</b>
        <button type="button" className="ib" aria-label="One more" onClick={() => setCount((n) => n + 1)}><Icon name="add" /></button>
      </div>
      <div className="field-label" style={{ marginTop: 12 }}>Where</div>
      <select className="input" aria-label="Where" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
        <option value="">No place yet</option>
        {placeTree(places).map((n) => <option key={n.place.id} value={n.place.id}>{`${' '.repeat(n.depth)}${n.place.name}`}</option>)}
      </select>
      <div className="field-label" style={{ marginTop: 12 }}>Paid, each ({money.currency.code})</div>
      <input className="input" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} aria-label="Paid, each" placeholder="What one cost" />
      <div className="field-label" style={{ marginTop: 12 }}>Worth now, each ({money.currency.code})</div>
      <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Worth now, each" placeholder="What one sells for now" />
      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
        The value you entered{product.valueAt && !isNew ? `, on ${new Date(product.valueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''} — there are no prices for sealed product, so update it now and then.
      </div>
      {!isNew && (
        <button type="button" className="btn soft" style={{ marginTop: 14, width: '100%' }} onClick={onOpen}>
          {isPrecon(product) && product.preconFile ? 'Open the precon' : 'Open one'}
        </button>
      )}
    </Dialog>
  )
}

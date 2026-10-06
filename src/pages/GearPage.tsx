import { useMemo, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { EmptyState } from '../components/EmptyState'
import {
  deleteGear, GEAR_KIND_LABELS, GEAR_KINDS, gearOf, gearRows, saveGear, type GearRow,
} from '../collection/gear'
import { placesOf } from '../collection/storagePlaces'
import { DeckNeedsLine } from '../collection/DeckNeedsLine'
import type { Deck, GearItem, GearKind } from '../types/models'
import '../collection/storage.css'
import '../collection/bag.css'

/**
 * Gear, the Android app's GearScreen (the Gear mockup): sleeves with how many are left and which decks
 * and binders use them ("running low" when a deck using them needs more), inner sleeves, deck boxes and
 * what each holds, tokens by name and where they're kept, dice, playmats and the rest; "This deck
 * needs" for a deck; "+ Add gear". The logic is collection/gear.ts; the gear syncs on the Unsorted
 * pile. At /collections/gear.
 */
export function GearPage() {
  const back = useBack('/collections?tab=storage')
  const { collections, decks } = useSync()
  const gear = gearOf(collections)
  const rows = useMemo(() => gearRows(gear, decks, collections), [gear, decks, collections])
  const [editing, setEditing] = useState<GearItem | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const shown = decks.filter((d) => !d.archived && !d.sample && d.ownership !== 'VIRTUAL')
  const [deckId, setDeckId] = useState<string>('')
  const deck = shown.find((d) => d.id === deckId) ?? shown[0]

  const tap = (row: GearRow) => {
    if (row.items.length === 1 && row.key === row.items[0].id) setEditing(row.items[0])
    else setOpen(open === row.key ? null : row.key)
  }

  return (
    <>
      <PageHeader title="Gear" onBack={back} />
      <div className="content-scroll pull-page bag-page">
        <div className="storage-list">
          {rows.length === 0 && (
            <EmptyState icon="style" text="Sleeves, deck boxes, tokens, dice and playmats: say what you have, and decks say what they still need." />
          )}
          {rows.map((row) => (
            <div key={row.key} className="storage-card">
              <button type="button" className="storage-row press" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }} onClick={() => tap(row)}>
                <div className="gear-row-h"><span>{row.title}</span><span className={row.warn ? 'warn' : ''}>{row.value}</span></div>
                <div className="gear-row-line">{row.line}</div>
              </button>
              {open === row.key && row.items.map((g) => (
                <button key={g.id} type="button" className="storage-row storage-sub press" onClick={() => setEditing(g)}>
                  <div className="storage-text"><b>{g.name}</b></div>
                  <span className="storage-n">{g.kind === 'DECK_BOX' ? '' : `×${g.count}`}</span>
                  <Icon name="edit" aria-hidden />
                </button>
              ))}
            </div>
          ))}
          {deck && <DeckNeedsCard deck={deck} decks={shown} onPick={setDeckId} />}
        </div>
      </div>
      <div className="bag-bar">
        <button type="button" className="btn gold bag-all" onClick={() => setEditing('new')}>+ Add gear</button>
      </div>
      {editing && <GearDialog item={editing === 'new' ? null : editing} onDismiss={() => setEditing(null)} />}
    </>
  )
}

/** "This deck needs": one deck's sleeves, deck box and tokens, with a picker for the deck. */
function DeckNeedsCard({ deck, decks, onPick }: { deck: Deck; decks: Deck[]; onPick: (id: string) => void }) {
  return (
    <section className="storage-card gear-needs" style={{ marginTop: 6 }}>
      <h2>This deck needs</h2>
      <select className="input" aria-label="Deck" value={deck.id} onChange={(e) => onPick(e.target.value)}>
        {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <DeckNeedsLine deck={deck} />
    </section>
  )
}

/** Add a piece of gear, or change one: what it is, its name, how many, what it's on or holds, where it's kept. */
function GearDialog({ item, onDismiss }: { item: GearItem | null; onDismiss: () => void }) {
  const { collections, decks, changeStorage } = useSync()
  const places = placesOf(collections)
  const [kind, setKind] = useState<GearKind>(item?.kind ?? 'SLEEVES')
  const [name, setName] = useState(item?.name ?? '')
  const [count, setCount] = useState(String(item?.count ?? (item ? 0 : 100)))
  const [usedBy, setUsedBy] = useState<string[]>(item?.usedBy ?? [])
  const [holds, setHolds] = useState(item?.holds ?? '')
  const [placeId, setPlaceId] = useState(item?.placeId ?? '')
  const live = decks.filter((d) => !d.archived && !d.sample)
  const binders = places.filter((p) => p.kind === 'BINDER')
  const sleeves = kind === 'SLEEVES' || kind === 'INNER_SLEEVES'
  const flip = (id: string) => setUsedBy(usedBy.includes(id) ? usedBy.filter((x) => x !== id) : [...usedBy, id])
  const label = name.trim() || (kind === 'DECK_BOX' ? '' : GEAR_KIND_LABELS[kind])

  const save = () => {
    if (!label) return
    changeStorage((c) => saveGear(c, {
      id: item?.id ?? crypto.randomUUID(),
      kind,
      name: label,
      count: kind === 'DECK_BOX' ? 1 : Math.max(0, Number(count) || 0),
      ...(sleeves && usedBy.length > 0 ? { usedBy } : {}),
      ...(kind === 'DECK_BOX' && holds ? { holds } : {}),
      ...(!sleeves && kind !== 'DECK_BOX' && placeId ? { placeId } : {}),
      ...(item?.note ? { note: item.note } : {}),
      createdAt: item?.createdAt ?? Date.now(),
    }))
    onDismiss()
  }

  return (
    <Dialog
      title={item ? 'Change gear' : 'Add gear'}
      onDismiss={onDismiss}
      actions={<>
        {item && <button type="button" className="btn line" onClick={() => { changeStorage((c) => deleteGear(c, item.id)); onDismiss() }}>Delete</button>}
        <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
        <button type="button" className="btn gold" disabled={!label} onClick={save}>{item ? 'Save' : 'Add'}</button>
      </>}
    >
      <div className="field-label">What it is</div>
      <div className="chips wrap">
        {GEAR_KINDS.map((k) => <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{GEAR_KIND_LABELS[k]}</button>)}
      </div>
      <div className="field-label" style={{ marginTop: 12 }}>{kind === 'TOKENS' ? 'Token' : kind === 'DECK_BOX' ? 'Deck box' : 'Name'}</div>
      <input
        className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus
        placeholder={kind === 'TOKENS' ? 'Goblin' : kind === 'DECK_BOX' ? 'Red' : kind === 'SLEEVES' ? 'Black matte sleeves' : GEAR_KIND_LABELS[kind]}
      />
      {kind !== 'DECK_BOX' && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>{sleeves ? 'How many left' : 'How many'}</div>
          <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
        </>
      )}
      {sleeves && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>{kind === 'INNER_SLEEVES' ? 'Double-sleeving' : 'On'}</div>
          <div className="chips wrap">
            {live.map((d) => <button key={d.id} type="button" className="chip" aria-pressed={usedBy.includes(d.id)} onClick={() => flip(d.id)}>{d.name}</button>)}
            {binders.map((p) => <button key={p.id} type="button" className="chip" aria-pressed={usedBy.includes(p.id)} onClick={() => flip(p.id)}>{p.name}</button>)}
          </div>
        </>
      )}
      {kind === 'DECK_BOX' && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>Holds</div>
          <select className="input" aria-label="Holds" value={holds} onChange={(e) => setHolds(e.target.value)}>
            <option value="">Nothing — it's empty</option>
            {live.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </>
      )}
      {!sleeves && kind !== 'DECK_BOX' && places.length > 0 && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>Kept in</div>
          <select className="input" aria-label="Kept in" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            <option value="">Not said</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}
    </Dialog>
  )
}

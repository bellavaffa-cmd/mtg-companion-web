// The Collection's Storage tab: how much of the collection has a place, the places themselves as a
// tree with their copies, the deck boxes and the copies lent out (the Loans page), Sort a new pile and
// Value by place — and the dialogs to make, change and pick a place. The logic is in storagePlaces.ts. Mirrors the Android app's StorageTab.kt
// (ui/collection/StorageTab.kt).

import { countAction } from '../usage/usage'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { Dialog } from '../components/Dialog'
import { ActionSheet } from '../components/ActionSheet'
import { rise } from '../components/kit'
import type { PlaceKind, SortRule, StoragePlace } from '../types/models'
import {
  canMoveInto, childrenOf, copiesWithin, defaultSections, DEFAULT_POCKETS, PLACE_KIND_LABELS, PLACE_KINDS, placeAndInside, placeSubtitle,
  placeTree, placesOf, savePlace, SORT_RULE_LABELS, SORT_RULES, storageSummary, type StorageSummary,
} from './storagePlaces'
import { useUpkeep } from './useUpkeep'
import './storage.css'

export const PLACE_ICONS: Record<PlaceKind, string> = { BOX: 'inventory_2', BINDER: 'menu_book', DECK_BOX: 'style', SHELF: 'shelves', OTHER: 'category' }

const count = (n: number) => n.toLocaleString('en-GB')

export function StorageTab() {
  const { collections, decks } = useSync()
  const navigate = useNavigate()
  const places = placesOf(collections)
  const summary = useMemo(() => storageSummary(collections, decks), [collections, decks])
  const [editing, setEditing] = useState<StoragePlace | 'new' | null>(null)
  const [choosing, setChoosing] = useState(false)
  const share = summary.total > 0 ? summary.placed / summary.total : 0
  const putAway = () => (places.length === 0 ? navigate('/collections/setup') : setChoosing(true))
  const upkeep = useUpkeep()

  return (
    <>
      <div className="storage-progress rise" style={rise(1)}>
        <div className="storage-progress-h">{count(summary.placed)} of {count(summary.total)} {summary.total === 1 ? 'copy has' : 'copies have'} a place</div>
        <div className="storage-bar"><div style={{ width: `${Math.round(share * 100)}%` }} /></div>
        {summary.unplaced > 0 && (
          <button type="button" className="link storage-progress-link" onClick={putAway}>
            {count(summary.unplaced)} without a place · Put them away
          </button>
        )}
      </div>

      <div className="storage-head rise" style={rise(2)}>
        <h2>Your places</h2>
        <button type="button" className="btn soft" onClick={() => setEditing('new')}><Icon name="add" aria-hidden />New place</button>
      </div>

      <div className="storage-list">
        {places.length === 0 && (
          <EmptyState
            className="rise"
            style={rise(3)}
            icon="shelves"
            text="No places yet. Say roughly what you keep your cards in — binders, boxes, a shelf — and the app makes the places, their labels, and keeps track of where each copy is."
            actions={[
              { label: 'Get started', icon: 'inventory_2', onClick: () => navigate('/collections/setup') },
              { label: 'New place', icon: 'add', onClick: () => setEditing('new') },
            ]}
          />
        )}
        {childrenOf(places, null).map((top, i) => (
          <PlaceGroup key={top.id} top={top} places={places} summary={summary} index={i} onOpen={(id) => navigate(`/collections/place/${id}`)} />
        ))}
        <button type="button" className="storage-row storage-card press rise" style={rise(4)} onClick={() => navigate('/decks')}>
          <Icon name="style" className="storage-icon" />
          <div className="storage-text"><b>Deck boxes</b><span>Your physical decks, kept up to date</span></div>
          <span className="storage-n">{count(summary.inDecks)}</span>
        </button>
        <button type="button" className="storage-row storage-card press rise" style={rise(5)} onClick={() => navigate('/loans')}>
          <Icon name="handshake" className="storage-icon" />
          <div className="storage-text"><b>Lent out</b><span>Your loans, and what friends lent you</span></div>
          <span className="storage-n">{count(summary.lent)}</span>
        </button>
        <div className="place-actions rise" style={rise(6)}>
          <button type="button" className={upkeep.items.length > 0 ? 'btn soft' : 'btn line'} onClick={() => navigate('/collections/upkeep')}>
            <Icon name="task_alt" aria-hidden />Upkeep{upkeep.items.length > 0 && <span className="badge-n">{upkeep.items.length}</span>}
          </button>
          <button type="button" className="btn line" onClick={() => navigate('/collections/setup')}><Icon name="inventory_2" aria-hidden />Set up storage</button>
        </div>
        <div className="place-actions rise" style={rise(6)}>
          <button type="button" className="btn line" onClick={() => navigate('/scan?sort')}><Icon name="call_split" aria-hidden />Sort a new pile</button>
          <button type="button" className="btn line" onClick={() => navigate('/collections/value')}><Icon name="payments" aria-hidden />Value by place</button>
        </div>
        <div className="place-actions rise" style={rise(6)}>
          <button type="button" className="btn line" onClick={() => navigate('/collections/space')}><Icon name="inventory_2" aria-hidden />Space</button>
          <button type="button" className="btn line" onClick={() => navigate('/collections/sell')}><Icon name="sell" aria-hidden />To sell</button>
        </div>
      </div>

      {editing && <PlaceDialog place={editing === 'new' ? null : editing} onDismiss={() => setEditing(null)} />}
      {choosing && (
        <PlacePicker
          title="Put cards away into…"
          onPick={(id) => navigate(`/scan?putAway=${encodeURIComponent(id)}`)}
          onClose={() => setChoosing(false)}
        />
      )}
    </>
  )
}

/** A top-level place as a card, with every place inside it beneath. */
function PlaceGroup({ top, places, summary, index, onOpen }: {
  top: StoragePlace; places: StoragePlace[]; summary: StorageSummary; index: number; onOpen: (id: string) => void
}) {
  const within = placeAndInside(places, top.id)
  const inside = placeTree(places).filter((n) => n.place.id !== top.id && within.has(n.place.id))
  const kids = childrenOf(places, top.id).length
  return (
    <div className="storage-card rise" style={rise(Math.min(index, 6) + 3)}>
      <button type="button" className="storage-row press" onClick={() => onOpen(top.id)}>
        <Icon name={PLACE_ICONS[top.kind]} className="storage-icon" />
        <div className="storage-text"><b>{top.name}</b>{kids === 0 && <span>{placeSubtitle(top)}</span>}</div>
        <span className="storage-n">{kids > 0 ? `${kids} ${kids === 1 ? 'place' : 'places'}` : count(copiesWithin(summary, places, top.id))}</span>
      </button>
      {inside.map((n) => (
        <button key={n.place.id} type="button" className="storage-row storage-sub press" style={{ marginLeft: 24 * n.depth }} onClick={() => onOpen(n.place.id)}>
          <Icon name={PLACE_ICONS[n.place.kind]} className="storage-icon gold" />
          <div className="storage-text"><b>{n.place.name}</b><span>{placeSubtitle(n.place)}</span></div>
          <span className="storage-n">{count(copiesWithin(summary, places, n.place.id))}</span>
        </button>
      ))}
    </div>
  )
}

/** Pick a place: every place, in tree order. */
export function PlacePicker({ title, onPick, onClose, without }: { title: string; onPick: (id: string) => void; onClose: () => void; without?: string }) {
  const { collections } = useSync()
  const places = placesOf(collections)
  return (
    <ActionSheet
      title={title}
      actions={placeTree(places).filter((n) => n.place.id !== without).map((n) => ({
        label: `${'  '.repeat(n.depth)}${n.place.name}`,
        icon: PLACE_ICONS[n.place.kind],
        detail: placeSubtitle(n.place),
        onClick: () => { onClose(); onPick(n.place.id) },
      }))}
      onClose={onClose}
    />
  )
}

/** Make a place, or change one: its name, what it is, where it sits and how it's organised. */
export function PlaceDialog({ place, parentId, onDismiss, onSaved }: {
  place: StoragePlace | null; parentId?: string; onDismiss: () => void; onSaved?: (id: string) => void
}) {
  const { collections, changeStorage } = useSync()
  const places = placesOf(collections)
  const [name, setName] = useState(place?.name ?? '')
  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? 'BOX')
  const [parent, setParent] = useState(place?.parentId ?? parentId ?? '')
  const [note, setNote] = useState(place?.note ?? '')
  const [pockets, setPockets] = useState(String(place?.pocketsPerPage ?? DEFAULT_POCKETS))
  const [rule, setRule] = useState<SortRule | ''>(place?.sortRule ?? '')
  const [sections, setSections] = useState((place?.sections ?? []).join(', '))
  const parents = placeTree(places).filter((n) => !place || canMoveInto(places, place.id, n.place.id))

  const save = () => {
    if (!name.trim()) return
    const id = place?.id ?? crypto.randomUUID()
    const list = sections.split(',').map((s) => s.trim()).filter(Boolean)
    const next: StoragePlace = {
      id,
      name: name.trim(),
      kind,
      ...(parent ? { parentId: parent } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(kind === 'BOX' && list.length > 0 ? { sections: list } : {}),
      ...(kind === 'BINDER' && Number(pockets) > 0 && Number(pockets) !== DEFAULT_POCKETS ? { pocketsPerPage: Math.round(Number(pockets)) } : {}),
      // A box's sorting rule, or a binder's order (collection/binderPages.ts).
      ...((kind === 'BOX' || kind === 'BINDER') && rule ? { sortRule: rule } : {}),
      createdAt: place?.createdAt ?? Date.now(),
      // When it was last checked (collection/placeCheck.ts) isn't changed here, nor its size (Change size, boxSpace.ts).
      ...(place?.lastChecked ? { lastChecked: place.lastChecked } : {}),
      ...(place?.capacity !== undefined ? { capacity: place.capacity } : {}),
      ...(place?.pages !== undefined ? { pages: place.pages } : {}),
    }
    changeStorage((c) => savePlace(c, next))
    if (!place) countAction('place_created')
    onSaved?.(id)
    onDismiss()
  }

  return (
    <Dialog
      title={place ? 'Change place' : 'New place'}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!name.trim()} onClick={save}>{place ? 'Save' : 'Make place'}</button>
        </>
      }
    >
      <div className="field-label">Name</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Red box" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
      <div className="field-label" style={{ marginTop: 12 }}>What it is</div>
      <div className="chips wrap">
        {PLACE_KINDS.map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            <Icon name={PLACE_ICONS[k]} aria-hidden />{PLACE_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="field-label" style={{ marginTop: 12 }}>Inside</div>
      <select className="input" aria-label="Inside" value={parent} onChange={(e) => setParent(e.target.value)}>
        <option value="">Nothing — it stands on its own</option>
        {parents.map((n) => <option key={n.place.id} value={n.place.id}>{`${' '.repeat(n.depth)}${n.place.name}`}</option>)}
      </select>
      <div className="field-label" style={{ marginTop: 12 }}>Note</div>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bulk, trade fodder…" />
      {kind === 'BINDER' && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>Pockets per page</div>
          <input className="input" inputMode="numeric" value={pockets} onChange={(e) => setPockets(e.target.value.replace(/\D/g, ''))} />
          <div className="field-label" style={{ marginTop: 12 }}>In order</div>
          <select className="input" aria-label="In order" value={rule} onChange={(e) => setRule(e.target.value as SortRule | '')}>
            <option value="">No order — new cards go in the next free pocket</option>
            {SORT_RULES.map((r) => <option key={r} value={r}>{SORT_RULE_LABELS[r]}</option>)}
          </select>
          <div className="dim" style={{ marginTop: 6 }}>With an order, Add cards in order says where new cards go and what to shift.</div>
        </>
      )}
      {kind === 'BOX' && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>Sorted</div>
          <select
            className="input"
            aria-label="Sorted"
            value={rule}
            onChange={(e) => {
              const next = e.target.value as SortRule | ''
              setRule(next)
              if (!sections.trim() && next) setSections(defaultSections(next).join(', '))
            }}
          >
            <option value="">Not sorted</option>
            {SORT_RULES.map((r) => <option key={r} value={r}>{SORT_RULE_LABELS[r]}</option>)}
          </select>
          <div className="field-label" style={{ marginTop: 12 }}>Sections</div>
          <input className="input" value={sections} onChange={(e) => setSections(e.target.value)} placeholder="White, Blue, Black…" />
          <div className="dim" style={{ marginTop: 6 }}>In order, with commas between. Cards put away go in the section the rule gives them.</div>
        </>
      )}
    </Dialog>
  )
}

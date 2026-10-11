// The Collection's Storage tab: Put cards away (and the other storage tools under More), the places
// themselves as a tree with their copies and the binders using them, then deck boxes, sealed, graded,
// lent out and gear, and how much of the collection has a place — and the dialogs to make, change and
// pick a place. The logic is in storagePlaces.ts. Mirrors the Android app's StorageTab.kt
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
  canMoveInto, cardsByPlace, childrenOf, copiesWithin, DEFAULT_POCKETS, PLACE_KIND_LABELS, PLACE_KINDS, placeAndInside, placeSubtitle,
  placeTree, placesOf, savePlace, SORT_RULE_LABELS, SORT_RULES, storageSummary, type PlacedCard, type StorageSummary,
} from './storagePlaces'
import { useUpkeep } from './useUpkeep'
import { sealedOf, sealedTotalUsd } from './sealed'
import { useMoney } from '../money/currency'
import { gearOf, gearSummary } from './gear'
import { gradedOf } from './graded'
import { bindersByPlace, bindersIn, inBindersLine } from './collectionLayout'
import { CardsFilterControls, CopyGroups } from './CardsFilterControls'
import { useStorageFilterFacts } from './useStorageFilterFacts'
import { cardsFilterActive, filterCopies, filterTotals, NO_CARDS_FILTER, placedCopyUsd, storageMatchingTitle, totalsLine, type CardsFilter } from './placeFilter'
import { copiesByPlace, walkPullList } from './pullList'
import { startWalk } from './walkSession'
import { holdsMap, overlapLine, overlaps, placeOrderOf, placeRules, ruleSections, withRules, type Holds } from './storageRules'
import type { SplitLevel } from './sortRecipes'
import { HoldsDialog, RuleOrderDialog, RulesFields } from './StorageRulesUi'
import { ruleCardsOf } from './storageRulesView'
import './storage.css'

export const PLACE_ICONS: Record<PlaceKind, string> = { BOX: 'inventory_2', BINDER: 'menu_book', DECK_BOX: 'style', SHELF: 'shelves', OTHER: 'category' }

const count = (n: number) => n.toLocaleString('en-GB')

const NO_COPIES: PlacedCard[] = []

export function StorageTab({ query = '', onSearchEverywhere, filter = NO_CARDS_FILTER, onFilterChange, filterOpen = false }: {
  query?: string
  onSearchEverywhere?: () => void
  /** The Storage tab's own filters (the header's filter button), with the header's search: also finds the cards in storage. */
  filter?: CardsFilter
  onFilterChange?: (f: CardsFilter) => void
  filterOpen?: boolean
} = {}) {
  const { collections, decks } = useSync()
  const navigate = useNavigate()
  const places = placesOf(collections)
  const summary = useMemo(() => storageSummary(collections, decks), [collections, decks])
  const byPlace = useMemo(() => bindersByPlace(collections), [collections])
  const [editing, setEditing] = useState<StoragePlace | 'new' | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [more, setMore] = useState(false)
  const [ruleOrder, setRuleOrder] = useState(false)
  const share = summary.total > 0 ? summary.placed / summary.total : 0
  const putAway = () => (places.length === 0 ? navigate('/collections/setup') : setChoosing(true))
  const upkeep = useUpkeep()
  const money = useMoney()
  const sealed = sealedOf(collections)
  const graded = gradedOf(collections)
  const gradedUsd = graded.reduce((n, g) => n + (g.valueUsd ?? 0), 0)
  const gearLine = useMemo(() => gearSummary(gearOf(collections), decks), [collections, decks])
  const q = query.trim()
  // The header's search and the filters, over every copy in storage: "Cards in storage matching …".
  const searching: CardsFilter = { ...filter, query }
  const matchingOn = cardsFilterActive(searching)
  const known = useMemo(() => new Set(placesOf(collections).map((p) => p.id)), [collections])
  const stored = useMemo(() => [...cardsByPlace(collections).values()].flat().filter((c) => known.has(c.line.placeId)), [collections, known])
  const { facts, data } = useStorageFilterFacts(matchingOn || filterOpen ? stored : NO_COPIES, q !== '' || !!filter.basic.untagged)
  const matching = useMemo(() => (matchingOn ? filterCopies(stored, searching, facts) : NO_COPIES),
    // searching is filter with the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchingOn, stored, filter, query, facts])
  const usdOf = (c: PlacedCard) => {
    const card = data?.get(c.entry.scryfallId)
    const n = (v: string | null | undefined) => (v ? Number(v) || null : null)
    return placedCopyUsd(c, n(card?.prices?.usd), n(card?.prices?.usd_foil))
  }
  const walk = () => {
    startWalk(storageMatchingTitle(searching).replace('Cards in storage matching ', 'Storage · '), walkPullList(matching, places))
    navigate('/collections/walk')
  }
  const found = q ? placeTree(places).filter((n) => n.place.name.toLowerCase().includes(q.toLowerCase())) : []
  // A place's line: what it is, and the binders with copies in it ("in 2 binders").
  const detail = (p: StoragePlace, withSubtitle: boolean) =>
    [withSubtitle ? placeSubtitle(p) : '', inBindersLine(bindersIn(byPlace, places, p.id))].filter(Boolean).join(' · ')

  return (
    <>
      {/* Put cards away, and the rest of storage's tools behind More. */}
      <div className="storage-actions rise" style={rise(1)}>
        <button type="button" className="btn gold storage-putaway" onClick={putAway}>
          <Icon name="qr_code_scanner" aria-hidden />Put cards away{summary.unplaced > 0 && ` · ${count(summary.unplaced)}`}
        </button>
        <button type="button" className="ib" aria-label="More storage tools" aria-haspopup="dialog" onClick={() => setMore(true)}><Icon name="more_vert" /></button>
      </div>

      {onFilterChange && (
        <CardsFilterControls
          filter={filter}
          onChange={(f) => onFilterChange({ ...f, query: '' })}
          open={filterOpen}
          countFor={(f) => filterCopies(stored, { ...f, query }, facts).reduce((n, c) => n + c.line.qty, 0)}
          data={data}
        />
      )}
      {matchingOn && places.length > 0 && (
        <section className="storage-matches" aria-label="Cards in storage">
          <h2>{storageMatchingTitle(searching)}</h2>
          <div className="filter-line">
            <b>{totalsLine(filterTotals(stored, matching, data ? usdOf : null), (usd) => money.format(usd, true))}</b>
            {matching.length > 0 && <button type="button" className="btn soft sm" onClick={walk}><Icon name="checklist" aria-hidden />Walk this list</button>}
          </div>
          {matching.length === 0
            ? <div className="dim" style={{ marginTop: 8 }}>No cards in your places match.</div>
            : <CopyGroups groups={copiesByPlace(matching, places)} places={places} />}
        </section>
      )}

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
        {q ? (
          <>
            {found.length === 0 && places.length > 0 && <div className="dim">No places match “{q}”.</div>}
            {found.map((n) => (
              <button key={n.place.id} type="button" className="storage-row storage-card press" onClick={() => navigate(`/collections/place/${n.place.id}`)}>
                <Icon name={PLACE_ICONS[n.place.kind]} className={`storage-icon${n.depth > 0 ? ' gold' : ''}`} />
                <div className="storage-text"><b>{n.place.name}</b><span>{detail(n.place, true)}</span></div>
                <span className="storage-n">{count(copiesWithin(summary, places, n.place.id))}</span>
              </button>
            ))}
            {onSearchEverywhere && <SearchEverywhereRow query={q} onClick={onSearchEverywhere} />}
          </>
        ) : (
          <>
            {childrenOf(places, null).map((top, i) => (
              <PlaceGroup key={top.id} top={top} places={places} summary={summary} index={i} detail={detail} onOpen={(id) => navigate(`/collections/place/${id}`)} />
            ))}
            <button type="button" className="storage-row storage-card press rise" style={rise(4)} onClick={() => navigate('/decks')}>
              <Icon name="style" className="storage-icon" />
              <div className="storage-text"><b>Deck boxes</b><span>Your physical decks, kept up to date</span></div>
              <span className="storage-n">{count(summary.inDecks)}</span>
            </button>
            <button type="button" className="storage-row storage-card press rise" style={rise(5)} onClick={() => navigate('/collections/sealed')}>
              <Icon name="inventory_2" className="storage-icon" />
              <div className="storage-text"><b>Sealed</b><span>{sealed.length > 0 ? `${count(sealed.reduce((n, p) => n + p.count, 0))} sealed · ${money.format(sealedTotalUsd(sealed), true)}` : 'Booster boxes, bundles and precons'}</span></div>
              <span className="storage-n">{count(sealed.reduce((n, p) => n + p.count, 0))}</span>
            </button>
            <button type="button" className="storage-row storage-card press rise" style={rise(5)} onClick={() => navigate('/collections/graded-list')}>
              <Icon name="verified" className="storage-icon" />
              <div className="storage-text">
                <b>Graded</b>
                <span>{graded.length > 0 ? `${count(graded.length)} ${graded.length === 1 ? 'slab' : 'slabs'}${gradedUsd > 0 ? ` · ${money.format(gradedUsd, true)}` : ''}` : 'Slabs from PSA, BGS, CGC — mark one from a card\'s page'}</span>
              </div>
              <span className="storage-n">{count(graded.length)}</span>
            </button>
            <button type="button" className="storage-row storage-card press rise" style={rise(5)} onClick={() => navigate('/loans')}>
              <Icon name="handshake" className="storage-icon" />
              <div className="storage-text"><b>Lent out</b><span>Your loans, and what friends lent you</span></div>
              <span className="storage-n">{count(summary.lent)}</span>
            </button>
            <button type="button" className="storage-row storage-card press rise" style={rise(5)} onClick={() => navigate('/collections/gear')}>
              <Icon name="backpack" className="storage-icon" />
              <div className="storage-text"><b>Gear</b><span>{gearLine}</span></div>
              <Icon name="chevron_right" aria-hidden />
            </button>
            {/* How much of the collection has a place. */}
            <div className="storage-progress rise" style={rise(6)}>
              <div className="storage-progress-h">{count(summary.placed)} of {count(summary.total)} {summary.total === 1 ? 'copy has' : 'copies have'} a place</div>
              <div className="storage-bar"><div style={{ width: `${Math.round(share * 100)}%` }} /></div>
              {summary.unplaced > 0 && (
                <button type="button" className="link storage-progress-link" onClick={putAway}>
                  {count(summary.unplaced)} without a place · Put them away
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {more && (
        <ActionSheet
          title="Storage"
          actions={[
            { label: upkeep.items.length > 0 ? `Upkeep · ${upkeep.items.length}` : 'Upkeep', icon: 'task_alt', detail: "What's worth doing this week", onClick: () => navigate('/collections/upkeep') },
            { label: 'Set up storage', icon: 'inventory_2', detail: 'Make your places from what you keep cards in', onClick: () => navigate('/collections/setup') },
            { label: 'Value by place', icon: 'payments', detail: "What each box and binder is worth", onClick: () => navigate('/collections/value') },
            { label: 'Space', icon: 'inventory_2', detail: 'How full each place is', onClick: () => navigate('/collections/space') },
            { label: 'To sell', icon: 'sell', detail: 'Copies marked to sell, with where they are', onClick: () => navigate('/collections/sell') },
            { label: 'Sort a new pile', icon: 'call_split', detail: 'Scan a pile into piles with a recipe', onClick: () => navigate('/scan?mode=sort') },
            { label: 'Rule order', icon: 'low_priority', detail: 'Which place a card goes to when it fits more than one', onClick: () => setRuleOrder(true) },
            { label: 'Data and speed', icon: 'speed', detail: 'Save a backup of everything, or restore one', onClick: () => navigate('/settings/data') },
            { label: 'Sharing storage at home', icon: 'shelves', detail: 'Keep cards on the same shelf as someone you live with', onClick: () => navigate('/collections/household') },
          ]}
          onClose={() => setMore(false)}
        />
      )}
      {editing && <PlaceDialog place={editing === 'new' ? null : editing} onDismiss={() => setEditing(null)} />}
      {ruleOrder && <RuleOrderDialog onDismiss={() => setRuleOrder(false)} />}
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

/** "Search everywhere for “ram”": Find anything — your cards, places and decks at once. */
export function SearchEverywhereRow({ query, onClick }: { query: string; onClick: () => void }) {
  return (
    <button type="button" className="storage-row storage-card press search-everywhere" onClick={onClick}>
      <Icon name="travel_explore" className="storage-icon gold" />
      <div className="storage-text"><b>Search everywhere for “{query.trim()}”</b><span>Your cards, places and decks</span></div>
      <Icon name="chevron_right" aria-hidden />
    </button>
  )
}

/** A top-level place as a card, with every place inside it beneath. */
function PlaceGroup({ top, places, summary, index, detail, onOpen }: {
  top: StoragePlace; places: StoragePlace[]; summary: StorageSummary; index: number; detail: (p: StoragePlace, withSubtitle: boolean) => string; onOpen: (id: string) => void
}) {
  const within = placeAndInside(places, top.id)
  const inside = placeTree(places).filter((n) => n.place.id !== top.id && within.has(n.place.id))
  const kids = childrenOf(places, top.id).length
  return (
    <div className="storage-card rise" style={rise(Math.min(index, 6) + 3)}>
      <button type="button" className="storage-row press" onClick={() => onOpen(top.id)}>
        <Icon name={PLACE_ICONS[top.kind]} className="storage-icon" />
        <div className="storage-text"><b>{top.name}</b>{detail(top, kids === 0) && <span>{detail(top, kids === 0)}</span>}</div>
        <span className="storage-n">{kids > 0 ? `${kids} ${kids === 1 ? 'place' : 'places'}` : count(copiesWithin(summary, places, top.id))}</span>
      </button>
      {inside.map((n) => (
        <button key={n.place.id} type="button" className="storage-row storage-sub press" style={{ marginLeft: 24 * n.depth }} onClick={() => onOpen(n.place.id)}>
          <Icon name={PLACE_ICONS[n.place.kind]} className="storage-icon gold" />
          <div className="storage-text"><b>{n.place.name}</b><span>{detail(n.place, true)}</span></div>
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

/**
 * Make a place, or change one: its name, what it is, where it sits and how it's organised — and its rules
 * (storageRules.ts): what it holds, its sections and its order, with a warning when they overlap
 * another place's.
 */
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
  // A binder's order (collection/binderPages.ts).
  const [rule, setRule] = useState<SortRule | ''>(place?.sortRule ?? '')
  const [sections, setSections] = useState((place?.sections ?? []).join(', '))
  // The rules, as the place goes by them now — an older app's sorting rule read as what it meant.
  const [start] = useState(() => (place ? placeRules(place) : { holds: null, sectionsBy: null, sortBy: [] as string[] }))
  const [holds, setHolds] = useState<Holds | null>(start.holds)
  const [level, setLevel] = useState<SplitLevel | null>(start.sectionsBy)
  const [sortKey, setSortKey] = useState(start.sortBy.join(','))
  const [choosingHolds, setChoosingHolds] = useState(false)
  const [ruleOrder, setRuleOrder] = useState(false)
  const parents = placeTree(places).filter((n) => !place || canMoveInto(places, place.id, n.place.id))
  const isBinder = kind === 'BINDER'
  // The cards in storage as the rules judge them — only while what it holds is being set or checked.
  const needCards = holds !== null || choosingHolds
  const stored = useMemo(() => (needCards ? [...cardsByPlace(collections).values()].flat() : NO_COPIES), [needCards, collections])
  const { facts } = useStorageFilterFacts(stored, needCards)
  const ruleCards = useMemo(() => ruleCardsOf(stored, facts), [stored, facts])

  const built = (id: string): StoragePlace => {
    const list = sections.split(',').map((s) => s.trim()).filter(Boolean)
    const base: StoragePlace = {
      id,
      name: name.trim(),
      kind,
      ...(parent ? { parentId: parent } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(!isBinder && list.length > 0 ? { sections: list } : {}),
      ...(isBinder && Number(pockets) > 0 && Number(pockets) !== DEFAULT_POCKETS ? { pocketsPerPage: Math.round(Number(pockets)) } : {}),
      // A binder's order (collection/binderPages.ts); anything else's is written from its rules (withRules).
      ...(isBinder && rule ? { sortRule: rule } : {}),
      createdAt: place?.createdAt ?? Date.now(),
      // When it was last checked (collection/placeCheck.ts) isn't changed here, nor its size (Change size, boxSpace.ts).
      ...(place?.lastChecked ? { lastChecked: place.lastChecked } : {}),
      ...(place?.capacity !== undefined ? { capacity: place.capacity } : {}),
      ...(place?.pages !== undefined ? { pages: place.pages } : {}),
      ...(place?.holds ? { holds: place.holds } : {}),
      ...(place?.sectionsBy ? { sectionsBy: place.sectionsBy } : {}),
      ...(place?.sortBy ? { sortBy: place.sortBy } : {}),
    }
    return withRules(base, holds ? holdsMap(holds.basic, holds.advanced) : null, isBinder ? null : level, isBinder ? [] : sortKey.split(',').filter(Boolean))
  }
  const overlapLines = holds && ruleCards.length > 0
    ? overlaps(built(place?.id ?? 'new'), places, placeOrderOf(collections), ruleCards, (n) => facts.toUsd?.(n) ?? n).map(overlapLine)
    : []

  const save = () => {
    if (!name.trim()) return
    const id = place?.id ?? crypto.randomUUID()
    const next = built(id)
    changeStorage((c) => savePlace(c, next))
    if (!place) countAction('place_created')
    onSaved?.(id)
    onDismiss()
  }

  if (choosingHolds) return <HoldsDialog holds={holds} cards={ruleCards} onDone={(h) => { setHolds(h); setChoosingHolds(false) }} onDismiss={() => setChoosingHolds(false)} />
  if (ruleOrder) return <RuleOrderDialog onDismiss={() => setRuleOrder(false)} />
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
        {parents.map((n) => <option key={n.place.id} value={n.place.id}>{`${' '.repeat(n.depth)}${n.place.name}`}</option>)}
      </select>
      <div className="field-label" style={{ marginTop: 12 }}>Note</div>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bulk, trade fodder…" />
      {isBinder && (
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
      <RulesFields
        isBinder={isBinder}
        holds={holds}
        onHolds={setHolds}
        level={level}
        onLevel={(l) => { setLevel(l); setSections(ruleSections(l).join(', ')) }}
        sortKey={sortKey}
        onSortKey={setSortKey}
        overlaps={overlapLines}
        onRuleOrder={() => setRuleOrder(true)}
        onChooseHolds={() => setChoosingHolds(true)}
      />
      {!isBinder && (level || kind === 'BOX' || sections.trim()) && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>Sections</div>
          <input className="input" value={sections} onChange={(e) => setSections(e.target.value)} placeholder="White, Blue, Black…" />
          <div className="dim" style={{ marginTop: 6 }}>In order, with commas between. Cards put away go in the section the rule gives them; rename them as you like.</div>
        </>
      )}
    </Dialog>
  )
}

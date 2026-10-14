import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ActionSheet } from '../components/ActionSheet'
import { useLongPress } from '../components/useLongPress'
import { ArtImage, IconButton, PageHeader, SearchPill, SegmentedTabs, StatFigure, rise, toArtCrop, useLayoutSize } from '../components/kit'
import { SharedFriendsView } from '../social/SharedFriends'
import { isUnsorted, type Collection } from '../types/models'
import { isWishlist, WISHLIST_ID } from '../collection/wishlist'
import { ExportCollectionDialog, ImportCardsDialog } from '../collection/CardListDialogs'
import { ShareCollectionDialog } from '../social/ShareWithFriend'
import { TagBindersSection } from '../collection/TagBinders'
import { AllCardsTab } from '../collection/AllCardsTab'
import { SearchEverywhereRow, StorageTab } from '../collection/StorageTab'
import { GoalsSection } from '../collection/GoalsUi'
import { EmptyState } from '../components/EmptyState'
import { CollectionDetailPage } from './CollectionDetailPage'
import { useCollectionValue } from '../collection/valueHistory'
import { placesOf } from '../collection/storagePlaces'
import { useUpkeep } from '../collection/useUpkeep'
import {
  collectionRoute, COLLECTION_TABS, groupByOf, lastTab, needsAttentionLabel, placesUsed, quickOf, rememberTab, startTab, TAB_LABELS,
  type CollectionTab,
} from '../collection/collectionLayout'
import { binderView, deckCopiesByBinder, inDecksOf, keptInPlacesAndDecksLine, NO_BINDER_TITLE, noBinderLine, ownCopiesOf, unsortedView, viewDecks, viewTotal, type BinderView } from '../collection/binderViews'
import { useMoney } from '../money/currency'
import { FilterButton } from '../collection/CardsFilterControls'
import { cardsFilterCount, STORAGE_FILTER_KEY } from '../collection/placeFilter'
import { usePlaceFilter } from '../collection/placeFilterStore'
import { useCardViewMode } from '../settings/settings'
import { WhatsNewTour } from '../onboarding/WhatsNewTour'
import { markTourSeen, tourSeen } from '../onboarding/whatsNewStore'
import { shouldShowTour, tourSteps } from '../onboarding/whatsNew'
import '../onboarding/onboarding.css'
import '../collection/collectionTabs.css'
import '../collection/collectionHome.css'

export function CollectionsPage() {
  const { collections, decks, deleteCollection, accountsAvailable } = useSync()
  // The Collection: one header — its value (tap: over time), sync, one search over the tab you're on,
  // the filters (Cards) and "Needs attention · N" — and four tabs, always there: Cards, Binders,
  // Storage, Wishlist, at ?tab=…. Old tabs and the old home's tiles map onto these (collectionLayout.ts);
  // with no tab it opens on the one used last. Mirrors the Android app's CollectionsScreen.kt.
  const [params, setParams] = useSearchParams()
  const route = collectionRoute(params.get('tab'))
  const tab: CollectionTab = route?.tab ?? startTab(null, lastTab())
  const navigate = useNavigate()
  const money = useMoney()
  const value = useCollectionValue(collections)
  const upkeep = useUpkeep()
  const attention = needsAttentionLabel(upkeep.items.length)
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filtersOn, setFiltersOn] = useState(0)
  // The Storage tab's filters (the Cards tab's kind, over the copies in places), kept while the app is open.
  const [storageFilter, setStorageFilter] = usePlaceFilter(STORAGE_FILTER_KEY)
  const [view, setView] = useCardViewMode('allCards')
  const group = groupByOf(params.get('group'))
  const quick = quickOf(params.get('quick'))
  const shared = params.get('tab') === 'shared' && accountsAvailable
  // The What's new tour, once on this device (onboarding/whatsNew.ts), or asked for from Settings (?tour).
  const [touring, setTouring] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [sheet, setSheet] = useState<Collection | null>(null)
  const [menu, setMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Collection | null>(null)
  const [importing, setImporting] = useState<Collection | 'new' | null>(null)
  const [exporting, setExporting] = useState<Collection | null>(null)
  const [sharingAll, setSharingAll] = useState(false)
  const wide = useLayoutSize() !== 'phone'

  const owned = collections.filter((c) => c.type !== 'WISHLIST')
  const ownedCards = owned.reduce((s, c) => s + c.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0), 0)

  // An old route (?tab=all, sets, sealed, loans…) becomes the new one, kept in the address.
  useEffect(() => {
    const raw = params.get('tab')
    if (!raw || raw === 'shared') return
    if (route && (raw !== route.tab || route.group || route.quick)) {
      const next = new URLSearchParams(params)
      next.set('tab', route.tab)
      if (route.group) next.set('group', route.group)
      if (route.quick) next.set('quick', route.quick)
      setParams(next, { replace: true })
    }
  }, [params, route, setParams])
  useEffect(() => { rememberTab(tab) }, [tab])

  const setTab = (t: CollectionTab) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
  }
  const setParam = (key: string, v: string | null) => {
    const next = new URLSearchParams(params)
    next.set('tab', tab)
    if (v) next.set(key, v)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const searchEverywhere = () => navigate(`/collections/find${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
  const onFiltersOn = useCallback((n: number) => setFiltersOn(n), [])

  const askedForTour = params.has('tour')
  useEffect(() => {
    if (askedForTour || shouldShowTour(tourSeen(), { cards: ownedCards, decks: decks.length })) {
      markTourSeen()
      setTouring(true)
      if (askedForTour) { const next = new URLSearchParams(params); next.delete('tour'); setParams(next, { replace: true }) }
    }
  }, [askedForTour, ownedCards, decks.length, params, setParams])

  const hints: Record<CollectionTab, string> = {
    cards: 'Search your cards, e.g. ramp',
    binders: 'Search binders and goals',
    storage: 'Search your places and the cards in them',
    wishlist: 'Search your wishlist',
  }

  if (shared) {
    return (
      <>
        <PageHeader title="Shared with me" onBack={() => setTab('cards')} />
        <div className={`content-scroll${wide ? '' : ' with-nav'}`}><SharedFriendsView /></div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Collection"
        actions={
          <span className="row" style={{ gap: 4, alignItems: 'center' }} data-tour="header">
            {value && <button type="button" className="chome-value-h press" aria-label={`Collection value ${money.format(value.usd, true)}: see it over time`} onClick={() => navigate('/value')}>{money.format(value.usd, true)}</button>}
            <IconButton icon="more_vert" label="More" onClick={() => setMenu(true)} />
          </span>
        }
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        <div className="ctabs-head rise" style={{ ...rise(0), maxWidth: wide ? 720 : undefined }}>
          <div className="ctabs-search" data-tour="search">
            <SearchPill value={query} onChange={setQuery} placeholder={hints[tab]} />
            {tab === 'cards' && (
              <>
                <IconButton icon={view === 'list' ? 'grid_view' : 'view_list'} label={view === 'list' ? 'Show as a grid' : 'Show as a list'} onClick={() => setView(view === 'list' ? 'grid' : 'list')} />
                <FilterButton count={filtersOn} open={filterOpen} onClick={() => setFilterOpen((o) => !o)} />
              </>
            )}
            {tab === 'storage' && <FilterButton count={cardsFilterCount(storageFilter)} open={filterOpen} onClick={() => setFilterOpen((o) => !o)} />}
          </div>
          {attention && (
            <button type="button" className="ctabs-attention press" aria-label={`${attention}: open Upkeep`} onClick={() => navigate('/collections/upkeep')}>
              <Icon name="warning" aria-hidden />{attention}
            </button>
          )}
          <div className="ctabs-tabs" data-tour="tabs">
            <SegmentedTabs
              labels={COLLECTION_TABS.map((t) => TAB_LABELS[t])}
              selected={COLLECTION_TABS.indexOf(tab)}
              onSelect={(i) => setTab(COLLECTION_TABS[i])}
              idPrefix="ctab"
              ariaLabel="Collection"
              tabAttrs={(i): Record<string, string> => (COLLECTION_TABS[i] === 'storage' || COLLECTION_TABS[i] === 'cards' ? { 'data-tour': COLLECTION_TABS[i] } : {})}
            />
          </div>
        </div>
        <div id="ctab-panel" role="tabpanel" aria-labelledby={`ctab-tab-${COLLECTION_TABS.indexOf(tab)}`}>
          {tab === 'cards' ? (
            <AllCardsTab
              onImport={() => setImporting('new')}
              query={query}
              onQueryChange={setQuery}
              filterOpen={filterOpen}
              onFiltersOn={onFiltersOn}
              group={group}
              onGroup={(g) => setParam('group', g === 'none' ? null : g)}
              quick={quick}
              onQuick={(q) => setParam('quick', q)}
              onSearchEverywhere={searchEverywhere}
            />
          ) : tab === 'storage' ? (
            <StorageTab query={query} onSearchEverywhere={searchEverywhere} filter={storageFilter} onFilterChange={setStorageFilter} filterOpen={filterOpen} />
          ) : tab === 'wishlist' ? (
            <CollectionDetailPage embeddedId={WISHLIST_ID} externalQuery={query} />
          ) : (
            <BindersTab
              query={query}
              onImport={() => setImporting('new')}
              onNewBinder={() => setShowCreate(true)}
              onMore={setSheet}
              onSearchEverywhere={searchEverywhere}
            />
          )}
        </div>
      </div>

      {touring && (
        <WhatsNewTour
          steps={tourSteps(placesOf(collections).length > 0)}
          onAction={(action) => navigate(action === 'find' ? '/collections/find' : '/collections/setup')}
          onClose={() => setTouring(false)}
        />
      )}

      {menu && (
        <ActionSheet
          title="Collection"
          actions={[
            { label: 'Import list', icon: 'playlist_add', detail: 'A list from Moxfield, ManaBox, Archidekt…', onClick: () => setImporting('new') },
            { label: 'New binder', icon: 'add', onClick: () => setShowCreate(true) },
            { label: 'Share my collection', icon: 'group_add', detail: 'With a friend', onClick: () => setSharingAll(true) },
            ...(accountsAvailable ? [{ label: 'Shared with me', icon: 'handshake', detail: 'What friends share with you', onClick: () => setParams({ tab: 'shared' }) }] : []),
          ]}
          onClose={() => setMenu(false)}
        />
      )}

      {sheet && (
        <ActionSheet
          title={sheet.name}
          subtitle={`${isWishlist(sheet) ? 'Wishlist' : 'Binder'} · ${sheet.entries.length} unique cards`}
          imageUrl={sheet.entries[0]?.imageUrl ?? null}
          actions={[
            { label: 'Open binder', icon: 'folder_open', detail: "Its cards and what they're worth", onClick: () => navigate(`/collections/${sheet.id}`) },
            { label: 'Import list', icon: 'playlist_add', detail: 'A list from Moxfield, ManaBox, Archidekt…', onClick: () => setImporting(sheet) },
            { label: 'Export list', icon: 'ios_share', detail: 'For other apps, or a .txt or .csv file', onClick: () => setExporting(sheet) },
            // The Wishlist is always there.
            ...(isWishlist(sheet) ? [] : [{ label: 'Delete binder', icon: 'delete', tone: 'danger' as const, detail: 'Asks first — its cards leave your collection', onClick: () => setConfirmDelete(sheet) }]),
          ]}
          onClose={() => setSheet(null)}
        />
      )}

      {confirmDelete && (() => {
        // Copies, not different cards: "its 40 cards" for a binder of 4 × 10 cards.
        const copies = confirmDelete.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0)
        return (
        <Dialog
          title="Delete this binder?"
          onDismiss={() => setConfirmDelete(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { deleteCollection(confirmDelete.id); setConfirmDelete(null) }}>Delete binder</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>“{confirmDelete.name}” and its {copies} {copies === 1 ? 'card' : 'cards'} will be removed here and on your other devices.</p>
        </Dialog>
        )
      })()}

      {importing && (
        <ImportCardsDialog
          collection={importing === 'new' ? undefined : importing}
          onDismiss={() => setImporting(null)}
          onCreated={(id) => navigate(`/collections/${id}`)}
          // From Cards the whole collection comes in unsorted by default; from Binders, as a binder.
          startInNewBinder={tab === 'binders'}
        />
      )}
      {sharingAll && <ShareCollectionDialog onClose={() => setSharingAll(false)} />}
      {exporting && <ExportCollectionDialog collection={exporting} onDismiss={() => setExporting(null)} />}

      {showCreate && <CreateCollectionDialog onDismiss={() => setShowCreate(false)} onCreated={(id) => navigate(`/collections/${id}`)} />}
    </>
  )
}

/** The Binders tab: the Unsorted pile, the binders (each saying where it's kept), tag binders and Goals. */
function BindersTab({ query, onImport, onNewBinder, onMore, onSearchEverywhere }: {
  query: string; onImport: () => void; onNewBinder: () => void; onMore: (c: Collection) => void; onSearchEverywhere: () => void
}) {
  const { collections, decks } = useSync()
  const navigate = useNavigate()
  const wide = useLayoutSize() !== 'phone'
  const q = query.trim().toLowerCase()
  // What each binder shows: its own cards and the deck copies sorted into it (collection/binderViews.ts).
  const views = useMemo(() => deckCopiesByBinder(collections, decks), [collections, decks])
  const noBinder = unsortedView(collections, decks, views)
  const known = useMemo(() => new Set(placesOf(collections).map((p) => p.id)), [collections])
  // The Unsorted pile counts as owned cards, but isn't listed or counted as a binder. Like the
  // Wishlist (a tab of its own) it's always there, even empty — it's where a loose card goes.
  const unsorted = collections.find(isUnsorted)
  const allBinders = collections.filter((c) => !isUnsorted(c) && !isWishlist(c) && c.type !== 'WISHLIST')
  const binders = q ? allBinders.filter((c) => c.name.toLowerCase().includes(q)) : allBinders
  const unsortedCards = unsorted?.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0) ?? 0
  const ownedCards = collections.filter((c) => c.type !== 'WISHLIST').reduce((s, c) => s + c.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0), 0)
  const unique = new Set(collections.filter((c) => c.type !== 'WISHLIST').flatMap((c) => c.entries.map((e) => e.scryfallId))).size
  return (
    <>
      {!q && (
        <div className="stats rise" style={{ ...rise(1), maxWidth: wide ? 720 : undefined }}>
          <StatFigure value={ownedCards} label="Cards owned" />
          <StatFigure value={unique} label="Unique cards" />
          <StatFigure value={allBinders.length} label="Binders" />
        </div>
      )}
      {unsorted && !q && (
        <div className="list wide-list rise" style={{ ...rise(2), marginBottom: 14 }}>
          <button type="button" className="brow press unsorted-row" onClick={() => navigate(`/collections/${unsorted.id}`)}>
            <div className="icon-tile"><Icon name="inbox" /></div>
            <div style={{ minWidth: 0 }}>
              <div className="brow-name">{NO_BINDER_TITLE}</div>
              <div className="brow-meta">
                {viewTotal(noBinder) > 0
                  ? <span>{noBinderLine(noBinder)}</span>
                  : <span>Empty — for cards you own that aren't in a binder</span>}
              </div>
            </div>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </button>
        </div>
      )}
      <div className="binders-h">
        <h2>Binders</h2>
        <button type="button" className="btn soft sm" onClick={onNewBinder}><Icon name="add" aria-hidden />New binder</button>
      </div>
      {allBinders.length === 0 && unsortedCards === 0 ? (
        <EmptyState
          className="rise"
          style={rise(1)}
          icon="collections"
          text="No binders yet. Import your collection from another app, or make a binder for the cards you own."
          actions={[
            { label: 'Import your collection', icon: 'playlist_add', onClick: onImport },
            { label: 'New binder', icon: 'add', onClick: onNewBinder },
          ]}
        />
      ) : binders.length === 0 && q ? (
        <div className="dim">No binders match “{query.trim()}”.</div>
      ) : (
        <div className="list wide-list">
          {binders.map((c, i) => {
            const view = binderView(c.id, collections, decks, views)
            return (
            <BinderRow
              key={c.id}
              collection={c}
              index={i}
              view={view}
              kept={keptInPlacesAndDecksLine(placesUsed(c, known), ownCopiesOf(view), viewDecks(view))}
              onOpen={() => navigate(`/collections/${c.id}`)}
              onMore={() => onMore(c)}
            />
            )
          })}
        </div>
      )}
      {!q && <TagBindersSection />}
      <GoalsSection query={query} />
      {q && <SearchEverywhereRow query={query} onClick={onSearchEverywhere} />}
    </>
  )
}

function BinderRow({ collection, index, kept, view, onOpen, onMore }: { collection: Collection; index: number; kept: string; view?: BinderView; onOpen: () => void; onMore: () => void }) {
  // The row takes the pointer; its name is the keyboard button, since the row holds the actions button.
  const { role, tabIndex, onKeyDown, ...pointer } = useLongPress({ onLongPress: onMore, onClick: onOpen })
  const total = collection.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0)
  const cover = collection.entries[0]
  return (
    <div className="brow press rise" style={{ ...rise(Math.min(index, 8) + 3), cursor: 'pointer' }} {...pointer}>
      {cover ? (
        <ArtImage src={toArtCrop(cover.imageUrl)} seed={collection.name} />
      ) : (
        <div className="icon-tile"><Icon name={collection.type === 'WISHLIST' ? 'star' : 'collections'} /></div>
      )}
      <div style={{ minWidth: 0 }} role={role} tabIndex={tabIndex} onKeyDown={onKeyDown}>
        <div className="brow-name">{collection.name}{collection.sample && <span className="badge soft sample" style={{ marginLeft: 8 }}>Sample</span>}</div>
        <div className="brow-meta">
          {isWishlist(collection)
            ? <><span>Cards you want</span><span><b>{total}</b>{total === 1 ? 'card' : 'cards'}</span><span>not counted as owned</span></>
            // With deck copies sorted into it: "84 cards · 12 in decks" (collection/binderViews.ts).
            : view && inDecksOf(view) > 0
              ? <><span><b>{viewTotal(view)}</b>cards</span><span><b>{inDecksOf(view)}</b>in decks</span>{kept && <span>{kept}</span>}</>
              : <><span><b>{total}</b>cards</span><span><b>{collection.entries.length}</b>unique</span>{kept && <span>{kept}</span>}</>}
        </div>
      </div>
      <button
        type="button"
        className="more"
        aria-label={`Actions for ${collection.name}`}
        onClick={(e) => { e.stopPropagation(); onMore() }}
      >
        <Icon name="more_vert" style={{ fontSize: 20 }} />
      </button>
    </div>
  )
}

function CreateCollectionDialog({ onDismiss, onCreated }: { onDismiss: () => void; onCreated: (id: string) => void }) {
  const { createCollection } = useSync()
  const [name, setName] = useState('')
  // New binders are owned binders: the Wishlist is the only wishlist.
  const create = () => {
    if (!name.trim()) return
    onCreated(createCollection(name.trim(), 'OWNED').id)
  }

  return (
    <Dialog
      title="New binder"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!name.trim()} onClick={create}>Create binder</button>
        </>
      }
    >
      <div className="field-label">Binder name</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus />
      <div className="dim" style={{ marginTop: 10 }}>Cards you own. Cards you want go in your Wishlist.</div>
    </Dialog>
  )
}

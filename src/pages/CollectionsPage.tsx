import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ActionSheet } from '../components/ActionSheet'
import { useLongPress } from '../components/useLongPress'
import { ArtImage, IconButton, PageHeader, PillChip, StatFigure, rise, toArtCrop, useLayoutSize } from '../components/kit'
import { isUnsorted, type Collection, type CollectionType } from '../types/models'
import { ExportCollectionDialog, ImportCardsDialog } from '../collection/CardListDialogs'
import { ShareCollectionDialog } from '../social/ShareWithFriend'

const TYPE_LABELS: Record<CollectionType, string> = { OWNED: 'Owned', WISHLIST: 'Wishlist' }

export function CollectionsPage() {
  const { collections, deleteCollection } = useSync()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<CollectionType | 'ALL'>('ALL')
  const [sheet, setSheet] = useState<Collection | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Collection | null>(null)
  const [importing, setImporting] = useState<Collection | 'new' | null>(null)
  const [exporting, setExporting] = useState<Collection | null>(null)
  const [sharingAll, setSharingAll] = useState(false)
  const wide = useLayoutSize() !== 'phone'

  const owned = collections.filter((c) => c.type !== 'WISHLIST')
  const ownedCards = owned.reduce((s, c) => s + c.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0), 0)
  const unique = new Set(owned.flatMap((c) => c.entries.map((e) => e.scryfallId))).size
  // The Unsorted pile counts as owned cards, but isn't listed or counted as a binder.
  const unsorted = collections.find(isUnsorted)
  const binders = collections.filter((c) => !isUnsorted(c))
  const unsortedCards = unsorted?.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0) ?? 0
  const shown = binders.filter((c) => filter === 'ALL' || c.type === filter)

  return (
    <>
      <PageHeader
        title="Collection"
        actions={wide
          ? (
            <>
              <button type="button" className="btn line" onClick={() => setSharingAll(true)}><Icon name="group_add" />Share</button>
              <button type="button" className="btn line" onClick={() => setImporting('new')}><Icon name="playlist_add" />Import cards</button>
              <button type="button" className="btn gold" onClick={() => setShowCreate(true)}><Icon name="add" />New binder</button>
            </>
          )
          : (
            <>
              <IconButton icon="group_add" label="Share my collection" onClick={() => setSharingAll(true)} />
              <IconButton icon="playlist_add" label="Import cards from another app" onClick={() => setImporting('new')} />
              <IconButton icon="add" label="New binder" variant="gold" onClick={() => setShowCreate(true)} />
            </>
          )}
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        {binders.length === 0 && unsortedCards === 0 ? (
          <div className="empty-state rise" style={rise(1)}>
            <Icon name="collections" />
            <div>No binders yet. Make one for the cards you own, or a wishlist for the ones you want — or import your whole collection from another app and sort it later.</div>
            <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn gold" onClick={() => setShowCreate(true)}><Icon name="add" />New binder</button>
              <button type="button" className="btn line" onClick={() => setImporting('new')}><Icon name="playlist_add" />Import your collection</button>
            </div>
          </div>
        ) : (
          <>
            <div className="stats rise" style={{ ...rise(1), maxWidth: wide ? 720 : undefined }}>
              <StatFigure value={ownedCards} label="Cards owned" />
              <StatFigure value={unique} label="Unique cards" />
              <StatFigure value={binders.length} label="Binders" />
            </div>
            {unsorted && unsortedCards > 0 && (
              <div className="list wide-list rise" style={{ ...rise(2), marginBottom: 14 }}>
                <button type="button" className="brow press unsorted-row" onClick={() => navigate(`/collections/${unsorted.id}`)}>
                  <div className="icon-tile"><Icon name="inbox" /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="brow-name">Unsorted</div>
                    <div className="brow-meta"><span><b>{unsortedCards}</b>{unsortedCards === 1 ? 'card' : 'cards'} not in a binder yet — open to sort them</span></div>
                  </div>
                  <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
                </button>
              </div>
            )}
            <div className="chips rise" style={rise(2)}>
              <PillChip label="All" count={binders.length} selected={filter === 'ALL'} onClick={() => setFilter('ALL')} />
              {(['OWNED', 'WISHLIST'] as const).map((t) => (
                <PillChip key={t} label={TYPE_LABELS[t]} count={binders.filter((c) => c.type === t).length} selected={filter === t} onClick={() => setFilter(t)} />
              ))}
            </div>
            <div className="list wide-list">
              {shown.map((c, i) => (
                <BinderRow
                  key={c.id}
                  collection={c}
                  index={i}
                  onOpen={() => navigate(`/collections/${c.id}`)}
                  onMore={() => setSheet(c)}
                />
              ))}
              {shown.length === 0 && <div className="empty-state">No {filter === 'WISHLIST' ? 'wishlists' : 'binders'} here yet.</div>}
            </div>
          </>
        )}
      </div>

      {sheet && (
        <ActionSheet
          title={sheet.name}
          subtitle={`${TYPE_LABELS[sheet.type]} · ${sheet.entries.length} unique cards`}
          imageUrl={sheet.entries[0]?.imageUrl ?? null}
          actions={[
            { label: 'Open binder', icon: 'folder_open', onClick: () => navigate(`/collections/${sheet.id}`) },
            { label: 'Import cards', icon: 'playlist_add', detail: 'A list from Moxfield, ManaBox, Archidekt…', onClick: () => setImporting(sheet) },
            { label: 'Export as text', icon: 'ios_share', detail: 'For other apps, or a .txt file', onClick: () => setExporting(sheet) },
            { label: 'Delete binder', icon: 'delete', tone: 'danger', onClick: () => setConfirmDelete(sheet) },
          ]}
          onClose={() => setSheet(null)}
        />
      )}

      {confirmDelete && (
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
          <p className="muted" style={{ margin: 0 }}>“{confirmDelete.name}” and its {confirmDelete.entries.length} cards will be removed here and on your other devices.</p>
        </Dialog>
      )}

      {importing && (
        <ImportCardsDialog
          collection={importing === 'new' ? undefined : importing}
          onDismiss={() => setImporting(null)}
          onCreated={(id) => navigate(`/collections/${id}`)}
          // Here the whole collection comes in unsorted by default; from a binder's menu, into it.
          startInNewBinder={false}
        />
      )}
      {sharingAll && <ShareCollectionDialog onClose={() => setSharingAll(false)} />}
      {exporting && <ExportCollectionDialog collection={exporting} onDismiss={() => setExporting(null)} />}

      {showCreate && <CreateCollectionDialog onDismiss={() => setShowCreate(false)} onCreated={(id) => navigate(`/collections/${id}`)} />}
    </>
  )
}

function BinderRow({ collection, index, onOpen, onMore }: { collection: Collection; index: number; onOpen: () => void; onMore: () => void }) {
  const longPress = useLongPress({ onLongPress: onMore, onClick: onOpen })
  const total = collection.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0)
  const cover = collection.entries[0]
  return (
    <div className="brow press rise" style={{ ...rise(Math.min(index, 8) + 3), cursor: 'pointer' }} {...longPress}>
      {cover ? (
        <ArtImage src={toArtCrop(cover.imageUrl)} seed={collection.name} />
      ) : (
        <div className="icon-tile"><Icon name={collection.type === 'WISHLIST' ? 'star' : 'collections'} /></div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="brow-name">{collection.name}</div>
        <div className="brow-meta">
          {collection.type === 'WISHLIST' && <span className="badge soft">Wishlist</span>}
          <span><b>{total}</b>cards</span>
          <span><b>{collection.entries.length}</b>unique</span>
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
  const [type, setType] = useState<CollectionType>('OWNED')
  const create = () => {
    if (!name.trim()) return
    onCreated(createCollection(name.trim(), type).id)
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
      <div className="field-label" style={{ marginTop: 16 }}>Type</div>
      <div className="chips wrap">
        {(['OWNED', 'WISHLIST'] as const).map((t) => (
          <PillChip key={t} label={TYPE_LABELS[t]} selected={type === t} onClick={() => setType(t)} className="on-g2" />
        ))}
      </div>
      <div className="dim" style={{ marginTop: 10 }}>
        {type === 'OWNED' ? 'Cards you own. They count toward your collection.' : "Cards you want. They don't count as owned."}
      </div>
    </Dialog>
  )
}

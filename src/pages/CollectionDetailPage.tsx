import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal } from '../components/CardZoomModal'
import { ActionSheet } from '../components/ActionSheet'
import { useLongPress } from '../components/useLongPress'
import { CardSearchResults } from '../components/CardSearchResults'
import { ShareDialog } from '../social/ShareDialog'
import { ExportCollectionDialog, ImportCardsDialog } from '../collection/CardListDialogs'
import { ArtImage, IconButton, SearchPill, SectionHeader, StatFigure, rise, toArtCrop, useBack, useLayoutSize, useScrollProgress } from '../components/kit'
import { Dialog } from '../components/Dialog'
import { isUnsorted, type CollectionEntry } from '../types/models'

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const back = useBack('/collections')
  const { collections, setEntryQuantities, removeEntryFromCollection, addEntryToCollection, moveEntry, createCollection } = useSync()
  const collection = collections.find((c) => c.id === id)
  const [zoomId, setZoomId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<CollectionEntry | null>(null)
  const [filter, setFilter] = useState('')
  const [sharing, setSharing] = useState(false)
  const [listDialog, setListDialog] = useState<'import' | 'export' | null>(null)
  // The card whose "move to binder" picker is open, and the one being moved into a new binder.
  const [moving, setMoving] = useState<CollectionEntry | null>(null)
  const [naming, setNaming] = useState<CollectionEntry | null>(null)
  const [newName, setNewName] = useState('')
  // The big title scrolls away; the bar's title fades in to replace it.
  const titleProgress = useScrollProgress(90)
  const size = useLayoutSize()

  if (!collection) {
    return (
      <>
        <TopBar title="Binder" onBack={back} />
        <div className="content-scroll">
          <div className="empty-state"><Icon name="collections" />Binder not found. It may have been deleted.</div>
        </div>
      </>
    )
  }

  const zoomEntry = collection.entries.find((e) => e.scryfallId === zoomId) ?? null
  const cards = collection.entries.reduce((s, e) => s + e.quantity, 0)
  const foils = collection.entries.reduce((s, e) => s + e.foilQuantity, 0)
  const q = filter.trim().toLowerCase()
  const shown = collection.entries
    .filter((e) => !q || e.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
  const setQty = (e: CollectionEntry, quantity: number, foilQuantity: number) =>
    setEntryQuantities(collection.id, e.scryfallId, Math.max(0, quantity), Math.max(0, foilQuantity))

  const summary = (
    <div className="stats rise" style={{ ...rise(1), maxWidth: size === 'phone' ? undefined : 720 }}>
      <StatFigure value={cards} label="Cards" />
      <StatFigure value={foils} label="Foils" />
      <StatFigure value={collection.entries.length} label="Unique" />
    </div>
  )

  const unsorted = isUnsorted(collection)
  const moveToNew = () => {
    if (!naming || !newName.trim()) return
    moveEntry(collection.id, naming.scryfallId, createCollection(newName.trim(), 'OWNED').id)
    setNaming(null)
  }
  const entryList = collection.entries.length === 0 ? (
    unsorted
      ? <div className="empty-state"><Icon name="inbox" />All sorted — every card is in a binder.</div>
      : <div className="empty-state"><Icon name="playing_cards" />No cards yet — search {size === 'desktop' ? 'on the right' : 'below'} to add some.</div>
  ) : (
    <>
      {unsorted && (
        <p className="muted rise" style={{ ...rise(2), margin: '14px 0 0' }}>
          Cards you own that aren't in a binder yet. Use <Icon name="more_vert" style={{ fontSize: 16, verticalAlign: -3 }} /> → <b>Move to binder</b> on a card to sort it — into a binder you have, or a new one.
        </p>
      )}
      {collection.entries.length > 8 && (
        <div className="rise" style={{ ...rise(2), marginTop: 14, maxWidth: size === 'phone' ? undefined : 480 }}>
          <SearchPill value={filter} onChange={setFilter} placeholder="Find in this binder" />
        </div>
      )}
      <div className="list wide-list" style={{ marginTop: 14 }}>
        {shown.map((entry) => (
          <EntryRow
            key={entry.scryfallId}
            entry={entry}
            onZoom={() => setZoomId(entry.scryfallId)}
            onMore={() => setSheet(entry)}
            onIncrement={() => setQty(entry, entry.quantity + 1, entry.foilQuantity)}
            onDecrement={() => setQty(entry, entry.quantity - 1, entry.foilQuantity)}
          />
        ))}
        {shown.length === 0 && <div className="empty-state">Nothing in this binder matches “{filter}”.</div>}
      </div>
    </>
  )

  const addCards = <CardSearchResults onAdd={(card) => addEntryToCollection(collection.id, card)} placeholder="Search Scryfall to add cards" />

  return (
    <>
      <TopBar
        title={collection.name}
        onBack={back}
        progress={titleProgress}
        actions={
          <>
            <IconButton icon="playlist_add" label="Import cards from another app" variant={titleProgress < 0.6 ? 'glass' : ''} onClick={() => setListDialog('import')} />
            <IconButton icon="ios_share" label="Export as text" variant={titleProgress < 0.6 ? 'glass' : ''} onClick={() => setListDialog('export')} />
            <IconButton icon="group_add" label="Share with friends" variant={titleProgress < 0.6 ? 'glass' : ''} onClick={() => setSharing(true)} />
          </>
        }
      />
      <div className="content-scroll">
        <div className="binder-head rise" style={rise(0)}>
          <div className="eyebrow">{unsorted ? 'Not in a binder yet' : collection.type === 'WISHLIST' ? 'Wishlist' : 'Binder'}</div>
          <h1>{collection.name}</h1>
        </div>
        {size === 'desktop' ? (
          <div className="binder-columns" style={{ marginTop: 12 }}>
            <div style={{ minWidth: 0 }}>{summary}{entryList}</div>
            <aside className="deck-aside">
              <div className="panel">
                <div className="p-h"><h3>Add cards</h3></div>
                {addCards}
              </div>
            </aside>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 12 }}>{summary}</div>
            {entryList}
            <SectionHeader title="Add cards" />
            {addCards}
          </>
        )}
      </div>

      {sheet && (
        <ActionSheet
          title={sheet.name}
          subtitle={`${sheet.quantity} regular · ${sheet.foilQuantity} foil`}
          imageUrl={sheet.imageUrl}
          actions={[
            { label: 'View card', icon: 'visibility', onClick: () => setZoomId(sheet.scryfallId) },
            { label: 'Add a foil copy', icon: 'auto_awesome', tone: 'gold', onClick: () => setQty(sheet, sheet.quantity, sheet.foilQuantity + 1) },
            ...(sheet.foilQuantity > 0
              ? [{ label: 'Remove a foil copy', icon: 'remove_circle_outline', onClick: () => setQty(sheet, sheet.quantity, sheet.foilQuantity - 1) }]
              : []),
            { label: 'Move to binder', icon: 'drive_file_move', detail: 'Every copy, into another binder', onClick: () => setMoving(sheet) },
            { label: 'Remove from binder', icon: 'delete', tone: 'danger' as const, onClick: () => removeEntryFromCollection(collection.id, sheet.scryfallId) },
          ]}
          onClose={() => setSheet(null)}
        />
      )}

      {moving && (
        <ActionSheet
          title={`Move ${moving.name}`}
          subtitle={`${moving.quantity + moving.foilQuantity} ${moving.quantity + moving.foilQuantity === 1 ? 'copy' : 'copies'}`}
          imageUrl={moving.imageUrl}
          actions={[
            { label: 'New binder…', icon: 'add', tone: 'gold' as const, onClick: () => { setNewName(''); setNaming(moving) } },
            ...collections
              .filter((c) => c.id !== collection.id)
              .map((c) => ({
                label: c.name,
                icon: isUnsorted(c) ? 'inbox' : c.type === 'WISHLIST' ? 'star' : 'collections',
                detail: isUnsorted(c) ? 'Not in a binder' : c.type === 'WISHLIST' ? 'Wishlist' : 'Binder',
                onClick: () => moveEntry(collection.id, moving.scryfallId, c.id),
              })),
          ]}
          onClose={() => setMoving(null)}
        />
      )}

      {naming && (
        <Dialog
          title={`Move ${naming.name} to a new binder`}
          onDismiss={() => setNaming(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setNaming(null)}>Cancel</button>
              <button type="button" className="btn gold" disabled={!newName.trim()} onClick={moveToNew}>Create &amp; move</button>
            </>
          }
        >
          <label className="field-label" htmlFor="move-new-name" style={{ marginTop: 0 }}>Binder name</label>
          <input id="move-new-name" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && moveToNew()} autoFocus />
        </Dialog>
      )}

      {listDialog === 'import' && <ImportCardsDialog collection={collection} onDismiss={() => setListDialog(null)} />}
      {listDialog === 'export' && <ExportCollectionDialog collection={collection} onDismiss={() => setListDialog(null)} />}
      {sharing && <ShareDialog kind="collection" itemId={collection.id} name={collection.name} onClose={() => setSharing(false)} />}

      {zoomEntry && (
        <CardZoomModal
          imageUrl={zoomEntry.imageUrl}
          name={zoomEntry.name}
          scryfallId={zoomEntry.scryfallId}
          currentCollectionId={collection.id}
          backImageUrl={zoomEntry.backImageUrl}
          tags={zoomEntry.tags}
          onSelectSimilar={(similar) => addEntryToCollection(collection.id, similar)}
          similarActionLabel="Tap a card to add it to this binder"
          onClose={() => setZoomId(null)}
        >
          <div className="panel detail-grid">
            <div className="row-between">
              <div><div className="p-h" style={{ margin: 0 }}><h3>Regular</h3></div><div className="dim">In this binder</div></div>
              <div className="stepper-big">
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity - 1, zoomEntry.foilQuantity)} aria-label="One fewer">−</button>
                <span className="qn">{zoomEntry.quantity}</span>
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity + 1, zoomEntry.foilQuantity)} aria-label="One more">+</button>
              </div>
            </div>
            <div className="row-between">
              <div><div className="p-h" style={{ margin: 0 }}><h3>Foil</h3></div><div className="dim">In this binder</div></div>
              <div className="stepper-big">
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity, zoomEntry.foilQuantity - 1)} aria-label="One fewer foil">−</button>
                <span className="qn">{zoomEntry.foilQuantity}</span>
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity, zoomEntry.foilQuantity + 1)} aria-label="One more foil">+</button>
              </div>
            </div>
          </div>
        </CardZoomModal>
      )}
    </>
  )
}

function EntryRow({
  entry, onZoom, onMore, onIncrement, onDecrement,
}: { entry: CollectionEntry; onZoom: () => void; onMore: () => void; onIncrement: () => void; onDecrement: () => void }) {
  const longPress = useLongPress({ onLongPress: onMore, onClick: onZoom })
  return (
    <div className="crow">
      <div className="thumb-wrap" onClick={onZoom} style={{ cursor: 'pointer' }}>
        <ArtImage className="thumb" src={toArtCrop(entry.imageUrl)} seed={entry.name} />
        {entry.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cmain" {...longPress}>
        <div className="cname">{entry.name}</div>
        <div className="cmeta">
          {entry.foilQuantity > 0 && <span className="badge gold"><Icon name="auto_awesome" />{entry.foilQuantity} foil</span>}
          <span>{entry.tags?.slice(0, 3).join(' · ') ?? ''}</span>
        </div>
      </div>
      <div className="qty">
        <button type="button" onClick={onDecrement} aria-label={`One fewer ${entry.name}`}>−</button>
        <span className="qn">{entry.quantity}</span>
        <button type="button" onClick={onIncrement} aria-label={`One more ${entry.name}`}>+</button>
      </div>
      <button type="button" className="more" onClick={onMore} aria-label={`Actions for ${entry.name}`}>
        <Icon name="more_vert" style={{ fontSize: 20 }} />
      </button>
    </div>
  )
}

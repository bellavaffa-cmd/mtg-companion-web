import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { CardZoomModal } from '../components/CardZoomModal'
import { ContextMenu } from '../components/ContextMenu'
import { useLongPress } from '../components/useLongPress'
import { CardSearchResults } from '../components/CardSearchResults'
import type { CollectionEntry } from '../types/models'

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { collections, setEntryQuantities, removeEntryFromCollection, addEntryToCollection } = useSync()
  const collection = collections.find((c) => c.id === id)
  const [zoomId, setZoomId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: CollectionEntry } | null>(null)

  if (!collection) {
    return (
      <>
        <TopBar title="BINDER" onBack={() => navigate('/collections')} />
        <div className="content-scroll">
          <div className="empty-state">Binder not found. It may have been deleted.</div>
        </div>
      </>
    )
  }

  const zoomEntry = collection.entries.find((e) => e.scryfallId === zoomId) ?? null

  return (
    <>
      <TopBar title={collection.name.toUpperCase()} onBack={() => navigate('/collections')} />
      <div className="content-scroll">
        {collection.entries.length === 0 ? (
          <div className="empty-state">No cards yet — search below to add some.</div>
        ) : (
          collection.entries.map((entry) => (
            <EntryRow
              key={entry.scryfallId}
              entry={entry}
              onZoom={() => setZoomId(entry.scryfallId)}
              onLongPress={(x, y) => setMenu({ x, y, entry })}
            />
          ))
        )}

        <div className="section-label" style={{ marginTop: 20 }}>ADD CARDS</div>
        <CardSearchResults onAdd={(card) => addEntryToCollection(collection.id, card)} />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          actions={[
            { label: 'Remove from binder', icon: 'delete', destructive: true, onClick: () => removeEntryFromCollection(collection.id, menu.entry.scryfallId) },
          ]}
        />
      )}

      {zoomEntry && (
        <CardZoomModal imageUrl={zoomEntry.imageUrl} name={zoomEntry.name} onClose={() => setZoomId(null)}>
          <div className="row" style={{ marginTop: 14, gap: 22, justifyContent: 'center' }}>
            <div>
              <div className="dim" style={{ textAlign: 'center', marginBottom: 4 }}>QTY</div>
              <div className="qty-stepper">
                <button onClick={() => setEntryQuantities(collection.id, zoomEntry.scryfallId, zoomEntry.quantity - 1, zoomEntry.foilQuantity)}>−</button>
                <span>{zoomEntry.quantity}</span>
                <button onClick={() => setEntryQuantities(collection.id, zoomEntry.scryfallId, zoomEntry.quantity + 1, zoomEntry.foilQuantity)}>+</button>
              </div>
            </div>
            <div>
              <div className="dim" style={{ textAlign: 'center', marginBottom: 4 }}>FOIL</div>
              <div className="qty-stepper">
                <button onClick={() => setEntryQuantities(collection.id, zoomEntry.scryfallId, zoomEntry.quantity, zoomEntry.foilQuantity - 1)}>−</button>
                <span>{zoomEntry.foilQuantity}</span>
                <button onClick={() => setEntryQuantities(collection.id, zoomEntry.scryfallId, zoomEntry.quantity, zoomEntry.foilQuantity + 1)}>+</button>
              </div>
            </div>
          </div>
        </CardZoomModal>
      )}
    </>
  )
}

function EntryRow({
  entry,
  onZoom,
  onLongPress,
}: {
  entry: CollectionEntry
  onZoom: () => void
  onLongPress: (x: number, y: number) => void
}) {
  const longPress = useLongPress({ onLongPress, onClick: onZoom })
  return (
    <div className="card-row" {...longPress} style={{ cursor: 'pointer' }}>
      {entry.imageUrl && <img src={entry.imageUrl} alt={entry.name} />}
      <div className="name">{entry.name}</div>
      <div className="dim">
        {entry.quantity}
        {entry.foilQuantity > 0 ? ` (+${entry.foilQuantity} foil)` : ''}
      </div>
    </div>
  )
}

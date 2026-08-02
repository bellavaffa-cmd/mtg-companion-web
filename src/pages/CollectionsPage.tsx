import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ContextMenu } from '../components/ContextMenu'
import { useLongPress } from '../components/useLongPress'
import type { Collection, CollectionType } from '../types/models'

export function CollectionsPage() {
  const { collections, deleteCollection } = useSync()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; collection: Collection } | null>(null)

  return (
    <>
      <TopBar
        title="COLLECTION"
        actions={
          <button className="top-bar-icon" onClick={() => setShowCreate(true)} aria-label="New binder">
            <Icon name="add" />
          </button>
        }
      />
      <div className="content-scroll">
        {collections.length === 0 ? (
          <div className="empty-state">No binders yet. Tap + to create one.</div>
        ) : (
          collections.map((c) => (
            <CollectionRow
              key={c.id}
              collection={c}
              onClick={() => navigate(`/collections/${c.id}`)}
              onLongPress={(x, y) => setMenu({ x, y, collection: c })}
            />
          ))
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          actions={[
            { label: 'Delete binder', icon: 'delete', destructive: true, onClick: () => deleteCollection(menu.collection.id) },
          ]}
        />
      )}

      {showCreate && <CreateCollectionDialog onDismiss={() => setShowCreate(false)} />}
    </>
  )
}

function CollectionRow({
  collection,
  onClick,
  onLongPress,
}: {
  collection: Collection
  onClick: () => void
  onLongPress: (x: number, y: number) => void
}) {
  const longPress = useLongPress({ onLongPress, onClick })
  const total = collection.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0)
  const label = collection.type === 'WISHLIST' ? 'WISHLIST · ' : ''

  return (
    <div className="card-row" {...longPress} style={{ cursor: 'pointer' }}>
      <Icon name={collection.type === 'WISHLIST' ? 'star' : 'collections'} style={{ fontSize: 32, color: 'var(--accent-dim)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="name" style={{ whiteSpace: 'normal' }}>{collection.name}</div>
        <div className="type-line">{label}{total} cards · {collection.entries.length} unique</div>
      </div>
    </div>
  )
}

function CreateCollectionDialog({ onDismiss }: { onDismiss: () => void }) {
  const { createCollection } = useSync()
  const [name, setName] = useState('')
  const [type, setType] = useState<CollectionType>('OWNED')

  return (
    <Dialog
      title="New binder"
      onDismiss={onDismiss}
      actions={
        <>
          <button className="btn" onClick={onDismiss}>CANCEL</button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              createCollection(name.trim(), type)
              onDismiss()
            }}
          >
            CREATE
          </button>
        </>
      }
    >
      <div className="field-label">Binder name</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="field-label" style={{ marginTop: 14 }}>Type</div>
      <select className="input" value={type} onChange={(e) => setType(e.target.value as CollectionType)}>
        <option value="OWNED">Owned</option>
        <option value="WISHLIST">Wishlist</option>
      </select>
    </Dialog>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import type { CollectionType } from '../types/models'

export function CollectionsPage() {
  const { collections, createCollection, deleteCollection } = useSync()
  const [name, setName] = useState('')
  const [type, setType] = useState<CollectionType>('OWNED')

  return (
    <div>
      <h1 className="page-title">COLLECTION</h1>
      <div className="card-panel" style={{ marginBottom: 20 }}>
        <div className="row">
          <input
            className="input"
            placeholder="New binder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <select className="input" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value as CollectionType)}>
            <option value="OWNED">Owned</option>
            <option value="WISHLIST">Wishlist</option>
          </select>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              createCollection(name.trim(), type)
              setName('')
            }}
          >
            Create
          </button>
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="empty-state">No binders yet. Create one above.</div>
      ) : (
        collections.map((c) => {
          const totalCards = c.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0)
          return (
            <div key={c.id} className="card-row" style={{ padding: '14px 16px' }}>
              <Link to={`/collections/${c.id}`} className="name" style={{ color: 'var(--text-primary)' }}>
                <div style={{ fontSize: 15 }}>{c.name}</div>
                <div className="dim">
                  {c.type === 'WISHLIST' ? 'Wishlist' : 'Owned'} · {totalCards} card{totalCards === 1 ? '' : 's'}
                </div>
              </Link>
              <button className="btn btn-danger" onClick={() => deleteCollection(c.id)}>
                Delete
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}

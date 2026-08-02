import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { CardSearchResults } from '../components/CardSearchResults'

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { collections, setEntryQuantities, removeEntryFromCollection, addEntryToCollection } = useSync()
  const collection = collections.find((c) => c.id === id)

  if (!collection) {
    return <div className="empty-state">Binder not found. It may have been deleted.</div>
  }

  return (
    <div>
      <button className="btn" onClick={() => navigate('/collections')} style={{ marginBottom: 16 }}>
        ← Back to Collection
      </button>
      <h1 className="page-title">{collection.name.toUpperCase()}</h1>

      {collection.entries.length === 0 ? (
        <div className="empty-state">No cards yet — search below to add some.</div>
      ) : (
        collection.entries.map((entry) => (
          <div key={entry.scryfallId} className="card-row">
            {entry.imageUrl && <img src={entry.imageUrl} alt={entry.name} />}
            <div className="name">{entry.name}</div>
            <div className="qty-stepper">
              <span className="dim">Qty</span>
              <button onClick={() => setEntryQuantities(collection.id, entry.scryfallId, entry.quantity - 1, entry.foilQuantity)}>−</button>
              <span>{entry.quantity}</span>
              <button onClick={() => setEntryQuantities(collection.id, entry.scryfallId, entry.quantity + 1, entry.foilQuantity)}>+</button>
            </div>
            <div className="qty-stepper">
              <span className="dim">Foil</span>
              <button onClick={() => setEntryQuantities(collection.id, entry.scryfallId, entry.quantity, entry.foilQuantity - 1)}>−</button>
              <span>{entry.foilQuantity}</span>
              <button onClick={() => setEntryQuantities(collection.id, entry.scryfallId, entry.quantity, entry.foilQuantity + 1)}>+</button>
            </div>
            <button className="btn btn-danger" onClick={() => removeEntryFromCollection(collection.id, entry.scryfallId)}>
              Remove
            </button>
          </div>
        ))
      )}

      <div className="card-panel" style={{ marginTop: 24 }}>
        <div className="muted" style={{ marginBottom: 10 }}>ADD CARDS</div>
        <CardSearchResults onAdd={(card) => addEntryToCollection(collection.id, card)} />
      </div>
    </div>
  )
}

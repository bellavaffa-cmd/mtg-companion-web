import { useState } from 'react'
import { useSync } from '../sync/SyncContext'
import type { ScryfallCard } from '../types/scryfall'

/** A small "Add to…" dropdown listing every deck/binder, for the standalone Search page. */
export function AddToTargetMenu({ card }: { card: ScryfallCard }) {
  const { decks, collections, addCardToDeck, addEntryToCollection } = useSync()
  const [open, setOpen] = useState(false)

  if (decks.length === 0 && collections.length === 0) {
    return <span className="dim">No decks/binders yet</span>
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-primary" onClick={() => setOpen((v) => !v)}>
        Add to…
      </button>
      {open && (
        <div
          className="card-panel"
          style={{ position: 'absolute', right: 0, top: '110%', zIndex: 10, minWidth: 180, maxHeight: 260, overflowY: 'auto' }}
        >
          {collections.length > 0 && <div className="dim" style={{ marginBottom: 4 }}>BINDERS</div>}
          {collections.map((c) => (
            <div
              key={c.id}
              className="nav-link"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                addEntryToCollection(c.id, card)
                setOpen(false)
              }}
            >
              {c.name}
            </div>
          ))}
          {decks.length > 0 && <div className="dim" style={{ margin: '8px 0 4px' }}>DECKS</div>}
          {decks.map((d) => (
            <div
              key={d.id}
              className="nav-link"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                addCardToDeck(d.id, card)
                setOpen(false)
              }}
            >
              {d.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

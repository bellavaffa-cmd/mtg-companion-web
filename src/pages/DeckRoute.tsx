import { Navigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { isCube } from '../decks/cube'
import { DeckDetailPage } from './DeckDetailPage'

/** A deck's page — or, for a cube (kept as a deck, decks/cube.ts), the cube's own page. */
export function DeckRoute() {
  const { id } = useParams<{ id: string }>()
  const { decks } = useSync()
  const deck = decks.find((d) => d.id === id)
  if (deck && isCube(deck)) return <Navigate to={`/cubes/${deck.id}`} replace />
  return <DeckDetailPage />
}

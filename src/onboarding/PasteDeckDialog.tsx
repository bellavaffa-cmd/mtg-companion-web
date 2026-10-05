import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DeckImportDialog } from '../components/DeckBuildingDialogs'
import { useSync } from '../sync/SyncContext'

/**
 * "Paste a list" for a deck that doesn't exist yet: the decklist import every deck has, into a new
 * Commander deck made when the cards are found (so cancelling leaves nothing behind). Closing it
 * opens the new deck. Used by the welcome flow and the empty Decks page. The Android app's
 * ui/onboarding/PasteDeckDialog.kt.
 */
export function PasteDeckDialog({ name = 'My deck', onDismiss }: { name?: string; onDismiss: () => void }) {
  const { createDeck, importIntoDeck } = useSync()
  const navigate = useNavigate()
  const made = useRef<string | null>(null)
  return (
    <DeckImportDialog
      mode="COMMANDER"
      onImport={async (cards, considering, sideboard) => {
        const deck = createDeck(name.trim() || 'My deck', 'COMMANDER')
        made.current = deck.id
        importIntoDeck(deck.id, cards, considering, sideboard)
        return { cards, sideboard }
      }}
      onDismiss={() => {
        onDismiss()
        if (made.current) navigate(`/decks/${made.current}`)
      }}
    />
  )
}

// Where a card's copies are, on its row: "Blue box › Instants ×2", "Talrand deck ×1", "Lent to Sam ×1",
// at most two and then "+N", and an amber "No place yet · Put away" when some copies have none. The
// words are collectionLayout.ts's (chipText, chipDescription); the Android app's LocationChipsUi.kt.

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { knownCards } from './cardData'
import { chipDescription, chipText, moreChipsDescription, shownChips, type LocationChip } from './collectionLayout'
import { putAwayMove } from './copyHistory'
import { recordMoves } from './copyHistoryStore'
import { cardFactsOf, placesOf, placeUnplaced, suggestSpot } from './storagePlaces'
import { PlacePicker } from './StorageTab'
import './collectionTabs.css'

/** What a chip's tap does; a missing one leaves the chip as plain text. */
export interface ChipActions {
  onPlace?: (placeId: string, section?: string, page?: number) => void
  onDeck?: (deckId: string) => void
  onLent?: () => void
  onPutAway?: () => void
  /** "+N": everything, on the card's page. */
  onMore?: () => void
}

export function LocationChips({ chips, actions }: { chips: LocationChip[]; actions: ChipActions }) {
  if (chips.length === 0) return null
  const { shown, more } = shownChips(chips)
  return (
    <span className="loc-chips">
      {shown.map((chip, i) => {
        const tap = chip.kind === 'place' ? (chip.placeId && actions.onPlace ? () => actions.onPlace!(chip.placeId!, chip.section, chip.page) : undefined)
          : chip.kind === 'deck' ? (chip.deckId && actions.onDeck ? () => actions.onDeck!(chip.deckId!) : undefined)
          : chip.kind === 'lent' ? actions.onLent
          : actions.onPutAway
        return <Chip key={i} text={chipText(chip)} label={chipDescription(chip)} amber={chip.kind === 'none'} onClick={tap} />
      })}
      {more > 0 && <Chip text={`+${more}`} label={moreChipsDescription(more)} amber={false} onClick={actions.onMore} />}
    </span>
  )
}

function Chip({ text, label, amber, onClick }: { text: string; label: string; amber: boolean; onClick?: () => void }) {
  const cls = `loc-chip${amber ? ' amber' : ''}`
  if (!onClick) return <span className={cls}><span aria-hidden="true">{text}</span><span className="sr-only">{label}</span></span>
  return (
    <button
      type="button"
      className={`${cls} press`}
      aria-label={label}
      // A chip sits on a row that opens the card: its tap is its own.
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {text}
    </button>
  )
}

/**
 * A row's "No place yet · Put away": pick a place and the card's copies with none go there, where the
 * place's rule puts them (as Where it is's Give it a place). With no places yet, setting up storage.
 */
export function PutAwayCard({ name, scryfallId, count, onClose }: { name: string; scryfallId: string; count: number; onClose: () => void }) {
  const { collections, changeStorage } = useSync()
  const navigate = useNavigate()
  const places = placesOf(collections)
  useEffect(() => {
    if (places.length === 0) { onClose(); navigate('/collections/setup') }
  }, [places.length, onClose, navigate])
  if (places.length === 0) return null
  const give = (placeId: string) => {
    const place = places.find((p) => p.id === placeId)
    if (!place) return
    const card = knownCards.get(scryfallId)
    let moved = 0
    changeStorage((c) => {
      const out = placeUnplaced(c, name, scryfallId, suggestSpot(place, card ? cardFactsOf(card) : { name }, c).spot, Math.max(1, count))
      moved = out.moved
      return out.collections
    })
    if (moved > 0) recordMoves([putAwayMove(Date.now(), { name, scryfallId }, moved, { id: place.id, name: place.name }, null)])
  }
  return <PlacePicker title={`Give ${name} a place`} onPick={give} onClose={onClose} />
}

import { useMemo, useRef } from 'react'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { copiesWithin, parentsOf, placesOf, storageSummary } from './storagePlaces'
import { openPullDeck } from './pullProgress'
import { pullGroupsIn, pullList } from './pullList'
import { useModalFocus } from '../components/useModalFocus'

/**
 * What a scanned box label offers, the Android app's PlaceLabelSheet: put cards away into the place,
 * open it, or — with a pull list open — pull from it. A label for a place that isn't in the
 * collection (deleted, or another account's) says so. Shown by the scanner, and at /place/:id where
 * a phone's own camera takes the label's link. [inline]: in a page rather than over the camera.
 */
export function PlaceLabelContent({ placeId, onPutAway, onOpen, onPull, onClose }: {
  placeId: string
  onPutAway: (id: string) => void
  onOpen: (id: string) => void
  onPull: (deckId: string, placeId: string) => void
  onClose?: () => void
}) {
  const { collections, decks } = useSync()
  const places = placesOf(collections)
  const place = places.find((p) => p.id === placeId)
  const summary = useMemo(() => storageSummary(collections, decks), [collections, decks])
  const pullDeck = useMemo(() => {
    const id = openPullDeck()
    const deck = id ? decks.find((d) => d.id === id) : undefined
    if (!deck || !place) return null
    // Only when the open pull list needs something from here.
    return pullGroupsIn(pullList(deck, collections, decks), collections, place.id).length > 0 ? deck : null
  }, [decks, collections, place])

  if (!place) {
    return (
      <div className="label-found">
        <div className="label-found-h"><Icon name="qr_code_2" aria-hidden /><b>This label's place isn't in your collection</b></div>
        <span className="dim">It may have been deleted, or the label belongs to another account.</span>
        {onClose && <button type="button" className="btn line" onClick={onClose}>OK</button>}
      </div>
    )
  }
  const where = parentsOf(places, place.id).map((p) => p.name).join(' › ')
  const copies = copiesWithin(summary, places, place.id)
  return (
    <div className="label-found">
      <span className="label-h">Box label found</span>
      <div className="label-found-place">
        {where && <span className="where">{where}</span>}
        <b>{place.name}</b>
        <span className="dim">{copies} {copies === 1 ? 'copy' : 'copies'}</span>
      </div>
      <button type="button" className="btn gold" onClick={() => onPutAway(place.id)}><Icon name="document_scanner" aria-hidden />Put cards away here</button>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn line" style={{ flex: 1 }} onClick={() => onOpen(place.id)}>Open box</button>
        {pullDeck && <button type="button" className="btn line" style={{ flex: 1 }} onClick={() => onPull(pullDeck.id, place.id)}>Pull from here</button>}
      </div>
      {pullDeck && <span className="dim">Pull from here shows only the cards your open pull list ({pullDeck.name}) needs from this box.</span>}
    </div>
  )
}

/** The same over the scanner's camera, as a sheet. */
export function PlaceLabelSheet(props: Parameters<typeof PlaceLabelContent>[0] & { onClose: () => void }) {
  const { onClose } = props
  const box = useRef<HTMLDivElement>(null)
  const keepFocusIn = useModalFocus(box, onClose)
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={box} className="sheet" role="dialog" aria-modal="true" aria-label="Box label" onKeyDown={keepFocusIn}>
        <div className="grab" />
        <PlaceLabelContent {...props} />
      </div>
    </>
  )
}

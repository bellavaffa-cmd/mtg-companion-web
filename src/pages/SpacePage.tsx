import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { PageHeader, useBack } from '../components/kit'
import { useCopyHistory } from '../collection/copyHistoryStore'
import { lastPileAdded, planSplit, spaceOf, splitBox, withSize } from '../collection/boxSpace'
import { cardsIn, placesOf, placeTree, savePlace } from '../collection/storagePlaces'
import { SizeDialog, SpaceCard, SplitSection } from '../collection/SpaceParts'
import type { StoragePlace } from '../types/models'
import '../collection/storage.css'
import '../collection/inventory.css'

/**
 * Box space, the Android app's SpaceScreen: every place with a size as a bar — "96% full · 612 of
 * 640", the fullest first — with "Room for about 28 more", Split into two boxes (on whole sections,
 * then the new box's label to print) and Change size; the places with no size yet below. The logic
 * is collection/boxSpace.ts. At /collections/space.
 */
export function SpacePage() {
  const { collections, changeStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const history = useCopyHistory()
  const places = placesOf(collections)
  const sized = useMemo(() => {
    const ps = placesOf(collections)
    return placeTree(ps)
      .flatMap((n) => { const s = spaceOf(n.place, collections); return s ? [{ place: n.place, space: s }] : [] })
      .sort((a, b) => b.space.used / Math.max(1, b.space.size) - a.space.used / Math.max(1, a.space.size))
  }, [collections])
  const unsized = places.filter((p) => !sized.some((s) => s.place.id === p.id) && p.kind !== 'DECK_BOX')
  const [selected, setSelected] = useState<string | null>(null)
  const [splitting, setSplitting] = useState<string | null>(null)
  const [sizing, setSizing] = useState<StoragePlace | null>(null)
  const open = selected ?? sized.find((s) => s.space.used * 100 >= s.space.size * 90)?.place.id ?? null
  const splitPlace = splitting ? places.find((p) => p.id === splitting) ?? null : null
  const plan = splitPlace ? planSplit(splitPlace, cardsIn(collections, splitPlace.id)) : null

  const split = () => {
    if (!splitPlace) return
    const id = crypto.randomUUID()
    const now = Date.now()
    changeStorage((c) => {
      const p = placesOf(c).find((x) => x.id === splitPlace.id)
      const fresh = p ? planSplit(p, cardsIn(c, p.id)) : null
      return fresh ? splitBox(c, splitPlace.id, fresh, id, now) : c
    })
    setSplitting(null)
    navigate(`/collections/place/${id}/label`)
  }

  return (
    <>
      <PageHeader title="Space" onBack={back} />
      <div className="content-scroll pull-page">
        <div className="space-list">
          {sized.length === 0 && <div className="dim">No place has a size yet. Give a box the cards it holds, or a binder its pages, and see how full each is.</div>}
          {sized.map(({ place, space }) => (
            <SpaceCard
              key={place.id}
              place={place}
              space={space}
              lastPile={lastPileAdded(history, place.id)}
              open={place.id === open}
              canSplit={place.kind !== 'BINDER' && planSplit(place, cardsIn(collections, place.id)) !== null}
              onClick={() => { setSelected(place.id); if (splitting !== place.id) setSplitting(null) }}
              onOpen={() => navigate(`/collections/place/${place.id}`)}
              onSplit={() => { setSelected(place.id); setSplitting(place.id) }}
              onSize={() => setSizing(place)}
            />
          ))}
        </div>
        {splitPlace && plan && <SplitSection place={splitPlace} plan={plan} places={places} />}
        {unsized.length > 0 && (
          <div className="space-list" style={{ marginTop: 18 }}>
            <h3 className="section-label" style={{ margin: 0, fontSize: 12, color: 'var(--t1)', letterSpacing: '0.06em' }}>NO SIZE YET</h3>
            {unsized.map((p) => (
              <div key={p.id} className="space-card" style={{ flexDirection: 'row', alignItems: 'center' }}>
                <button type="button" className="link" style={{ flex: 1, textAlign: 'left', padding: 0, color: 'inherit', fontWeight: 700 }} onClick={() => navigate(`/collections/place/${p.id}`)}>{p.name}</button>
                <button type="button" className="btn line sm" onClick={() => setSizing(p)}>Set size</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {splitPlace && plan && (
        <div className="pull-bar">
          <button type="button" className="btn gold" onClick={split}>Split and print new label</button>
        </div>
      )}
      {sizing && (
        <SizeDialog
          place={sizing}
          onDismiss={() => setSizing(null)}
          onSave={(n) => {
            changeStorage((c) => { const p = placesOf(c).find((x) => x.id === sizing.id); return p ? savePlace(c, withSize(p, n)) : c })
            setSizing(null)
          }}
        />
      )}
    </>
  )
}

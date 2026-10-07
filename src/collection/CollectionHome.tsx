// The Collection's home (the Android app's CollectionHome.kt): what the collection is worth, "Find a
// card, a place or a deck", a tile for each part — All cards, Storage, Binders, Sets, Sealed and
// graded, Loans and selling — the few things worth doing this week (from Upkeep) and Scan, Sort a
// pile and Import. The numbers are collectionHome.ts. The tabs it opens stay at /collections?tab=….

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { ActionSheet } from '../components/ActionSheet'
import { rise } from '../components/kit'
import { useMoney } from '../money/currency'
import { homeNumbers, homeTiles, homeTodo, type HomeTileKey } from './collectionHome'
import { useUpkeep } from './useUpkeep'
import { upkeepHeadline, type UpkeepItem } from './upkeep'
import { placesOf } from './storagePlaces'
import { PlacePicker } from './StorageTab'
import { useNewSetsLine } from './newSetsStore'
import './collectionHome.css'

const TILE_ICONS: Record<HomeTileKey, string> = {
  all: 'style', storage: 'shelves', binders: 'collections', sets: 'grid_view', sealed: 'inventory_2', loans: 'handshake',
}

/** The tour's names for the parts it lights up (WhatsNewTour.tsx). */
const TILE_TOUR: Partial<Record<HomeTileKey, string>> = { storage: 'home-storage', sealed: 'home-sealed' }

export function CollectionHome({ onImport }: { onImport: () => void }) {
  const { collections, decks } = useSync()
  const navigate = useNavigate()
  const money = useMoney()
  const numbers = useMemo(() => homeNumbers(collections, decks), [collections, decks])
  const tiles = homeTiles(numbers, (usd) => money.format(usd, true))
  const upkeep = useUpkeep()
  const todo = homeTodo(upkeep.items, decks)
  const [choosing, setChoosing] = useState(false)
  const [sheet, setSheet] = useState<'loans' | null>(null)
  const hasPlaces = placesOf(collections).length > 0
  const sets = useNewSetsLine()

  const openTile = (key: HomeTileKey) => {
    switch (key) {
      case 'all': case 'storage': case 'binders': case 'sets': navigate(`/collections?tab=${key}`); break
      case 'sealed': navigate('/collections/sealed'); break
      case 'loans': setSheet('loans'); break
    }
  }
  const doTodo = (item: UpkeepItem) => {
    switch (item.kind) {
      case 'PUT_AWAY': if (hasPlaces) setChoosing(true); else navigate('/collections/setup'); break
      case 'CHECK': navigate(`/scan?check=${encodeURIComponent(item.placeId ?? '')}`); break
      case 'REMIND': navigate('/loans'); break
      case 'SPLIT': navigate('/collections/space'); break
      case 'CARRY_ON': navigate(`/decks/${item.deckId}/pull`); break
    }
  }

  return (
    <div className="chome">
      <button type="button" className="chome-find press rise" style={rise(1)} data-tour="home-find" onClick={() => navigate('/collections/find')}>
        <Icon name="search" aria-hidden />
        <span>Find a card, a place or a deck</span>
      </button>

      <div className="chome-tiles rise" style={rise(2)} data-tour="home-tiles">
        {tiles.map((t) => (
          <button key={t.key} type="button" className="chome-tile press" data-tour={TILE_TOUR[t.key]} onClick={() => openTile(t.key)}>
            <Icon name={TILE_ICONS[t.key]} className="chome-tile-icon" aria-hidden />
            <b>{t.title}</b>
            <span>{t.line}</span>
          </button>
        ))}
      </div>

      <button type="button" className="chome-sets press rise" style={rise(3)} onClick={() => navigate('/new-sets')}>
        <Icon name="new_releases" aria-hidden />
        <span className="chome-sets-text"><b>New sets</b><span>{sets.line}</span></span>
        {sets.out > 0 && <span className="badge" aria-label={`${sets.out} followed ${sets.out === 1 ? 'set is' : 'sets are'} out`}>{sets.out}</span>}
        <Icon name="chevron_right" aria-hidden />
      </button>

      <section className="chome-todo rise" style={rise(3)} data-tour="home-todo">
        <div className="chome-head">
          <h2>To do</h2>
          <button type="button" className="link" onClick={() => navigate('/collections/upkeep')}>Upkeep</button>
        </div>
        {todo.length === 0
          ? <div className="chome-row"><span className="dim">{upkeepHeadline(0)}</span></div>
          : todo.map((t, i) => (
            <div key={`${t.item.kind}:${t.item.placeId ?? ''}:${t.item.personKey ?? ''}:${t.item.deckId ?? ''}`} className="chome-row">
              <span>{t.title}</span>
              <button type="button" className={`btn sm ${i === 0 ? 'gold' : 'line'}`} onClick={() => doTodo(t.item)}>{t.action}</button>
            </div>
          ))}
      </section>

      <div className="chome-quick rise" style={rise(4)}>
        <button type="button" className="btn line" onClick={() => navigate('/scan')}><Icon name="photo_camera" aria-hidden />Scan</button>
        <button type="button" className="btn line" onClick={() => navigate('/scan?sort')}><Icon name="call_split" aria-hidden />Sort a pile</button>
        <button type="button" className="btn line" onClick={onImport}><Icon name="playlist_add" aria-hidden />Import</button>
      </div>

      {choosing && (
        <PlacePicker title="Put cards away into…" onPick={(id) => navigate(`/scan?putAway=${encodeURIComponent(id)}`)} onClose={() => setChoosing(false)} />
      )}
      {sheet === 'loans' && (
        <ActionSheet
          title="Loans and selling"
          actions={[
            { label: 'Loans', icon: 'handshake', detail: `${numbers.lentOut} out`, onClick: () => navigate('/loans') },
            { label: 'To sell', icon: 'sell', detail: `${numbers.toSell} to sell`, onClick: () => navigate('/collections/sell') },
          ]}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

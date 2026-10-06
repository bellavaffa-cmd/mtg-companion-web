import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { PageHeader, useBack } from '../components/kit'
import { PlacePicker } from '../collection/StorageTab'
import { placesOf } from '../collection/storagePlaces'
import { upkeepHeadline, type UpkeepItem, type UpkeepKind } from '../collection/upkeep'
import { useUpkeep } from '../collection/useUpkeep'
import '../collection/storage.css'

const ICONS: Record<UpkeepKind, string> = { PUT_AWAY: 'inventory_2', CHECK: 'qr_code_scanner', REMIND: 'handshake', SPLIT: 'call_split', CARRY_ON: 'checklist' }

/**
 * Upkeep, the Android app's UpkeepScreen: the share of copies with a place and the things worth doing
 * this week — copies with no place, places not checked in 90 days, overdue loans, full boxes and pull
 * lists half done — each opening the page that does it. The logic is collection/upkeep.ts. At
 * /collections/upkeep.
 */
export function UpkeepPage() {
  const { collections } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const report = useUpkeep()
  const places = placesOf(collections)
  const [choosing, setChoosing] = useState(false)
  const share = report.total > 0 ? report.placed / report.total : 0

  const open = (item: UpkeepItem) => {
    switch (item.kind) {
      case 'PUT_AWAY': if (places.length === 0) navigate('/collections/setup'); else setChoosing(true); break
      case 'CHECK': navigate(`/scan?check=${encodeURIComponent(item.placeId ?? '')}`); break
      case 'REMIND': navigate('/loans'); break
      case 'SPLIT': navigate('/collections/space'); break
      case 'CARRY_ON': navigate(`/decks/${item.deckId}/pull`); break
    }
  }

  return (
    <>
      <PageHeader title="Upkeep" onBack={back} />
      <div className="content-scroll pull-page">
        <div className="storage-progress upkeep-head">
          <div className="upkeep-big"><b>{report.percent}%</b><span>of copies have a place</span></div>
          <div className="storage-bar"><div style={{ width: `${Math.round(share * 100)}%` }} /></div>
          <div className="storage-progress-h">{upkeepHeadline(report.items.length)}</div>
        </div>
        <div className="storage-list" style={{ marginTop: 10 }}>
          {report.items.map((item) => (
            <div key={`${item.kind}:${item.placeId ?? ''}:${item.personKey ?? ''}:${item.deckId ?? ''}`} className="storage-card storage-row upkeep-row">
              <Icon name={ICONS[item.kind]} className="storage-icon gold" />
              <div className="storage-text upkeep-text"><b>{item.title}</b>{item.detail && <span>{item.detail}</span>}</div>
              <button type="button" className="btn gold sm" onClick={() => open(item)}>{item.action}</button>
            </div>
          ))}
          <div className="storage-card storage-row upkeep-row" style={{ marginTop: 8 }}>
            <Icon name="notifications" className="storage-icon" />
            <div className="storage-text upkeep-text">
              <b>Weekly reminder</b>
              <span>The Manabind phone app can say what's worth doing once a week, in a notification. Here, this page always has it.</span>
            </div>
          </div>
        </div>
      </div>
      {choosing && (
        <PlacePicker title="Put cards away into…" onPick={(id) => navigate(`/scan?putAway=${encodeURIComponent(id)}`)} onClose={() => setChoosing(false)} />
      )}
    </>
  )
}

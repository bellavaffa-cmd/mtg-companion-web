import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { countAction } from '../usage/usage'
import { Icon } from '../components/Icon'
import { PageHeader, useBack } from '../components/kit'
import { PLACE_ICONS } from '../collection/StorageTab'
import { copiesWithin, placesOf, SORT_RULE_SHORT, storageSummary } from '../collection/storagePlaces'
import {
  applySetup, DEFAULT_SETUP, deckBoxCount, nextBoxRule, nextPockets, placedPercent, setupDrafts, setupPlaces, type SetupCounts,
} from '../collection/storageSetup'
import '../collection/storage.css'

/**
 * Getting started with storage, the Android app's StorageSetupScreen: what the cards are kept in, the
 * places' names, then their labels and putting cards away one box at a time, with the share of copies
 * that have a place. The logic is collection/storageSetup.ts. At /collections/setup.
 */
export function StorageSetupPage() {
  const { collections, decks, changeStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const [step, setStep] = useState(1)
  const [counts, setCounts] = useState<SetupCounts>(DEFAULT_SETUP)
  const [names, setNames] = useState<Record<string, string>>({})
  const [made, setMade] = useState<string[]>([])
  const places = placesOf(collections)
  const drafts = useMemo(() => setupDrafts(counts, step === 3 ? [] : placesOf(collections)), [counts, step, collections])
  const summary = useMemo(() => storageSummary(collections, decks), [collections, decks])
  const total = counts.binders + counts.boxes + counts.shelves
  const set = (over: Partial<SetupCounts>) => setCounts((c) => ({ ...c, ...over }))

  const make = () => {
    const fresh = setupPlaces(counts, drafts, names, Date.now(), () => crypto.randomUUID())
    changeStorage((c) => applySetup(c, fresh))
    fresh.forEach(() => countAction('place_created'))
    setMade(fresh.map((p) => p.id))
    setStep(3)
  }
  const toFill = places.filter((p) => made.includes(p.id) && p.kind !== 'SHELF')

  return (
    <>
      <PageHeader title="Set up storage" onBack={step === 2 ? () => setStep(1) : back} />
      <div className="content-scroll pull-page">
        <div className="setup">
          <div className="setup-step">Step {step} of 3</div>
          {step === 1 && (
            <>
              <h2>What do you keep your cards in?</h2>
              <p className="muted">Rough numbers are fine. You can add, rename and move places later.</p>
              <CountRow icon={PLACE_ICONS.BINDER} title="Binders" detail={`${counts.pockets} per page`} value={counts.binders}
                onDetail={() => set({ pockets: nextPockets(counts.pockets) })} onValue={(binders) => set({ binders })} />
              <CountRow icon={PLACE_ICONS.BOX} title="Bulk boxes" detail={counts.boxRule ? SORT_RULE_SHORT[counts.boxRule] : 'not sorted'} value={counts.boxes}
                onDetail={() => set({ boxRule: nextBoxRule(counts.boxRule) })} onValue={(boxes) => set({ boxes })} />
              <div className="storage-card storage-row setup-row">
                <Icon name="style" className="storage-icon gold" />
                <div className="storage-text"><b>Deck boxes</b><span>one per physical deck{deckBoxCount(decks) > 0 ? ` · ${deckBoxCount(decks)} now` : ''}</span></div>
                <span className="storage-n">Automatic</span>
              </div>
              <CountRow icon={PLACE_ICONS.SHELF} title="A shelf or cupboard" detail="to group the rest" value={counts.shelves} onValue={(shelves) => set({ shelves })} />
              <p className="dim setup-note">Next: name them, then print labels. Then put cards away one box at a time; the progress bar shows how far you are.</p>
              <div className="place-actions">
                <button type="button" className="btn line" onClick={back}>Skip</button>
                <button type="button" className="btn gold" disabled={total === 0} onClick={() => setStep(2)}>Next: name them</button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h2>Name them</h2>
              <p className="muted">Call each what's written on it, or will be. Binders and boxes go inside the shelf.</p>
              {drafts.map((d) => (
                <label key={d.key} className="setup-name">
                  <Icon name={PLACE_ICONS[d.kind]} className="storage-icon gold" />
                  <input className="input" aria-label={`${d.name} name`} value={names[d.key] ?? d.name} maxLength={60} onChange={(e) => setNames((n) => ({ ...n, [d.key]: e.target.value }))} />
                </label>
              ))}
              <div className="place-actions">
                <button type="button" className="btn line" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="btn gold" onClick={make}>Make {drafts.length} {drafts.length === 1 ? 'place' : 'places'}</button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h2>Labels, then put cards away</h2>
              <p className="muted">Print a label for each place and stick it on. Then put cards away one box at a time: scan each card as it goes in.</p>
              <div className="storage-progress">
                <div className="storage-progress-h">{placedPercent(summary)}% of copies have a place</div>
                <div className="storage-bar"><div style={{ width: `${summary.total > 0 ? Math.round((summary.placed / summary.total) * 100) : 0}%` }} /></div>
                <span className="dim" style={{ fontSize: 12.5 }}>{summary.placed} of {summary.total} · {summary.unplaced} to go</span>
              </div>
              <div className="place-actions">
                <button type="button" className="btn line" onClick={() => navigate('/collections/labels')}><Icon name="qr_code_2" aria-hidden />Print labels</button>
              </div>
              <div className="storage-list" style={{ marginTop: 10 }}>
                {toFill.map((p) => (
                  <div key={p.id} className="storage-card storage-row setup-row">
                    <Icon name={PLACE_ICONS[p.kind]} className="storage-icon gold" />
                    <div className="storage-text"><b>{p.name}</b><span>{copiesWithin(summary, places, p.id)} copies</span></div>
                    <button type="button" className="btn line sm" onClick={() => navigate(`/scan?putAway=${encodeURIComponent(p.id)}`)}>Put away</button>
                  </div>
                ))}
              </div>
              <div className="place-actions">
                <button type="button" className="btn gold" onClick={back}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** A row with − and + either side of its number; tapping [detail] (when [onDetail]) changes it. */
function CountRow({ icon, title, detail, value, onDetail, onValue }: {
  icon: string; title: string; detail: string; value: number; onDetail?: () => void; onValue: (n: number) => void
}) {
  return (
    <div className="storage-card storage-row setup-row">
      <Icon name={icon} className="storage-icon gold" />
      <div className="storage-text">
        <b>{title}</b>
        {onDetail ? <button type="button" className="link setup-detail" onClick={onDetail}>{detail}</button> : <span>{detail}</span>}
      </div>
      <div className="setup-stepper">
        <button type="button" className="ib" aria-label={`Fewer ${title.toLowerCase()}`} disabled={value <= 0} onClick={() => onValue(value - 1)}><Icon name="remove" /></button>
        <b>{value}</b>
        <button type="button" className="ib" aria-label={`More ${title.toLowerCase()}`} disabled={value >= 50} onClick={() => onValue(value + 1)}><Icon name="add" /></button>
      </div>
    </div>
  )
}

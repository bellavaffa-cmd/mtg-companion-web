import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { PageHeader, useBack } from '../components/kit'
import { QrCode } from '../social/ui'
import { copiesWithin, placesOf, storageSummary } from '../collection/storagePlaces'
import {
  DEFAULT_LABEL_SHOW, LABEL_SIZES, labelOrder, labelSizeInfo, labelText, placeLabelLink,
  type LabelShow, type LabelSize,
} from '../collection/placeLabel'
import type { StoragePlace } from '../types/models'
import { PlaceLabelContent } from '../collection/PlaceLabelSheet'
import '../collection/storage.css'

const SHOW_CHIPS: { key: keyof LabelShow; label: string }[] = [
  { key: 'where', label: 'Where it lives' },
  { key: 'sections', label: 'Sections' },
  { key: 'rule', label: 'Sorting rule' },
  { key: 'count', label: 'Card count' },
]

/**
 * A storage place's label, the Android app's PlaceLabelScreen: a preview with its QR code (a link to
 * the place — collection/placeLabel.ts), where it lives, its sections and sorting rule, in one of
 * three sizes; printed (or saved as a PDF) with the browser's own print, which prints only the labels.
 * "All labels" puts every place's label on one sheet. At /collections/place/:id/label (?all=1).
 */
export function PlaceLabelPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const { collections, decks } = useSync()
  const back = useBack(`/collections/place/${id}`)
  const places = placesOf(collections)
  const place = places.find((p) => p.id === id)
  const summary = useMemo(() => storageSummary(collections, decks), [collections, decks])
  const [size, setSize] = useState<LabelSize>('BOX_END')
  const [show, setShow] = useState<LabelShow>(DEFAULT_LABEL_SHOW)
  const all = params.get('all') === '1' || !id

  if (!place && !all) {
    return (
      <>
        <PageHeader title="Label" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="shelves" /><div>This place isn't here any more.</div></div></div>
      </>
    )
  }
  const printed = all ? labelOrder(places) : [place!]
  const info = labelSizeInfo(size)

  const label = (p: StoragePlace) => {
    const t = labelText(p, places, show, copiesWithin(summary, places, p.id))
    return (
      <div key={p.id} className={`box-label size-${size.toLowerCase()}`} style={{ width: `${info.widthMm}mm`, height: `${info.heightMm}mm` }}>
        <div className="box-label-qr"><QrCode text={placeLabelLink(p.id)} size={160} label={`QR code for ${p.name}`} /></div>
        <div className="box-label-text">
          {t.where && <span className="where">{t.where}</span>}
          <span className="name">{t.name}</span>
          {t.sections && <span className="line">{t.sections}</span>}
          {t.rule && <span className="line">{t.rule}</span>}
          {t.count && <span className="line">{t.count}</span>}
          <span className="brand">Manabind</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader title={all ? 'All labels' : `Label: ${place!.name}`} onBack={back} />
      <div className="content-scroll label-page">
        <div className="label-print">{printed.map(label)}</div>

        <div className="label-options">
          <span className="label-h">Size</span>
          <div className="label-sizes">
            {LABEL_SIZES.map((s) => (
              <button key={s.size} type="button" className={`pull-chip${size === s.size ? ' on' : ''}`} onClick={() => setSize(s.size)}>{s.label}</button>
            ))}
          </div>
          <span className="label-h">Show on it</span>
          <div className="chips wrap">
            {SHOW_CHIPS.map((c) => (
              <button key={c.key} type="button" className={`pull-chip${show[c.key] ? ' on' : ''}`} aria-pressed={show[c.key]} onClick={() => setShow((s) => ({ ...s, [c.key]: !s[c.key] }))}>
                {c.label}
              </button>
            ))}
          </div>
          <span className="dim">The code only names the place, so the label stays right as cards come and go.</span>
        </div>
      </div>
      <div className="pull-bar">
        {all
          ? place && <button type="button" className="btn line" onClick={() => { params.delete('all'); setParams(params, { replace: true }) }}>Just this one</button>
          : <button type="button" className="btn line" onClick={() => setParams({ all: '1' }, { replace: true })}>All labels</button>}
        <button type="button" className="btn gold" onClick={() => window.print()}><Icon name="print" aria-hidden />Print or save PDF</button>
      </div>
    </>
  )
}

/**
 * Where a box label's link leads (https://manabind.com/place/<id>) when a phone's own camera reads
 * it: the same choices as the app's scanner offers. At /place/:id.
 */
export function PlaceLinkPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  return (
    <>
      <PageHeader title="Box label" onBack={back} />
      <div className="content-scroll">
        <div className="storage-card" style={{ maxWidth: 560 }}>
          <PlaceLabelContent
            placeId={id}
            onPutAway={(p) => navigate(`/scan?putAway=${encodeURIComponent(p)}`, { replace: true })}
            onOpen={(p) => navigate(`/collections/place/${p}`, { replace: true })}
            onPull={(deckId, p) => navigate(`/decks/${deckId}/pull?place=${encodeURIComponent(p)}`, { replace: true })}
            onClose={() => navigate('/collections?tab=storage', { replace: true })}
          />
        </div>
      </div>
    </>
  )
}

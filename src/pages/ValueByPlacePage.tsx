import { useMemo } from 'react'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { PageHeader, rise, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { lentCopies } from '../collection/storagePlaces'
import { valueCsv, valueGroups, valueRows, type PrintingFacts } from '../collection/valueByPlace'
import { boughtLabel, photoDayLabel, photosForReport, type CopyPhoto } from '../collection/copyPhotos'
import { useCopyPhotos, usePhotoUrl } from '../collection/copyPhotoStore'
import { dayOf } from '../collection/copyHistoryStore'
import '../collection/loans.css'
import '../collection/inventory.css'

const count = (n: number) => n.toLocaleString('en-GB')

/**
 * Value by place: everything owned in total, and place by place as bars — binders and boxes, the deck
 * boxes, lent out, no place yet — with a spreadsheet of every card (CSV, in the user's currency) and a
 * report to print or save as PDF (the browser's print, which prints only the report). The logic is
 * collection/valueByPlace.ts. Mirrors the Android app's ValueByPlaceScreen.kt. At /collections/value.
 */
export function ValueByPlacePage() {
  const back = useBack('/collections?tab=storage')
  const { collections, decks } = useSync()
  const money = useMoney()
  const ids = useMemo(() => {
    const out = new Set<string>()
    for (const c of collections) if (c.type !== 'WISHLIST') for (const e of c.entries) out.add(e.scryfallId)
    for (const d of decks) for (const e of d.cards) out.add(e.scryfallId)
    for (const l of lentCopies(collections, decks)) out.add(l.card.scryfallId)
    return [...out]
  }, [collections, decks])
  const data = useCardData(ids)
  const rows = useMemo(() => valueRows(collections, decks, (id): PrintingFacts | undefined => {
    const c = data?.get(id)
    if (!c) return undefined
    const n = (v: string | null | undefined) => (v ? Number(v) : NaN)
    return {
      set: c.set ?? '', number: c.collector_number ?? '',
      usd: Number.isFinite(n(c.prices?.usd)) ? n(c.prices?.usd) : null,
      usdFoil: Number.isFinite(n(c.prices?.usd_foil)) ? n(c.prices?.usd_foil) : null,
    }
  }), [collections, decks, data])
  const v = useMemo(() => valueGroups(rows, collections), [rows, collections])
  const max = Math.max(1, ...v.groups.map((g) => g.usd))
  // Photos of the copies still owned go in the report too (collection/copyPhotos.ts) — kept in this browser.
  const saved = useCopyPhotos()
  const shots = useMemo(() => photosForReport(saved?.photos ?? [], new Set(rows.map((r) => r.scryfallId))), [saved, rows])

  const spreadsheet = () => {
    const csv = valueCsv(rows, { code: money.currency.code, rate: money.rate, decimals: money.currency.decimals ?? 2 })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `manabind-value-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <>
      <PageHeader title="Value by place" onBack={back} />
      <div className="content-scroll value-page">
        <div className="value-total rise" style={rise(1)}>
          <span className="dim">Everything you own</span>
          <span className="big">{data ? money.format(v.usd, true) : '…'}</span>
          <span className="dim">{count(v.copies)} {v.copies === 1 ? 'copy' : 'copies'} · prices from today</span>
        </div>
        <div className="value-bars">
          {v.groups.map((g, i) => (
            <div key={g.key} className="value-bar rise" style={rise(Math.min(i, 6) + 2)}>
              <div className="value-bar-h">
                <span><b>{g.label}</b>{g.detail && <span className="dim"> ·&nbsp;{g.detail}</span>}</span>
                <b>{money.format(g.usd, true)}</b>
              </div>
              <div className="storage-bar"><div className={g.kind === 'none' ? 'grey' : ''} style={{ width: `${Math.round((g.usd / max) * 100)}%` }} /></div>
              <span className="dim" style={{ fontSize: 12 }}>{count(g.copies)} {g.copies === 1 ? 'copy' : 'copies'}</span>
            </div>
          ))}
          {v.groups.length === 0 && <div className="empty-state"><Icon name="payments" /><div>Nothing owned yet.</div></div>}
        </div>
        <div className="dim" style={{ fontSize: 12, marginTop: 16 }}>For insurance or a move: every card, where it is and what it's worth.</div>
        <div className="pull-bar" style={{ marginTop: 8 }}>
          <button type="button" className="btn line" disabled={rows.length === 0} onClick={spreadsheet}><Icon name="table" aria-hidden />Spreadsheet</button>
          <button type="button" className="btn gold" disabled={rows.length === 0} onClick={() => window.print()}><Icon name="picture_as_pdf" aria-hidden />PDF report</button>
        </div>

        {/* What the PDF report prints: only this. */}
        <div className="value-print" aria-hidden>
          <h1>Manabind collection report</h1>
          <p>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · {count(v.copies)} copies · {money.format(v.usd)} · prices from Scryfall, in {money.currency.code}</p>
          <table>
            <thead><tr><th>Place</th><th>Copies</th><th>Value</th></tr></thead>
            <tbody>{v.groups.map((g) => <tr key={g.key}><td>{[g.detail, g.label].filter(Boolean).join(' › ')}</td><td>{g.copies}</td><td>{money.format(g.usd)}</td></tr>)}</tbody>
          </table>
          <table>
            <thead><tr><th>Card</th><th>Set</th><th>Finish</th><th>Qty</th><th>Place</th><th>Spot</th><th>Each</th><th>Total</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => a.where.localeCompare(b.where) || a.name.localeCompare(b.name)).map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td><td>{[r.set, r.number].filter(Boolean).join(' ')}</td><td>{r.foil ? 'Foil' : ''}</td><td>{r.qty}</td>
                  <td>{r.where}</td><td>{r.spot}</td>
                  <td>{r.unitUsd === null ? '' : money.format(r.unitUsd)}</td><td>{r.unitUsd === null ? '' : money.format(r.unitUsd * r.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shots.length > 0 && (
            <>
              <h2 style={{ fontSize: '13pt', margin: '12pt 0 6pt' }}>Photos of your copies</h2>
              {shots.map((p) => <ReportShot key={p.key} photo={p} money={(usd) => money.format(usd)} />)}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** One copy's photos in the printed report, with what it was bought for and when it was photographed. */
function ReportShot({ photo, money }: { photo: CopyPhoto; money: (usd: number) => string }) {
  const front = usePhotoUrl(photo.front)
  const back = usePhotoUrl(photo.back)
  const bought = boughtLabel(photo, money)
  const lines = [bought ? `Bought for ${bought}` : '', photo.photographedAt ? `Photographed ${photoDayLabel(dayOf(photo.photographedAt))}` : ''].filter(Boolean).join(' · ')
  return (
    <div className="shot">
      <b>{photo.name}{photo.foil ? ' · foil' : ''}</b><br />{lines}<br />
      {front && <img src={front} alt="" />}
      {back && <img src={back} alt="" />}
    </div>
  )
}

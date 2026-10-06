import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { IconButton, PageHeader, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { recordMoves } from '../collection/copyHistoryStore'
import { soldMove } from '../collection/copyHistory'
import { metaLine, pulledCopies, sellPullList, type PullRow } from '../collection/pullList'
import { loadPullProgress, savePullProgress } from '../collection/pullProgress'
import {
  cardmarketCsv, markSold, markSparesToSell, markUnusedToSell, sellQty, sellRows, sellRowTitle, sellRowUsd, sellTotalUsd, tcgplayerMassEntry,
  unmarkToSell, type SellPrinting,
} from '../collection/selling'
import '../collection/storage.css'
import '../collection/inventory.css'

/** The pull list's ticks are kept as a deck's are (pullProgress.ts), under this id. */
const SELL_LIST = 'sell'

/**
 * The To sell list, the Android app's SellScreen: every card marked to sell, with where its copies are
 * (place, page and pocket or section) and what they're worth, the total, two quick rules ("Spares over
 * 4", "Not in any deck, over $5"), TCGplayer mass entry and a Cardmarket CSV, a pull list to fetch them
 * (the deck pull list's look, ticks kept in the browser), and "Mark N sold": the ticked cards leave the
 * collection and their pockets show empty. The logic is collection/selling.ts. At /collections/sell.
 */
export function SellPage() {
  const { collections, decks, changeStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const money = useMoney()
  const rows = useMemo(() => sellRows(collections), [collections])
  const ids = useMemo(() => [...new Set(collections.filter((c) => c.type !== 'WISHLIST').flatMap((c) => c.entries.map((e) => e.scryfallId)))], [collections])
  const data = useCardData(ids)
  const facts = (id: string): SellPrinting | undefined => {
    const c = data?.get(id)
    if (!c) return undefined
    const n = (v: string | null | undefined) => (v ? Number(v) : NaN)
    const num = (v: string | null | undefined) => (Number.isFinite(n(v)) ? n(v) : null)
    return { set: c.set ?? '', number: c.collector_number ?? '', usd: num(c.prices?.usd), usdFoil: num(c.prices?.usd_foil), eur: num(c.prices?.eur) }
  }
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const tickedNow = new Set([...ticked].filter((k) => rows.some((r) => r.key === k)))
  const [pulling, setPulling] = useState(false)
  const [pullTicks, setPullTicks] = useState<Set<string>>(() => new Set(loadPullProgress(SELL_LIST).ticked))
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const total = sellTotalUsd(rows, facts)
  const soldRows = rows.filter((r) => tickedNow.has(r.key))
  const soldUsd = sellTotalUsd(soldRows, facts)
  const soldCopies = soldRows.reduce((n, r) => n + sellQty(r), 0)
  const five = money.format(5, true)

  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([cardmarketCsv(rows, facts)], { type: 'text/csv;charset=utf-8' }))
    a.download = `manabind-to-sell-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setMessage("Saved. Upload it on Cardmarket's stock page.")
  }
  const sold = () => {
    const keys = tickedNow
    const at = Date.now()
    // The copies' history: each sold, from where it was (collection/copyHistory.ts).
    recordMoves(soldRows.map((r) => soldMove(at, { name: r.name, scryfallId: r.scryfallId }, sellQty(r), `from ${r.where}`, r.lines[0]?.placeId ?? null)))
    changeStorage((c) => markSold(c, keys).collections)
    setMessage(`Sold ${soldCopies} ${soldCopies === 1 ? 'card' : 'cards'}.`)
    setTicked(new Set())
    setConfirming(false)
  }

  if (pulling) {
    const list = sellPullList(collections)
    const all = list.groups.flatMap((g) => g.rows)
    const pulled = pulledCopies(all, pullTicks)
    const toggle = (r: PullRow) => {
      const next = new Set(pullTicks)
      if (next.has(r.key)) next.delete(r.key)
      else next.add(r.key)
      setPullTicks(next)
      savePullProgress(SELL_LIST, { ticked: [...next] })
    }
    return (
      <>
        <PageHeader title="Pull list" eyebrow="To sell" onBack={() => setPulling(false)} />
        <div className="content-scroll pull-page">
          <div className="storage-progress">
            <div className="pull-progress-h"><b>{pulled} of {list.total} pulled</b><span>{list.places} {list.places === 1 ? 'place' : 'places'}</span></div>
            <div className="storage-bar"><div style={{ width: `${list.total ? Math.round((pulled / list.total) * 100) : 0}%` }} /></div>
          </div>
          <div className="pull-groups">
            {all.length === 0 && <div className="dim">Nothing to pull: no cards are marked to sell.</div>}
            {list.groups.map((g) => (
              <section key={g.key} className="pull-group">
                <div className="pull-group-h">
                  <h2>{g.title}</h2>
                  <span>{metaLine([g.kind === 'place' ? g.detail : '', `${pulledCopies(g.rows, pullTicks)} of ${g.rows.reduce((n, r) => n + r.qty, 0)}`])}</span>
                </div>
                {g.rows.map((r) => (
                  <label key={r.key} className={`pull-row${pullTicks.has(r.key) ? ' done' : ''}`}>
                    <input type="checkbox" checked={pullTicks.has(r.key)} onChange={() => toggle(r)} />
                    <span className="nm">{r.name}{r.qty > 1 ? ` ×${r.qty}` : ''}</span>
                    {r.hint && <span className="hint">{r.hint}</span>}
                  </label>
                ))}
              </section>
            ))}
            <div className="dim" style={{ fontSize: 12 }}>Ticks here only say you've fetched them. Tick them on the list once they're sold.</div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="To sell" onBack={back} actions={rows.length > 0 ? <span className="sell-total">{data ? money.format(total, true) : '…'}</span> : undefined} />
      <div className="content-scroll sell-page">
        <div className="chips wrap" style={{ gap: 8, maxWidth: 560 }}>
          <button
            type="button"
            className="pull-chip"
            onClick={() => {
              const n = markSparesToSell(collections, decks).added
              changeStorage((c) => markSparesToSell(c, decks).collections)
              setMessage(n > 0 ? `${n} ${n === 1 ? 'copy' : 'copies'} beyond four added.` : 'No card is owned more than four times.')
            }}
          >+ Spares over 4</button>
          <button
            type="button"
            className="pull-chip"
            disabled={!data}
            onClick={() => {
              const n = markUnusedToSell(collections, decks, 5, facts).added
              changeStorage((c) => markUnusedToSell(c, decks, 5, facts).collections)
              setMessage(n > 0 ? `${n} ${n === 1 ? 'copy' : 'copies'} added.` : `No card outside your decks is worth over ${five}.`)
            }}
          >+ Not in any deck, over {five}</button>
        </div>
        {message && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gold-light)' }} role="status">{message}</div>}
        {rows.length === 0 && (
          <div className="empty-state"><Icon name="sell" /><div>Nothing to sell yet. Add cards with a quick rule above, or with Sell… on a card's Where it is.</div></div>
        )}
        <div className="sell-rows">
          {rows.map((r) => {
            const usd = sellRowUsd(r, facts)
            const on = tickedNow.has(r.key)
            return (
              <div key={r.key} className="sell-row">
                <input
                  type="checkbox"
                  checked={on}
                  aria-label={`Sold: ${sellRowTitle(r)}`}
                  onChange={() => setTicked(() => { const n = new Set(tickedNow); if (on) n.delete(r.key); else n.add(r.key); return n })}
                />
                <button type="button" className="what" onClick={() => navigate(`/card/${encodeURIComponent(r.name)}?id=${r.scryfallId}`)}>
                  <b>{sellRowTitle(r)}</b><span>{r.where}</span>
                </button>
                <span className="price">{usd !== null ? money.format(usd, usd >= 10) : data ? '—' : '…'}</span>
                <IconButton icon="close" label={`Not selling ${r.name}`} onClick={() => changeStorage((c) => unmarkToSell(c, r))} />
              </div>
            )
          })}
        </div>
        {rows.length > 0 && (
          <section className="sell-list-them">
            <h2>List them</h2>
            <div className="row">
              <button type="button" className="btn line" onClick={() => { void navigator.clipboard.writeText(tcgplayerMassEntry(rows, facts)).then(() => setMessage("Copied. Paste it into TCGplayer's mass entry.")) }}>TCGplayer mass entry</button>
              <button type="button" className="btn line" onClick={download}>Cardmarket CSV</button>
            </div>
            <div className="dim" style={{ fontSize: 12 }}>Ticked = sold. Sold cards leave your collection and their pockets show as empty.</div>
          </section>
        )}
      </div>
      {rows.length > 0 && (
        <div className="pull-bar">
          <button type="button" className="btn line" onClick={() => setPulling(true)}>Pull list</button>
          <button type="button" className="btn gold" disabled={soldCopies === 0} onClick={() => setConfirming(true)}>
            Mark {soldCopies} sold{soldCopies > 0 && data ? ` · ${money.format(soldUsd, soldUsd >= 10)}` : ''}
          </button>
        </div>
      )}
      {confirming && (
        <Dialog
          title={`Mark ${soldCopies} sold?`}
          onDismiss={() => setConfirming(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn gold" onClick={sold}>Mark sold</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {soldCopies === 1 ? 'It leaves' : 'They leave'} your collection, here and on your other devices, and {soldCopies === 1 ? 'its pocket shows' : 'their pockets show'} as empty.
          </p>
        </Dialog>
      )}
    </>
  )
}

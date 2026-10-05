import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { placesOf } from '../collection/storagePlaces'
import {
  holdsCards, markMissingAsProxies, movePulled, pullBuyList, pulledCopies, pullGroupsIn, pullList, pullRowsAZ,
  type MovePulledResult, type PullRow,
} from '../collection/pullList'
import { loadPullProgress, savePullProgress, setOpenPullDeck } from '../collection/pullProgress'
import '../collection/storage.css'

type View = 'place' | 'az'

/**
 * A deck's pull list, the Android app's PullListScreen: every copy the deck still needs, grouped as
 * you'd walk round the shelves to fetch them (collection/pullList.ts), ticked off as you go — by hand
 * or with the scanner — then moved into the deck box in one go. The ticks are kept in this browser
 * (collection/pullProgress.ts). At /decks/:id/pull; ?place=<id> shows only what's in one box, for
 * "Pull from here" on its label.
 */
export function PullListPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const { decks, collections, changeDecksAndStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack(`/decks/${id}`)
  const money = useMoney()
  const deck = decks.find((d) => d.id === id)
  const list = useMemo(() => (deck ? pullList(deck, collections, decks) : null), [deck, collections, decks])
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(loadPullProgress(id).ticked))
  const [view, setView] = useState<View>('place')
  const [hidePulled, setHidePulled] = useState(false)
  const [asking, setAsking] = useState<PullRow | null>(null)
  const [moving, setMoving] = useState(false)
  const [done, setDone] = useState<MovePulledResult | null>(null)
  const [copied, setCopied] = useState(false)
  const placeFilter = params.get('place')
  const filterPlace = placeFilter ? placesOf(collections).find((p) => p.id === placeFilter) ?? null : null

  // This is the open pull list now: a scanned box label offers "Pull from here".
  const deckId = deck?.id
  useEffect(() => { if (deckId) setOpenPullDeck(deckId) }, [deckId])
  // The scanner ticks rows too: pick its ticks up on coming back.
  useEffect(() => {
    const onShow = () => setTicked(new Set(loadPullProgress(id).ticked))
    window.addEventListener('focus', onShow)
    return () => window.removeEventListener('focus', onShow)
  }, [id])

  const missingRows = list?.groups.filter((g) => g.kind === 'missing').flatMap((g) => g.rows) ?? []
  const prices = useCardData(missingRows.map((r) => r.scryfallId))

  if (!deck || !list) {
    return (
      <>
        <PageHeader title="Pull list" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="inventory_2" /><div>This deck isn't here any more.</div></div></div>
      </>
    )
  }

  const save = (next: Set<string>) => { setTicked(next); savePullProgress(deck.id, { ticked: [...next] }) }
  const toggle = (row: PullRow) => {
    if (ticked.has(row.key)) { const n = new Set(ticked); n.delete(row.key); save(n); return }
    // The owner's choice: a card only another deck has is asked about every time.
    if (row.source.kind === 'deck') { setAsking(row); return }
    save(new Set([...ticked, row.key]))
  }
  const allRows = list.groups.flatMap((g) => g.rows)
  const pulled = pulledCopies(allRows, ticked)
  const groups = filterPlace ? pullGroupsIn(list, collections, filterPlace.id) : list.groups
  const cost = prices ? missingRows.reduce((n, r) => n + (Number(prices.get(r.scryfallId)?.prices?.usd) || 0) * r.qty, 0) : null
  const shown = (rows: PullRow[]) => (hidePulled ? rows.filter((r) => !ticked.has(r.key)) : rows)
  const nothing = list.total === 0 && list.toBuy === 0

  const move = () => {
    let result: MovePulledResult | null = null
    changeDecksAndStorage((cols, ds) => {
      const d = ds.find((x) => x.id === deck.id)
      if (!d) return { collections: cols, decks: ds }
      result = movePulled(d, pullList(d, cols, ds), ticked, cols, ds)
      return { collections: result.collections, decks: result.decks }
    })
    setMoving(false)
    save(new Set())
    setOpenPullDeck(null)
    setDone(result)
  }

  const row = (r: PullRow) => {
    const on = ticked.has(r.key)
    if (r.source.kind === 'missing') return null
    return (
      <label key={r.key} className={`pull-row${on ? ' done' : ''}`}>
        <input type="checkbox" checked={on} onChange={() => toggle(r)} />
        <span className="nm">{r.name}{r.qty > 1 ? ` ×${r.qty}` : ''}</span>
        {view === 'az'
          ? <span className="hint">{r.where}</span>
          : r.hint && <span className={`hint${r.source.kind === 'deck' ? ' ask' : ''}`}>{r.hint}</span>}
      </label>
    )
  }

  return (
    <>
      <PageHeader title="Pull list" eyebrow={`Build: ${deck.name}`} onBack={back} />
      <div className="content-scroll pull-page">
        {nothing ? (
          <div className="empty-state"><Icon name="check_circle" /><div>Nothing to pull: every card is in the deck box.</div></div>
        ) : (
          <>
            <div className="storage-progress">
              <div className="pull-progress-h">
                <b>{pulled} of {list.total} pulled</b>
                <span>{list.places} {list.places === 1 ? 'place' : 'places'}{list.toBuy > 0 ? ` · ${list.toBuy} to buy` : ''}</span>
              </div>
              <div className="storage-bar"><div style={{ width: `${list.total ? Math.round((pulled / list.total) * 100) : 0}%` }} /></div>
            </div>

            <div className="chips wrap pull-chips">
              <button type="button" className={`pull-chip${view === 'place' ? ' on' : ''}`} onClick={() => setView('place')}>By place</button>
              <button type="button" className={`pull-chip${view === 'az' ? ' on' : ''}`} onClick={() => setView('az')}>A–Z</button>
              <button type="button" className={`pull-chip${hidePulled ? ' on' : ''}`} onClick={() => setHidePulled((h) => !h)}>Hide pulled</button>
              {filterPlace && (
                <button type="button" className="pull-chip on" onClick={() => { params.delete('place'); setParams(params, { replace: true }) }}>
                  Only {filterPlace.name} <Icon name="close" aria-hidden />
                </button>
              )}
            </div>

            <div className="pull-groups">
              {view === 'az' && !filterPlace ? (
                <section className="pull-group">{shown(pullRowsAZ(list)).map(row)}</section>
              ) : groups.filter((g) => g.kind !== 'missing').map((g) => {
                const rows = view === 'az' ? [...g.rows].sort((a, b) => a.name.localeCompare(b.name)) : g.rows
                const of = g.rows.reduce((n, r) => n + r.qty, 0)
                const got = pulledCopies(g.rows, ticked)
                if (shown(rows).length === 0) return null
                return (
                  <section key={g.key} className={`pull-group${g.kind === 'deck' ? ' ask' : ''}`}>
                    <div className="pull-group-h">
                      <h2>{g.title}</h2>
                      <span>{[g.kind === 'place' ? g.detail : '', `${got} of ${of}`].filter(Boolean).join(' · ')}</span>
                    </div>
                    {shown(rows).map(row)}
                  </section>
                )
              })}
              {filterPlace && groups.length === 0 && <div className="dim">Nothing on this list is kept in {filterPlace.name}.</div>}

              {!filterPlace && missingRows.length > 0 && (
                <section className="pull-group">
                  <div className="pull-group-h">
                    <h2>Not owned</h2>
                    <span>{list.toBuy}{cost !== null && cost > 0 ? ` · ${money.format(cost)}` : ''}</span>
                  </div>
                  <div className="dim">{missingRows.map((r) => (r.qty > 1 ? `${r.name} ×${r.qty}` : r.name)).join(', ')}</div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn line sm" onClick={() => { void navigator.clipboard.writeText(pullBuyList(list)).then(() => setCopied(true)) }}>
                      <Icon name={copied ? 'check' : 'content_copy'} aria-hidden />{copied ? 'Copied' : 'Copy buy list'}
                    </button>
                    {!holdsCards(deck) && (
                      <button
                        type="button"
                        className="btn line sm"
                        onClick={() => changeDecksAndStorage((cols, ds) => ({ collections: cols, decks: ds.map((d) => (d.id === deck.id ? markMissingAsProxies(d, pullList(d, cols, ds)) : d)) }))}
                      >
                        <Icon name="print" aria-hidden />Mark as proxies
                      </button>
                    )}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>

      {!nothing && (
        <div className="pull-bar">
          <button type="button" className="btn line" onClick={() => navigate(`/scan?pull=${encodeURIComponent(deck.id)}`)}>
            <Icon name="document_scanner" aria-hidden />Scan to tick
          </button>
          <button type="button" className="btn gold" disabled={pulled === 0} onClick={() => setMoving(true)}>Move pulled into deck box</button>
        </div>
      )}

      {asking && (() => {
        const from = asking.source.kind === 'deck' ? decks.find((d) => d.id === (asking.source as { deckId: string }).deckId)?.name ?? 'another deck' : 'another deck'
        return (
          <Dialog
            title={`Take ${asking.name} from ${from}?`}
            onDismiss={() => setAsking(null)}
            actions={
              <>
                <button type="button" className="btn line" onClick={() => setAsking(null)}>Leave it there</button>
                <button type="button" className="btn gold" onClick={() => { save(new Set([...ticked, asking.key])); setAsking(null) }}>Take it</button>
              </>
            }
          >
            <p className="muted" style={{ margin: 0 }}>{from} will be a card short: it shows there as a proxy until a copy goes back.</p>
          </Dialog>
        )
      })()}

      {moving && (
        <Dialog
          title="Move pulled into deck box?"
          onDismiss={() => setMoving(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setMoving(false)}>Cancel</button>
              <button type="button" className="btn gold" onClick={move}>Move {pulled} {pulled === 1 ? 'card' : 'cards'}</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            The {pulled === 1 ? 'card leaves its' : 'cards leave their'} places and {pulled === 1 ? 'counts' : 'count'} as in {deck.name}.
            {!holdsCards(deck) && ` ${deck.name} becomes a physical deck; the cards not pulled yet count as its proxies.`}
          </p>
        </Dialog>
      )}

      {done && (
        <Dialog title="In the deck box" onDismiss={() => { setDone(null); back() }} actions={<button type="button" className="btn gold" onClick={() => { setDone(null); back() }}>Done</button>}>
          <p className="muted" style={{ margin: 0 }}>
            {done.moved} {done.moved === 1 ? 'card is' : 'cards are'} in {deck.name} now.
            {done.nowPhysical && ` It's a physical deck${done.proxies > 0 ? `, with ${done.proxies} ${done.proxies === 1 ? 'proxy' : 'proxies'} for the cards still to pull` : ''}.`}
            {!done.nowPhysical && done.proxies > 0 && ` ${done.proxies} ${done.proxies === 1 ? 'proxy is' : 'proxies are'} left to swap.`}
          </p>
          {done.taken.map((t) => (
            <p key={`${t.deckId}:${t.name}`} className="muted" style={{ margin: '8px 0 0' }}>
              {t.name} came out of {t.deck}: it shows there as a proxy until a copy goes back.
            </p>
          ))}
        </Dialog>
      )}
    </>
  )
}

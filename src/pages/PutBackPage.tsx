import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, SegmentedTabs, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { cardFactsOf, placesOf } from '../collection/storagePlaces'
import { putBackMove } from '../collection/copyHistory'
import { recordMoves } from '../collection/copyHistoryStore'
import { metaLine, putBackList, takeApart, type PutBackMode, type PutBackRow, type TakeApartResult } from '../collection/pullList'
import { loadPutBackProgress, savePutBackProgress } from '../collection/pullProgress'
import type { DeckCardEntry } from '../types/models'
import '../collection/storage.css'

const MODES: PutBackMode[] = ['ORIGIN', 'RULE']

/**
 * Taking a deck apart, the Android app's PutBackScreen: every real copy in the deck with where it
 * goes — where it came from when it was pulled, or the best place by the boxes' sorting rules —
 * grouped by place, ticked off as you go (by hand or with the scanner), then put back in one go
 * (collection/pullList.ts takeApart). At /decks/:id/put-back.
 */
export function PutBackPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { decks, collections, changeDecksAndStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack(`/decks/${id}`)
  const deck = decks.find((d) => d.id === id)
  const [progress] = useState(() => loadPutBackProgress(id))
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(progress.ticked))
  const [mode, setMode] = useState<PutBackMode>(progress.mode === 'RULE' ? 'RULE' : 'ORIGIN')
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<TakeApartResult | null>(null)
  const data = useCardData(deck?.cards.map((c) => c.scryfallId) ?? [])
  const list = useMemo(() => {
    if (!deck) return null
    const facts = (e: DeckCardEntry) => { const card = data?.get(e.scryfallId); return card ? cardFactsOf(card) : null }
    return putBackList(deck, collections, mode, facts)
  }, [deck, collections, mode, data])
  // The scanner ticks rows too: pick its ticks up on coming back.
  useEffect(() => {
    const onShow = () => setTicked(new Set(loadPutBackProgress(id).ticked))
    window.addEventListener('focus', onShow)
    return () => window.removeEventListener('focus', onShow)
  }, [id])

  if (!deck || !list) {
    return (
      <>
        <PageHeader title="Put back list" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="inventory_2" /><div>This deck isn't here any more.</div></div></div>
      </>
    )
  }

  const save = (next: Set<string>, m = mode) => { setTicked(next); savePutBackProgress(deck.id, { ticked: [...next], mode: m }) }
  const toggle = (r: PutBackRow) => {
    const n = new Set(ticked)
    if (n.has(r.key)) n.delete(r.key)
    else n.add(r.key)
    save(n)
  }
  const finish = () => {
    let result: TakeApartResult | null = null
    changeDecksAndStorage((cols, ds) => {
      const d = ds.find((x) => x.id === deck.id)
      if (!d) return { collections: cols, decks: ds }
      result = takeApart(d, list, cols)
      const out = result
      return { collections: out.collections, decks: ds.map((x) => (x.id === d.id ? out.deck : x)) }
    })
    // The copies' history: each back in its place, or out of the deck with none (collection/copyHistory.ts).
    const at = Date.now()
    const places = placesOf(collections)
    recordMoves(list.groups.flatMap((g) => g.rows).map((r) => {
      const place = r.dest ? places.find((p) => p.id === r.dest!.placeId) : undefined
      return putBackMove(at, { name: r.name, scryfallId: r.scryfallId }, r.qty, deck.name, place ? { id: place.id, name: [place.name, r.dest!.section].filter(Boolean).join(' › ') } : null)
    }))
    setConfirming(false)
    savePutBackProgress(deck.id, null)
    setDone(result)
  }
  const rows = list.groups.flatMap((g) => g.rows)
  const done_ = rows.filter((r) => ticked.has(r.key)).reduce((n, r) => n + r.qty, 0)

  return (
    <>
      <PageHeader title="Put back list" eyebrow={`Take apart: ${deck.name}`} onBack={back} />
      <div className="content-scroll pull-page">
        {list.total === 0 ? (
          <div className="empty-state"><Icon name="inventory_2" /><div>There are no real cards in this deck to put back.</div></div>
        ) : (
          <>
            <div className="storage-progress">
              <div className="pull-progress-h"><b>Where should the cards go?</b><span>{done_} of {list.total} put back</span></div>
              <SegmentedTabs
                labels={['Where they came from', 'Best place by rule']}
                selected={MODES.indexOf(mode)}
                onSelect={(i) => { setMode(MODES[i]); save(ticked, MODES[i]) }}
              />
              <span className="dim">
                {mode === 'ORIGIN' ? 'Cards bought for this deck go where the box rules say.' : 'Each card goes to the first box whose sorting rule fits it.'}
              </span>
            </div>
            <div className="pull-groups">
              {list.groups.map((g) => {
                const of = g.rows.reduce((n, r) => n + r.qty, 0)
                const got = g.rows.filter((r) => ticked.has(r.key)).reduce((n, r) => n + r.qty, 0)
                return (
                  <section key={g.key} className="pull-group">
                    <div className="pull-group-h">
                      <h2>{g.title}</h2>
                      <span>{g.kind === 'basic' ? of : metaLine([g.detail, `${got} of ${of}`])}</span>
                    </div>
                    {g.kind === 'basic' && <div className="dim">{g.detail}</div>}
                    {g.rows.map((r) => (
                      <label key={r.key} className={`pull-row${ticked.has(r.key) ? ' done' : ''}`}>
                        <input type="checkbox" checked={ticked.has(r.key)} onChange={() => toggle(r)} />
                        <span className="nm">{g.kind === 'basic' ? `${r.qty} ${r.name}` : `${r.name}${r.qty > 1 ? ` ×${r.qty}` : ''}`}{r.foil ? ' · foil' : ''}</span>
                        {r.hint && <span className="hint">{r.hint}</span>}
                      </label>
                    ))}
                  </section>
                )
              })}
            </div>
          </>
        )}
      </div>
      {list.total > 0 && (
        <div className="pull-bar">
          <button type="button" className="btn line" onClick={() => navigate(`/scan?putBack=${encodeURIComponent(deck.id)}`)}>
            <Icon name="document_scanner" aria-hidden />Scan to tick
          </button>
          <button type="button" className="btn gold" onClick={() => setConfirming(true)}>Done: deck taken apart</button>
        </div>
      )}

      {confirming && (
        <Dialog
          title={`Take ${deck.name} apart?`}
          onDismiss={() => setConfirming(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn gold" onClick={finish}>Take apart</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Its {list.total} {list.total === 1 ? 'card goes' : 'cards go'} back into your collection at the places on this list
            {done_ < list.total ? ', ticked or not' : ''}. The list stays, as a virtual deck, so you can build it again.
          </p>
        </Dialog>
      )}
      {done && (
        <Dialog title="Taken apart" onDismiss={() => { setDone(null); back() }} actions={<button type="button" className="btn gold" onClick={() => { setDone(null); back() }}>Done</button>}>
          <p className="muted" style={{ margin: 0 }}>
            {done.placed > 0 && `${done.placed} ${done.placed === 1 ? 'card is' : 'cards are'} back in their places. `}
            {done.unplaced > 0 && `${done.unplaced} ${done.unplaced === 1 ? 'is' : 'are'} in Unsorted with no place yet. `}
            {deck.name} is a virtual deck now.
          </p>
        </Dialog>
      )}
    </>
  )
}

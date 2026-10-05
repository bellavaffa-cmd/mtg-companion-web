import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { PageHeader, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { BinderPagesView } from '../collection/BinderPagesView'
import { applyFit, factsFrom, fitLooseCards, fitSteps, pocketAt, printingLine, type FitMode } from '../collection/binderPages'
import { cardsIn, placesOf, pocketsOf, savePlace, SORT_RULE_LABELS, SORT_RULES } from '../collection/storagePlaces'
import '../collection/storage.css'

/**
 * Add cards in order (the Android app's BinderFitScreen): the binder's cards that aren't in a pocket
 * yet — put away into it with the scanner, say — fitted in by its order. "Keep the order" shifts cards
 * along to make room, "Fill gaps, no shifting" only uses empty pockets; the steps say what to do by
 * hand, from the last card backwards, and Show on pages shows the binder as it'll be. Done moves every
 * copy to its new pocket. The rules are collection/binderPages.ts. At /collections/place/:id/fit.
 */
export function BinderFitPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { collections, changeStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack(`/collections/place/${id}`)
  const place = placesOf(collections).find((p) => p.id === id)
  const cards = useMemo(() => cardsIn(collections, id), [collections, id])
  const data = useCardData([...new Set(cards.map((c) => c.entry.scryfallId))])
  const [mode, setMode] = useState<FitMode>('KEEP')
  const [onPages, setOnPages] = useState(false)
  const [page, setPage] = useState<number | null>(null)

  const facts = factsFrom(data)
  const keep = useMemo(() => (place ? fitLooseCards(collections, place, facts, 'KEEP') : null), [collections, place, data]) // eslint-disable-line react-hooks/exhaustive-deps
  const gaps = useMemo(() => (place ? fitLooseCards(collections, place, facts, 'GAPS') : null), [collections, place, data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!place || place.kind !== 'BINDER' || !keep || !gaps) {
    return (
      <>
        <PageHeader title="Add cards in order" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="menu_book" /><div>This binder isn't here any more.</div></div></div>
      </>
    )
  }
  const shifting = keep.plan.moves.length
  const chosen = shifting === 0 || mode === 'KEEP' ? keep : gaps
  const pockets = pocketsOf(place)
  const items = chosen.items
  const loading = !data && items.length > 0 && place.sortRule !== 'NAME'
  const steps = fitSteps(
    chosen.plan,
    pockets,
    (i) => chosen.pockets.find((p) => p.index === i)?.cards[0]?.entry.name ?? 'the card',
    (i) => ({ name: items[i].entry.name, detail: printingLine(data?.get(items[i].entry.scryfallId), !!items[i].line.foil) }),
  )
  const firstPage = chosen.plan.puts.length > 0 ? Math.min(...chosen.plan.puts.map((p) => pocketAt(p.to, pockets).page)) : 1
  const preview = onPages ? applyFit(collections, place, chosen.plan, items) : null
  const done = () => {
    changeStorage((c) => applyFit(c, place, chosen.plan, items))
    navigate(`/collections/place/${place.id}?page=${firstPage}`, { replace: true })
  }

  return (
    <>
      <PageHeader title={items.length > 0 ? `Adding ${items.length} ${items.length === 1 ? 'card' : 'cards'}` : 'Add cards in order'} eyebrow={place.name} onBack={back} />
      <div className="content-scroll pull-page">
        {!place.sortRule && (
          <div className="fit-choice rise">
            <b>What order is this binder in?</b>
            <div className="chips wrap">
              {SORT_RULES.map((r) => (
                <button key={r} type="button" className="pull-chip" onClick={() => changeStorage((c) => savePlace(c, { ...place, sortRule: r }))}>{SORT_RULE_LABELS[r]}</button>
              ))}
            </div>
          </div>
        )}
        {place.sortRule && items.length === 0 && (
          <div className="empty-state">
            <Icon name="menu_book" />
            <div>No cards waiting. Scan cards into this binder, then fit them in by its order — {SORT_RULE_LABELS[place.sortRule].toLowerCase()}.</div>
            <button type="button" className="btn gold" onClick={() => navigate(`/scan?putAway=${encodeURIComponent(place.id)}`)}>
              <Icon name="document_scanner" aria-hidden />Scan cards in
            </button>
          </div>
        )}
        {place.sortRule && items.length > 0 && loading && <div className="dim">Getting the cards' sets and numbers…</div>}
        {place.sortRule && items.length > 0 && !loading && (
          <>
            {shifting > 0 ? (
              <div className="fit-choice">
                <b>Shift {shifting} {shifting === 1 ? 'card' : 'cards'} along, or use the gaps?</b>
                <div className="seg2">
                  <button type="button" className={mode === 'KEEP' ? 'on' : ''} aria-pressed={mode === 'KEEP'} onClick={() => setMode('KEEP')}>Keep the order</button>
                  <button type="button" className={mode === 'GAPS' ? 'on' : ''} aria-pressed={mode === 'GAPS'} onClick={() => setMode('GAPS')}>Fill gaps, no shifting</button>
                </div>
              </div>
            ) : (
              <div className="fit-choice"><b>Nothing needs to move</b><span className="dim">Each card has an empty pocket where it goes.</span></div>
            )}
            {preview ? (
              <BinderPagesView
                place={place}
                collections={preview}
                data={data}
                page={page ?? firstPage}
                onPage={setPage}
                preview
                marked={new Set(chosen.plan.puts.map((p) => p.to))}
              />
            ) : (
              <div className="fit-steps">
                <h2>Steps</h2>
                {steps.map((st, i) => (
                  <div key={i} className="fit-step">
                    <span className="num">{i + 1}</span>
                    <div className="storage-text"><b>{st.title}</b>{st.detail && <span>{st.detail}</span>}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {place.sortRule && items.length > 0 && !loading && (
        <div className="pull-bar">
          <button type="button" className="btn line" onClick={() => setOnPages((v) => !v)}>{onPages ? 'Show steps' : 'Show on pages'}</button>
          <button type="button" className="btn gold" onClick={done}>Done</button>
        </div>
      )}
    </>
  )
}

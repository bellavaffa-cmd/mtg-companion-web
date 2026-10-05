import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ActionSheet } from '../components/ActionSheet'
import { ArtImage, IconButton, PageHeader, StatFigure, rise, toArtCrop, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { PLACE_ICONS, PlaceDialog } from '../collection/StorageTab'
import {
  cardsIn, childrenOf, copiesWithin, deletePlace, pagesOf, parentsOf, placeAndInside, placeSubtitle, placesOf, pocketsOf,
  sectionsOf, SORT_RULE_LABELS, storageSummary, type PlacedCard,
} from '../collection/storagePlaces'
import { BinderList, BinderPagesView } from '../collection/BinderPagesView'
import { binderPockets, closeGapsMoves, fitSteps, looseCopies, relocate, undoMoves, type PocketMove } from '../collection/binderPages'
import { lastCheckedLabel } from '../collection/placeCheck'
import { clearCheck, loadCheck, saveCheck } from '../collection/checkSession'
import { useUndoBar } from '../components/useUndoBar'
import { movesOfPlace } from '../collection/copyHistory'
import { useCopyHistory } from '../collection/copyHistoryStore'
import { MoveList } from './CopyHistoryPage'
import '../collection/storage.css'
import '../collection/loans.css'

/**
 * One storage place, the Android app's PlaceScreen: its copies, their value and its sections — a box's
 * sections with their cards, a binder one page at a time or as a list (BinderPagesView.tsx) — the
 * places inside it, "Put cards away" into it with the scanner, Check (scan everything in it, see
 * collection/placeCheck.ts) and when it was last checked, and a label to stick on it
 * (PlaceLabelPage.tsx). A binder has Close the gaps and Add cards in order (BinderFitPage.tsx).
 * More has Lend cards from here (LendPage.tsx); Recent moves lists what came and went (copyHistory.ts).
 * At /collections/place/:id (?page=3 opens a binder at that page).
 */
export function PlacePage() {
  const { id = '' } = useParams<{ id: string }>()
  const { collections, decks, changeStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const money = useMoney()
  const places = placesOf(collections)
  const place = places.find((p) => p.id === id)
  const summary = useMemo(() => storageSummary(collections, decks), [collections, decks])
  const cards = useMemo(() => cardsIn(collections, id), [collections, id])
  // Every copy in it and in the places inside it, for its value.
  const within = useMemo(() => {
    const ids = placeAndInside(places, id)
    return [...ids].flatMap((p) => cardsIn(collections, p))
  }, [collections, places, id])
  const data = useCardData([...new Set(within.map((c) => c.entry.scryfallId))])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [params, setParams] = useSearchParams()
  const [listView, setListView] = useState(false)
  const [checking, setChecking] = useState(false)
  const [closing, setClosing] = useState<PocketMove[] | null>(null)
  const showUndo = useUndoBar()
  const history = useCopyHistory()
  const recent = useMemo(() => movesOfPlace(history, placeAndInside(places, id), 10), [history, places, id])
  const page = Number(params.get('page')) || 1
  const setPage = (n: number) => setParams((ps) => { const next = new URLSearchParams(ps); next.set('page', String(n)); return next }, { replace: true })

  if (!place) {
    return (
      <>
        <PageHeader title="Place" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="shelves" /><div>This place isn't here any more.</div></div></div>
      </>
    )
  }

  const value = data
    ? within.reduce((sum, c) => {
      const card = data.get(c.entry.scryfallId)
      const price = Number(c.line.foil ? card?.prices?.usd_foil ?? card?.prices?.usd : card?.prices?.usd ?? card?.prices?.usd_foil) || 0
      return sum + price * c.line.qty
    }, 0)
    : null
  const copies = copiesWithin(summary, places, place.id)
  const inside = childrenOf(places, place.id)
  const sections = sectionsOf(place, cards)
  const binder = place.kind === 'BINDER' ? pagesOf(place, cards) : null
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const third = binder
    ? { value: binder.pages.length, label: binder.pages.length === 1 ? 'page' : 'pages' }
    : place.kind === 'BOX' || (place.sections?.length ?? 0) > 0
      ? { value: sections.filter((s) => s.name !== null).length, label: 'sections' }
      : { value: inside.length, label: inside.length === 1 ? 'place inside' : 'places inside' }
  const openCard = (c: PlacedCard) => navigate(`/card/${encodeURIComponent(c.entry.name)}?id=${c.entry.scryfallId}`)
  const pocketsInUse = binder ? binderPockets(place, cards) : []
  const waiting = binder ? looseCopies(place, cards).length : 0
  const sectionNames = sections.flatMap((s) => (s.name !== null ? [s.name] : []))
  const going = loadCheck(place.id)
  const startCheck = (section: string | null, fresh: boolean) => {
    if (fresh) { clearCheck(); saveCheck({ placeId: place.id, section, scans: [] }) }
    navigate(`/scan?check=${encodeURIComponent(place.id)}`)
  }
  const closeGaps = (moves: PocketMove[]) => {
    changeStorage((c) => relocate(c, place, moves))
    setClosing(null)
    showUndo({
      message: `Closed the gaps — ${moves.length} ${moves.length === 1 ? 'card' : 'cards'} moved`,
      undo: () => changeStorage((c) => relocate(c, place, undoMoves(moves))),
    })
  }

  return (
    <>
      <PageHeader
        title={place.name}
        eyebrow={parentsOf(places, place.id).map((p) => p.name).join(' › ') || placeSubtitle(place)}
        onBack={back}
        actions={<IconButton icon="more_horiz" label="More" onClick={() => setMore(true)} />}
      />
      <div className="content-scroll">
        <div className="place-stats rise" style={rise(1)}>
          <StatFigure value={copies} label={copies === 1 ? 'copy' : 'copies'} />
          <StatFigure value={value} label="value" format={(v) => money.format(v)} />
          <StatFigure value={third.value} label={third.label} />
        </div>
        <div className="place-actions rise" style={rise(2)}>
          <button type="button" className="btn gold" onClick={() => navigate(`/scan?putAway=${encodeURIComponent(place.id)}`)}>
            <Icon name="document_scanner" aria-hidden />Put cards away
          </button>
          <button type="button" className="btn line" onClick={() => (sectionNames.length > 0 || going ? setChecking(true) : startCheck(null, true))}>
            <Icon name="fact_check" aria-hidden />Check
          </button>
          <button type="button" className="btn line" onClick={() => navigate(`/collections/place/${place.id}/label`)}><Icon name="qr_code_2" aria-hidden />Label</button>
        </div>
        {place.sortRule && place.kind !== 'BINDER' && (
          <p className="place-rule">Sorted {SORT_RULE_LABELS[place.sortRule].charAt(0).toLowerCase() + SORT_RULE_LABELS[place.sortRule].slice(1)}. New cards get a section by this rule.</p>
        )}
        {place.kind === 'BINDER' && (
          <p className="place-rule">
            {pocketsOf(place)} pockets a page{place.sortRule
              ? `, in order ${SORT_RULE_LABELS[place.sortRule].charAt(0).toLowerCase() + SORT_RULE_LABELS[place.sortRule].slice(1)}. Add cards in order says where new cards go.`
              : '. New cards go in the next free pocket.'}
          </p>
        )}
        {place.lastChecked && <p className="place-rule">Last checked: {lastCheckedLabel(place.lastChecked, Date.now())}</p>}

        {inside.length > 0 && (
          <div className="place-sections">
            {inside.map((p) => (
              <button key={p.id} type="button" className="storage-row storage-sub press" onClick={() => navigate(`/collections/place/${p.id}`)}>
                <Icon name={PLACE_ICONS[p.kind]} className="storage-icon gold" />
                <div className="storage-text"><b>{p.name}</b><span>{placeSubtitle(p)}</span></div>
                <span className="storage-n">{copiesWithin(summary, places, p.id)}</span>
              </button>
            ))}
          </div>
        )}

        {binder ? (
          <>
            <div className="binder-toggle">
              <button type="button" className={`pull-chip${listView ? '' : ' on'}`} aria-pressed={!listView} onClick={() => setListView(false)}>Pages</button>
              <button type="button" className={`pull-chip${listView ? ' on' : ''}`} aria-pressed={listView} onClick={() => setListView(true)}>List</button>
              <span className="count">
                {cards.reduce((n, c) => n + c.line.qty, 0)} cards · {binder.pages.length} {binder.pages.length === 1 ? 'page' : 'pages'}
              </span>
            </div>
            {listView
              ? <div className="place-pages"><BinderList place={place} cards={cards} onCard={openCard} /></div>
              : <BinderPagesView place={place} collections={collections} data={data} page={page} onPage={setPage} />}
            {!listView && binder.loose.length > 0 && (
              <div className="place-pages">
                <CardGroup title="Not in a pocket yet" cards={binder.loose} isOpen onToggle={() => {}} onCard={openCard} />
              </div>
            )}
            {cards.length === 0 && <div className="dim" style={{ marginTop: 10 }}>Nothing here yet. Put cards away to fill it, pocket by pocket.</div>}
            <div className="pull-bar" style={{ marginTop: 16 }}>
              <button type="button" className="btn line" disabled={pocketsInUse.length === 0} onClick={() => setClosing(closeGapsMoves(pocketsInUse.map((p) => p.index)))}>
                Close the gaps
              </button>
              <button type="button" className="btn gold" onClick={() => navigate(`/collections/place/${place.id}/fit`)}>
                Add cards in order{waiting > 0 ? ` (${waiting})` : ''}
              </button>
            </div>
          </>
        ) : (
          <div className="place-sections">
            {sections.map((s) => (
              <CardGroup
                key={s.name ?? ''}
                title={s.name ?? (sections.length > 1 ? 'No section' : 'Cards')}
                count={s.copies}
                cards={s.cards}
                isOpen={open.has(s.name ?? '') || (sections.length === 1 && s.name === null)}
                onToggle={() => toggle(s.name ?? '')}
                onCard={openCard}
              />
            ))}
            {cards.length === 0 && sections.length === 0 && inside.length === 0 && <div className="dim">Nothing here yet. Put cards away to fill it.</div>}
          </div>
        )}
        {recent.length > 0 && (
          <div className="recent-moves">
            <h3>Recent moves</h3>
            <MoveList moves={recent} named />
          </div>
        )}
      </div>

      {more && (
        <ActionSheet
          title={place.name}
          subtitle={placeSubtitle(place)}
          actions={[
            { label: 'Change place', icon: 'edit', detail: 'Its name, what it is, where it sits', onClick: () => setEditing(true) },
            { label: 'New place inside', icon: 'add', detail: `A box or binder in ${place.name}`, onClick: () => setAdding(true) },
            { label: 'Lend cards from here', icon: 'handshake', detail: 'Tick the cards, then who has them', onClick: () => navigate(`/loans/lend?place=${encodeURIComponent(place.id)}`) },
            { label: 'Delete place', icon: 'delete', tone: 'danger', detail: 'Its cards stay in your collection, with no place', onClick: () => setDeleting(true) },
          ]}
          onClose={() => setMore(false)}
        />
      )}
      {checking && (
        <ActionSheet
          title={`Check ${place.name}`}
          subtitle="Scan everything in it, then see what's missing and what's extra"
          actions={[
            ...(going ? [{
              label: 'Carry on checking', icon: 'play_arrow',
              detail: `${going.section ?? `Whole ${place.kind === 'BINDER' ? 'binder' : 'box'}`} · ${going.scans.length} scanned`,
              onClick: () => startCheck(going.section, false),
            }] : []),
            { label: `Whole ${place.kind === 'BINDER' ? 'binder' : place.kind === 'BOX' ? 'box' : 'place'}`, icon: PLACE_ICONS[place.kind], detail: 'Every section', onClick: () => startCheck(null, true) },
            ...sectionNames.map((name) => ({ label: name, icon: 'label', detail: 'Only this section', onClick: () => startCheck(name, true) })),
          ]}
          onClose={() => setChecking(false)}
        />
      )}
      {closing && (
        <Dialog
          title="Close the gaps?"
          onDismiss={() => setClosing(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setClosing(null)}>Cancel</button>
              {closing.length > 0 && <button type="button" className="btn gold" onClick={() => closeGaps(closing)}>Close the gaps</button>}
            </>
          }
        >
          {closing.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>There are no empty pockets between the cards.</p>
          ) : (
            <>
              <p className="muted" style={{ margin: '0 0 10px' }}>
                {closing.length} {closing.length === 1 ? 'card moves' : 'cards move'} back to fill the empty pockets, in the same order. You can undo it.
              </p>
              <div className="fit-steps" style={{ marginTop: 0, maxHeight: 260, overflow: 'auto' }}>
                {fitSteps({ moves: closing, puts: [] }, pocketsOf(place), (i) => pocketsInUse.find((p) => p.index === i)?.cards[0]?.entry.name ?? 'the card', () => ({ name: '', detail: '' }))
                  .map((st, i) => (
                    <div key={i} className="fit-step">
                      <span className="num">{i + 1}</span>
                      <div className="storage-text"><b>{st.title}</b>{st.detail && <span>{st.detail}</span>}</div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </Dialog>
      )}
      {editing && <PlaceDialog place={place} onDismiss={() => setEditing(false)} />}
      {adding && <PlaceDialog place={null} parentId={place.id} onDismiss={() => setAdding(false)} />}
      {deleting && (
        <Dialog
          title={`Delete “${place.name}”?`}
          onDismiss={() => setDeleting(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setDeleting(false)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { changeStorage((c) => deletePlace(c, place.id)); setDeleting(false); back() }}>Delete place</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Its {cards.length > 0 ? `${cards.reduce((n, c) => n + c.line.qty, 0)} copies stay in your collection with no place` : 'cards stay in your collection'}
            {inside.length > 0 ? ', and the places inside it move up a level' : ''}. Here and on your other devices.
          </p>
        </Dialog>
      )}
    </>
  )
}

function CardGroup({ title, count, cards, isOpen, onToggle, onCard }: {
  title: string; count?: number; cards: PlacedCard[]; isOpen: boolean; onToggle: () => void; onCard: (c: PlacedCard) => void
}) {
  return (
    <div className={`place-section${isOpen && cards.length > 0 ? ' open' : ''}`}>
      <button type="button" className="place-section-h" aria-expanded={isOpen} onClick={onToggle}>
        <b>{title}</b><span>{count ?? cards.reduce((n, c) => n + c.line.qty, 0)}</span>
      </button>
      {isOpen && cards.length > 0 && (
        <div className="place-cards">
          {cards.map((c, i) => (
            <button key={`${c.collectionId}:${c.entry.scryfallId}:${i}`} type="button" className="place-card" onClick={() => onCard(c)}>
              <ArtImage className="thumb" src={toArtCrop(c.entry.imageUrl)} seed={c.entry.name} />
              <span className="nm">{c.entry.name}{c.line.foil ? ' · foil' : ''}</span>
              <span className="q">×{c.line.qty}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

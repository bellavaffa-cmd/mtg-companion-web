import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ActionSheet } from '../components/ActionSheet'
import { ArtImage, IconButton, PageHeader, StatFigure, rise, toArtCrop, useBack } from '../components/kit'
import { QrCode } from '../social/ui'
import { useCardData } from '../collection/cardData'
import { PLACE_ICONS, PlaceDialog } from '../collection/StorageTab'
import {
  cardsIn, childrenOf, copiesWithin, deletePlace, pagesOf, parentsOf, placeAndInside, placeSubtitle, placesOf, pocketsOf,
  sectionsOf, SORT_RULE_LABELS, storageSummary, type PlacedCard,
} from '../collection/storagePlaces'
import '../collection/storage.css'

/**
 * One storage place, the Android app's PlaceScreen: its copies, their value and its sections — a box's
 * sections with their cards, a binder's pages of pockets — the places inside it, "Put cards away"
 * into it with the scanner, and a label to stick on it. At /collections/place/:id.
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
  const [label, setLabel] = useState(false)

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
          <button type="button" className="btn line" onClick={() => setLabel(true)}><Icon name="qr_code_2" aria-hidden />Label</button>
        </div>
        {place.sortRule && (
          <p className="place-rule">Sorted {SORT_RULE_LABELS[place.sortRule].charAt(0).toLowerCase() + SORT_RULE_LABELS[place.sortRule].slice(1)}. New cards get a section by this rule.</p>
        )}
        {place.kind === 'BINDER' && <p className="place-rule">{pocketsOf(place)} pockets a page. New cards go in the next free pocket.</p>}

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
          <div className="place-pages">
            {binder.pages.map((pg) => (
              <div key={pg.page} className="place-page">
                <h3>Page {pg.page}</h3>
                <div className="pockets" style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(pg.slots.length))}, minmax(0, 1fr))` }}>
                  {pg.slots.map((slot, i) => {
                    const first = slot[0]
                    const n = slot.reduce((s, c) => s + c.line.qty, 0)
                    return first ? (
                      <button key={i} type="button" className="pocket" title={`${first.entry.name} — page ${pg.page}, slot ${i + 1}`} onClick={() => openCard(first)}>
                        {first.entry.imageUrl ? <img src={first.entry.imageUrl} alt={first.entry.name} loading="lazy" /> : <ArtImage src={null} seed={first.entry.name} />}
                        {n > 1 && <span className="n">×{n}</span>}
                      </button>
                    ) : <div key={i} className="pocket" aria-label={`Page ${pg.page}, slot ${i + 1}: empty`} />
                  })}
                </div>
              </div>
            ))}
            {binder.loose.length > 0 && <CardGroup title="Not in a pocket yet" cards={binder.loose} isOpen onToggle={() => {}} onCard={openCard} />}
            {cards.length === 0 && <div className="dim">Nothing here yet. Put cards away to fill it, pocket by pocket.</div>}
          </div>
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
            {cards.length === 0 && sections.length === 0 && <div className="dim">Nothing here yet. Put cards away to fill it.</div>}
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
            { label: 'Delete place', icon: 'delete', tone: 'danger', detail: 'Its cards stay in your collection, with no place', onClick: () => setDeleting(true) },
          ]}
          onClose={() => setMore(false)}
        />
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
      {label && (
        <Dialog title={`Label for ${place.name}`} onDismiss={() => setLabel(false)} actions={<button type="button" className="btn gold" onClick={() => setLabel(false)}>Done</button>}>
          <div className="place-label">
            <QrCode text={place.id} size={200} label={`QR code for ${place.name}`} />
            <b>{place.name}</b>
            <span className="dim">Print it and stick it on. The code is the place's own, so it stays right if you rename it.</span>
          </div>
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

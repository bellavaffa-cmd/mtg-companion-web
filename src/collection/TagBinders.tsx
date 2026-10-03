import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AddToSheet } from '../components/AddToSheet'
import { useUndoBar } from '../components/useUndoBar'
import { cardsLabel, deckPlace, doneMessage } from './addTo'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { CardZoomModal, zoomSteps } from '../components/CardZoomModal'
import { useLongPress } from '../components/useLongPress'
import { ArtImage, SearchPill, rise, toArtCrop, useBack, useLayoutSize } from '../components/kit'
import { getCardsByIds } from '../api/scryfall'
import type { Deck } from '../types/models'
import { ownedCards, type OwnedCard } from './owned'
import { ROLE_TAGS, matchedTags, matchesNameOrTag, tagById, tagLabel, tagsOf, useRoleTags } from '../tags/roleTags'

/**
 * The cards the user owns that do [label]'s job and aren't in [deck]: each can go into the deck,
 * or onto its Considering list.
 */
export function OwnedForTagDialog({ label, deck, cards, onDismiss }: { label: string; deck: Deck; cards: OwnedCard[]; onDismiss: () => void }) {
  const addOwned = useAddOwnedToDeck()
  const [busy, setBusy] = useState<string | null>(null)
  const considering = new Set((deck.considering ?? []).map((c) => c.name.trim().toLowerCase()))

  const add = async (card: OwnedCard, toConsidering: boolean) => {
    setBusy(card.key)
    await addOwned([card], { id: deck.id, name: deck.name, considering: toConsidering })
    setBusy(null)
  }

  return (
    <Dialog title={`${label} you own`} onDismiss={onDismiss} actions={<button type="button" className="btn gold" onClick={onDismiss}>Done</button>}>
      <p className="dim" style={{ margin: '0 0 10px', fontSize: 13 }}>In your binders, not in this deck yet.</p>
      {cards.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>All added.</p>
      ) : (
        <div className="deck-pick-list">
          {cards.map((card) => {
            const onList = considering.has(card.key)
            return (
              <div key={card.key} className="deck-pick owned-pick">
                <ArtImage className="deck-pick-art" src={toArtCrop(card.imageUrl)} seed={card.name} />
                <span className="deck-pick-name">
                  {card.name}
                  <span className="dim owned-where">{onList ? 'On Considering' : card.where.map((w) => w.name).join(', ')}</span>
                </span>
                <span className="owned-actions">
                  {!onList && <button type="button" className="btn line sm" disabled={busy != null} onClick={() => void add(card, true)}>Consider</button>}
                  <button type="button" className="btn gold sm" disabled={busy != null} onClick={() => void add(card, false)}>{busy === card.key ? 'Adding…' : 'Add to deck'}</button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}

const TAGS_SHOWN = 8

/**
 * "By tag · automatic": a binder for each tag, gathering every card the user owns that has it.
 * They fill themselves — the copies stay in the binders they're in, so nothing is counted twice.
 */
export function TagBindersSection() {
  const navigate = useNavigate()
  const { collections } = useSync()
  const owned = useMemo(() => ownedCards(collections), [collections])
  const { tags, loading } = useRoleTags(owned.map((c) => c.name))
  const [showAll, setShowAll] = useState(false)
  if (owned.length === 0) return null

  const byTag = ROLE_TAGS
    .map((t) => ({ tag: t, cards: owned.filter((c) => tagsOf(tags, c.name).includes(t.id)) }))
    .filter((b) => b.cards.length > 0)
    .sort((a, b) => b.cards.length - a.cards.length)
  const shown = showAll ? byTag : byTag.slice(0, TAGS_SHOWN)

  return (
    <section className="tag-binders rise" style={rise(4)}>
      <div className="grp tag-binders-head">
        <span><Icon name="sell" aria-hidden />By tag · automatic</span>
        {loading && <span className="dim">Tagging your cards… {Math.min(loading.done, loading.total)} of {loading.total}</span>}
      </div>
      {byTag.length === 0 ? (
        <div className="dim">{loading ? 'Looking up what each of your cards does…' : "None of your cards has a tag yet — they're looked up when you're online."}</div>
      ) : (
        <div className="tag-binder-grid">
          {shown.map(({ tag, cards }) => (
            <button key={tag.id} type="button" className="tag-binder press" onClick={() => navigate(`/collections/tag/${tag.id}`)}>
              <div className="tag-binder-cover">
                {cards.slice(0, 3).map((c) => <ArtImage key={c.key} src={toArtCrop(c.imageUrl)} seed={c.name} />)}
                <span className="tag-binder-badge"><Icon name="sell" aria-hidden />auto</span>
              </div>
              <span className="tag-binder-name">{tag.label}</span>
              <span className="tag-binder-count">{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span>
            </button>
          ))}
        </div>
      )}
      {byTag.length > TAGS_SHOWN && (
        <button type="button" className="btn line sm" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer tags' : `Show all ${byTag.length} tags`}
        </button>
      )}
    </section>
  )
}

/** One tag's automatic binder: every owned card with the tag, to look through and add to decks. */
export function TagBinderPage() {
  const { tagId = '' } = useParams<{ tagId: string }>()
  const back = useBack('/collections?tab=binders')
  const navigate = useNavigate()
  const size = useLayoutSize()
  const { collections } = useSync()
  const tag = tagById(tagId)
  const owned = useMemo(() => ownedCards(collections), [collections])
  const { tags, loading } = useRoleTags(owned.map((c) => c.name))
  const [filter, setFilter] = useState('')
  const [zoom, setZoom] = useState<OwnedCard | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<OwnedCard[] | null>(null)
  const addOwned = useAddOwnedToDeck()
  // Another tag's binder, opened from a card's zoom, starts fresh.
  useEffect(() => { setFilter(''); setSelected(new Set()) }, [tagId])

  if (!tag) {
    return (
      <>
        <TopBar title="Tag" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="sell" />There's no such tag.</div></div>
      </>
    )
  }

  const cards = owned.filter((c) => tagsOf(tags, c.name).includes(tag.id))
  const q = filter.trim().toLowerCase()
  const shown = cards.filter((c) => matchesNameOrTag(c.name, tagsOf(tags, c.name), q))
  const tagHits = q ? [...new Set(shown.filter((c) => !c.name.toLowerCase().includes(q)).flatMap((c) => matchedTags(tagsOf(tags, c.name), q)))] : []
  const picked = cards.filter((c) => selected.has(c.key))
  const toggle = (c: OwnedCard) => {
    const next = new Set(picked.map((p) => p.key))
    if (next.has(c.key)) next.delete(c.key)
    else next.add(c.key)
    setSelected(next)
  }

  return (
    <>
      <TopBar title={tag.label} onBack={back} />
      <div className="content-scroll">
        <div className="binder-head rise" style={rise(0)}>
          <div className="eyebrow"><Icon name="sell" style={{ fontSize: 14, verticalAlign: -2 }} aria-hidden /> Automatic binder</div>
          <h1>{tag.label}</h1>
          <p className="dim" style={{ margin: '6px 0 0', maxWidth: 560 }}>
            Every card you own tagged {tag.label}. Your copies stay in their own binders. Tap a card to see what else it does,
            or press and hold to pick several and add them to a deck.
          </p>
        </div>
        {loading && <div className="dim search-note">Tagging your cards… {Math.min(loading.done, loading.total)} of {loading.total}</div>}
        {cards.length > 0 && (
          <div className="rise" style={{ ...rise(1), marginTop: 14, maxWidth: size === 'phone' ? undefined : 480 }}>
            <SearchPill value={filter} onChange={setFilter} placeholder="Name or tag, e.g. rock" />
            {q && (
              <div className="dim search-note">
                {shown.length} {shown.length === 1 ? 'card' : 'cards'}
                {tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}
              </div>
            )}
          </div>
        )}
        {cards.length === 0 ? (
          <div className="empty-state"><Icon name="sell" />{loading ? 'Looking up your cards…' : `You don't own any cards tagged ${tag.label}.`}</div>
        ) : (
          <div className="list wide-list" style={{ marginTop: 14 }}>
            {shown.map((c) => (
              <OwnedRow key={c.key} card={c} selecting={picked.length > 0} selected={selected.has(c.key)} onToggle={() => toggle(c)} onOpen={() => setZoom(c)} />
            ))}
            {shown.length === 0 && <div className="empty-state">Nothing here matches “{filter}”.</div>}
          </div>
        )}
      </div>

      {picked.length > 0 && (
        <div className="select-bar" role="toolbar" aria-label="Selected cards">
          <button type="button" className="icon-btn" aria-label="Stop selecting" onClick={() => setSelected(new Set())}><Icon name="close" /></button>
          <span className="select-count"><b>{picked.length}</b> selected</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn gold sm" onClick={() => setAdding(picked)}><Icon name="add" aria-hidden />Add to…</button>
        </div>
      )}

      {zoom && (
        <CardZoomModal
          imageUrl={zoom.imageUrl}
          name={zoom.name}
          scryfallId={zoom.scryfallId}
          backImageUrl={zoom.backImageUrl}
          tags={tagsOf(tags, zoom.name).map(tagLabel)}
          onTagClick={(label) => {
            const next = ROLE_TAGS.find((t) => t.label === label)
            setZoom(null)
            if (next && next.id !== tag.id) navigate(`/collections/tag/${next.id}`)
          }}
          onClose={() => setZoom(null)}
          {...zoomSteps(shown, zoom, setZoom, (card) => card.key)}
        >
          <div className="panel detail-grid">
            <div>
              <div className="p-h" style={{ margin: 0 }}><h3>You own</h3></div>
              <div className="dim">{zoom.where.map((w) => `${w.copies} in ${w.name}`).join(' · ')}</div>
            </div>
            <button type="button" className="btn gold" onClick={() => { setAdding([zoom]); setZoom(null) }}>
              <Icon name="add" aria-hidden />Add to…
            </button>
          </div>
        </CardZoomModal>
      )}

      {adding && (
        <AddToSheet
          verb="add"
          what={cardsLabel(adding.map((c) => c.name))}
          subtitle="One copy of each, unless the deck has it already"
          imageUrl={adding[0]?.imageUrl}
          binders={false}
          create
          quantity={null}
          onPick={(target) => {
            if (target.kind !== 'deck') return
            setSelected(new Set())
            void addOwned(adding, target)
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}

function OwnedRow({ card, selecting, selected, onToggle, onOpen }: {
  card: OwnedCard
  selecting: boolean
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  // Press and hold picks the card; while picking, a tap adds or drops it.
  const longPress = useLongPress({ onLongPress: onToggle, onClick: selecting ? onToggle : onOpen })
  return (
    <div className={`crow${selected ? ' picked' : ''}`} style={{ cursor: 'pointer' }} {...longPress}>
      <div className="thumb-wrap">
        {selecting && <span className={`pick-mark${selected ? ' on' : ''}`} aria-label={selected ? 'Selected' : 'Not selected'}>{selected && <Icon name="check" />}</span>}
        <ArtImage className="thumb" src={toArtCrop(card.imageUrl)} seed={card.name} />
      </div>
      <div className="cmain">
        <div className="cname">{card.name}</div>
        <div className="cmeta"><span>{card.copies} {card.copies === 1 ? 'copy' : 'copies'} · {card.where.map((w) => w.name).join(', ')}</span></div>
      </div>
    </div>
  )
}

/**
 * Adds cards the user owns (one copy each, skipping any the deck has) to a deck or its Considering
 * list, and says so on the Undo bar. A deck entry needs the full card (type, commander-ness…), which
 * a binder entry doesn't keep, so they're fetched first.
 */
function useAddOwnedToDeck() {
  const { addCardsToDeck, recordUndo } = useSync()
  const showUndo = useUndoBar()
  return async (cards: OwnedCard[], deck: { id: string; name: string; considering: boolean }) => {
    try {
      const full = await getCardsByIds(cards.map((c) => c.scryfallId), true)
      let added = 0
      const undo = recordUndo(() => { added = addCardsToDeck(deck.id, full, deck.considering) })
      const skipped = cards.length - added
      showUndo({
        message: added === 0
          ? `${deck.name} already has ${cards.length === 1 ? 'it' : 'them'}`
          : doneMessage('add', added === cards.length ? cardsLabel(cards.map((c) => c.name)) : `${added} ${added === 1 ? 'card' : 'cards'}`, deckPlace(deck.name, deck.considering)),
        warning: added > 0 && skipped > 0 ? `${skipped} ${skipped === 1 ? 'was' : 'were'} already there` : null,
        undo,
      })
    } catch (e) {
      showUndo({ message: e instanceof Error ? e.message : "Couldn't reach Scryfall — try again when you're online." })
    }
  }
}

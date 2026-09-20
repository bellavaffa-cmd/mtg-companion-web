import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal, zoomSteps } from '../components/CardZoomModal'
import { ActionSheet } from '../components/ActionSheet'
import { useLongPress } from '../components/useLongPress'
import { CardSearchResults } from '../components/CardSearchResults'
import { ShareDialog } from '../social/ShareDialog'
import { ExportCollectionDialog, ImportCardsDialog } from '../collection/CardListDialogs'
import { ArtImage, IconButton, PillChip, SearchPill, SectionHeader, StatFigure, rise, toArtCrop, useBack, useLayoutSize, useScrollProgress } from '../components/kit'
import { Dialog } from '../components/Dialog'
import { isUnsorted, type CollectionEntry } from '../types/models'
import { decksConsidering, isWishlist } from '../collection/wishlist'
import { buyCardUrl, buyListUrl } from '../api/buy'
import { askForNotifications, usePrices } from '../collection/priceAlerts'
import { useMoney } from '../money/currency'
import { matchedTags, matchesNameOrTag, tagLabel, tagsOf, useRoleTags } from '../tags/roleTags'

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const back = useBack('/collections?tab=binders')
  const { collections, decks, setEntryQuantities, setEntryPriceAlert, removeEntryFromCollection, removeEntriesFromCollection, addEntryToCollection, moveEntries, createCollection, notInterested, wantAgain } = useSync()
  const collection = collections.find((c) => c.id === id)
  // A wishlist shows what each card costs now, and can watch for it to drop.
  const wishlist = collection?.type === 'WISHLIST'
  const prices = usePrices(collection?.entries ?? [], wishlist)
  // Prices show — and alerts are typed — in the chosen currency; they're kept in US dollars.
  const money = useMoney()
  const formatUsd = (v: number) => money.format(v)
  const decimals = money.currency.decimals ?? 2
  // What each card does: found by the search, shown in the zoom.
  const { tags: roleTags, loading: tagging } = useRoleTags(collection?.entries.map((e) => e.name) ?? [])
  const [alerting, setAlerting] = useState<CollectionEntry | null>(null)
  const [alertText, setAlertText] = useState('')
  const [zoomId, setZoomId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<CollectionEntry | null>(null)
  const [filter, setFilter] = useState('')
  const [sharing, setSharing] = useState(false)
  const [listDialog, setListDialog] = useState<'import' | 'export' | null>(null)
  // The cards whose "move to binder" picker is open, and the ones being moved into a new binder.
  const [moving, setMoving] = useState<CollectionEntry[] | null>(null)
  const [naming, setNaming] = useState<CollectionEntry[] | null>(null)
  // Cards picked by pressing and holding (scryfall ids), and whether their remove / export is open.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<'remove' | 'export' | null>(null)
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(new Set()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size])
  const [newName, setNewName] = useState('')
  // The Wishlist: cards said no to, shown on request so they can be asked for again.
  const [showNotWanted, setShowNotWanted] = useState(false)
  // The big title scrolls away; the bar's title fades in to replace it.
  const titleProgress = useScrollProgress(90)
  const size = useLayoutSize()

  if (!collection) {
    return (
      <>
        <TopBar title="Binder" onBack={back} />
        <div className="content-scroll">
          <div className="empty-state"><Icon name="collections" />Binder not found. It may have been deleted.</div>
        </div>
      </>
    )
  }

  const zoomEntry = collection.entries.find((e) => e.scryfallId === zoomId) ?? null
  const cards = collection.entries.reduce((s, e) => s + e.quantity, 0)
  const foils = collection.entries.reduce((s, e) => s + e.foilQuantity, 0)
  const q = filter.trim().toLowerCase()
  const shown = collection.entries
    .filter((e) => matchesNameOrTag(e.name, tagsOf(roleTags, e.name), q))
    .sort((a, b) => a.name.localeCompare(b.name))
  const tagHits = q ? [...new Set(shown.filter((e) => !e.name.toLowerCase().includes(q)).flatMap((e) => matchedTags(tagsOf(roleTags, e.name), q)))] : []
  const setQty = (e: CollectionEntry, quantity: number, foilQuantity: number) =>
    setEntryQuantities(collection.id, e.scryfallId, Math.max(0, quantity), Math.max(0, foilQuantity))
  /**
   * Takes cards off. On the Wishlist, ones the app added by itself mean "not interested": they stay
   * off while decks consider them, instead of coming straight back.
   */
  const takeOff = (cards: CollectionEntry[]) => {
    if (isWishlist(collection)) cards.filter((e) => e.auto).forEach((e) => notInterested(e.name))
    const rest = cards.filter((e) => !isWishlist(collection) || !e.auto).map((e) => e.scryfallId)
    if (rest.length > 0) removeEntriesFromCollection(collection.id, rest)
  }

  const summary = (
    <div className="stats rise" style={{ ...rise(1), maxWidth: size === 'phone' ? undefined : 720 }}>
      <StatFigure value={cards} label="Cards" />
      <StatFigure value={foils} label="Foils" />
      <StatFigure value={collection.entries.length} label="Unique" />
    </div>
  )

  const unsorted = isUnsorted(collection)
  // Cards removed or moved out drop from the pick.
  const picked = collection.entries.filter((e) => selected.has(e.scryfallId))
  const selecting = picked.length > 0
  const toggle = (e: CollectionEntry) => {
    const next = new Set(picked.map((p) => p.scryfallId))
    if (next.has(e.scryfallId)) next.delete(e.scryfallId)
    else next.add(e.scryfallId)
    setSelected(next)
  }
  const label = (cards: CollectionEntry[]) => (cards.length === 1 ? cards[0].name : `${cards.length} cards`)
  const copies = (cards: CollectionEntry[]) => cards.reduce((n, e) => n + e.quantity + e.foilQuantity, 0)
  const moveTo = (cards: CollectionEntry[], toId: string) => {
    moveEntries(collection.id, cards.map((e) => e.scryfallId), toId)
    setSelected(new Set())
  }
  const moveToNew = () => {
    if (!naming || !newName.trim()) return
    moveTo(naming, createCollection(newName.trim(), 'OWNED').id)
    setNaming(null)
  }
  const entryList = collection.entries.length === 0 ? (
    unsorted
      ? <div className="empty-state"><Icon name="inbox" />All sorted — every card is in a binder.</div>
      : <div className="empty-state"><Icon name="playing_cards" />No cards yet — search {size === 'desktop' ? 'on the right' : 'below'} to add some.</div>
  ) : (
    <>
      {unsorted && (
        <p className="muted rise" style={{ ...rise(2), margin: '14px 0 0' }}>
          Cards you own that aren't in a binder yet. Use <Icon name="more_vert" style={{ fontSize: 16, verticalAlign: -3 }} /> → <b>Move to binder</b> on a card to sort it — into a binder you have, or a new one.
        </p>
      )}
      {(collection.entries.length > 8 || filter) && (
        <div className="rise" style={{ ...rise(2), marginTop: 14, maxWidth: size === 'phone' ? undefined : 480 }}>
          <SearchPill value={filter} onChange={setFilter} placeholder="Name or tag, e.g. ramp" />
          {q && (
            <div className="dim search-note">
              {shown.length} {shown.length === 1 ? 'card' : 'cards'}
              {tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}
              {tagging && ' · finding tags…'}
            </div>
          )}
        </div>
      )}
      <div className="list wide-list" style={{ marginTop: 14 }}>
        {shown.map((entry) => (
          <EntryRow
            key={entry.scryfallId}
            entry={entry}
            selecting={selecting}
            selected={selected.has(entry.scryfallId)}
            onToggle={() => toggle(entry)}
            onZoom={() => setZoomId(entry.scryfallId)}
            onMore={() => setSheet(entry)}
            price={wishlist ? prices?.get(entry.scryfallId) : undefined}
            considering={entry.auto ? decksConsidering(decks, entry.name).join(', ') || undefined : undefined}
            onIncrement={() => setQty(entry, entry.quantity + 1, entry.foilQuantity)}
            onDecrement={() => setQty(entry, entry.quantity - 1, entry.foilQuantity)}
          />
        ))}
        {shown.length === 0 && <div className="empty-state">Nothing in this binder matches “{filter}”.</div>}
      </div>
    </>
  )

  const addCards = <CardSearchResults onAdd={(card) => addEntryToCollection(collection.id, card)} placeholder="Search Scryfall to add cards" />

  return (
    <>
      <TopBar
        title={collection.name}
        onBack={back}
        progress={titleProgress}
        actions={
          <>
            <IconButton icon="playlist_add" label="Import cards from another app" variant={titleProgress < 0.6 ? 'glass' : ''} onClick={() => setListDialog('import')} />
            <IconButton icon="ios_share" label="Export as text" variant={titleProgress < 0.6 ? 'glass' : ''} onClick={() => setListDialog('export')} />
            {isWishlist(collection) && collection.entries.length > 0 && (
              <IconButton
                icon="shopping_cart"
                label="Buy these cards at TCGplayer"
                variant={titleProgress < 0.6 ? 'glass' : ''}
                onClick={() => {
                  const url = buyListUrl(collection.entries.map((e) => ({ name: e.name, quantity: e.quantity })))
                  if (url) window.open(url, '_blank', 'noopener,noreferrer')
                }}
              />
            )}
            <IconButton icon="group_add" label="Share with friends" variant={titleProgress < 0.6 ? 'glass' : ''} onClick={() => setSharing(true)} />
          </>
        }
      />
      <div className="content-scroll">
        <div className="binder-head rise" style={rise(0)}>
          <div className="eyebrow">{unsorted ? 'Not in a binder yet' : collection.type === 'WISHLIST' ? 'Wishlist' : 'Binder'}</div>
          <h1>{collection.name}</h1>
        </div>
        {isWishlist(collection) && (collection.notWanted ?? []).length > 0 && (
          <div className="rise" style={{ ...rise(1), margin: '10px 0 0', maxWidth: 720 }}>
            <button type="button" className="btn line sm" onClick={() => setShowNotWanted((v) => !v)}>
              <Icon name={showNotWanted ? 'expand_less' : 'expand_more'} aria-hidden />
              {(collection.notWanted ?? []).length} {(collection.notWanted ?? []).length === 1 ? 'card' : 'cards'} you said no to
            </button>
            {showNotWanted && (
              <div className="chips wrap" style={{ marginTop: 8 }}>
                {(collection.notWanted ?? []).map((cardName) => (
                  <PillChip
                    key={cardName}
                    label={`${cardName} · want it`}
                    icon="undo"
                    onClick={() => wantAgain(cardName)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {isWishlist(collection) && (
          <p className="muted rise" style={{ ...rise(1), margin: '6px 0 0', maxWidth: 720 }}>
            Cards you want. They don't count as owned. Cards your decks are considering that you don't own are added here by themselves, until you own them — take one off and it stays off.
          </p>
        )}
        {size === 'desktop' ? (
          <div className="binder-columns" style={{ marginTop: 12 }}>
            <div style={{ minWidth: 0 }}>{summary}{entryList}</div>
            <aside className="deck-aside">
              <div className="panel">
                <div className="p-h"><h3>Add cards</h3></div>
                {addCards}
              </div>
            </aside>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 12 }}>{summary}</div>
            {entryList}
            <SectionHeader title="Add cards" />
            {addCards}
          </>
        )}
      </div>

      {sheet && (
        <ActionSheet
          title={sheet.name}
          subtitle={`${sheet.quantity} regular · ${sheet.foilQuantity} foil`}
          imageUrl={sheet.imageUrl}
          actions={[
            { label: 'View card', icon: 'visibility', onClick: () => setZoomId(sheet.scryfallId) },
            ...(wishlist
              ? [{
                  label: 'Price alert',
                  icon: sheet.priceAlert ? 'notifications_active' : 'notifications',
                  detail: sheet.priceAlert ? `When it's ${formatUsd(sheet.priceAlert)} or less` : 'Hear when it gets cheaper',
                  onClick: () => {
                    const now = prices?.get(sheet.scryfallId)
                    setAlertText(sheet.priceAlert ? money.toLocal(sheet.priceAlert).toFixed(decimals) : now ? (money.toLocal(now) * 0.9).toFixed(decimals) : '')
                    setAlerting(sheet)
                  },
                }]
              : []),
            { label: 'Add a foil copy', icon: 'auto_awesome', tone: 'gold', onClick: () => setQty(sheet, sheet.quantity, sheet.foilQuantity + 1) },
            ...(sheet.foilQuantity > 0
              ? [{ label: 'Remove a foil copy', icon: 'remove_circle_outline', onClick: () => setQty(sheet, sheet.quantity, sheet.foilQuantity - 1) }]
              : []),
            { label: 'Move to binder', icon: 'drive_file_move', detail: 'Every copy, into another binder', onClick: () => setMoving([sheet]) },
            { label: 'Select', icon: 'check_circle', detail: 'Pick several cards to move, export or remove', onClick: () => toggle(sheet) },
            sheet.auto && isWishlist(collection)
              ? { label: 'Not interested', icon: 'delete', tone: 'danger' as const, detail: "It won't come back while a deck considers it", onClick: () => takeOff([sheet]) }
              : { label: 'Remove from binder', icon: 'delete', tone: 'danger' as const, onClick: () => removeEntryFromCollection(collection.id, sheet.scryfallId) },
          ]}
          onClose={() => setSheet(null)}
        />
      )}

      {selecting && (
        <div className="select-bar" role="toolbar" aria-label="Selected cards">
          <button type="button" className="icon-btn" aria-label="Stop selecting" onClick={() => setSelected(new Set())}><Icon name="close" /></button>
          <span className="select-count"><b>{picked.length}</b> selected</span>
          {picked.length < collection.entries.length && (
            <button type="button" className="btn line sm" onClick={() => setSelected(new Set(shown.map((e) => e.scryfallId).concat(picked.map((e) => e.scryfallId))))}>
              <Icon name="select_all" aria-hidden />All
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn line sm" onClick={() => setMoving(picked)}><Icon name="drive_file_move" aria-hidden />Move</button>
          <button type="button" className="btn line sm" onClick={() => setBulk('export')}><Icon name="ios_share" aria-hidden />Export</button>
          <button type="button" className="btn line sm danger-text" onClick={() => setBulk('remove')}><Icon name="delete" aria-hidden />Remove</button>
        </div>
      )}

      {bulk === 'remove' && selecting && (
        <Dialog
          title={picked.length === 1 ? 'Remove card?' : `Remove ${picked.length} cards?`}
          onDismiss={() => setBulk(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setBulk(null)}>Cancel</button>
              <button
                type="button"
                className="btn danger"
                onClick={() => { takeOff(picked); setSelected(new Set()); setBulk(null) }}
              >
                Remove
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Remove {label(picked)} ({copies(picked)} {copies(picked) === 1 ? 'copy' : 'copies'}) from this binder?
            {isWishlist(collection) && picked.some((e) => e.auto) && " Ones your decks are considering won't come back."}
          </p>
        </Dialog>
      )}
      {bulk === 'export' && selecting && (
        <ExportCollectionDialog collection={{ ...collection, entries: picked }} title={`Export ${label(picked)}`} onDismiss={() => setBulk(null)} />
      )}

      {moving && (
        <ActionSheet
          title={`Move ${label(moving)}`}
          subtitle={`${copies(moving)} ${copies(moving) === 1 ? 'copy' : 'copies'}`}
          imageUrl={moving[0]?.imageUrl}
          actions={[
            { label: 'New binder…', icon: 'add', tone: 'gold' as const, onClick: () => { setNewName(''); setNaming(moving) } },
            ...collections
              .filter((c) => c.id !== collection.id)
              .map((c) => ({
                label: c.name,
                icon: isUnsorted(c) ? 'inbox' : c.type === 'WISHLIST' ? 'star' : 'collections',
                detail: isUnsorted(c) ? 'Not in a binder' : c.type === 'WISHLIST' ? 'Wishlist' : 'Binder',
                onClick: () => moveTo(moving, c.id),
              })),
          ]}
          onClose={() => setMoving(null)}
        />
      )}

      {naming && (
        <Dialog
          title={`Move ${label(naming)} to a new binder`}
          onDismiss={() => setNaming(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setNaming(null)}>Cancel</button>
              <button type="button" className="btn gold" disabled={!newName.trim()} onClick={moveToNew}>Create &amp; move</button>
            </>
          }
        >
          <label className="field-label" htmlFor="move-new-name" style={{ marginTop: 0 }}>Binder name</label>
          <input id="move-new-name" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && moveToNew()} autoFocus />
        </Dialog>
      )}

      {alerting && (
        <Dialog
          title={`Price alert · ${alerting.name}`}
          onDismiss={() => setAlerting(null)}
          actions={
            <>
              {alerting.priceAlert ? (
                <button type="button" className="btn line" onClick={() => { setEntryPriceAlert(collection.id, alerting.scryfallId, null); setAlerting(null) }}>Turn off</button>
              ) : (
                <button type="button" className="btn line" onClick={() => setAlerting(null)}>Cancel</button>
              )}
              <button
                type="button"
                className="btn gold"
                disabled={!(Number(alertText) > 0)}
                onClick={() => {
                  setEntryPriceAlert(collection.id, alerting.scryfallId, Math.round(money.toUsd(Number(alertText)) * 10_000) / 10_000)
                  askForNotifications()
                  setAlerting(null)
                }}
              >
                Save
              </button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {prices?.get(alerting.scryfallId) != null ? `It's ${formatUsd(prices.get(alerting.scryfallId)!)} now. ` : ''}
            Tell me when it's this much or less ({money.currency.code}, non-foil):
          </p>
          <input
            className="input"
            inputMode="decimal"
            value={alertText}
            onChange={(e) => setAlertText(e.target.value.replace(/[^0-9.]/g, ''))}
            aria-label={`Alert price in ${money.currency.code}`}
            autoFocus
          />
          <p className="dim" style={{ marginBottom: 0 }}>Checked when you open the app. The Android app can also send a notification.</p>
        </Dialog>
      )}

      {listDialog === 'import' && <ImportCardsDialog collection={collection} onDismiss={() => setListDialog(null)} />}
      {listDialog === 'export' && <ExportCollectionDialog collection={collection} onDismiss={() => setListDialog(null)} />}
      {sharing && <ShareDialog kind="collection" itemId={collection.id} name={collection.name} onClose={() => setSharing(false)} />}

      {zoomEntry && (
        <CardZoomModal
          imageUrl={zoomEntry.imageUrl}
          name={zoomEntry.name}
          scryfallId={zoomEntry.scryfallId}
          currentCollectionId={collection.id}
          backImageUrl={zoomEntry.backImageUrl}
          tags={tagsOf(roleTags, zoomEntry.name).map(tagLabel)}
          tagsLoading={!!tagging && !roleTags.has(zoomEntry.name.trim().toLowerCase())}
          buyUrl={buyCardUrl(null, zoomEntry.name)}
          onTagClick={(label) => { setZoomId(null); setFilter(label) }}
          onSelectSimilar={(similar) => addEntryToCollection(collection.id, similar)}
          similarActionLabel="Tap a card to add it to this binder"
          onClose={() => setZoomId(null)}
          {...zoomSteps(shown, zoomEntry, (card) => setZoomId(card.scryfallId))}
        >
          <div className="panel detail-grid">
            <div className="row-between">
              <div><div className="p-h" style={{ margin: 0 }}><h3>Regular</h3></div><div className="dim">In this binder</div></div>
              <div className="stepper-big">
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity - 1, zoomEntry.foilQuantity)} aria-label="One fewer">−</button>
                <span className="qn">{zoomEntry.quantity}</span>
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity + 1, zoomEntry.foilQuantity)} aria-label="One more">+</button>
              </div>
            </div>
            <div className="row-between">
              <div><div className="p-h" style={{ margin: 0 }}><h3>Foil</h3></div><div className="dim">In this binder</div></div>
              <div className="stepper-big">
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity, zoomEntry.foilQuantity - 1)} aria-label="One fewer foil">−</button>
                <span className="qn">{zoomEntry.foilQuantity}</span>
                <button type="button" onClick={() => setQty(zoomEntry, zoomEntry.quantity, zoomEntry.foilQuantity + 1)} aria-label="One more foil">+</button>
              </div>
            </div>
          </div>
        </CardZoomModal>
      )}
    </>
  )
}

function EntryRow({
  entry, selecting, selected, price, considering, onToggle, onZoom, onMore, onIncrement, onDecrement,
}: {
  entry: CollectionEntry
  /** The Wishlist: the decks considering a card it has because of them. */
  considering?: string
  /** Wishlists: today's price (null: none), undefined elsewhere or while loading. */
  price?: number | null
  selecting: boolean
  selected: boolean
  onToggle: () => void
  onZoom: () => void
  onMore: () => void
  onIncrement: () => void
  onDecrement: () => void
}) {
  const money = useMoney()
  const formatUsd = (v: number) => money.format(v)
  // Press and hold picks the card; while picking, a tap adds or drops it.
  const longPress = useLongPress({ onLongPress: onToggle, onClick: selecting ? onToggle : onZoom })
  return (
    <div className={`crow${selected ? ' picked' : ''}`}>
      <div className="thumb-wrap" onClick={selecting ? onToggle : onZoom} style={{ cursor: 'pointer' }}>
        {selecting && <span className={`pick-mark${selected ? ' on' : ''}`} aria-label={selected ? 'Selected' : 'Not selected'}>{selected && <Icon name="check" />}</span>}
        <ArtImage className="thumb" src={toArtCrop(entry.imageUrl)} seed={entry.name} />
        {entry.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cmain" {...longPress}>
        <div className="cname">{entry.name}</div>
        <div className="cmeta">
          {entry.foilQuantity > 0 && <span className="badge gold"><Icon name="auto_awesome" />{entry.foilQuantity} foil</span>}
          {(price != null || entry.priceAlert) && (
            <span className={`price-tag${price != null && entry.priceAlert && price <= entry.priceAlert ? ' hit' : ''}`}>
              {price != null && formatUsd(price)}
              {entry.priceAlert ? <><Icon name={price != null && price <= entry.priceAlert ? 'notifications_active' : 'notifications'} aria-hidden />{formatUsd(entry.priceAlert)}</> : null}
            </span>
          )}
          {considering && <span className="dim considering">Considering in {considering}</span>}
        </div>
      </div>
      <div className="qty">
        <button type="button" onClick={onDecrement} aria-label={`One fewer ${entry.name}`}>−</button>
        <span className="qn">{entry.quantity}</span>
        <button type="button" onClick={onIncrement} aria-label={`One more ${entry.name}`}>+</button>
      </div>
      <button type="button" className="more" onClick={onMore} aria-label={`Actions for ${entry.name}`}>
        <Icon name="more_vert" style={{ fontSize: 20 }} />
      </button>
    </div>
  )
}

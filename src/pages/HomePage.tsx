import { NewsPanel } from '../components/RelayPanels'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { SyncButton } from '../components/SyncButton'
import {
  ArtImage, IconButton, IdentityStrip, SectionHeader, StatFigure, rise, toArtCrop, useLayoutSize,
} from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { CardZoomModal } from '../components/CardZoomModal'
import { InboxBadge, LAST_DECK_KEY } from '../components/Layout'
import { getRandomCard } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import { backImageUrl, cardTags, displayImageUrl, displayManaCost, displayOracleText } from '../types/scryfall'
import type { Collection, Deck } from '../types/models'
import { usePriceAlertHits } from '../collection/priceAlerts'
import { useCollectionValue } from '../collection/valueHistory'
import { useMoney } from '../money/currency'
import { isAndroid } from './GetAppPage'

const CARD_OF_DAY_KEY = 'mtgweb_card_of_day'
/** Set once the "Get the Android app" banner has been dismissed. */
const APP_BANNER_KEY = 'mtgweb_app_banner_dismissed'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** One random card per day, remembered so it doesn't change on every visit. */
function useCardOfDay(): ScryfallCard | null {
  const today = new Date().toISOString().slice(0, 10)
  const [card, setCard] = useState<ScryfallCard | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CARD_OF_DAY_KEY) ?? 'null')
      return saved?.date === today ? saved.card : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (card) return
    let cancelled = false
    getRandomCard()
      .then((c) => {
        if (cancelled) return
        setCard(c)
        try { localStorage.setItem(CARD_OF_DAY_KEY, JSON.stringify({ date: today, card: c })) } catch { /* ignore */ }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [card, today])
  return card
}

export function HomePage() {
  const navigate = useNavigate()
  const size = useLayoutSize()
  const { decks, collections, account, accountsAvailable, cloud } = useSync()
  const priceAlerts = usePriceAlertHits(collections)
  // On an Android phone, point at the app once (until it's dismissed).
  const [appBannerHidden, setAppBannerHidden] = useState(() => {
    try { return localStorage.getItem(APP_BANNER_KEY) === '1' } catch { return true }
  })
  const appBanner = isAndroid() && !appBannerHidden && (
    <div className="banner rise app-banner" style={{ ...rise(1), marginBottom: 0 }}>
      <Icon name="android" />
      <button type="button" className="banner-text" onClick={() => navigate('/app')}>
        <b>Get the Android app</b>: the same account, with notifications, price alerts and offline card search.
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Not now"
        onClick={() => {
          setAppBannerHidden(true)
          try { localStorage.setItem(APP_BANNER_KEY, '1') } catch { /* shows again next time */ }
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  )
  const alertBanner = priceAlerts.hits.length > 0 && (
    <PriceAlertBanner hits={priceAlerts.hits} onOpen={(id) => navigate(`/collections/${id}`)} onDismiss={priceAlerts.dismiss} />
  )
  const deckColors = useDeckColors(decks)
  const cardOfDay = useCardOfDay()
  const [zoomCard, setZoomCard] = useState<ScryfallCard | null>(null)
  const [globalQuery, setGlobalQuery] = useState('')

  const lastId = localStorage.getItem(LAST_DECK_KEY)
  const lastDeck = decks.find((d) => d.id === lastId) ?? null
  const continueDeck = lastDeck ?? decks[0] ?? null
  const railDecks = [...decks].sort((a, b) => Number(b.id === lastId) - Number(a.id === lastId))
  // The owned binders' value, noted once a day for the value history (/value).
  const value = useCollectionValue(collections)
  const money = useMoney()
  const results = decks.flatMap((d) => d.gameResults)
  const wins = results.filter((r) => r.result === 'WIN').length
  const losses = results.filter((r) => r.result === 'LOSS').length
  const draws = results.filter((r) => r.result === 'DRAW').length
  const record = results.length > 0 ? `${wins}–${losses}${draws > 0 ? `–${draws}` : ''}` : null

  const hero = continueDeck && (
    <ContinueHero deck={continueDeck} colors={deckColors[continueDeck.id] ?? []} isLast={!!lastDeck} onOpen={() => navigate(`/decks/${continueDeck.id}`)} />
  )

  const zoom = zoomCard && (
    <CardZoomModal
      imageUrl={displayImageUrl(zoomCard)}
      name={zoomCard.name}
      typeLine={zoomCard.type_line}
      priceUsd={zoomCard.prices?.usd}
      priceUsdFoil={zoomCard.prices?.usd_foil}
      scryfallId={zoomCard.id}
      backImageUrl={backImageUrl(zoomCard)}
      tags={cardTags(zoomCard)}
      oracleText={displayOracleText(zoomCard)}
      manaCost={displayManaCost(zoomCard)}
      onSelectSimilar={setZoomCard}
      onClose={() => setZoomCard(null)}
    />
  )

  if (size !== 'phone') {
    const desktop = size === 'desktop'
    const gridDecks = railDecks.slice(0, desktop ? 11 : 5)
    return (
      <>
        <header className="home-wide-top rise" style={rise(0)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">{greeting()}</div>
            <h1>{desktop ? 'Welcome back' : 'MTG Companion'}</h1>
          </div>
          <form
            className="searchpill"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              navigate(globalQuery.trim() ? `/search?q=${encodeURIComponent(globalQuery.trim())}` : '/search')
            }}
          >
            <Icon name="search" style={{ fontSize: 20 }} />
            <input value={globalQuery} onChange={(e) => setGlobalQuery(e.target.value)} placeholder="Search every card on Scryfall" aria-label="Search cards" />
          </form>
          {desktop && (
            <button type="button" className="btn gold" onClick={() => navigate('/decks?new=1')}><Icon name="add" />New deck</button>
          )}
        </header>

        <div className="content-scroll" style={{ display: 'grid', gap: desktop ? 28 : 20, alignContent: 'start' }}>
          {accountsAvailable && !account && (
            <button type="button" className="banner press rise" style={{ ...rise(1), marginBottom: 0 }} onClick={() => navigate('/account')}>
              <Icon name="sync" />
              <span style={{ flex: 1 }}>Sign in to sync your decks and binders with the Android app.</span>
              <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
            </button>
          )}
          {alertBanner}
          {appBanner}

          {desktop ? (
            <section className="home-hero-row rise" style={rise(1)}>
              {hero ?? <EmptyDecks onNew={() => navigate('/decks?new=1')} />}
              <div className="stats-2x2">
                <StatFigure value={decks.length} label="Decks" onClick={() => navigate('/decks')} />
                <StatFigure value={collections.length} label="Binders" onClick={() => navigate('/collections?tab=binders')} />
                <StatFigure value={value?.usd ?? null} format={(v) => money.format(v, true)} label="Collection value" onClick={() => navigate('/value')} />
                <button type="button" className="stat press" style={{ cursor: 'default' }}>
                  <span className="num">{record ?? <span style={{ color: 'var(--t2)' }}>—</span>}</span>
                  <span className="lbl">{record ? `Match record · ${Math.round((wins * 100) / results.length)}% wins` : 'No games logged yet'}</span>
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="rise" style={rise(1)}>{hero ?? <EmptyDecks onNew={() => navigate('/decks?new=1')} />}</div>
              <div className="stats four rise" style={rise(2)}>
                <StatFigure value={decks.length} label="Decks" onClick={() => navigate('/decks')} />
                <StatFigure value={collections.length} label="Binders" onClick={() => navigate('/collections?tab=binders')} />
                <StatFigure value={value?.usd ?? null} format={(v) => money.format(v, true)} label="Collection value" onClick={() => navigate('/value')} />
                <button type="button" className="stat press" style={{ cursor: 'default' }}>
                  <span className="num">{record ?? <span style={{ color: 'var(--t2)' }}>—</span>}</span>
                  <span className="lbl">Match record</span>
                </button>
              </div>
            </>
          )}

          {decks.length > 0 && (
            <section className="rise" style={rise(3)}>
              <SectionHeader title="Your decks" action="See all" onAction={() => navigate('/decks')} style={{ paddingTop: 0 }} />
              <div className="deck-grid">
                {gridDecks.map((deck) => <MiniDeck key={deck.id} deck={deck} colors={deckColors[deck.id] ?? []} onOpen={() => navigate(`/decks/${deck.id}`)} />)}
                <button type="button" className="mini add press" onClick={() => navigate('/decks?new=1')}>
                  <span className="ic"><Icon name="add" /></span>
                  New deck
                </button>
              </div>
            </section>
          )}

          <section className="home-bottom rise" style={rise(4)}>
            {cardOfDay ? <CardOfDay card={cardOfDay} onOpen={() => setZoomCard(cardOfDay)} /> : <div />}
            <BinderSummary collections={collections} onOpen={(id) => navigate(`/collections/${id}`)} onAll={() => navigate('/collections?tab=binders')} />
          </section>

          <NewsPanel limit={desktop ? 8 : 6} index={5} />
        </div>
        {zoom}
      </>
    )
  }

  return (
    <>
      <header className="home-top rise" style={rise(0)}>
        <div>
          <div className="eyebrow">{greeting()}</div>
          <div className="brand">MTG Companion</div>
        </div>
        {accountsAvailable && (
          <div className="row" style={{ gap: 8 }}>
            <SyncButton />
            <span className="badge-anchor">
              <IconButton icon="group" label="Friends" onClick={() => navigate('/friends')} />
              <InboxBadge dot />
            </span>
            <IconButton
              icon={account ? (cloud.failed ? 'cloud_off' : 'cloud_done') : 'account_circle'}
              label="Account & sync"
              onClick={() => navigate('/account')}
            />
          </div>
        )}
      </header>

      <div className="content-scroll with-nav">
        {accountsAvailable && !account && (
          <button type="button" className="banner press rise" style={rise(1)} onClick={() => navigate('/account')}>
            <Icon name="sync" />
            <span style={{ flex: 1 }}>Sign in to sync your decks and binders with the Android app.</span>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </button>
        )}
        {alertBanner}
        {appBanner}

        {hero && <div className="rise" style={rise(1)}>{hero}</div>}

        <div className="stats rise" style={{ ...rise(2), marginTop: 10 }}>
          <StatFigure value={decks.length} label="Decks" onClick={() => navigate('/decks')} />
          <StatFigure value={collections.length} label="Binders" onClick={() => navigate('/collections?tab=binders')} />
          <StatFigure value={value?.usd ?? null} format={(v) => money.format(v, true)} label="Collection value" onClick={() => navigate('/value')} />
        </div>

        <button type="button" className="banner press rise" style={{ ...rise(3), marginTop: 10 }} onClick={() => navigate('/life')}>
          <Icon name="favorite" />
          <span style={{ flex: 1 }}>Life counter — life, commander damage and turns for the whole table</span>
          <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
        </button>
        <button type="button" className="banner press rise" style={{ ...rise(3), marginTop: 10 }} onClick={() => navigate('/rules')}>
          <Icon name="gavel" />
          <span style={{ flex: 1 }}>Rules — what a keyword does, and the official rulings for any card</span>
          <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
        </button>
        {accountsAvailable && (
          <button type="button" className="banner press rise" style={{ ...rise(3), marginTop: 10 }} onClick={() => navigate('/friends')}>
            <Icon name="group" />
            <span style={{ flex: 1 }}>Friends — share decks and binders, trade cards, join a life counter</span>
            <InboxBadge />
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </button>
        )}

        {record && (
          <div className="record rise" style={rise(3)}>
            <span className="num">{record}</span>
            <div>
              <div className="record-title">Match record</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{Math.round((wins * 100) / results.length)}% win rate across all decks</div>
            </div>
          </div>
        )}

        <section className="rise" style={rise(3)}>
          <SectionHeader title="Your decks" action={decks.length > 0 ? 'See all' : undefined} onAction={() => navigate('/decks')} />
          <div className="rail">
            {railDecks.map((deck) => <MiniDeck key={deck.id} deck={deck} colors={deckColors[deck.id] ?? []} onOpen={() => navigate(`/decks/${deck.id}`)} />)}
            <button type="button" className="mini add press" onClick={() => navigate('/decks?new=1')}>
              <span className="ic"><Icon name="add" /></span>
              New deck
            </button>
          </div>
        </section>

        {cardOfDay && (
          <section className="rise" style={rise(4)}>
            <SectionHeader title="Card of the day" />
            <CardOfDay card={cardOfDay} onOpen={() => setZoomCard(cardOfDay)} />
          </section>
        )}

        <section style={{ marginTop: 18 }}>
          <NewsPanel index={5} />
        </section>
      </div>
      {zoom}
    </>
  )
}

function ContinueHero({ deck, colors, isLast, onOpen }: { deck: Deck; colors: string[]; isLast: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="continue press" onClick={onOpen}>
      <ArtImage src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={colors} />
      <div className="shade" />
      <div className="c-body">
        <div className="eyebrow">{isLast ? 'Continue building' : 'Your deck'}</div>
        <div className="c-name">{deck.name}</div>
        <div className="c-sub">
          {[deck.commander?.name, `${deck.cards.reduce((s, c) => s + c.quantity, 0)} cards`].filter(Boolean).join(' · ')}
        </div>
        <IdentityStrip colors={colors} />
      </div>
      <span className="c-go"><Icon name="arrow_forward" /></span>
    </button>
  )
}

function MiniDeck({ deck, colors, onOpen }: { deck: Deck; colors: string[]; onOpen: () => void }) {
  return (
    <button type="button" className="mini press" onClick={onOpen}>
      <ArtImage src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={colors} />
      <div className="shade" />
      <div className="mini-body">
        <div className="mini-name">{deck.name}</div>
        <IdentityStrip colors={colors} />
      </div>
    </button>
  )
}

function EmptyDecks({ onNew }: { onNew: () => void }) {
  return (
    <div className="panel empty-state" style={{ minHeight: 260, alignContent: 'center' }}>
      <Icon name="style" />
      <div>No decks yet. Build your first one to see it here.</div>
      <button type="button" className="btn gold" onClick={onNew}><Icon name="add" />New deck</button>
    </div>
  )
}

function CardOfDay({ card, onOpen }: { card: ScryfallCard; onOpen: () => void }) {
  const money = useMoney()
  return (
    <button type="button" className="cotd press" onClick={onOpen}>
      <div className="foil" style={{ borderRadius: 7 }}>
        <img src={displayImageUrl(card) ?? undefined} alt={card.name} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow">Card of the day</div>
        <div className="cotd-name">{card.name}</div>
        <div className="cotd-meta">
          <span>{card.prices?.usd ? `${money.formatPrice(card.prices.usd)} · ` : ''}{card.type_line}</span>
          <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
        </div>
      </div>
    </button>
  )
}

function BinderSummary({ collections, onOpen, onAll }: { collections: Collection[]; onOpen: (id: string) => void; onAll: () => void }) {
  return (
    <div className="panel home-binders">
      <div className="row-between" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Binders</h2>
        <button type="button" className="link" onClick={onAll}>Open collection</button>
      </div>
      {collections.length === 0 && <div className="muted">No binders yet.</div>}
      {collections.slice(0, 4).map((c) => {
        const total = c.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0)
        return (
          <button key={c.id} type="button" className="brow press" onClick={() => onOpen(c.id)}>
            {c.entries[0]
              ? <ArtImage src={toArtCrop(c.entries[0].imageUrl)} seed={c.name} />
              : <div className="icon-tile"><Icon name={c.type === 'WISHLIST' ? 'star' : 'collections'} /></div>}
            <div style={{ minWidth: 0 }}>
              <div className="brow-name">{c.name}</div>
              <div className="brow-meta">
                {c.type === 'WISHLIST' && <span className="badge soft">Wishlist</span>}
                <span><b>{total}</b>cards</span>
              </div>
            </div>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </button>
        )
      })}
    </div>
  )
}

/** Wishlist cards that dropped to (or under) the price the user asked to hear about. */
function PriceAlertBanner({ hits, onOpen, onDismiss }: { hits: import('../collection/priceAlerts').PriceAlertHit[]; onOpen: (collectionId: string) => void; onDismiss: () => void }) {
  const first = hits[0]
  const money = useMoney()
  const formatUsd = (v: number) => money.format(v)
  return (
    <div className="banner rise price-alert-banner" style={{ ...rise(1), marginBottom: 0 }} role="status">
      <Icon name="notifications_active" />
      <button type="button" className="banner-text" onClick={() => onOpen(first.collectionId)}>
        {hits.length === 1
          ? <><b>{first.entry.name}</b> is {formatUsd(first.price)} — under your {formatUsd(first.entry.priceAlert ?? 0)} alert</>
          : <><b>{hits.length} wishlist cards</b> are under your alert prices: {hits.map((h) => `${h.entry.name} ${formatUsd(h.price)}`).join(', ')}</>}
      </button>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onDismiss}><Icon name="close" /></button>
    </div>
  )
}

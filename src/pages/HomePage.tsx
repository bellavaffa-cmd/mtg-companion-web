import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { ArtImage, IconButton, IdentityStrip, SectionHeader, StatFigure, rise, toArtCrop } from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { CardZoomModal } from '../components/CardZoomModal'
import { getRandomCard } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import { backImageUrl, cardTags, displayImageUrl, displayManaCost, displayOracleText } from '../types/scryfall'

export const LAST_DECK_KEY = 'mtgweb_last_deck'
const CARD_OF_DAY_KEY = 'mtgweb_card_of_day'

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
  const { decks, collections, account, accountsAvailable, cloud } = useSync()
  const deckColors = useDeckColors(decks)
  const cardOfDay = useCardOfDay()
  const [zoomCard, setZoomCard] = useState<ScryfallCard | null>(null)

  const lastId = localStorage.getItem(LAST_DECK_KEY)
  const lastDeck = decks.find((d) => d.id === lastId) ?? null
  const continueDeck = lastDeck ?? decks[0] ?? null
  const railDecks = [...decks].sort((a, b) => Number(b.id === lastId) - Number(a.id === lastId))
  const ownedCards = collections
    .filter((c) => c.type !== 'WISHLIST')
    .reduce((sum, c) => sum + c.entries.reduce((s, e) => s + e.quantity + e.foilQuantity, 0), 0)
  const results = decks.flatMap((d) => d.gameResults)
  const wins = results.filter((r) => r.result === 'WIN').length
  const losses = results.filter((r) => r.result === 'LOSS').length
  const draws = results.filter((r) => r.result === 'DRAW').length

  return (
    <>
      <header className="home-top rise" style={rise(0)}>
        <div>
          <div className="eyebrow">{greeting()}</div>
          <div className="brand">MTG Companion</div>
        </div>
        {accountsAvailable && (
          <IconButton
            icon={account ? (cloud.failed ? 'cloud_off' : 'cloud_done') : 'account_circle'}
            label="Account & sync"
            onClick={() => navigate('/account')}
          />
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

        {continueDeck && (
          <button type="button" className="continue press rise" style={rise(1)} onClick={() => navigate(`/decks/${continueDeck.id}`)}>
            <ArtImage src={toArtCrop(continueDeck.commander?.imageUrl)} seed={continueDeck.name} colors={deckColors[continueDeck.id]} />
            <div className="shade" />
            <div className="c-body">
              <div className="eyebrow">{lastDeck ? 'Continue building' : 'Your deck'}</div>
              <div className="c-name">{continueDeck.name}</div>
              <div className="c-sub">
                {[continueDeck.commander?.name, `${continueDeck.cards.reduce((s, c) => s + c.quantity, 0)} cards`].filter(Boolean).join(' · ')}
              </div>
              <IdentityStrip colors={deckColors[continueDeck.id] ?? []} />
            </div>
            <span className="c-go"><Icon name="arrow_forward" /></span>
          </button>
        )}

        <div className="stats rise" style={{ ...rise(2), marginTop: 10 }}>
          <StatFigure value={decks.length} label="Decks" onClick={() => navigate('/decks')} />
          <StatFigure value={collections.length} label="Binders" onClick={() => navigate('/collections')} />
          <StatFigure value={ownedCards} label="Cards owned" onClick={() => navigate('/collections')} />
        </div>

        {results.length > 0 && (
          <div className="record rise" style={rise(3)}>
            <span className="num">{wins}–{losses}{draws > 0 ? `–${draws}` : ''}</span>
            <div>
              <div className="record-title">Match record</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{Math.round((wins * 100) / results.length)}% win rate across all decks</div>
            </div>
          </div>
        )}

        <section className="rise" style={rise(3)}>
          <SectionHeader title="Your decks" action={decks.length > 0 ? 'See all' : undefined} onAction={() => navigate('/decks')} />
          <div className="rail">
            {railDecks.map((deck) => (
              <button key={deck.id} type="button" className="mini press" onClick={() => navigate(`/decks/${deck.id}`)}>
                <ArtImage src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={deckColors[deck.id]} />
                <div className="shade" />
                <div className="mini-body">
                  <div className="mini-name">{deck.name}</div>
                  <IdentityStrip colors={deckColors[deck.id] ?? []} />
                </div>
              </button>
            ))}
            <button type="button" className="mini add press" onClick={() => navigate('/decks?new=1')}>
              <span className="ic"><Icon name="add" /></span>
              New deck
            </button>
          </div>
        </section>

        {cardOfDay && (
          <section className="rise" style={rise(4)}>
            <SectionHeader title="Card of the day" />
            <button type="button" className="cotd press" onClick={() => setZoomCard(cardOfDay)}>
              <div className="foil" style={{ borderRadius: 7 }}>
                <img src={displayImageUrl(cardOfDay) ?? undefined} alt={cardOfDay.name} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">Today's pick</div>
                <div className="cotd-name">{cardOfDay.name}</div>
                <div className="cotd-meta">
                  <span>{cardOfDay.prices?.usd ? `$${cardOfDay.prices.usd} · ` : ''}{cardOfDay.type_line}</span>
                  <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
                </div>
              </div>
            </button>
          </section>
        )}
      </div>

      {zoomCard && (
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
      )}
    </>
  )
}

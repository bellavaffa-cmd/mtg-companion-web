import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import { madeByLabel, tokensNeeded, type TokenNeeded } from '../decks/tokens'
import { displayImageUrl, largeImageUrl, type ScryfallCard } from '../types/scryfall'
import type { Deck } from '../types/models'
import { CardZoomModal } from './CardZoomModal'
import { ArtImage } from './kit'

/**
 * What to put in the box besides the deck. Tokens are read off the cards themselves (decks/tokens.ts)
 * and their art is fetched once per deck; a token that hasn't arrived yet still shows its name, so
 * the list is useful before the pictures are.
 */
export function TokensPanel({ deck, cardsById }: { deck: Deck; cardsById: Map<string, ScryfallCard> | null | undefined }) {
  const tokens = tokensNeeded(deck, cardsById)
  const [art, setArt] = useState<Map<string, ScryfallCard>>(new Map())
  const [zoom, setZoom] = useState<TokenNeeded | null>(null)
  const ids = tokens.map((t) => t.id).join(',')

  useEffect(() => {
    if (!ids) { setArt(new Map()); return }
    let cancelled = false
    getCardsByIds(ids.split(','))
      .then((cards) => { if (!cancelled) setArt(new Map(cards.map((c) => [c.id, c]))) })
      .catch(() => { /* names alone are still worth showing */ })
    return () => { cancelled = true }
  }, [ids])

  // Nothing to say while the deck's cards are still being read.
  if (!cardsById) return null
  if (tokens.length === 0) {
    return (
      <div className="panel">
        <div className="p-h"><h3>Tokens</h3></div>
        <div className="dim">Nothing in this deck makes a token.</div>
      </div>
    )
  }

  const zoomCard = zoom ? art.get(zoom.id) : null
  return (
    <div className="panel">
      <div className="p-h">
        <h3>Tokens to bring</h3>
        <span className="p-sub">Kinds<b>{tokens.length}</b></span>
      </div>
      <div className="token-grid">
        {tokens.map((token) => {
          const card = art.get(token.id)
          return (
            <button
              key={`${token.name}-${token.typeLine ?? ''}`}
              type="button"
              className="token press"
              onClick={() => setZoom(token)}
              title={`${token.name} — made by ${token.madeBy.join(', ')}`}
            >
              {card ? (
                <img src={displayImageUrl(card) ?? undefined} alt="" loading="lazy" data-card-preview={largeImageUrl(card) ?? undefined} />
              ) : (
                <ArtImage src={null} seed={token.name} preview={false} />
              )}
              <span className="token-name">{token.name}</span>
              <span className="token-from">{madeByLabel(token)}</span>
              {token.madeBy.length > 1 && <span className="token-count">×{token.madeBy.length}</span>}
            </button>
          )
        })}
      </div>
      <div className="dim" style={{ marginTop: 10 }}>
        Read off the cards themselves. A number is how many cards in the deck make that token — not how many you need.
      </div>

      {zoom && (
        <CardZoomModal
          imageUrl={zoomCard ? displayImageUrl(zoomCard) : null}
          name={zoom.name}
          typeLine={zoom.typeLine}
          oracleText={zoomCard?.oracle_text ?? null}
          scryfallId={zoom.id}
          onClose={() => setZoom(null)}
        >
          <div className="panel" style={{ padding: '14px 16px' }}>
            <div className="p-h" style={{ margin: 0 }}><h3>Made by</h3></div>
            <div className="dim">{zoom.madeBy.join(' · ')}</div>
          </div>
        </CardZoomModal>
      )}
    </div>
  )
}

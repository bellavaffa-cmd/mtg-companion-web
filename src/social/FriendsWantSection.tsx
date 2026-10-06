import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import type { PlacedCard } from '../collection/storagePlaces'
import { useOverview } from './SocialContext'
import * as more from './more'
import { bringToGameNight, friendsWantHere, hasLine, wantedAsDeckCards, wantedAsTrade, wantedWhere, wantsLine, type WantedHere } from './friendsWant'

/**
 * "Friends want these" on a binder (social/friendsWant.ts): the friends whose wishlists want cards in
 * it, from the trade matches — each with how many and what they're worth, every card with its pocket,
 * what they have that the user wants, Propose a trade and, when it goes both ways, Bring to game
 * night. Nothing at all when signed out, with no friends' wants here, or before the server has trade
 * matches. The Android app's FriendsWantSection.kt.
 */
export function FriendsWantSection({ cards, priceOf }: { cards: PlacedCard[]; priceOf: (c: PlacedCard) => number | null }) {
  const available = more.useSocialMore()
  const { overview, person } = useOverview()
  const { changeDecksAndStorage, decks } = useSync()
  const navigate = useNavigate()
  const money = useMoney()
  const [matches, setMatches] = useState<more.TradeMatch[]>([])
  useEffect(() => {
    if (!available) return
    let cancelled = false
    more.tradeMatches().then((m) => { if (!cancelled) setMatches(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [available])
  if (!overview) return null
  const wants = friendsWantHere(matches, cards, priceOf).filter((w) => person(w.friend))
  if (wants.length === 0) return null
  const bring = (picked: WantedHere[]) => {
    const newId = crypto.randomUUID()
    const lines = wantedAsDeckCards(picked)
    const { deckId } = bringToGameNight(decks, lines, newId)
    changeDecksAndStorage((collections, all) => ({ collections, decks: bringToGameNight(all, lines, newId).decks }))
    navigate(`/decks/${deckId}/pull`)
  }
  return (
    <section className="friends-want" aria-labelledby="friends-want-h">
      <h3 id="friends-want-h">Friends want these</h3>
      {wants.map((w) => {
        const name = person(w.friend)?.display_name ?? 'A friend'
        const both = w.theyHave.length > 0
        const priced = w.cards.some((c) => c.price !== null)
        return (
          <div key={w.friend} className="friend-want">
            <div className="friend-want-h">
              <h4>{name}</h4>
              <span>{wantsLine(w.cards.length, priced ? money.format(w.value) : null)}</span>
            </div>
            {w.cards.map((c) => (
              <div key={`${c.card.collectionId}:${c.card.entry.scryfallId}`} className="friend-want-card">
                <span className="nm">{c.card.entry.name}</span>
                <span className="where">{wantedWhere(c)}</span>
              </div>
            ))}
            {hasLine(name, w.theyHave) && <div className="friend-want-has">{hasLine(name, w.theyHave)}</div>}
            <div className="friend-want-actions">
              <button
                type="button"
                className={`btn ${both ? 'gold' : 'line'}`}
                onClick={() => navigate(`/trades/new?to=${w.friend}`, { state: { want: w.theyHave, give: wantedAsTrade(w.cards) } })}
              >
                Propose a trade
              </button>
              {both && <button type="button" className="btn line" onClick={() => bring(w.cards)}>Bring to game night</button>}
            </div>
          </div>
        )
      })}
      {wants.some((w) => w.theyHave.length > 0) && (
        <p className="friend-want-note">"Bring to game night" adds the cards to a pull list, so they're in your bag on the night.</p>
      )}
    </section>
  )
}

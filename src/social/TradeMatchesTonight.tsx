import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { namesDecksUse } from '../collection/spares'
import { cardsIn, placesOf } from '../collection/storagePlaces'
import { useOverview } from './SocialContext'
import * as more from './more'
import { bringToGameNight } from './friendsWant'
import { addFriendLine, tonightAsDeckCards, tonightLine, tradeMatchesTonight, type TonightMatch, type TonightPlayer } from './tradeTonight'
import '../collection/storage.css'

/**
 * "Trade matches tonight" (social/tradeTonight.ts), on Game night and in Pack your bag: for each
 * friend at the table, the cards on their wishlist the user has spare or for trade (and where each
 * is), and theirs for trade the user wants — with Propose a trade (both sides filled in) and Bring
 * them (onto the "Bring to game night" pull list, as Friends want these does). Guests are named with
 * "Add … as a friend to see what they want". Nothing when signed out, or before the server has trade
 * matches. The Android app's TradeMatchesTonight.kt.
 */
export function TradeMatchesTonight({ players, className }: { players: TonightPlayer[]; className?: string }) {
  const available = more.useSocialMore()
  const { overview } = useOverview()
  const { collections, decks, changeDecksAndStorage } = useSync()
  const navigate = useNavigate()
  const [matches, setMatches] = useState<more.TradeMatch[] | null>(null)
  const [brought, setBrought] = useState<{ friend: string; deckId: string } | null>(null)
  useEffect(() => {
    if (!available) return
    let cancelled = false
    more.tradeMatches().then((m) => { if (!cancelled) setMatches(m) }).catch(() => { if (!cancelled) setMatches([]) })
    return () => { cancelled = true }
  }, [available])

  const tonight = useMemo(() => {
    if (!overview || !matches) return null
    const friends = new Set(overview.friends.filter((f) => f.status === 'accepted').map((f) => f.user_id))
    const places = placesOf(collections)
    const placed = places.flatMap((p) => cardsIn(collections, p.id))
    return tradeMatchesTonight(players, friends, matches, namesDecksUse(decks), placed, new Map(places.map((p) => [p.id, p.name])))
  }, [overview, matches, players, collections, decks])

  if (!available || players.length === 0 || !tonight) return null

  const bring = (m: TonightMatch) => {
    const newId = crypto.randomUUID()
    const lines = tonightAsDeckCards(m.theyWant)
    const { deckId } = bringToGameNight(decks, lines, newId)
    changeDecksAndStorage((cols, all) => ({ collections: cols, decks: bringToGameNight(all, lines, newId).decks }))
    setBrought({ friend: m.friend, deckId })
  }

  return (
    <section className={`friends-want${className ? ` ${className}` : ''}`} aria-labelledby="tonight-h">
      <h3 id="tonight-h">Trade matches tonight</h3>
      {tonight.matches.map((m) => (
        <div key={m.friend} className="friend-want">
          <div className="friend-want-h"><h4>{m.name}</h4></div>
          <div className="friend-want-has">{tonightLine(m)}</div>
          {m.theyWant.map((c) => (
            <div key={`${c.card.collectionId ?? ''}:${c.card.scryfallId}`} className="friend-want-card">
              <span className="nm">{c.card.name}</span>
              <span className="where">{c.where}</span>
            </div>
          ))}
          {m.theyHave.length > 0 && (
            <div className="friend-want-has">For trade, that you want: {m.theyHave.map((c) => c.name).join(', ')}</div>
          )}
          <div className="friend-want-actions">
            <button
              type="button"
              className="btn gold"
              onClick={() => navigate(`/trades/new?to=${m.friend}`, { state: { want: m.theyHave, give: m.theyWant.map((c) => c.card) } })}
            >
              Propose a trade
            </button>
            {m.theyWant.length > 0 && (
              brought?.friend === m.friend
                ? <button type="button" className="btn line" onClick={() => navigate(`/decks/${brought.deckId}/pull`)}>Open pull list</button>
                : <button type="button" className="btn line" onClick={() => bring(m)}>Bring them</button>
            )}
          </div>
          {brought?.friend === m.friend && <p className="friend-want-note">On the "Bring to game night" pull list.</p>}
        </div>
      ))}
      {tonight.nothing.length > 0 && (
        <p className="friend-want-note">Nothing to trade with {tonight.nothing.join(', ')} tonight.</p>
      )}
      {tonight.notFriends.map((n) => <p key={n} className="friend-want-note">{addFriendLine(n)}.</p>)}
    </section>
  )
}

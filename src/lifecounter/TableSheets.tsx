import { useEffect, useState, type ReactNode } from 'react'
import { searchCards } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import type { Deck } from '../types/models'
import type { TableGame } from './tableGames'

// The table's own sheets for who's playing what: a seat's commander (for a player without a phone),
// the table owner's seat and deck, and the games played at this table. Mirrors the Android app's
// TableSeatOverlays.kt.

type SheetProps = { title: string; subtitle?: string; onClose: () => void; children: ReactNode }

const artOf = (card: ScryfallCard) => card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null

/** Picks the commander a seat is playing: into everyone's game records, and its art behind a bare tile. */
export function CommanderSheet({ playerName, current, onPick, onClose, Sheet }: {
  playerName: string
  current: string | null | undefined
  onPick: (name: string | null, art: string | null) => void
  onClose: () => void
  Sheet: (p: SheetProps) => ReactNode
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryfallCard[] | null>(null)
  useEffect(() => {
    const q = query.trim().replace(/"/g, '')
    if (q.length < 2) { setResults(null); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchCards(`is:commander name:"${q}"`)
        .then((page) => { if (!cancelled) setResults(page.cards.slice(0, 20)) })
        .catch(() => { if (!cancelled) setResults([]) })
    }, 400)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])

  return (
    <Sheet title={`${playerName}'s commander`} subtitle="For everyone's game records — and its art behind the tile" onClose={onClose}>
      <input className="lc-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Commander name" autoFocus aria-label="Commander name" />
      {current && (
        <p className="lc-hint">
          Now: <b>{current}</b> · <button type="button" className="lc-link" onClick={() => onPick(null, null)}>Clear</button>
        </p>
      )}
      {results && results.length === 0 && <p className="lc-hint">No commander called that.</p>}
      <div className="lc-pick-list">
        {results?.map((card) => (
          <button key={card.id} type="button" className="lc-pick" onClick={() => onPick(card.name, artOf(card))}>
            {artOf(card) ? <img src={artOf(card)!} alt="" loading="lazy" /> : <span className="lc-pick-art" />}
            <span className="lc-pick-text"><b>{card.name}</b><span>{card.type_line}</span></span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/**
 * "This is me": marks a seat as the table owner's, for playing without a phone of their own, and
 * picks the deck their games there are saved to.
 */
export function MeSheet({ decks, currentDeckId, isMe, onPick, onNotMe, onClose, Sheet }: {
  decks: Deck[]
  currentDeckId: string | null | undefined
  isMe: boolean
  onPick: (deckId: string) => void
  onNotMe: () => void
  onClose: () => void
  Sheet: (p: SheetProps) => ReactNode
}) {
  return (
    <Sheet title="Your seat · deck" subtitle="Each game at this seat is saved to the deck you pick" onClose={onClose}>
      <p className="lc-hint">If you join the seat from your phone, the phone saves the game instead, so it's never saved twice.</p>
      {isMe && <button type="button" className="lc-wide-btn" onClick={onNotMe}>Not me</button>}
      <div className="lc-pick-list">
        {decks.map((deck) => {
          const art = deck.commander?.imageUrl?.replace('/normal/', '/art_crop/') ?? null
          return (
            <button key={deck.id} type="button" className={`lc-pick${isMe && deck.id === currentDeckId ? ' on' : ''}`} onClick={() => onPick(deck.id)}>
              {art ? <img src={art} alt="" loading="lazy" /> : <span className="lc-pick-art" />}
              <span className="lc-pick-text"><b>{deck.name}</b><span>{deck.commander?.name ?? ''}</span></span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

/** The games played at this table, newest first: who won, how long it took, and who played what. */
export function TableGamesSheet({ games, onDelete, onClear, onClose, Sheet }: {
  games: TableGame[]
  onDelete: (id: string) => void
  onClear: () => void
  onClose: () => void
  Sheet: (p: SheetProps) => ReactNode
}) {
  const [confirm, setConfirm] = useState(false)
  const wins = new Map<string, number>()
  for (const g of games) {
    const w = g.players.find((p) => p.seat === g.winnerSeat)
    if (w) wins.set(w.name, (wins.get(w.name) ?? 0) + 1)
  }
  const top = [...wins.entries()].sort((a, b) => b[1] - a[1])[0]
  return (
    <Sheet
      title="Games at this table"
      subtitle={games.length ? `${games.length} ${games.length === 1 ? 'game' : 'games'}${top ? ` · most wins: ${top[0]} (${top[1]})` : ''}` : undefined}
      onClose={onClose}
    >
      {games.length === 0 ? (
        <p className="lc-hint">Finished games show up here.</p>
      ) : (
        <>
          <ul className="lc-games">
            {games.map((g) => {
              const winner = g.players.find((p) => p.seat === g.winnerSeat)
              return (
                <li key={g.id}>
                  <div className="lc-game-head">
                    <b>{winner ? `${winner.name} won` : 'No winner'}</b>
                    <button type="button" className="lc-icon-btn" aria-label="Remove this game" onClick={() => onDelete(g.id)}>
                      <span className="material-symbols-rounded">close</span>
                    </button>
                  </div>
                  <div className="lc-hint">
                    {new Date(g.endedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {g.minutes} min · {g.turns} {g.turns === 1 ? 'turn' : 'turns'}
                  </div>
                  {g.players.map((p) => (
                    <div key={p.seat} className={`lc-game-player${p.out ? ' out' : ''}`}>
                      {p.seat === g.winnerSeat ? '★ ' : ''}{p.name}{p.commander ? ` · ${p.commander}` : ''}{p.me ? ' · you' : ''}
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
          <button type="button" className="lc-wide-btn" onClick={() => (confirm ? (onClear(), setConfirm(false)) : setConfirm(true))}>
            {confirm ? 'Clear all games? Tap again' : 'Clear all games'}
          </button>
        </>
      )}
    </Sheet>
  )
}

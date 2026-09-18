import { useEffect, useRef, useState } from 'react'
import { commanderSuggestions, edhrecImageUrl, inclusionPercent, OfflineError, type EdhrecCard } from '../api/edhrec'
import { getByFuzzyName } from '../api/scryfall'
import type { Deck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { Icon } from './Icon'
import { rise } from './kit'

/**
 * Cards other people play with this deck's commander that it doesn't have yet, from EDHREC —
 * the Android app's Suggestions tab. Tapping one looks it up on Scryfall and adds it.
 */
export function DeckSuggestions({ deck, onAdd, index = 0 }: { deck: Deck; onAdd: (card: ScryfallCard) => void; index?: number }) {
  const commander = deck.commander?.name ?? null
  const have = [...deck.cards.map((c) => c.name), ...(deck.commander ? [deck.commander.name] : [])]
  const key = `${commander}#${[...have].sort().join('|')}`
  const [cards, setCards] = useState<EdhrecCard[] | null | undefined>(undefined)
  // Set when EDHREC couldn't be reached at all — a different thing from having no page for the commander.
  const [unreachable, setUnreachable] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // Only a new commander shows the loading state; a card added to the deck just re-ranks the list.
  const shownFor = useRef<string | null>(null)

  useEffect(() => {
    if (!commander) return
    let cancelled = false
    if (shownFor.current !== commander) {
      setCards(undefined)
      setUnreachable(null)
    }
    shownFor.current = commander
    // edhrec.ts keeps each commander's page, so this is quick after the first time.
    commanderSuggestions(commander, have)
      .then((result) => { if (!cancelled) setCards(result) })
      .catch((e) => {
        if (cancelled) return
        shownFor.current = null
        setUnreachable(e instanceof OfflineError ? e.message : "Couldn't reach EDHREC. Try again in a moment.")
        setCards(null)
      })
    return () => { cancelled = true }
    // key covers the commander and every card already in the deck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const add = async (card: EdhrecCard) => {
    setAdding(card.name)
    setFailed(null)
    try {
      onAdd(await getByFuzzyName(card.name))
    } catch {
      setFailed(card.name)
    } finally {
      setAdding(null)
    }
  }

  if (!commander) {
    return (
      <div className="empty-state">
        <Icon name="tips_and_updates" />
        Set a commander to see what other people play with it.
      </div>
    )
  }
  if (cards === undefined) return <div className="empty-state">Asking EDHREC what pairs well with {commander}…</div>
  if (unreachable) return <div className="empty-state"><Icon name="cloud_off" />{unreachable}</div>
  if (cards === null) return <div className="empty-state">EDHREC has no page for {commander} yet.</div>
  if (cards.length === 0) return <div className="empty-state">This deck already runs EDHREC's picks for {commander}.</div>

  return (
    <div className="rise" style={rise(index)}>
      <div className="suggest-grid">
        {cards.map((card) => {
          const image = edhrecImageUrl(card)
          const percent = inclusionPercent(card)
          return (
            <button
              key={card.name}
              type="button"
              className="suggest press"
              onClick={() => void add(card)}
              disabled={adding === card.name}
              title={`Add ${card.name} to this deck`}
            >
              {image
                ? <img src={image} alt="" loading="lazy" />
                : <span className="suggest-noart"><Icon name="image_not_supported" /></span>}
              <span className="suggest-name">{card.name}</span>
              <span className="suggest-meta">
                {adding === card.name ? 'Adding…' : percent !== null ? `${percent}% of decks` : `${card.numDecks ?? 0} decks`}
              </span>
              <span className="suggest-add"><Icon name="add" /></span>
            </button>
          )
        })}
      </div>
      {failed && <div className="dim" style={{ marginTop: 10 }}>Couldn't find {failed} on Scryfall.</div>}
      <div className="dim" style={{ marginTop: 10 }}>From EDHREC, based on decks people have published with {commander}.</div>
    </div>
  )
}

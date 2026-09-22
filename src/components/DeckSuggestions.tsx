import { useEffect, useRef, useState } from 'react'
import { biggerImageUrl } from '../types/scryfall'
import { commanderSuggestions, edhrecImageUrl, inclusionPercent, OfflineError, type EdhrecCard } from '../api/edhrec'
import { getByFuzzyName } from '../api/scryfall'
import type { Deck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { Icon } from './Icon'
import { rise } from './kit'

/**
 * Cards other people play with this deck's commander that it doesn't have yet, from EDHREC —
 * the Android app's Suggestions tab. Tapping one opens it, to read before deciding; the + puts it
 * in Considering, since a suggestion is a thought about the deck rather than a change to it.
 */
export function DeckSuggestions({ deck, onExpand, onConsider, index = 0 }: {
  deck: Deck
  /** Look at the card — it's only a suggestion until the user says otherwise. */
  onExpand: (card: ScryfallCard) => void
  onConsider: (card: ScryfallCard) => void
  index?: number
}) {
  const commander = deck.commander?.name ?? null
  const have = [...deck.cards.map((c) => c.name), ...(deck.commander ? [deck.commander.name] : [])]
  const key = `${commander}#${[...have].sort().join('|')}`
  const [cards, setCards] = useState<EdhrecCard[] | null | undefined>(undefined)
  // Set when EDHREC couldn't be reached at all — a different thing from having no page for the commander.
  const [unreachable, setUnreachable] = useState<string | null>(null)
  // The name being looked up on Scryfall, and what it's for: EDHREC gives us a name, nothing more.
  const [busy, setBusy] = useState<{ name: string; considering: boolean } | null>(null)
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

  const fetchThen = async (card: EdhrecCard, considering: boolean, use: (card: ScryfallCard) => void) => {
    setBusy({ name: card.name, considering })
    setFailed(null)
    try {
      use(await getByFuzzyName(card.name))
    } catch {
      setFailed(card.name)
    } finally {
      setBusy(null)
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
          const working = busy?.name === card.name
          return (
            <div key={card.name} className={`suggest${working ? ' busy' : ''}`}>
              <button
                type="button"
                className="suggest-open press"
                onClick={() => void fetchThen(card, false, onExpand)}
                disabled={working}
                title={`Look at ${card.name}`}
              >
                {image
                  ? <img src={image} alt="" loading="lazy" data-card-preview={biggerImageUrl(image) ?? undefined} />
                  : <span className="suggest-noart"><Icon name="image_not_supported" /></span>}
                <span className="suggest-name">{card.name}</span>
                <span className="suggest-meta">
                  {working
                    ? (busy!.considering ? 'Adding…' : 'Opening…')
                    : percent !== null ? `${percent}% of decks` : `${card.numDecks ?? 0} decks`}
                </span>
              </button>
              <button
                type="button"
                className="suggest-add"
                onClick={() => void fetchThen(card, true, onConsider)}
                disabled={working}
                aria-label={`Consider ${card.name} for this deck`}
                title={`Consider ${card.name} for this deck`}
              >
                <Icon name="add" />
              </button>
            </div>
          )
        })}
      </div>
      {failed && <div className="dim" style={{ marginTop: 10 }}>Couldn't find {failed} on Scryfall.</div>}
      <div className="dim" style={{ marginTop: 10 }}>
        From EDHREC, based on decks people have published with {commander}. Tap a card to read it, or + to put it in Considering.
      </div>
    </div>
  )
}

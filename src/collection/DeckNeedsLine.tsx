import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useCardData } from './cardData'
import { deckNeeds, deckNeedsLine, gearOf } from './gear'
import { tokensToBring } from '../decks/tokens'
import type { Deck } from '../types/models'

/** "Krenko goblins: 100 sleeves, a deck box and Goblin tokens. You have them all." — also on a deck's Tokens panel. */
export function DeckNeedsLine({ deck, tokens, heading = false }: { deck: Deck; tokens?: string[]; heading?: boolean }) {
  const { collections, decks } = useSync()
  const ids = useMemo(() => (tokens ? [] : [deck.commander, deck.partnerCommander, ...deck.cards].filter((c) => !!c).map((c) => c!.scryfallId)), [deck, tokens])
  const cards = useCardData(ids)
  const names = tokens ?? tokensToBring(deck, cards).map((t) => t.name)
  const line = deckNeedsLine(deck, deckNeeds(deck, gearOf(collections), names, decks, collections))
  if (!heading) return <p className="gear-needs-line">{line}</p>
  return (
    <div className="gear-needs" style={{ marginTop: 12 }}>
      <h3 className="p-h" style={{ margin: 0 }}>This deck needs</h3>
      <p className="dim" style={{ margin: '4px 0 0' }}>{line}{' '}<Link to="/collections/gear">Gear</Link></p>
    </div>
  )
}

import { GAME_MODE_LABELS, type Deck, type GameMode } from '../types/models'
import { deckIssues, type IssueKind } from '../decks/deckLegality'
import type { DeckCardData } from './DeckStats'
import { Icon } from './Icon'
import { rise } from './kit'

const ICONS: Record<IssueKind, string> = {
  DECK_SIZE: 'straighten',
  COMMANDER: 'shield_person',
  LEGALITY: 'gavel',
  COPY_LIMIT: 'content_copy',
  COLOR_IDENTITY: 'palette',
}

/** The deck's legality panel: a green all-clear, or what's in the way of it. */
export function DeckLegality({ deck, cardsById, index = 4 }: { deck: Deck; cardsById: DeckCardData; index?: number }) {
  if (cardsById === undefined) return null
  if (cardsById === null) {
    return (
      <div className="panel rise" style={rise(index)}>
        <div className="p-h"><h3>Legality</h3></div>
        <div className="dim">Couldn't load card data, so this deck hasn't been checked.</div>
      </div>
    )
  }
  const issues = deckIssues(deck, cardsById)
  const label = GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode

  return (
    <div className="panel rise" style={rise(index)}>
      <div className="p-h">
        <h3>Legality</h3>
        <span className="p-sub">{label}<b>{issues.length === 0 ? 'Legal' : issues.length}</b></span>
      </div>
      {issues.length === 0 ? (
        <div className="legal-ok"><Icon name="check_circle" />This deck follows {label}'s building rules.</div>
      ) : (
        <ul className="legal-list">
          {issues.map((issue, i) => (
            <li key={`${issue.card ?? 'deck'}-${i}`}>
              <Icon name={ICONS[issue.kind]} />
              <span>
                {issue.card && <b>{issue.card}</b>}
                {issue.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

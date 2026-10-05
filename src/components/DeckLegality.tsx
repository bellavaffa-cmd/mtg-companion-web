import { useState } from 'react'
import { GAME_MODE_LABELS, type Deck, type GameMode } from '../types/models'
import { deckIssues, type IssueKind } from '../decks/deckLegality'
import { useSync } from '../sync/SyncContext'
import type { ScryfallCard } from '../types/scryfall'
import { useUndoBar } from './useUndoBar'
import { Icon } from './Icon'

const ICONS: Record<IssueKind, string> = {
  DECK_SIZE: 'straighten',
  COMMANDER: 'shield_person',
  LEGALITY: 'gavel',
  COPY_LIMIT: 'content_copy',
  COLOR_IDENTITY: 'palette',
  COMPANION: 'pets',
}

/**
 * The deck's legality at a glance — "Legal" with a tick, or how many problems there are — which
 * opens the full list underneath, with its one-tap fixes. Heads Stats, in the summary strip.
 */
export function LegalitySection({ deck, cardsById }: { deck: Deck; cardsById: Map<string, ScryfallCard> }) {
  const { setCardQuantity, recordUndo } = useSync()
  const showUndo = useUndoBar()
  const [open, setOpen] = useState(false)
  const issues = deckIssues(deck, cardsById)
  const label = GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode
  const legal = issues.length === 0

  const reduce = (scryfallId: string, card: string, quantity: number) => {
    const undo = recordUndo(() => setCardQuantity(deck.id, scryfallId, quantity))
    showUndo({ message: `Reduced ${card} to ${quantity} ${quantity === 1 ? 'copy' : 'copies'}.`, undo })
  }

  return (
    <div className="legal-section">
      <button
        type="button"
        className={`legal-badge${legal ? ' ok' : ' bad'}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={legal ? 'check_circle' : 'cancel'} aria-hidden />
        {legal ? 'Legal' : `${issues.length} ${issues.length === 1 ? 'problem' : 'problems'}`}
        <Icon name={open ? 'expand_less' : 'expand_more'} aria-hidden />
      </button>
      {open && (
        <div className="legal-details">
          <div className={`legal-head${legal ? ' ok' : ' bad'}`}>{legal ? `Legal for ${label}` : `Not legal for ${label}`}</div>
          {legal ? (
            <div className="legal-ok"><Icon name="check_circle" />This deck follows {label}'s building rules.</div>
          ) : (
            <ul className="legal-list">
              {issues.map((issue, i) => (
                <li key={`${issue.card ?? 'deck'}-${i}`}>
                  <Icon name={ICONS[issue.kind]} />
                  <span>
                    {issue.card && <b>{issue.card}</b>}
                    {issue.reason}
                    {issue.kind === 'COPY_LIMIT' && issue.scryfallId && issue.fixQuantity != null && (
                      <button
                        type="button"
                        className="link legal-fix"
                        onClick={() => reduce(issue.scryfallId!, issue.card ?? '', issue.fixQuantity!)}
                      >
                        Reduce to {issue.fixQuantity}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

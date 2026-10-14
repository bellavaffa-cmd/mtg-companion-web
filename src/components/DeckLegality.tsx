import { useState } from 'react'
import type { Deck } from '../types/models'
import { deckLegality, type Issue, type IssueKind, type LegalityReport } from '../decks/deckLegality'
import {
  LEGALITY_CHECKING, deckSizeFix, deckSizeFixLabel, groupLegalityIssues, legalityReason, legalitySummary, uncheckedNote,
} from '../decks/legalitySummary'
import { useSync } from '../sync/SyncContext'
import type { ScryfallCard } from '../types/scryfall'
import { useUndoBar } from './useUndoBar'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

const ICONS: Record<IssueKind, string> = {
  DECK_SIZE: 'straighten',
  COMMANDER: 'shield_person',
  LEGALITY: 'gavel',
  COPY_LIMIT: 'content_copy',
  COLOR_IDENTITY: 'palette',
  COMPANION: 'pets',
}

/** What a problem's card can have done to it. Missing actions aren't offered. */
export interface LegalityActions {
  /** Open the issue's card. */
  onOpen?: (issue: Issue) => void
  /** A copy-limit issue: cut its row to fixQuantity. */
  onReduce?: (issue: Issue) => void
  /** A banned / off-colour main-deck card: out of the deck, into Considering. */
  onMoveToConsidering?: (issue: Issue) => void
  /** A banned / off-colour card (main deck or sideboard): take it out. */
  onRemove?: (issue: Issue) => void
  /** The deck's size is off: true, cards to add (Suggestions); false, cards to cut (Cards). */
  onSizeFix?: (add: boolean) => void
  /** Whether a card can go to Considering (default: not in the sideboard). */
  canConsider?: (issue: Issue) => boolean
}

/** Every problem under its heading, most important first. Shared by the header's dialog and Stats. */
function LegalityGroups({ report, actions }: { report: LegalityReport; actions: LegalityActions }) {
  const groups = groupLegalityIssues(report)
  const sizeLabel = deckSizeFixLabel(report)
  const adding = deckSizeFix(report) > 0
  const canConsider = actions.canConsider ?? ((i: Issue) => !i.sideboard)
  return (
    <div className="legal-groups">
      {groups.map((group) => (
        <section key={group.kind}>
          <h3 className="legal-group-head">{group.heading}</h3>
          <ul className="legal-list">
            {group.issues.map((issue, i) => {
              const open = actions.onOpen && issue.scryfallId && issue.card ? actions.onOpen : undefined
              const cardFix = (issue.kind === 'LEGALITY' || issue.kind === 'COLOR_IDENTITY') && issue.scryfallId
              return (
                <li key={`${issue.card ?? 'deck'}-${i}`}>
                  <Icon name={ICONS[issue.kind]} />
                  <span>
                    {issue.card && (open
                      ? <button type="button" className="link legal-card" onClick={() => open(issue)}><b>{issue.card}</b></button>
                      : <b>{issue.card}</b>)}
                    {issue.reason}
                    <span className="legal-fixes">
                      {issue.kind === 'COPY_LIMIT' && actions.onReduce && issue.scryfallId && issue.fixQuantity != null && (
                        <button type="button" className="link legal-fix" onClick={() => actions.onReduce!(issue)}>
                          Reduce to {issue.fixQuantity} {issue.fixQuantity === 1 ? 'copy' : 'copies'}
                        </button>
                      )}
                      {cardFix && actions.onMoveToConsidering && canConsider(issue) && (
                        <button type="button" className="link legal-fix" onClick={() => actions.onMoveToConsidering!(issue)}>Move to Considering</button>
                      )}
                      {cardFix && actions.onRemove && (
                        <button type="button" className="link legal-fix" onClick={() => actions.onRemove!(issue)}>{issue.sideboard ? 'Remove from sideboard' : 'Remove'}</button>
                      )}
                      {issue.kind === 'DECK_SIZE' && !issue.sideboard && sizeLabel && actions.onSizeFix && (
                        <button type="button" className="link legal-fix" onClick={() => actions.onSizeFix!(adding)}>
                          {sizeLabel} · {adding ? 'see suggestions' : 'open the cards'}
                        </button>
                      )}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** The size line and the not-checked note, above the groups. */
function LegalityFacts({ report }: { report: LegalityReport }) {
  const note = uncheckedNote(report)
  return (
    <>
      <div className="legal-size">{report.totalCards} cards · {report.exactSize ? `needs ${report.deckSize}` : `min ${report.deckSize}`}</div>
      {note && <p className="legal-note">{note}</p>}
    </>
  )
}

/**
 * The deck header's pill: "Legal", "Not legal · 3 banned", "Checking…" while the cards load. Tapping
 * it opens [LegalityDialog].
 */
export function LegalityPill({ report, loading, onClick }: { report: LegalityReport | null; loading: boolean; onClick: () => void }) {
  const text = legalitySummary(report, loading)
  const tone = text === LEGALITY_CHECKING ? 'checking' : report?.legal ? 'ok' : 'bad'
  return (
    <button type="button" className={`legal-pill ${tone}`} onClick={onClick} disabled={!report} aria-haspopup="dialog">
      {text}
    </button>
  )
}

/** Why the deck isn't legal, from the header pill: every problem grouped, with its fixes. */
export function LegalityDialog({ report, actions, onSeeStats, onClose }: {
  report: LegalityReport
  actions: LegalityActions
  onSeeStats?: () => void
  onClose: () => void
}) {
  const checking = legalitySummary(report) === LEGALITY_CHECKING
  const title = checking ? `Checking ${report.label} legality…` : report.legal ? `Legal for ${report.label}` : `Why it isn't legal for ${report.label}`
  return (
    <Dialog
      title={title}
      onDismiss={onClose}
      actions={
        <>
          {onSeeStats && <button type="button" className="btn line" onClick={onSeeStats}>See in Stats</button>}
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="legal-dialog">
        <LegalityFacts report={report} />
        {report.legal && !checking && <div className="legal-ok"><Icon name="check_circle" />This deck follows {report.label}'s building rules.</div>}
        <LegalityGroups report={report} actions={actions} />
      </div>
    </Dialog>
  )
}

/**
 * The deck's legality at a glance — "Legal" with a tick, or what's wrong ("3 banned", "4 problems") —
 * which opens the full list underneath, with its one-tap fixes; open from the start when the deck
 * isn't legal. Heads Stats, in the summary strip.
 */
export function LegalitySection({ deck, cardsById }: { deck: Deck; cardsById: Map<string, ScryfallCard> }) {
  const { setCardQuantity, recordUndo } = useSync()
  const showUndo = useUndoBar()
  const report = deckLegality(deck, cardsById)
  const [open, setOpen] = useState(!report.legal)
  const checking = legalitySummary(report) === LEGALITY_CHECKING
  const tone = checking ? ' checking' : report.legal ? ' ok' : ' bad'

  const reduce = (issue: Issue) => {
    const { scryfallId, fixQuantity: quantity } = issue
    if (!scryfallId || quantity == null) return
    const undo = recordUndo(() => setCardQuantity(deck.id, scryfallId, quantity))
    showUndo({ message: `Reduced ${issue.card ?? ''} to ${quantity} ${quantity === 1 ? 'copy' : 'copies'}.`, undo })
  }

  return (
    <div className="legal-section">
      <button
        type="button"
        className={`legal-badge${tone}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={report.legal ? 'check_circle' : 'cancel'} aria-hidden />
        {checking ? LEGALITY_CHECKING : report.legal ? 'Legal' : legalityReason(report)}
        <Icon name={open ? 'expand_less' : 'expand_more'} aria-hidden />
      </button>
      {open && (
        <div className="legal-details">
          <div className={`legal-head${tone}`}>{report.legal ? (checking ? `Checking ${report.label} legality…` : `Legal for ${report.label}`) : `Not legal for ${report.label}`}</div>
          <LegalityFacts report={report} />
          {report.legal && !checking && <div className="legal-ok"><Icon name="check_circle" />This deck follows {report.label}'s building rules.</div>}
          <LegalityGroups report={report} actions={{ onReduce: reduce }} />
        </div>
      )}
    </div>
  )
}

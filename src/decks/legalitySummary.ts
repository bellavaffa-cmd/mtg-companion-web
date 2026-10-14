// Why a deck isn't legal, in a few words for its header pill, and its problems grouped under plain
// headings for the dialog that pill opens. Pure, so it can be tested; the Android app's
// data/LegalitySummary.kt says the same words (tests/decks/legalitySummaryVectors.json, run by both).

import type { Issue, IssueKind, LegalityReport } from './deckLegality'

/** The kinds, most important first: the order the dialog's groups go in. */
export const LEGALITY_PRIORITY: IssueKind[] = ['COMMANDER', 'DECK_SIZE', 'LEGALITY', 'COLOR_IDENTITY', 'COPY_LIMIT', 'COMPANION']

/** Said while the cards' legality is still loading or couldn't be read, instead of a guess. */
export const LEGALITY_CHECKING = 'Checking…'

/**
 * The header pill's words: "Legal", "Not legal · 3 banned", "Not legal · 98/100 cards", "Not legal ·
 * no commander", "Not legal · 4 problems" when they're of different kinds — or "Checking…" while
 * [loading], and while no problem is found but some cards couldn't be checked yet.
 */
export function legalitySummary(report: LegalityReport | null | undefined, loading = false): string {
  if (!report || loading) return LEGALITY_CHECKING
  if (report.issues.length === 0) return report.unchecked > 0 ? LEGALITY_CHECKING : 'Legal'
  return `Not legal · ${legalityReason(report)}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The part after "Not legal · ": what's wrong, as briefly as it can be said. */
export function legalityReason(report: LegalityReport): string {
  const issues = report.issues
  const n = issues.length
  const problems = plural(n, 'problem')
  const kinds = new Set(issues.map((i) => i.kind))
  if (kinds.size !== 1) return problems
  switch (issues[0].kind) {
    case 'COMMANDER':
      if (issues.some((i) => i.reason.startsWith('No commander'))) return 'no commander'
      return n === 1 ? "commanders can't pair" : problems
    case 'DECK_SIZE': {
      if (n !== 1) return problems
      if (!issues[0].sideboard) return `${report.totalCards}/${report.deckSize} cards`
      return report.hasSideboard ? 'sideboard too big' : 'cards in the sideboard'
    }
    case 'LEGALITY':
      return issues.every((i) => i.reason.startsWith('Banned')) ? `${n} banned` : `${n} not legal`
    case 'COLOR_IDENTITY':
      return `${n} off-colour`
    case 'COPY_LIMIT':
      return n === 1 ? 'too many copies' : `${n} with too many copies`
    case 'COMPANION':
      return 'companion'
  }
}

/** The dialog's heading for a kind of problem. */
export function legalityHeading(kind: IssueKind, label: string): string {
  switch (kind) {
    case 'COMMANDER': return 'Commander'
    case 'DECK_SIZE': return 'Deck size'
    case 'LEGALITY': return `Banned or not legal in ${label}`
    case 'COLOR_IDENTITY': return "Outside the commander's colours"
    case 'COPY_LIMIT': return 'Too many copies'
    case 'COMPANION': return 'Companion'
  }
}

export interface LegalityGroup {
  kind: IssueKind
  heading: string
  issues: Issue[]
}

/** Every problem, grouped by kind under its heading, most important kind first; main deck before sideboard. */
export function groupLegalityIssues(report: LegalityReport): LegalityGroup[] {
  return LEGALITY_PRIORITY.flatMap((kind) => {
    const inKind = report.issues.filter((i) => i.kind === kind)
    const sorted = [...inKind.filter((i) => !i.sideboard), ...inKind.filter((i) => i.sideboard)]
    return sorted.length === 0 ? [] : [{ kind, heading: legalityHeading(kind, report.label), issues: sorted }]
  })
}

/**
 * How many cards the main deck is off by: positive, that many to add; negative, that many to take out
 * (an exact-size format over its size); 0 when the size is right.
 */
export function deckSizeFix(report: LegalityReport): number {
  if (report.totalCards < report.deckSize) return report.deckSize - report.totalCards
  if (report.exactSize && report.totalCards > report.deckSize) return report.deckSize - report.totalCards
  return 0
}

/** The deck-size fix as a button's words: "Add 2 cards", "Remove 1 card"; null when none is needed. */
export function deckSizeFixLabel(report: LegalityReport): string | null {
  const fix = deckSizeFix(report)
  if (fix === 0) return null
  return `${fix > 0 ? 'Add' : 'Remove'} ${plural(Math.abs(fix), 'card')}`
}

/** A line for the dialog when some cards couldn't be checked; null when every card was. */
export function uncheckedNote(report: LegalityReport): string | null {
  const n = report.unchecked
  if (n === 0) return null
  return `${plural(n, 'card')} couldn't be checked yet — ${n === 1 ? 'its' : 'their'} legality comes with the card data, which needs a connection.`
}

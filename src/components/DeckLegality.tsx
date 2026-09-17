import { GAME_MODE_LABELS, type Deck, type GameMode } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import type { DeckCardData } from './DeckStats'
import { Icon } from './Icon'
import { rise } from './kit'

/**
 * A deck checked against its format's building rules, mirroring the Android app's DeckLegality.kt:
 * deck size, commander, banned/restricted cards, copy limits and colour identity.
 */

type IssueKind = 'DECK_SIZE' | 'COMMANDER' | 'LEGALITY' | 'COPY_LIMIT' | 'COLOR_IDENTITY'

interface Issue {
  card: string | null
  reason: string
  kind: IssueKind
}

/** Per format: Scryfall's key, how big a deck is, whether that size is exact, copies allowed. */
const FORMATS: Record<string, { scryfall: string; deckSize: number; exactSize: boolean; singleton: boolean; maxCopies: number; usesCommander: boolean }> = {
  COMMANDER: { scryfall: 'commander', deckSize: 100, exactSize: true, singleton: true, maxCopies: 1, usesCommander: true },
  BRAWL: { scryfall: 'brawl', deckSize: 60, exactSize: true, singleton: true, maxCopies: 1, usesCommander: true },
  STANDARD: { scryfall: 'standard', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  PIONEER: { scryfall: 'pioneer', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  MODERN: { scryfall: 'modern', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  PAUPER: { scryfall: 'pauper', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  LEGACY: { scryfall: 'legacy', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  VINTAGE: { scryfall: 'vintage', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
}

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
])

const isBasicLand = (name: string, card?: ScryfallCard) =>
  BASIC_LAND_NAMES.has(name) || (card?.type_line ?? '').toLowerCase().includes('basic')

/** Whether two commanders may be paired: both plain Partner, or one naming the other. */
function partnersWith(a: { name: string; partnerAbility: string | null }, b: { name: string; partnerAbility: string | null }): boolean {
  if (!a.partnerAbility || !b.partnerAbility) return false
  if (a.partnerAbility === 'Partner' && b.partnerAbility === 'Partner') return true
  return a.partnerAbility.toLowerCase() === b.name.toLowerCase() || b.partnerAbility.toLowerCase() === a.name.toLowerCase()
}

export function deckIssues(deck: Deck, cardsById: Map<string, ScryfallCard>): Issue[] {
  const mode = (deck.gameMode as GameMode) ?? 'COMMANDER'
  const format = FORMATS[mode] ?? FORMATS.COMMANDER
  const label = GAME_MODE_LABELS[mode] ?? deck.gameMode
  const issues: Issue[] = []
  const totalCards = deck.cards.reduce((sum, c) => sum + c.quantity, 0)

  // Commander requirement, and the colour identity everything else is checked against.
  let commanderIdentity: Set<string> | null = null
  if (format.usesCommander) {
    if (!deck.commander) {
      issues.push({ card: null, reason: `No commander set — ${label} needs a commander.`, kind: 'COMMANDER' })
    } else {
      const main = cardsById.get(deck.commander.scryfallId)?.color_identity ?? []
      const partner = deck.partnerCommander
      if (partner) {
        if (!partnersWith(deck.commander, partner)) {
          issues.push({ card: null, reason: `${deck.commander.name} and ${partner.name} don't have a valid Partner pairing.`, kind: 'COMMANDER' })
        }
        commanderIdentity = new Set([...main, ...(cardsById.get(partner.scryfallId)?.color_identity ?? [])])
      } else {
        commanderIdentity = new Set(main)
      }
    }
  }

  if (format.exactSize) {
    if (totalCards !== format.deckSize) {
      issues.push({ card: null, reason: `Deck has ${totalCards} cards; ${label} requires exactly ${format.deckSize}.`, kind: 'DECK_SIZE' })
    }
  } else if (totalCards < format.deckSize) {
    issues.push({ card: null, reason: `Deck has ${totalCards} cards; ${label} requires at least ${format.deckSize}.`, kind: 'DECK_SIZE' })
  }

  for (const entry of deck.cards) {
    const card = cardsById.get(entry.scryfallId)
    const basic = isBasicLand(entry.name, card)

    switch (card?.legalities?.[format.scryfall]) {
      case 'banned':
        issues.push({ card: entry.name, reason: `Banned in ${label}.`, kind: 'LEGALITY' })
        break
      case 'not_legal':
        issues.push({ card: entry.name, reason: `Not legal in ${label}.`, kind: 'LEGALITY' })
        break
      case 'restricted':
        if (entry.quantity > 1) {
          issues.push({ card: entry.name, reason: `Restricted in ${label} — max 1 copy (has ${entry.quantity}).`, kind: 'COPY_LIMIT' })
        }
        break
    }

    if (!basic) {
      if (format.singleton && entry.quantity > 1) {
        issues.push({ card: entry.name, reason: `${label} is singleton — only 1 copy allowed (has ${entry.quantity}).`, kind: 'COPY_LIMIT' })
      } else if (!format.singleton && entry.quantity > format.maxCopies) {
        issues.push({ card: entry.name, reason: `Max ${format.maxCopies} copies allowed (has ${entry.quantity}).`, kind: 'COPY_LIMIT' })
      }
    }

    const isCommanderCard = entry.scryfallId === deck.commander?.scryfallId || entry.scryfallId === deck.partnerCommander?.scryfallId
    if (commanderIdentity && card && !isCommanderCard) {
      const outside = (card.color_identity ?? []).filter((c) => !commanderIdentity!.has(c))
      if (outside.length > 0) {
        issues.push({ card: entry.name, reason: `Outside the commander's colour identity (${outside.join('')}).`, kind: 'COLOR_IDENTITY' })
      }
    }
  }

  return issues
}

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

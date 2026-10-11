// What the places' rules screens show, worked out (StorageRulesUi.tsx): a level's options as typed,
// the cards in storage as the rules judge them, a copy's sorting facts. Mirrors the helpers in the
// Android app's StorageRulesUi.kt.

import type { CollectionEntry } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { copyFactsOfCopy, type FilterFacts } from './placeFilter'
import type { AdvancedFacts, CopyFacts } from './advancedFilter'
import type { CardFacts as BasicFacts } from './cardFilter'
import { splitLevel, type SplitLevel } from './sortRecipes'
import type { RuleCard } from './storageRules'
import { cardFactsOf, type CardFacts, type PlacedCard } from './storagePlaces'

/** A level's options as typed: VALUE, MANA_VALUE and NUMBER their cuts, NAME its letters, SET its sets. */
export function levelOptionsText(l: SplitLevel | null): string {
  switch (l?.by) {
    case 'VALUE': case 'MANA_VALUE': case 'NUMBER': return (l.cuts ?? []).join(', ')
    case 'NAME': return (l.letters ?? []).join(', ')
    case 'SET': return (l.sets ?? []).map((s) => s.toUpperCase()).join(', ')
    default: return ''
  }
}

/** [l] with its options typed as [text] (see levelOptionsText). */
export function withLevelOptions(l: SplitLevel, text: string): SplitLevel {
  const items = text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  switch (l.by) {
    case 'VALUE': case 'MANA_VALUE': case 'NUMBER':
      return splitLevel({ ...l, cuts: items.map((s) => Number(s.replace(/^\$/, ''))).filter((n) => Number.isFinite(n)) })
    case 'NAME': return splitLevel({ ...l, letters: items })
    case 'SET': return splitLevel({ ...l, sets: items })
    default: return splitLevel(l)
  }
}

/**
 * The cards in storage as the rules judge them, from the filter facts already worked out
 * (useStorageFilterFacts): for the overlap warnings and how many cards a "Holds" takes.
 */
export function ruleCardsOf(copies: PlacedCard[], facts: FilterFacts): RuleCard[] {
  const seen = new Set<string>()
  const out: RuleCard[] = []
  for (const c of copies) {
    const id = c.entry.scryfallId
    if (seen.has(id)) continue
    seen.add(id)
    const basic = facts.card(id)
    if (!basic) continue
    const advanced = facts.advanced(id) ?? null
    out.push({
      facts: {
        name: c.entry.name, colors: advanced?.colors ?? null, typeLine: basic.typeLine, set: advanced?.set ?? null, colorIdentity: advanced?.identity ?? null,
        cmc: advanced?.cmc ?? null, rarity: basic.rarity, usd: advanced?.usd ?? null, usdFoil: advanced?.usdFoil ?? null,
      },
      basic, advanced, roleTags: facts.roleTags?.(c.entry.name), userTags: facts.userTags?.(id) ?? [],
    })
  }
  return out
}

/** A copy's sorting facts from the cards' data, when it's here — for a place's order (suggestSpot's factsOf). */
export const entryFactsOf = (data: Map<string, ScryfallCard> | undefined) => (e: CollectionEntry): CardFacts | null => {
  const c = data?.get(e.scryfallId)
  return c ? cardFactsOf(c) : null
}

/**
 * A line of copies as the rules judge it, from the filter facts already worked out: the card's
 * ([basic], [advanced]; null when its data isn't here) and the copy's own (copyFactsOfCopy).
 */
export function ruleCardOfCopy(
  c: PlacedCard, basic: BasicFacts | undefined, advanced: AdvancedFacts | undefined, roleTags: string[] | undefined, userTags: string[],
  copies: Map<string, CopyFacts>, chains: Map<string, string[]>,
): RuleCard | null {
  if (!basic) return null
  return {
    facts: {
      name: c.entry.name, colors: advanced?.colors ?? null, typeLine: basic.typeLine, set: advanced?.set ?? null, colorIdentity: advanced?.identity ?? null,
      cmc: advanced?.cmc ?? null, rarity: basic.rarity, usd: advanced?.usd ?? null, usdFoil: advanced?.usdFoil ?? null, foil: !!c.line.foil,
    },
    basic, advanced: advanced ?? null, copy: copyFactsOfCopy(c, copies.get(c.entry.scryfallId), chains), roleTags, userTags,
  }
}

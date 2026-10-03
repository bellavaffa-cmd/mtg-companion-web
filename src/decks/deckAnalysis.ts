// The Stats tab's Commander bracket estimate and mana-base advice. Mirrors the Android app's
// estimateBracket and the bracket reason in DeckDetailViewModel.buildAnalysis, and manaBaseAdvice in
// data/DeckBuilding.kt — same thresholds, same wording.

import type { DeckCardEntry, GameMode } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

export interface Bracket {
  bracket: number
  name: string
  reason: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * A rough Commander bracket from the count of Game Changers and complete combos. Loosely WotC's
 * guidance: none of either is Core, up to three Game Changers is Upgraded, more is Optimized.
 * Brackets 1 (Exhibition) and 5 (cEDH) aren't guessed at. [combos] null: Commander Spellbook
 * couldn't be reached, which the reason says rather than implying a clean deck.
 */
export function estimateBracket(gameChangers: number, combos: number | null): Bracket {
  const c = combos ?? 0
  let result: Bracket
  if (gameChangers === 0 && c === 0) {
    result = { bracket: 2, name: 'Core', reason: 'No Game Changers or two-card combos detected — a typical Core-power deck.' }
  } else if (gameChangers <= 3) {
    result = {
      bracket: 3, name: 'Upgraded',
      reason: `${plural(gameChangers, 'Game Changer')}${c > 0 ? ` and ${plural(c, 'combo')}` : ''} — within the Upgraded ceiling of 3 Game Changers.`,
    }
  } else {
    result = {
      bracket: 4, name: 'Optimized',
      reason: `${gameChangers} Game Changers exceed the 3 allowed at Upgraded${c > 0 ? ` and ${c} combo(s) are present` : ''}, pushing this to Optimized.`,
    }
  }
  if (combos === null) {
    result.reason = gameChangers === 0
      ? "No Game Changers found. Combos weren't checked (Commander Spellbook couldn't be reached), so this may be higher."
      : `${result.reason} Combos weren't checked — Commander Spellbook couldn't be reached.`
  }
  return result
}

/** The deck's Game Changers (Scryfall's game_changer flag), by name, once each. */
export function gameChangersOf(entries: DeckCardEntry[], cardsById: Map<string, ScryfallCard>): string[] {
  return [...new Set(entries.filter((e) => cardsById.get(e.scryfallId)?.game_changer).map((e) => e.name))]
}

/**
 * Whether a card is played as a land: its front face says Land. Catches artifact lands and Dryad
 * Arbor, while a spell with a land back face still counts as the spell.
 */
export const isLandType = (typeLine: string | null | undefined) => !!typeLine && /land/i.test(typeLine.split(' // ')[0])

const COLORS = ['W', 'U', 'B', 'R', 'G']

/** How many of the deck's lands make each colour, by copies; colours no land makes are left out. */
export function landSources(entries: DeckCardEntry[], cardsById: Map<string, ScryfallCard>): { sources: [string, number][]; lands: number } {
  const totals = new Map(COLORS.map((c) => [c, 0]))
  let lands = 0
  for (const e of entries) {
    const card = cardsById.get(e.scryfallId)
    if (!isLandType(card?.type_line ?? e.typeLine)) continue
    lands += e.quantity
    for (const c of card?.produced_mana ?? []) if (totals.has(c)) totals.set(c, totals.get(c)! + e.quantity)
  }
  return { sources: COLORS.map((c) => [c, totals.get(c)!] as [string, number]).filter(([, n]) => n > 0), lands }
}

const percent = (share: number) => `${Math.floor(share * 100)}%`

/**
 * Plain-language warnings about the mana base, with mana symbols as `{U}` so the page can draw them.
 * Sources are lands only — mana rocks and dorks aren't counted, which the page says.
 */
export function manaBaseAdvice(pips: [string, number][], sources: [string, number][], landCount: number, mode: GameMode | string): string[] {
  const advice: string[] = []
  const colored = pips.filter(([c, n]) => COLORS.includes(c) && n > 0)
  const totalPips = colored.reduce((s, [, n]) => s + n, 0)
  const byColor = new Map(sources)
  const totalSources = sources.filter(([c]) => COLORS.includes(c)).reduce((s, [, n]) => s + n, 0)

  if (totalPips > 0 && landCount > 0) {
    for (const [color, count] of colored) {
      const pipShare = count / totalPips
      const have = byColor.get(color) ?? 0
      if (have === 0) {
        advice.push(`No lands make {${color}}, but ${count} of your mana symbols need it.`)
      } else if (totalSources > 0) {
        const sourceShare = have / totalSources
        if (pipShare - sourceShare >= 0.12) {
          advice.push(`{${color}} is ${percent(pipShare)} of your mana symbols but only ${percent(sourceShare)} of your land sources — add more {${color}} sources.`)
        }
      }
    }
  }

  const commander = mode === 'COMMANDER'
  const [low, high] = commander ? [34, 40] : [20, 27]
  const typical = commander ? '36–38' : '22–26'
  if (landCount >= 1 && landCount < low) {
    advice.push(`${landCount} lands is light — most decks like this run ${typical}, fewer only with plenty of cheap ramp.`)
  } else if (landCount > high) {
    advice.push(`${landCount} lands is on the heavy side — most decks like this run ${typical}.`)
  }
  return advice
}

/** The chance of at least one of [successes] among [draws] cards from a [population]-card library. */
export function probabilityAtLeastOne(population: number, successes: number, draws: number): number {
  if (successes <= 0 || population <= 0 || draws <= 0) return 0
  if (successes >= population) return 1
  let none = 1
  for (let i = 0; i < Math.min(draws, population); i++) {
    const misses = population - successes - i
    if (misses < 0) return 1
    none *= misses / (population - i)
  }
  return 1 - none
}

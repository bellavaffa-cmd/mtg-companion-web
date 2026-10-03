// The Search page's Combos mode: Commander Spellbook's variant search, asked by a card in the combo,
// what it produces, and the commander colours it has to fit. Mirrors the Android app's
// SearchViewModel.runComboSearch.

export const COMBO_COLORS = ['W', 'U', 'B', 'R', 'G'] as const

/**
 * The Spellbook query for the three filters, or '' with nothing filled in. Card and result are
 * substring matches; colours mean "fits within these" (ci<=), the letters sorted as the phone sorts
 * them — Spellbook reads them as a set.
 */
export function comboSearchQuery(card: string, result: string, colors: Iterable<string>): string {
  const parts: string[] = []
  const c = card.trim().replace(/"/g, '')
  const r = result.trim().replace(/"/g, '')
  if (c) parts.push(`card:"${c}"`)
  if (r) parts.push(`result:"${r}"`)
  const picked = [...new Set([...colors].map((x) => x.toUpperCase()))].sort()
  if (picked.length > 0) parts.push(`ci<=${picked.join('')}`)
  return parts.join(' ')
}

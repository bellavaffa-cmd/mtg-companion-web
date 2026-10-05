// What a screen reader says for things drawn as pictures or colour: mana symbols, colour identities,
// a life-counter seat, a match record. Pure, so the same cases run in tests on both apps — mirrored
// by the Android app's ui/common/A11yText.kt (tests: A11yTextTest.kt, tests/a11y/descriptions.test.ts).

const COLOUR_WORDS: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' }

const SPECIAL: Record<string, string> = {
  T: 'tap',
  Q: 'untap',
  S: 'snow mana',
  E: 'energy',
  X: 'X mana',
  Y: 'Y mana',
  Z: 'Z mana',
  CHAOS: 'chaos',
  PW: 'planeswalker',
}

/** One half of a hybrid symbol, or a whole plain one, without the word "mana". */
function part(code: string): string | null {
  if (COLOUR_WORDS[code]) return COLOUR_WORDS[code]
  if (code === 'COLORLESS' || code === 'COLOURLESS') return 'colourless'
  if (/^\d+$/.test(code)) return `${code} generic`
  return null
}

/**
 * A mana or card symbol as words: "{W}" → "white mana", "{2/U}" → "2 generic or blue mana",
 * "{G/P}" → "Phyrexian green mana", "{T}" → "tap". Takes the code with or without its braces.
 * Anything it doesn't know is read as it's written.
 */
export function manaSymbolName(symbol: string): string {
  const raw = symbol.trim().replace(/^\{|\}$/g, '')
  const code = raw.toUpperCase()
  if (SPECIAL[code]) return SPECIAL[code]
  const parts = code.split('/')
  const phyrexian = parts.length > 1 && parts[parts.length - 1] === 'P'
  const names = (phyrexian ? parts.slice(0, -1) : parts).map(part)
  if (names.length === 0 || names.some((n) => n === null)) return raw
  return `${phyrexian ? 'Phyrexian ' : ''}${names.join(' or ')} mana`
}

/** A whole cost, "{2}{W}{W}" → "2 generic mana, white mana, white mana". Empty for no symbols. */
export function manaCostName(cost: string): string {
  return [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => manaSymbolName(m[1])).join(', ')
}

/** Joins words the way a sentence does: "a", "a and b", "a, b and c". */
export function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** A colour identity in words, in WUBRG order as given: ["W", "U"] → "white and blue"; none → "colourless". */
export function colourIdentityName(colours: string[]): string {
  const words = colours.map((c) => COLOUR_WORDS[c.toUpperCase()]).filter((w): w is string => !!w && w !== 'colourless')
  return words.length === 0 ? 'colourless' : joinWords(words)
}

/** Commander damage one seat has taken from one source (a commander's name, or a player's). */
export interface SeatDamage { from: string; amount: number }

export interface SeatSummary {
  /** 1-based seat number. */
  seat: number
  /** The player's own name; unset or blank, the seat number says who it is. */
  name?: string | null
  life: number
  poison?: number
  commanderDamage?: SeatDamage[]
  /** Out of the game. */
  out?: boolean
}

/**
 * One life-counter seat read as a whole, whichever way the tile is turned:
 * "Seat 2, Sam, 34 life, 6 commander damage from Atraxa".
 */
export function seatDescription(s: SeatSummary): string {
  const parts = [`Seat ${s.seat}`]
  const name = s.name?.trim()
  if (name) parts.push(name)
  parts.push(`${s.life} life`)
  if ((s.poison ?? 0) > 0) parts.push(`${s.poison} poison`)
  for (const d of s.commanderDamage ?? []) if (d.amount > 0) parts.push(`${d.amount} commander damage from ${d.from}`)
  if (s.out) parts.push('out of the game')
  return parts.join(', ')
}

/** A win–loss(–draw) record in words: (3, 2, 0) → "3 wins, 2 losses". */
export function recordWords(wins: number, losses: number, draws = 0): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  return [n(wins, 'win', 'wins'), n(losses, 'loss', 'losses'), ...(draws > 0 ? [n(draws, 'draw', 'draws')] : [])].join(', ')
}

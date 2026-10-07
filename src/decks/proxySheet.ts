/**
 * Proxy sheets: the cards to print and how many of each, laid out nine to a page at real card size
 * (63 × 88 mm) on A4 or Letter, with thin cut lines between them. Pure: the page that prints them is
 * components/ProxyPrintDialog.tsx. Mirrors the Android app's data/ProxySheet.kt.
 */

import type { Collection, Deck, DeckCardEntry } from '../types/models'
import { holdsCards } from '../collection/pullList'
import type { ThinCard } from '../collection/spreadThin'
import { missingCards } from './missing'
import { proxyCopies } from './proxies'

export const CARD_WIDTH_MM = 63
export const CARD_HEIGHT_MM = 88
export const SHEET_COLUMNS = 3
export const SHEET_ROWS = 3
export const CARDS_PER_PAGE = SHEET_COLUMNS * SHEET_ROWS
/** Never more copies of one card than this on a sheet. */
export const MAX_PROXY_COPIES = 99

export type PaperSize = 'A4' | 'LETTER'

export const PAPERS: { size: PaperSize; label: string; widthMm: number; heightMm: number }[] = [
  { size: 'A4', label: 'A4', widthMm: 210, heightMm: 297 },
  { size: 'LETTER', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
]

/** Letter where it's the usual paper (the US, Canada, Mexico, the Philippines…), A4 everywhere else. */
export function defaultPaper(country: string | null | undefined): PaperSize {
  return ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR'].includes((country ?? '').toUpperCase()) ? 'LETTER' : 'A4'
}

/** Where things go on one page, in millimetres from its top left corner. */
export interface SheetLayout {
  widthMm: number
  heightMm: number
  /** The card grid's top left corner: the grid sits in the middle of the page. */
  leftMm: number
  topMm: number
  /** Each of the nine card spots, row by row. */
  slots: { xMm: number; yMm: number }[]
  /** The cut lines: across the whole page, along every card edge. */
  cutsXMm: number[]
  cutsYMm: number[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function sheetLayout(paper: PaperSize): SheetLayout {
  const p = PAPERS.find((x) => x.size === paper) ?? PAPERS[0]
  const left = round2((p.widthMm - SHEET_COLUMNS * CARD_WIDTH_MM) / 2)
  const top = round2((p.heightMm - SHEET_ROWS * CARD_HEIGHT_MM) / 2)
  const slots: { xMm: number; yMm: number }[] = []
  for (let row = 0; row < SHEET_ROWS; row++) {
    for (let col = 0; col < SHEET_COLUMNS; col++) slots.push({ xMm: round2(left + col * CARD_WIDTH_MM), yMm: round2(top + row * CARD_HEIGHT_MM) })
  }
  return {
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    leftMm: left,
    topMm: top,
    slots,
    cutsXMm: Array.from({ length: SHEET_COLUMNS + 1 }, (_, i) => round2(left + i * CARD_WIDTH_MM)),
    cutsYMm: Array.from({ length: SHEET_ROWS + 1 }, (_, i) => round2(top + i * CARD_HEIGHT_MM)),
  }
}

/** One card that could be printed, and how many copies are picked. */
export interface ProxyPick {
  name: string
  scryfallId: string
  imageUrl: string | null
  backImageUrl?: string | null
  /** Copies to print; 0 leaves it off the sheet. */
  copies: number
}

/** How the sheet prints. */
export interface ProxyOptions {
  paper: PaperSize
  /** "PROXY — not for sale" across each card. */
  marked: boolean
  /** Black and white, lighter: saves ink. */
  lowInk: boolean
  /** A double-faced card's back as a card of its own. */
  backs: boolean
}

export const PROXY_MARK = 'PROXY — not for sale'

const key = (name: string) => name.trim().toLowerCase()
const clampCopies = (n: number) => Math.max(0, Math.min(MAX_PROXY_COPIES, Math.floor(n)))

/** The deck's printing of each card, by name: what a card on a list looks like on the sheet. */
function printingsByName(entries: (DeckCardEntry | null | undefined)[]): Map<string, DeckCardEntry> {
  const out = new Map<string, DeckCardEntry>()
  for (const e of entries) if (e && !out.has(key(e.name))) out.set(key(e.name), e)
  return out
}

const pickOf = (e: { name: string; scryfallId: string; imageUrl: string | null; backImageUrl?: string | null }, copies: number): ProxyPick =>
  ({ name: e.name, scryfallId: e.scryfallId, imageUrl: e.imageUrl, backImageUrl: e.backImageUrl ?? null, copies: clampCopies(copies) })

/**
 * The cards a pull list doesn't own, as they are in [deck]: the copies still to buy picked. [needs]
 * is the pull list's Not owned rows.
 */
export function picksFromNeeds(deck: Deck, needs: { name: string; scryfallId: string; qty: number }[]): ProxyPick[] {
  const printings = printingsByName([deck.commander, deck.partnerCommander, ...deck.cards])
  const byName = new Map<string, ProxyPick>()
  for (const n of needs) {
    const had = byName.get(key(n.name))
    if (had) { had.copies = clampCopies(had.copies + n.qty); continue }
    const e = printings.get(key(n.name))
    byName.set(key(n.name), pickOf(e ?? { name: n.name, scryfallId: n.scryfallId, imageUrl: null }, n.qty))
  }
  return [...byName.values()]
}

/**
 * Every card in [deck], once by name, A–Z: the ones it still needs picked — the cards you don't own
 * for a deck on paper, its proxies for a deck you hold. The rest start at 0, to pick by hand.
 */
export function picksForDeck(deck: Deck, collections: Collection[], decks: Deck[]): ProxyPick[] {
  const needed = new Map<string, number>()
  if (holdsCards(deck)) {
    for (const e of deck.cards) needed.set(key(e.name), (needed.get(key(e.name)) ?? 0) + proxyCopies(deck, e))
  } else {
    for (const e of missingCards(deck, collections, decks)) needed.set(key(e.name), e.quantity)
  }
  const printings = printingsByName([deck.commander, deck.partnerCommander, ...deck.cards])
  return [...printings.values()]
    .map((e) => pickOf(e, needed.get(key(e.name)) ?? 0))
    .sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name))
}

/** Cards spread too thin, the copies each is short picked. */
export function picksFromThin(cards: ThinCard[]): ProxyPick[] {
  return cards.map((c) => pickOf({ name: c.name, scryfallId: c.scryfallIds[0] ?? '', imageUrl: c.imageUrl }, c.short))
}

/** [picks] with the copies of [name] set to [copies] (0 to 99). */
export function withCopies(picks: ProxyPick[], name: string, copies: number): ProxyPick[] {
  return picks.map((p) => (key(p.name) === key(name) ? { ...p, copies: clampCopies(copies) } : p))
}

/** Every pick at 0, or back to what was picked to begin with. */
export const withNone = (picks: ProxyPick[]): ProxyPick[] => picks.map((p) => ({ ...p, copies: 0 }))

/**
 * The biggest picture Scryfall has of the card, for print: its 'large' size, from the address of any
 * other size. Anything that isn't a Scryfall card picture is left as it is.
 */
export function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (!/^https:\/\/cards\.scryfall\.io\//.test(url)) return url
  return url
    .replace(/\/(small|normal|art_crop|border_crop|png)\//, '/large/')
    .replace(/\.png(\?|$)/, '.jpg$1')
}

/** One card on the sheet. */
export interface SheetCard {
  name: string
  imageUrl: string | null
}

/** Every copy to print, in order, each double-faced card's back after its front when [backs]. */
export function sheetCards(picks: ProxyPick[], backs: boolean): SheetCard[] {
  const out: SheetCard[] = []
  for (const p of picks) {
    for (let i = 0; i < p.copies; i++) {
      out.push({ name: p.name, imageUrl: proxyImageUrl(p.imageUrl) })
      if (backs && p.backImageUrl) out.push({ name: `${p.name} (back)`, imageUrl: proxyImageUrl(p.backImageUrl) })
    }
  }
  return out
}

/** The cards split into pages of nine. */
export function sheetPages(cards: SheetCard[]): SheetCard[][] {
  const pages: SheetCard[][] = []
  for (let i = 0; i < cards.length; i += CARDS_PER_PAGE) pages.push(cards.slice(i, i + CARDS_PER_PAGE))
  return pages
}

/** Copies picked. */
export const pickedCopies = (picks: ProxyPick[]): number => picks.reduce((n, p) => n + p.copies, 0)

/** "12 cards · 2 pages", or "Nothing picked". */
export function sheetSummary(picks: ProxyPick[], backs: boolean): string {
  const cards = sheetCards(picks, backs).length
  if (cards === 0) return 'Nothing picked'
  const pages = Math.ceil(cards / CARDS_PER_PAGE)
  return `${cards} ${cards === 1 ? 'card' : 'cards'} · ${pages} ${pages === 1 ? 'page' : 'pages'}`
}

/**
 * The printed copies marked as proxies in [deck]: each card's proxy count goes up by the copies
 * printed, never past the copies the deck plays. Only for a deck on paper — a deck you hold already
 * counts the cards it hasn't got as proxies (collection/pullList.ts). Unchanged otherwise.
 */
export function markPrintedAsProxies(deck: Deck, picks: ProxyPick[]): Deck {
  if (holdsCards(deck)) return deck
  const printed = new Map<string, number>()
  for (const p of picks) if (p.copies > 0) printed.set(key(p.name), (printed.get(key(p.name)) ?? 0) + p.copies)
  if (printed.size === 0) return deck
  let changed = false
  const cards = deck.cards.map((e) => {
    const want = printed.get(key(e.name)) ?? 0
    const already = Math.max(0, e.proxyQuantity ?? 0)
    const take = Math.min(want, e.quantity - already)
    if (take <= 0) return e
    printed.set(key(e.name), want - take)
    changed = true
    return { ...e, proxyQuantity: already + take }
  })
  if (!changed) return deck
  const fresh = (c: DeckCardEntry | null) => (c ? cards.find((e) => e.scryfallId === c.scryfallId) ?? c : c)
  return { ...deck, cards, commander: fresh(deck.commander), partnerCommander: fresh(deck.partnerCommander) }
}

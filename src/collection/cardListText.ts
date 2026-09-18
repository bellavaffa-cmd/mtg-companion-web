// Card lists as text, for moving a collection between this app and others (Moxfield, Archidekt,
// ManaBox, Deckbox, TCGplayer…). Reads the usual pasted/exported shapes, one card per line:
//
//   4 Lightning Bolt
//   2x Counterspell
//   1 Sol Ring (CMR) 472
//   1 Sol Ring [CMR] 472 *F*        (foil; *E* etched, "(foil)"/"[foil]" work too)
//
// and the CSV collection exports those apps make (a header row naming Count/Quantity and Name, and
// optionally the set code, collector number, foil and Scryfall ID). Writes the plain text form,
// which all of them read back. Mirrors the Android app's CardListText.kt.

/** One line of a list: how many, which card (by id, printing or name), and whether foil. */
export interface ListLine {
  quantity: number
  name: string | null
  set: string | null
  number: string | null
  scryfallId: string | null
  foil: boolean
}

export interface ParsedList {
  lines: ListLine[]
  /** Lines that looked like cards but couldn't be read. */
  skipped: string[]
}

const MAX_COPIES = 999

// ---- Text ----

const QTY = /^(\d+)\s*[xX]?\s+(.+)$/
/** "(SLD) 1962", "[MH3] 285", or just "(SLD)". */
const PRINTING = /[([]([A-Za-z0-9]{2,6})[)\]](?:\s+([A-Za-z0-9\-★]+))?/
const FOIL = /\*(?:f|foil|e|etched)\*|[([](?:foil|etched)[)\]]/i
const SECTION_WORDS = new Set(['deck', 'commander', 'companion', 'sideboard', 'maybeboard', 'tokens', 'about', 'name', 'collection', 'binder'])

function isHeader(line: string): boolean {
  if (SECTION_WORDS.has(line.toLowerCase().replace(/:$/, '').trim())) return true
  // "Creatures (30)", "Lands: 36"
  return /^[A-Za-z][^\d]*(\(\d+\)|:\s*\d+)\s*$/.test(line)
}

function parseTextLine(raw: string): ListLine | 'skip' | null {
  const line = raw.trim()
  if (!line || line.startsWith('#') || line.startsWith('//')) return null
  if (isHeader(line)) return null
  const qty = QTY.exec(line)
  const quantity = qty ? Math.min(Math.max(Number(qty[1]), 1), MAX_COPIES) : 1
  let rest = qty ? qty[2] : line
  const foil = FOIL.test(rest)
  rest = rest.replace(new RegExp(FOIL.source, 'gi'), ' ')
  const printing = PRINTING.exec(rest)
  // The name is whatever comes before the printing; trailing tags ("#Trade") go too.
  const name = rest.replace(/\s*[([][A-Za-z0-9]{2,6}[)\]].*$/, '').replace(/\s+#\S.*$/, '').replace(/\s+/g, ' ').trim()
  if (!name) return 'skip'
  return {
    quantity,
    name,
    set: printing?.[1]?.toLowerCase() ?? null,
    number: printing?.[2] ?? null,
    scryfallId: null,
    foil,
  }
}

// ---- CSV ----

/** The cells of one CSV row: commas outside quotes separate, "" inside quotes is a quote. */
export function csvCells(row: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { cells.push(cell); cell = '' }
    else cell += c
  }
  cells.push(cell)
  return cells.map((s) => s.trim())
}

const COLUMNS = {
  quantity: ['count', 'quantity', 'qty', 'amount'],
  name: ['name', 'card name', 'card'],
  set: ['set code', 'edition code', 'set', 'edition'],
  number: ['collector number', 'card number', 'collector_number', 'number', 'cn'],
  foil: ['foil', 'finish', 'printing'],
  id: ['scryfall id', 'scryfall_id', 'scryfallid'],
}

function column(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n)
    if (i !== -1) return i
  }
  return -1
}

const isFoilValue = (v: string) => /foil|etched|^(true|yes|1)$/i.test(v) && !/non|normal|^(false|no|0)$/i.test(v)

function parseCsv(rows: string[]): ParsedList {
  const header = csvCells(rows[0]).map((h) => h.toLowerCase())
  const at = {
    quantity: column(header, COLUMNS.quantity),
    name: column(header, COLUMNS.name),
    set: column(header, COLUMNS.set),
    number: column(header, COLUMNS.number),
    foil: column(header, COLUMNS.foil),
    id: column(header, COLUMNS.id),
  }
  const lines: ListLine[] = []
  const skipped: string[] = []
  for (const row of rows.slice(1)) {
    if (!row.trim()) continue
    const cells = csvCells(row)
    const get = (i: number) => (i >= 0 ? cells[i] ?? '' : '')
    const name = get(at.name) || null
    const id = /^[0-9a-f-]{36}$/i.test(get(at.id)) ? get(at.id).toLowerCase() : null
    if (!name && !id) { skipped.push(row); continue }
    // Some apps put the set's full name in "Edition" — only a short code is usable.
    const set = /^[A-Za-z0-9]{2,6}$/.test(get(at.set)) ? get(at.set).toLowerCase() : null
    const quantity = Math.min(Math.max(Number(get(at.quantity)) || 1, 1), MAX_COPIES)
    lines.push({ quantity, name, set, number: get(at.number) || null, scryfallId: id, foil: isFoilValue(get(at.foil)) })
  }
  return { lines, skipped }
}

function looksLikeCsv(firstRow: string): boolean {
  if (!firstRow.includes(',')) return false
  const header = csvCells(firstRow).map((h) => h.toLowerCase())
  return (column(header, COLUMNS.name) !== -1 || column(header, COLUMNS.id) !== -1) && column(header, COLUMNS.quantity) !== -1
}

/** Reads a pasted or exported card list (text or CSV). */
export function parseCardList(text: string): ParsedList {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/)
  const first = rows.find((r) => r.trim()) ?? ''
  if (looksLikeCsv(first)) return parseCsv(rows.slice(rows.indexOf(first)))
  const lines: ListLine[] = []
  const skipped: string[] = []
  for (const row of rows) {
    const line = parseTextLine(row)
    if (line === 'skip') skipped.push(row.trim())
    else if (line) lines.push(line)
  }
  return { lines, skipped }
}

// ---- Writing ----

export interface ListEntry {
  scryfallId: string
  name: string
  quantity: number
  foilQuantity: number
}

/**
 * The entries as text: "4 Lightning Bolt", foil copies on their own line ending in *F*. With
 * [printings] (scryfallId → set code and collector number), each line names its exact printing —
 * "(CMR) 472" — so importing it elsewhere keeps the same art.
 */
export function buildCardListText(entries: ListEntry[], printings?: Map<string, { set: string; number: string }>): string {
  const out: string[] = []
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const p = printings?.get(e.scryfallId)
    const card = p ? `${e.name} (${p.set.toUpperCase()}) ${p.number}` : e.name
    if (e.quantity > 0) out.push(`${e.quantity} ${card}`)
    if (e.foilQuantity > 0) out.push(`${e.foilQuantity} ${card} *F*`)
  }
  return out.join('\n')
}

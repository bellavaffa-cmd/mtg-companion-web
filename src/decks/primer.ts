// A deck's primer (Deck.description): a few lines of light markdown on how the deck plays. Read as
// blocks — headings ("#", "##", "###"), lists ("- " or "1. ") and paragraphs — each made of spans of
// text that may be bold (**…**), italic (*…* or _…_), a link ([words](https://…) or a bare
// https:// address) or a card ([[Card Name]], which opens the card). Only http and https links are
// made; everything else stays text, so nothing in a primer can run as a page. Pure, so it can be
// tested; the Android app's data/Primer.kt reads it the same way.

/** The longest primer kept, in characters. */
export const MAX_DESCRIPTION = 20000

export interface PrimerSpan {
  text: string
  bold: boolean
  italic: boolean
  /** A card's name: the span opens that card. */
  card: string | null
  /** An http(s) address: the span opens it. */
  url: string | null
}

export type PrimerBlock =
  | { kind: 'heading'; level: number; spans: PrimerSpan[] }
  | { kind: 'paragraph'; spans: PrimerSpan[] }
  | { kind: 'list'; ordered: boolean; items: PrimerSpan[][] }

/** [text] as it's kept: Windows line ends made plain, blank edges trimmed, at most MAX_DESCRIPTION. */
export function tidyDescription(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim().slice(0, MAX_DESCRIPTION)
}

const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/
const LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/
const BARE_URL = /^https?:\/\/[^\s<>()]+/
const TRAILING = /[.,;:!?'"]+$/

/** The primer's blocks, in order. */
export function parsePrimer(text: string): PrimerBlock[] {
  const blocks: PrimerBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: PrimerSpan[][] } | null = null
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join('\n')) })
    paragraph = []
  }
  const endList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '') { endParagraph(); endList(); continue }
    const heading = HEADING.exec(line)
    if (heading) {
      endParagraph(); endList()
      blocks.push({ kind: 'heading', level: heading[1].length, spans: parseSpans(heading[2].trim()) })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      endParagraph()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) endList()
      if (!list) list = { ordered, items: [] }
      list.items.push(parseSpans((bullet ?? numbered)![1].trim()))
      continue
    }
    endList()
    paragraph.push(line.trim())
  }
  endParagraph(); endList()
  return blocks
}

/** One line (or paragraph) of a primer as spans. */
export function parseSpans(text: string): PrimerSpan[] {
  const spans: PrimerSpan[] = []
  let buffer = ''
  let bold = false
  let italic = false
  let italicMark = ''
  const push = (span: Partial<PrimerSpan> & { text: string }) =>
    spans.push({ bold, italic, card: null, url: null, ...span })
  const flush = () => {
    if (buffer) {
      const last = spans[spans.length - 1]
      // Text next to text in the same style is one span.
      if (last && !last.card && !last.url && last.bold === bold && last.italic === italic) last.text += buffer
      else push({ text: buffer })
    }
    buffer = ''
  }
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    if (rest.startsWith('[[')) {
      const end = text.indexOf(']]', i + 2)
      const name = end < 0 ? '' : text.slice(i + 2, end).trim()
      if (name && name.length <= 150 && !/[[\]\n]/.test(name)) {
        flush()
        push({ text: name, card: name })
        i = end + 2
        continue
      }
    }
    if (rest.startsWith('[')) {
      const link = LINK.exec(rest)
      if (link) {
        flush()
        push({ text: link[1], url: link[2] })
        i += link[0].length
        continue
      }
    }
    if ((rest.startsWith('http://') || rest.startsWith('https://')) && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const url = (BARE_URL.exec(rest)?.[0] ?? '').replace(TRAILING, '')
      if (/^https?:\/\/./.test(url)) {
        flush()
        push({ text: url, url })
        i += url.length
        continue
      }
    }
    if (rest.startsWith('**')) {
      if (bold) { flush(); bold = false; i += 2; continue }
      if (text.indexOf('**', i + 2) > i + 2) { flush(); bold = true; i += 2; continue }
      buffer += '**'
      i += 2
      continue
    }
    const c = text[i]
    if (c === '*' || c === '_') {
      if (italic && italicMark === c) { flush(); italic = false; i += 1; continue }
      const next = text[i + 1] ?? ''
      const before = i > 0 ? text[i - 1] : ''
      // An underscore inside a word (snake_case) is just an underscore.
      const opens = !italic && next !== '' && !/\s/.test(next) && text.indexOf(c, i + 1) > i + 1 &&
        !(c === '_' && /[A-Za-z0-9]/.test(before))
      if (opens) { flush(); italic = true; italicMark = c; i += 1; continue }
    }
    buffer += c
    i += 1
  }
  flush()
  return spans
}

/** The cards a primer links to, each once, in the order they first appear. */
export function primerCardNames(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const take = (spans: PrimerSpan[]) => {
    for (const s of spans) {
      if (s.card && !seen.has(s.card.toLowerCase())) {
        seen.add(s.card.toLowerCase())
        out.push(s.card)
      }
    }
  }
  for (const b of parsePrimer(text)) {
    if (b.kind === 'list') b.items.forEach(take)
    else take(b.spans)
  }
  return out
}

/**
 * The primer as comment lines for a decklist ("// …"), which decklist readers — this app's own
 * importer too — skip. Empty when there's no primer.
 */
export function primerComments(text: string | undefined): string[] {
  const tidy = tidyDescription(text ?? '')
  if (!tidy) return []
  return tidy.split('\n').map((line) => (line.trim() ? `// ${line.trimEnd()}` : '//'))
}

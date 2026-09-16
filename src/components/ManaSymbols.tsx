import type { ReactNode } from 'react'

/**
 * Scryfall serves every mana/cost symbol as an SVG named after its contents with braces and
 * slashes stripped: {W} -> W.svg, {U/B} -> UB.svg, {2} -> 2.svg, {T} -> T.svg. Our colour
 * distribution uses the word "Colorless", which maps to the generic {C} symbol.
 *
 * Mirrors the Android app's ui/common/ManaSymbols.kt.
 */
function manaSymbolUrl(code: string): string {
  const upper = code.toUpperCase()
  const symbol = upper === 'COLORLESS' ? 'C' : upper.replace(/\//g, '')
  return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(symbol)}.svg`
}

/** A single mana symbol (e.g. "W", "U", "Colorless", "2/W") rendered as its Scryfall logo. */
export function ManaSymbol({ code, size = 14 }: { code: string; size?: number }) {
  return (
    <img
      className="mana-symbol"
      src={manaSymbolUrl(code)}
      alt={`{${code}}`}
      title={`{${code}}`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      // Deliberately not lazy-loaded: these are 1-3KB and sit inline inside a sentence, so
      // deferring them just reflows the text as each one pops in.
    />
  )
}

const SYMBOL_PATTERN = /\{([^}]+)\}/g

/**
 * Renders rules text with every `{X}` replaced by its Scryfall symbol, so oracle text reads the
 * way it does on the printed card instead of as raw brace syntax. Newlines are preserved by CSS
 * (`white-space: pre-wrap`) rather than by splitting into paragraphs, which keeps the inline
 * symbols flowing naturally through a wrapped line.
 */
export function InlineManaText({
  text,
  size = 14,
  className,
}: {
  text: string
  size?: number
  className?: string
}) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  // A fresh regex per call: SYMBOL_PATTERN is global, so sharing it across calls would carry
  // lastIndex over from the previous one and silently skip matches.
  const pattern = new RegExp(SYMBOL_PATTERN.source, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(<ManaSymbol key={`sym-${match.index}`} code={match[1]} size={size} />)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))

  return <span className={className ? `inline-mana ${className}` : 'inline-mana'}>{parts}</span>
}

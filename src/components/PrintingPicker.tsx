import { useEffect, useMemo, useRef, useState } from 'react'
import { getPrintings } from '../api/scryfall'
import { searchPrintings, setCodeQuery, type PrintingFacts } from '../scan/printingSearch'
import { displayImageUrl, largeImageUrl, type ScryfallCard } from '../types/scryfall'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { ArtImage } from './kit'

/** Which printing a card is, in words: the set it came in, and its number within that set. */
export const printingName = (card: ScryfallCard) =>
  [card.set_name ?? card.set?.toUpperCase(), card.collector_number && `#${card.collector_number}`].filter(Boolean).join(' · ')

/** A printing's set code and number, as a tile in the picker heads it: "FIN · 306". */
const printingCode = (card: ScryfallCard) =>
  [card.set?.toUpperCase(), card.collector_number].filter(Boolean).join(' · ')

const factsOf = (card: ScryfallCard): PrintingFacts => ({
  set: card.set, setName: card.set_name, number: card.collector_number, released: card.released_at,
})

// Whether the last thing the user did was a key rather than a tap or a click: the picker's search
// takes focus (and so a phone's keyboard) only when it was opened from the keyboard.
let keyboardLast = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => { keyboardLast = true }, true)
  window.addEventListener('pointerdown', () => { keyboardLast = false }, true)
}

/** Waits this long after the last key before asking Scryfall for a set the loaded printings don't have. */
const SET_LOOKUP_MS = 350

/**
 * Every printing of the card called [name], to pick one: the scanner's "which one are you holding",
 * and "change printing" on a card in a binder or deck. [currentId] is the printing it is now, ringed.
 * A search field narrows them by set name, set code, collector number or year (scan/printingSearch).
 */
export function PrintingPicker({ name, currentId, prompt = "Pick the printing you're holding.", onPick, onClose, onDifferent, autoFocusSearch }: {
  name: string
  currentId: string
  prompt?: string
  onPick: (card: ScryfallCard) => void
  onClose: () => void
  /** Given where a scan is being fixed: "It's a different card" — search for the card it really is. */
  onDifferent?: () => void
  /** Focus the search on opening. Left out: only when the picker was opened from the keyboard. */
  autoFocusSearch?: boolean
}) {
  const [printings, setPrintings] = useState<ScryfallCard[] | null>(null)
  // How many Scryfall says there are, and whether more pages are still coming.
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [focusSearch] = useState(() => autoFocusSearch ?? keyboardLast)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPrintings(name, undefined, (soFar, all) => {
      if (cancelled) return
      setTotal(all)
      // Printings fetched by set (below) while the pages were coming stay in.
      setPrintings((was) => merge(soFar, was ?? []))
    })
      .then((found) => { if (!cancelled) setPrintings((was) => merge(found, was ?? [])) })
      .catch(() => { if (!cancelled) setError("Couldn't load the other printings — check your connection.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [name])

  const shown = useMemo(() => (printings ? searchPrintings(printings, query, factsOf) : []), [printings, query])
  const searching = query.trim() !== ''

  // A card with so many printings they aren't all in yet (still loading, or more than the pages the
  // app follows): a set code with no match among them is asked of Scryfall itself, `!"name" set:code`.
  const asked = useRef(new Set<string>())
  const incomplete = loading || (total !== undefined && (printings?.length ?? 0) < total)
  useEffect(() => {
    if (!printings || shown.length > 0 || !incomplete) return
    const code = setCodeQuery(query)
    if (!code || asked.current.has(code.set)) return
    const timer = setTimeout(() => {
      asked.current.add(code.set)
      getPrintings(name, code.set)
        .then((found) => { if (found.length) setPrintings((was) => merge(was ?? [], found)) })
        .catch(() => {})
    }, SET_LOOKUP_MS)
    return () => clearTimeout(timer)
  }, [printings, shown.length, incomplete, query, name])

  const count = printings?.length ?? 0
  const of = Math.max(count, total ?? 0)

  return (
    <Dialog
      title={name}
      onDismiss={onClose}
      actions={<>
        {onDifferent && <button type="button" className="btn line" onClick={onDifferent}>It's a different card</button>}
        <button type="button" className="btn line" onClick={onClose}>Close</button>
      </>}
    >
      <p className="muted" style={{ marginTop: 0 }}>{prompt}</p>
      {error && !count && <div className="muted">{error}</div>}
      {!printings && !error && <div className="muted">Looking up printings…</div>}
      {printings && count <= 1 && !loading && <div className="muted">Only one printing of this card.</div>}
      {printings && count > 1 && (
        <>
          <label className="searchpill printing-search">
            <Icon name="search" style={{ fontSize: 20 }} />
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (shown.length === 1 && searching) onPick(shown[0])
              }}
              placeholder="Set name, code or number"
              aria-label={`Search the printings of ${name}`}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus={focusSearch}
              data-no-initial-focus={focusSearch ? undefined : ''}
            />
            {query && (
              <button type="button" className="clear" onClick={() => { setQuery(''); input.current?.focus() }} aria-label="Clear search">
                <Icon name="close" />
              </button>
            )}
          </label>
          <div className="muted printing-search-count" aria-live="polite">
            {searching ? `${shown.length} of ${of} printings` : `${of} printings`}
            {loading && ' · loading more…'}
          </div>
          {searching && shown.length === 0 ? (
            <div className="muted printing-search-empty">
              No printing of {name} in “{query.trim()}”
              {loading && ' yet'}.
              {onDifferent && <> <button type="button" className="link" onClick={onDifferent}>It's a different card</button></>}
            </div>
          ) : (
            <div className="card-grid">
              {shown.map((card) => (
                <button
                  type="button"
                  key={card.id}
                  className={`card-cell press${card.id === currentId ? ' picked' : ''}`}
                  aria-current={card.id === currentId ? 'true' : undefined}
                  aria-label={[printingCode(card), card.set_name].filter(Boolean).join(' · ')}
                  title={[printingCode(card), card.set_name].filter(Boolean).join(' · ')}
                  onClick={() => onPick(card)}
                >
                  <div className="card-cell-img">
                    {displayImageUrl(card) ? <img src={displayImageUrl(card)!} alt={card.name} loading="lazy" data-card-preview={largeImageUrl(card) ?? undefined} /> : <ArtImage src={null} seed={card.name} />}
                  </div>
                  <div className="card-cell-name">{printingCode(card) || printingName(card)}</div>
                  {card.set_name && <div className="card-cell-set muted">{card.set_name}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

/** [first] then whatever of [more] isn't in it already, by id. */
function merge(first: ScryfallCard[], more: ScryfallCard[]): ScryfallCard[] {
  if (more.length === 0) return first
  const ids = new Set(first.map((c) => c.id))
  return [...first, ...more.filter((c) => !ids.has(c.id))]
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { useBack } from '../components/kit'
import { buildFindIndex, chipLabel, copiesLine, finder } from '../collection/findAnything'
import '../collection/collectionHome.css'

/**
 * Find anything, the Android app's FindAnythingScreen: one search over the user's cards (each with its
 * copies and every place they are), places and decks, and "Search all cards" for what isn't theirs.
 * The library is indexed once when it changes; each keystroke filters what the last one found
 * (collection/findAnything.ts). At /collections/find (?q=…).
 */
export function FindAnythingPage() {
  const { collections, decks } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections')
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const input = useRef<HTMLInputElement>(null)
  const find = useMemo(() => finder(buildFindIndex(collections, decks)), [collections, decks])
  const result = useMemo(() => find(query), [find, query])
  const typed = query.trim()

  useEffect(() => { input.current?.focus() }, [])
  // The query rides in the address, so Back from a card comes back to the same results.
  useEffect(() => {
    const t = window.setTimeout(() => setParams(typed ? { q: query } : {}, { replace: true }), 300)
    return () => window.clearTimeout(t)
  }, [query, typed, setParams])

  return (
    <div className="content-scroll">
      <div className="find-bar">
        <label className="find-field">
          <Icon name="search" style={{ color: 'var(--t1)' }} />
          <input
            ref={input}
            aria-label="Find"
            placeholder="Find a card, a place or a deck"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') back() }}
            enterKeyHint="search"
          />
          {query && <button type="button" className="ib" aria-label="Clear" onClick={() => { setQuery(''); input.current?.focus() }}><Icon name="close" /></button>}
        </label>
        <button type="button" className="find-cancel" onClick={back}>Cancel</button>
      </div>

      {typed && (
        <div className="find-results" aria-live="polite">
          {result.cards.length > 0 && (
            <section className="find-section">
              <h2>Your cards</h2>
              {result.cards.map((c) => (
                <button key={c.name} type="button" className="find-card press" onClick={() => navigate(`/card/${encodeURIComponent(c.name)}`)}>
                  <div className="find-card-top">
                    {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" /> : <div className="find-thumb" />}
                    <b>{c.name}</b>
                    <span>{copiesLine(c)}</span>
                  </div>
                  {c.chips.length > 0 && (
                    <div className="find-chips">
                      {c.chips.map((chip) => (
                        <span key={`${chip.kind}|${chip.label}|${chip.placeId ?? ''}|${chip.deckId ?? ''}`} className={`find-chip${chip.kind === 'lent' ? ' lent' : ''}`}>{chipLabel(chip)}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
              {result.moreCards > 0 && <div className="dim" style={{ fontSize: 13 }}>And {result.moreCards} more — type a little more of the name</div>}
            </section>
          )}
          {result.places.length > 0 && (
            <section className="find-section">
              <h2>Places</h2>
              {result.places.map((p) => (
                <button key={p.id} type="button" className="find-row press" onClick={() => navigate(`/collections/place/${p.id}`)}>
                  <b>{p.name}</b><span>{p.line}</span>
                </button>
              ))}
            </section>
          )}
          {result.decksUsing.length > 0 && (
            <section className="find-section">
              <h2>Decks using it</h2>
              {result.decksUsing.map((d) => (
                <button key={d.id} type="button" className="find-row press" onClick={() => navigate(`/decks/${d.id}`)}>
                  <b>{d.name}</b><span>{d.line}</span>
                </button>
              ))}
            </section>
          )}
          {result.decks.length > 0 && (
            <section className="find-section">
              <h2>Decks</h2>
              {result.decks.map((d) => (
                <button key={d.id} type="button" className="find-row press" onClick={() => navigate(`/decks/${d.id}`)}>
                  <b>{d.name}</b><span>{d.line}</span>
                </button>
              ))}
            </section>
          )}
          <section className="find-section">
            <h2>Not yours</h2>
            <button type="button" className="find-row plain press" onClick={() => navigate(`/search?q=${encodeURIComponent(typed)}`)}>
              <b>Search all cards for "{typed}"</b><Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

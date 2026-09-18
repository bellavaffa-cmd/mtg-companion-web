import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { accessToken, apiHeaders, restUrl } from '../sync/supabaseAuth'
import { fetchGiphyGif, GiphyError } from './giphy'

interface Gif {
  id: string
  title: string
  preview: string
  width: number
  height: number
}

interface Page {
  gifs: Gif[]
  next: number | null
}

/** Trending (no query) or a search, through the giphy Edge Function (which holds the API key). */
async function searchGiphy(q: string, offset: number): Promise<Page> {
  const token = await accessToken()
  if (!token) throw new GiphyError('Sign in first.')
  let res: Response
  try {
    res = await fetch(restUrl(`/functions/v1/giphy?${new URLSearchParams({ q, offset: String(offset) })}`), { headers: apiHeaders(token) })
  } catch {
    throw new GiphyError("You're offline — try again when you're connected.")
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new GiphyError(body.error ?? `GIF search failed (HTTP ${res.status}).`)
  return body as Page
}

/**
 * Pick a GIF from Giphy without leaving the app: trending until you type, then search results; tap
 * one and it's fetched in a size that fits the picture limit. A pasted link works too.
 */
export function GiphyPicker({ onPicked, onClose }: { onPicked: (file: File) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    search.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Typing settles for a moment before searching, and one letter isn't searched: every search
  // counts against Giphy's hourly limit.
  useEffect(() => {
    const text = query.trim()
    if (text.length === 1) return
    const t = window.setTimeout(() => setQ(text), 800)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    searchGiphy(q, 0)
      .then((page) => { if (!cancelled) { setGifs(page.gifs); setNext(page.next) } })
      .catch((e: unknown) => { if (!cancelled) { setGifs([]); setNext(null); setError(e instanceof Error ? e.message : 'Something went wrong.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [q])

  const more = async () => {
    if (next === null || loading) return
    setLoading(true)
    try {
      const page = await searchGiphy(q, next)
      setGifs((list) => [...list, ...page.gifs.filter((g) => !list.some((x) => x.id === g.id))])
      setNext(page.next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const pick = async (url: string, id: string) => {
    setPicking(id)
    setError(null)
    try {
      onPicked(await fetchGiphyGif(url))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setPicking(null)
    }
  }

  // Drawn at the page's top level: opened from inside a dialog, it would otherwise be boxed into it.
  return createPortal(
    <>
      <div className="scrim giphy-scrim" onClick={onClose} />
      <div className="sheet picker-sheet giphy-sheet" role="dialog" aria-modal="true" aria-label="Pick a GIF">
        <div className="grab" />
        <div className="picker-head">
          <div className="giphy-search">
            <Icon name="search" aria-hidden />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Giphy"
              aria-label="Search Giphy"
              enterKeyHint="search"
              onKeyDown={(e) => { if (e.key === 'Enter') setQ(query.trim()) }}
            />
          </div>
          <button type="button" className="btn line sm" onClick={onClose}>Cancel</button>
        </div>
        <div className="picker-body">
          <div className="dim giphy-label">{q ? `“${q}”` : 'Trending'}</div>
          {error && <div className="notice warn" style={{ marginBottom: 10 }}>{error}</div>}
          <div className="giphy-grid">
            {gifs.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`giphy-cell${picking === g.id ? ' busy' : ''}`}
                disabled={picking !== null}
                onClick={() => void pick(`https://giphy.com/gifs/${g.id}`, g.id)}
                aria-label={g.title || 'GIF'}
              >
                <img src={g.preview} alt="" loading="lazy" width={g.width} height={g.height} />
                {picking === g.id && <span className="giphy-busy">Getting it…</span>}
              </button>
            ))}
          </div>
          {!loading && gifs.length === 0 && !error && <div className="empty-state">No GIFs for “{q}”.</div>}
          {loading && <div className="dim" style={{ textAlign: 'center', padding: 12 }}>Loading…</div>}
          {!loading && next !== null && (
            <button type="button" className="btn line block" style={{ marginTop: 12 }} onClick={() => void more()}>More GIFs</button>
          )}
          <form
            className="row giphy-link"
            style={{ gap: 8 }}
            onSubmit={(e) => { e.preventDefault(); if (link.trim()) void pick(link, 'link') }}
          >
            <input className="input" style={{ flex: 1, minWidth: 0 }} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a Giphy link" aria-label="Giphy link" inputMode="url" />
            <button type="submit" className="btn line" disabled={!link.trim() || picking !== null}>Use</button>
          </form>
          <div className="giphy-attribution">Powered by GIPHY</div>
        </div>
      </div>
    </>,
    document.body,
  )
}

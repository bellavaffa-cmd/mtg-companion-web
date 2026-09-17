import { useEffect, useState } from 'react'
import { comboUrl, fetchNews, findCombosInDeck, relayAvailable, type ComboVariant, type DeckCombos, type NewsItem } from '../api/relay'
import type { Deck } from '../types/models'
import { Icon } from './Icon'
import { rise } from './kit'

function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(ms).toLocaleDateString()
}

/** Latest MTG headlines (MTG Arena Zone, Star City Games), like the Android app's Home news. */
export function NewsPanel({ limit = 6, index = 0 }: { limit?: number; index?: number }) {
  const [items, setItems] = useState<NewsItem[] | null | undefined>(undefined)
  useEffect(() => {
    if (!relayAvailable) return
    let cancelled = false
    fetchNews()
      .then((n) => { if (!cancelled) setItems(n) })
      .catch(() => { if (!cancelled) setItems(null) })
    return () => { cancelled = true }
  }, [])

  // A news outage shouldn't leave an error box on Home; the section just isn't there.
  if (!relayAvailable || items === null || (items && items.length === 0)) return null
  return (
    <div className="panel news rise" style={rise(index)}>
      <div className="p-h"><h3>News</h3></div>
      {items === undefined ? (
        <div className="dim">Loading headlines…</div>
      ) : (
        <ul className="news-list">
          {items.slice(0, limit).map((item) => (
            <li key={item.link}>
              <a href={item.link} target="_blank" rel="noreferrer noopener" className="news-item press">
                <span className="news-title">{item.title}</span>
                <span className="news-meta">{item.source}{item.publishedAt ? ` · ${timeAgo(item.publishedAt)}` : ''}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// One lookup per decklist per page load, shared by the Stats tab and the desktop side panel.
const comboCache = new Map<string, Promise<DeckCombos>>()

/** Combos this deck contains, and those it's one card short of, from Commander Spellbook. */
export function DeckCombosPanel({ deck, index = 3 }: { deck: Deck; index?: number }) {
  const commanders = [deck.commander, deck.partnerCommander].filter((c) => c !== null).map((c) => c.name)
  const main = [...new Set(deck.cards.map((c) => c.name))].filter((n) => !commanders.includes(n))
  const key = `${commanders.join('|')}#${[...main].sort().join('|')}`
  const [combos, setCombos] = useState<DeckCombos | null | undefined>(undefined)
  const [showAlmost, setShowAlmost] = useState(false)

  useEffect(() => {
    if (!relayAvailable || (commanders.length === 0 && main.length === 0)) return
    let cancelled = false
    setCombos(undefined)
    let request = comboCache.get(key)
    if (!request) {
      request = findCombosInDeck(commanders, main)
      request.catch(() => comboCache.delete(key))
      comboCache.set(key, request)
    }
    request
      .then((c) => { if (!cancelled) setCombos(c) })
      .catch(() => { if (!cancelled) setCombos(null) })
    return () => { cancelled = true }
    // key captures every name the lookup depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!relayAvailable || (commanders.length === 0 && main.length === 0)) return null
  const inDeck = new Set([...commanders, ...main])

  return (
    <div className="panel rise" style={rise(index)}>
      <div className="p-h">
        <h3>Combos</h3>
        {combos && <span className="p-sub">In deck<b>{combos.included.length}</b></span>}
      </div>
      {combos === undefined && <div className="dim">Checking Commander Spellbook…</div>}
      {combos === null && <div className="dim">Couldn't reach Commander Spellbook. Check your connection and try again later.</div>}
      {combos && (
        <>
          {combos.included.length === 0 ? (
            <div className="dim">No complete combos in this deck.</div>
          ) : (
            <ul className="combo-list">
              {combos.included.slice(0, 12).map((v) => <ComboRow key={v.id} variant={v} inDeck={inDeck} />)}
            </ul>
          )}
          {combos.almostIncluded.length > 0 && (
            <>
              <button type="button" className="combo-more press" onClick={() => setShowAlmost((s) => !s)} aria-expanded={showAlmost}>
                <span style={{ flex: 1 }}>One card away<b>{combos.almostIncluded.length}</b></span>
                <Icon name={showAlmost ? 'expand_less' : 'expand_more'} />
              </button>
              {showAlmost && (
                <ul className="combo-list">
                  {combos.almostIncluded.slice(0, 20).map((v) => <ComboRow key={v.id} variant={v} inDeck={inDeck} />)}
                </ul>
              )}
            </>
          )}
          <div className="dim" style={{ marginTop: 10 }}>From Commander Spellbook. Missing pieces are highlighted.</div>
        </>
      )}
    </div>
  )
}

function ComboRow({ variant, inDeck }: { variant: ComboVariant; inDeck: Set<string> }) {
  const results = variant.produces.map((p) => p.feature.name).slice(0, 2)
  return (
    <li>
      <a className="combo press" href={comboUrl(variant.id)} target="_blank" rel="noreferrer noopener">
        <span className="combo-cards">
          {variant.uses.map((u, i) => (
            <span key={`${u.card.name}-${i}`} className={inDeck.has(u.card.name) ? '' : 'missing'}>
              {i > 0 && <i> + </i>}{u.card.name}
            </span>
          ))}
        </span>
        {results.length > 0 && <span className="combo-results">{results.join(' · ')}</span>}
      </a>
    </li>
  )
}

// One set's cards, owned and missing — opened from the Collection's Sets page: owned ones as they are
// (with how many), missing ones dimmed. "Add missing to Wishlist" puts what's missing on the
// Wishlist. A card opens its page. Mirrors the Android app's ui/collection/SetCardsScreen.kt.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { ArtImage, PillChip, rise, useBack } from '../components/kit'
import { getSetCards, getSets } from '../api/scryfall'
import { backImageUrl, biggerImageUrl, cardTags, displayImageUrl, type ScryfallCard } from '../types/scryfall'
import { missingFromSet, ownedPrintings, type SetInfo } from '../collection/setCompletion'

type Show = 'all' | 'missing' | 'owned'

export function SetCardsPage() {
  const { code = '' } = useParams<{ code: string }>()
  const back = useBack('/collections?tab=sets')
  const navigate = useNavigate()
  const { collections, decks, addToWishlist } = useSync()
  const [set, setSet] = useState<SetInfo | null>(null)
  // The set's printings in its own order; null while loading.
  const [cards, setCards] = useState<ScryfallCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [show, setShow] = useState<Show>('all')
  const [message, setMessage] = useState<string | null>(null)
  // Copies held of each printing, counted as All cards counts them.
  const owned = useMemo(() => ownedPrintings(collections, decks), [collections, decks])

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    getSets().then((s) => { if (!cancelled) setSet(s.get(code.toLowerCase()) ?? null) }).catch(() => {})
    getSetCards(code)
      .then((found) => { if (!cancelled) setCards(found) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [code, attempt])

  const list = cards ?? []
  const copies = (c: ScryfallCard) => owned.get(c.id) ?? 0
  const have = list.filter((c) => copies(c) > 0).length
  const total = Math.max(set?.cardCount ?? 0, list.length)
  const missing = list.length - have
  const shown = show === 'missing' ? list.filter((c) => copies(c) <= 0) : show === 'owned' ? list.filter((c) => copies(c) > 0) : list

  /** One of each card the user doesn't own onto the Wishlist (it keeps a card once, whatever its printing). */
  const addMissing = () => {
    const seen = new Set<string>()
    const wanted = missingFromSet(list, new Set([...owned.keys()].filter((id) => (owned.get(id) ?? 0) > 0)), (c) => c.id)
      .filter((c) => {
        const key = c.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    if (wanted.length === 0) return
    addToWishlist(wanted.map((c) => ({ scryfallId: c.id, name: c.name, imageUrl: displayImageUrl(c), backImageUrl: backImageUrl(c), tags: cardTags(c), quantity: 1 })))
    setMessage(wanted.length === 1 ? '1 card put on your Wishlist.' : `${wanted.length} cards put on your Wishlist.`)
  }

  return (
    <>
      <TopBar title={set?.name ?? code.toUpperCase()} onBack={back} />
      <div className="content-scroll">
        <div className="binder-head rise" style={rise(0)}>
          <div className="eyebrow">Set · {code.toUpperCase()}</div>
          <h1>{set?.name ?? code.toUpperCase()}</h1>
          {cards && <div className="dim">{have} / {total} cards</div>}
        </div>
        {failed && !cards ? (
          <div className="empty-state">
            <div>Couldn't fetch this set's cards from Scryfall.</div>
            <button type="button" className="btn line" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </div>
        ) : !cards ? (
          <div className="empty-state">Loading the set's cards…</div>
        ) : (
          <>
            <div className="set-head rise" style={rise(1)}>
              <span className="set-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={have} aria-label={`${have} of ${total} cards`}>
                <span style={{ width: `${total === 0 ? 0 : Math.min(100, (have / total) * 100)}%` }} />
              </span>
              <div className="chips">
                <PillChip label="All" count={list.length} selected={show === 'all'} onClick={() => setShow('all')} />
                <PillChip label="Missing" count={missing} selected={show === 'missing'} onClick={() => setShow('missing')} />
                <PillChip label="Owned" count={have} selected={show === 'owned'} onClick={() => setShow('owned')} />
              </div>
              {missing > 0 && (
                <div>
                  <button type="button" className="btn gold" onClick={addMissing}><Icon name="star" aria-hidden />Add missing to Wishlist</button>
                </div>
              )}
              {message && <div className="muted">{message}</div>}
              {list.length < total && <div className="dim" style={{ fontSize: 12 }}>Showing {list.length} of the set's {total} cards Scryfall can search.</div>}
            </div>
            <div className="card-grid" style={{ marginTop: 14 }}>
              {shown.map((card) => {
                const n = copies(card)
                const image = displayImageUrl(card)
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`card-cell press set-card${n > 0 ? ' owned' : ' missing'}`}
                    onClick={() => navigate(`/card/${encodeURIComponent(card.name)}?id=${card.id}`)}
                  >
                    <div className="card-cell-img">
                      {image ? <img src={image} alt={card.name} loading="lazy" data-card-preview={biggerImageUrl(image) ?? undefined} /> : <ArtImage src={null} seed={card.name} />}
                      {n > 0 && <span className="card-cell-count"><span aria-hidden="true">×</span>{n}<span className="sr-only"> copies</span></span>}
                    </div>
                    <div className="card-cell-name">{[card.collector_number ? `#${card.collector_number}` : null, card.name].filter(Boolean).join(' ')}</div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}

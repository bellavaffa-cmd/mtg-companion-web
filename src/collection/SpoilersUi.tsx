// Spoiler season (collection/spoilers.ts): a set's revealed cards as a gallery — each to want before
// release, with the decks it could go in (a tap puts it on that deck's Considering list) — and the
// Opening packs page for prerelease night. Part of New sets (pages/NewSetsPage.tsx). The Android
// app's ui/collection/SpoilersUi.kt.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ArtImage, rise, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import type { SetInfo } from './setCompletion'
import type { SetCard } from './newSets'
import { loadReleaseSets, loadSetCards } from './newSetsStore'
import { openingPacks, releaseCountdown, withPulled, type DeckMatch, type PackCard } from './spoilers'
import './newSets.css'

/** The price once it's out, or the countdown before. */
function PriceOrCountdown({ card, set, now }: { card: SetCard; set: SetInfo; now: string }) {
  const money = useMoney()
  const at = card.releasedAt ?? set.releasedAt ?? ''
  const usd = card.usd != null ? Number(card.usd) : NaN
  if (at <= now) return <>{Number.isFinite(usd) ? money.format(usd) : 'No price yet'}</>
  return <>{releaseCountdown(at, now) ?? 'No price yet'}</>
}

/**
 * One revealed card: its image (a tap opens it), the price or the countdown, how many are wanted
 * ([want], changed with [onWant]), and the decks it fits ([fits]) — [considering]: the deck ids
 * already considering it.
 */
export function SpoilerTile({ card, set, now, want, fits, considering, onOpen, onWant, onConsider }: {
  card: SetCard; set: SetInfo; now: string; want: number; fits: DeckMatch[]; considering: Set<string>
  onOpen: () => void; onWant: (n: number) => void; onConsider: (m: DeckMatch) => void
}) {
  return (
    <div className="spoiler-tile">
      <button type="button" className="spoiler-img press" onClick={onOpen} aria-label={card.name}>
        {card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" /> : <ArtImage src={null} seed={card.name} />}
      </button>
      <b className="spoiler-name">{card.name}</b>
      <span className="dim spoiler-price"><PriceOrCountdown card={card} set={set} now={now} /></span>
      {want <= 0 ? (
        <button type="button" className="btn line sm" onClick={() => onWant(1)}><Icon name="add" />Want</button>
      ) : (
        <div className="spoiler-want">
          <button type="button" onClick={() => onWant(want - 1)} aria-label={`Want one fewer ${card.name}`}>−</button>
          <b>Want {want}</b>
          <button type="button" onClick={() => onWant(want + 1)} aria-label={`Want one more ${card.name}`}>+</button>
        </div>
      )}
      {fits.length > 0 && (
        <div className="spoiler-fits">
          <span className="dim">Fits</span>
          {fits.map((m) => {
            const on = considering.has(m.deckId)
            return (
              <button
                key={m.deckId}
                type="button"
                className={`spoiler-deck${on ? ' on' : ''}`}
                disabled={on}
                title={on ? `On ${m.deckName}'s Considering list` : `${m.why} — tap to consider it for ${m.deckName}`}
                onClick={() => onConsider(m)}
              >
                <Icon name={on ? 'check' : 'add'} />{m.deckName}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Opening packs: the wanted cards from the set, to tick off as they come out of the packs — each
 * tick puts a copy in the Unsorted pile and wants one fewer.
 */
export function OpeningPacksPage() {
  const { code = '' } = useParams<{ code: string }>()
  const back = useBack(`/new-sets/${code}`)
  const navigate = useNavigate()
  const { collections, changeStorage } = useSync()
  const [set, setSet] = useState<SetInfo | null>(null)
  const [cards, setCards] = useState<SetCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pulled, setPulled] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    setFailed(false)
    Promise.all([loadReleaseSets(), loadSetCards(code.toLowerCase())])
      .then(([all, c]) => { if (!cancelled) { setSet(all.find((s) => s.code === code.toLowerCase()) ?? null); setCards(c) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [code, attempt])
  const list = useMemo(() => (cards ? openingPacks(collections, cards) : null), [collections, cards])
  const pull = (p: PackCard, foil: boolean) => {
    changeStorage((c) => withPulled(c, p, foil))
    setPulled((was) => [...was, p.card.name])
  }
  const counts = new Map<string, number>()
  for (const n of pulled) counts.set(n, (counts.get(n) ?? 0) + 1)

  return (
    <>
      <TopBar title="Opening packs" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width rise" style={rise(0)}>
          {failed && !cards ? (
            <EmptyState icon="cloud_off" text="Couldn't reach Scryfall for this set's cards." actions={[{ label: 'Try again', icon: 'refresh', onClick: () => setAttempt((a) => a + 1) }]} />
          ) : !list ? (
            <p className="muted">Looking through the set's cards…</p>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {set?.name ?? code.toUpperCase()}: the cards you want from it. Tick one off as it comes out of a pack — it goes into your Unsorted pile and you want one fewer.
              </p>
              {list.length === 0 && <EmptyState icon="inventory_2" text="Nothing wanted from this set yet. Mark cards Want on the set's page." />}
              <div className="list">
                {list.map((p) => (
                  <div key={p.entry.scryfallId} className="crow read-only set-card pack-row">
                    <button type="button" className="thumb-btn" onClick={() => navigate(`/card/${encodeURIComponent(p.card.name)}?id=${p.card.id}`)} aria-label={p.card.name}>
                      <ArtImage className="thumb" src={toArtCrop(p.card.imageUrl)} seed={p.card.name} colors={p.card.colorIdentity} />
                    </button>
                    <div className="cmain">
                      <div className="cname">{p.entry.name}</div>
                      <div className="cmeta"><span className="dim">{p.entry.quantity} wanted</span></div>
                    </div>
                    <div className="pack-actions">
                      <button type="button" className="btn line sm" onClick={() => pull(p, true)}>Foil</button>
                      <button type="button" className="btn gold sm" onClick={() => pull(p, false)}><Icon name="check" />Pulled</button>
                    </div>
                  </div>
                ))}
              </div>
              {pulled.length > 0 && (
                <>
                  <h2 className="set-head">Pulled so far</h2>
                  <p className="muted">{[...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ')}</p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

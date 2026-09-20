import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ArtImage, toArtCrop } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import type { Deck, DeckCardEntry } from '../types/models'
import * as api from './api'
import { PickerSheet } from './CardPicker'
import { SocialGate } from '../pages/FriendsPage'
import { Avatar } from './ui'
import { missingCards } from '../decks/missing'

/**
 * "Who has it?": the deck's missing cards, each with the friends whose shared binders hold a copy
 * (who_has_cards on the server), and a button to ask them for it in a trade.
 */
export function WhoHasItSheet({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const { collections, decks } = useSync()
  const missing = useMemo(() => missingCards(deck, collections, decks), [deck, collections, decks])
  return (
    <PickerSheet title="Who has it?" subtitle={`${deck.name} · ${missing.length} ${missing.length === 1 ? 'card' : 'cards'} you don't own`} onClose={onClose}>
      <SocialGate>{(overview) => <WhoHasList overview={overview} missing={missing} />}</SocialGate>
    </PickerSheet>
  )
}

function WhoHasList({ overview, missing }: { overview: api.Overview; missing: DeckCardEntry[] }) {
  const navigate = useNavigate()
  const [hits, setHits] = useState<api.SharedCardHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = missing.slice(0, 250).map((e) => e.name).join('\n')
  useEffect(() => {
    if (!key) { setHits([]); return }
    let cancelled = false
    setError(null)
    api.whoHasCards(key.split('\n'))
      .then((r) => { if (!cancelled) setHits(r) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.') })
    return () => { cancelled = true }
  }, [key])

  if (missing.length === 0) return <div className="empty-state"><Icon name="task_alt" />You own every card in this deck.</div>
  if (error) return <div className="notice warn">{error}</div>
  if (!hits) return <div className="empty-state"><Icon name="hourglass_empty" />Looking through your friends' binders…</div>

  const byName = new Map<string, api.SharedCardHit[]>()
  for (const h of hits) byName.set(h.name.toLowerCase(), [...(byName.get(h.name.toLowerCase()) ?? []), h])
  const found = missing.filter((e) => byName.has(e.name.toLowerCase()))
  const nobody = missing.filter((e) => !byName.has(e.name.toLowerCase()))
  const ask = (h: api.SharedCardHit) => navigate(`/trades/new?to=${h.owner}`, {
    state: { want: [{ scryfallId: h.scryfall_id, name: h.name, imageUrl: h.image_url, foil: h.quantity === 0 && h.foil_quantity > 0, quantity: 1, collectionId: h.item_id }] },
  })

  return (
    <div className="who-has">
      {found.length === 0 && <p className="dim">None of your friends' shared binders have these cards.</p>}
      {found.map((e) => (
        <div key={e.scryfallId} className="who-card">
          <div className="who-card-head">
            <ArtImage className="thumb sm" src={toArtCrop(e.imageUrl)} seed={e.name} />
            <span className="who-name">{e.name}</span>
          </div>
          {byName.get(e.name.toLowerCase())!.map((h) => {
            const person = overview.people[h.owner] ?? null
            const copies = h.quantity + h.foil_quantity
            return (
              <div key={`${h.owner}:${h.item_id}:${h.scryfall_id}`} className="who-row">
                <Avatar profile={person} size={26} />
                <span className="who-text">{person?.display_name ?? 'A friend'} has {copies} · {h.item_name}</span>
                <button type="button" className="btn gold sm" onClick={() => ask(h)}>Ask</button>
              </div>
            )
          })}
        </div>
      ))}
      {nobody.length > 0 && (
        <>
          <div className="picker-group-title" style={{ marginTop: 14 }}>No friend has these</div>
          <p className="dim who-nobody">{nobody.map((e) => e.name).join(', ')}</p>
        </>
      )}
      <p className="dim" style={{ fontSize: 12.5 }}>Only binders your friends share with you are searched — not their decks or wishlists.</p>
    </div>
  )
}

/**
 * Offering your spares to a friend: pick who, and the trade opens with the cards already on your
 * side of it. The most valuable go first, since that's what a trade is usually about.
 */

import { useNavigate } from 'react-router-dom'
import { ActionSheet, type SheetAction } from '../components/ActionSheet'
import { useOverview } from './SocialContext'
import { spareValue, type Spare } from '../collection/spares'
import type { TradeCard } from './api'

/** How many spares a trade starts with — enough to choose from, not a wall of cards. */
const OFFER_LIMIT = 20

/** The spares as cards to offer, dearest first. */
export function offerCards(spares: Spare[], prices?: Map<string, number>, limit = OFFER_LIMIT): TradeCard[] {
  const sorted = prices ? [...spares].sort((a, b) => spareValue(b, prices) - spareValue(a, prices)) : spares
  return sorted.slice(0, limit).map((s) => ({
    scryfallId: s.entry.scryfallId,
    name: s.entry.name,
    imageUrl: s.entry.imageUrl,
    foil: s.copies === s.foils,
    quantity: s.copies,
  }))
}

export function TradeOfferSheet({ cards, prices, onClose }: { cards: Spare[]; prices?: Map<string, number>; onClose: () => void }) {
  const navigate = useNavigate()
  const { overview } = useOverview()
  const friends = (overview?.friends ?? []).filter((f) => f.status === 'accepted')
  const give = offerCards(cards, prices)

  const actions: SheetAction[] = friends.length === 0
    ? [{ label: 'No friends yet — add one first', icon: 'group_add', onClick: () => { onClose(); navigate('/friends') } }]
    : friends.map((f) => ({
        label: overview?.people[f.user_id]?.display_name ?? 'Friend',
        icon: 'person',
        detail: overview?.people[f.user_id]?.username,
        onClick: () => {
          onClose()
          navigate(`/trades/new?to=${f.user_id}`, { state: { give } })
        },
      }))

  return (
    <ActionSheet
      title={`Offer ${give.length} ${give.length === 1 ? 'card' : 'cards'} to…`}
      subtitle="Your spares, dearest first — you can change the list in the trade"
      actions={actions}
      onClose={onClose}
    />
  )
}

import type { ScryfallCard } from '../types/scryfall'
import type { Deck } from '../types/models'
import { KEEPABLE_LANDS, handOdds, oddsPercent } from '../decks/handOdds'
import { tagsOf } from '../tags/roleTags'
import { rise } from './kit'

/**
 * How the opening hand tends to look, worked out exactly from the list: a keepable seven, how many
 * lands it holds, ramp in it, and hitting land drops. The library is the deck less one copy of each
 * commander; ramp counts once the cards' tags are known. Mirrors the Android app's HandOddsPanel.
 */
export function HandOddsPanel({ deck, cardsById, roleTags, index }: {
  deck: Deck
  cardsById: Map<string, ScryfallCard>
  roleTags?: Map<string, string[]>
  index: number
}) {
  const commanders = new Map<string, number>()
  for (const c of [deck.commander, deck.partnerCommander]) if (c) commanders.set(c.scryfallId, (commanders.get(c.scryfallId) ?? 0) + 1)
  let library = 0
  let lands = 0
  let ramp = 0
  for (const e of deck.cards) {
    const copies = Math.max(0, e.quantity - (commanders.get(e.scryfallId) ?? 0))
    library += copies
    if (/\bland\b/i.test(cardsById.get(e.scryfallId)?.type_line ?? e.typeLine ?? '')) lands += copies
    else if (roleTags && tagsOf(roleTags, e.name).includes('ramp')) ramp += copies
  }
  const commander = deck.gameMode === 'COMMANDER'
  const odds = handOdds(library, lands, ramp, commander)
  if (!odds) return null
  const most = Math.max(...odds.landSpread)

  return (
    <div className="panel rise" style={rise(index)}>
      <div className="p-h"><h3>Opening hand</h3></div>
      <div className="match-head">
        <span className="match-score">{oddsPercent(odds.keepable)}</span>
        <span className="match-rate">chance of a keepable seven ({KEEPABLE_LANDS[0]}–{KEEPABLE_LANDS[1]} lands)</span>
      </div>
      <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>
        {oddsPercent(odds.keepableWithMulligan)} within one mulligan{odds.drawsOnTurnOne ? ' — the first is free in Commander' : ''}
      </div>
      <div className="curve land-spread" aria-label="Lands in the opening seven">
        {odds.landSpread.map((p, n) => (
          <div className={`bcol${n >= KEEPABLE_LANDS[0] && n <= KEEPABLE_LANDS[1] ? ' keep' : ''}`} key={n}>
            <span className="bnum">{p >= 0.005 ? Math.round(p * 100) : ''}</span>
            <div className="btrack"><div className="bar" style={{ ['--h' as string]: `${(p / most) * 100}%`, ['--i' as string]: n }} /></div>
            <span className="blbl">{n}</span>
          </div>
        ))}
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Lands in the opening seven, as a % of hands</div>
      <div style={{ marginTop: 12 }}>
        {odds.ramp > 0 && <OddsRow label="A ramp card in your opening hand" chance={odds.rampInHand} />}
        {odds.landDrops.map((d) => <OddsRow key={d.turn} label={`${d.turn} lands by turn ${d.turn}`} chance={d.chance} />)}
        {odds.ramp > 0 && <OddsRow label="2+ lands and a ramp card by turn 2" chance={odds.landsAndRampByTurn2} />}
      </div>
      <div className="dim" style={{ marginTop: 10, fontSize: 12.5 }}>
        From the {odds.library} cards in the library: {odds.lands} lands, {odds.ramp} ramp.{' '}
        {odds.drawsOnTurnOne ? 'Multiplayer Commander draws on turn 1.' : 'On the play, with no draw on turn 1.'}
      </div>
    </div>
  )
}

function OddsRow({ label, chance }: { label: string; chance: number }) {
  return (
    <div className="matchup">
      <span className="grow">{label}</span>
      <b className="up">{oddsPercent(chance)}</b>
    </div>
  )
}

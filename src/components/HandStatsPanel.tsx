import { useMemo } from 'react'
import type { ScryfallCard } from '../types/scryfall'
import type { Deck } from '../types/models'
import { oddsPercent } from '../decks/handOdds'
import { SIM_HANDS, SIM_KEEP_LANDS, handStats, simLibrary } from '../decks/handSim'

/**
 * Hand stats in the playtest: 10,000 shuffles of the deck, counted (decks/handSim.ts) — lands in the
 * opener, a land drop each turn on the play and on the draw, a two-drop on turn 2, and how often a
 * 2–5 land keep rule mulligans. The Android app's HandStatsPanel in GoldfishDialog.kt.
 */
export function HandStatsPanel({ deck, cardsById }: { deck: Deck; cardsById: Map<string, ScryfallCard> | null | undefined }) {
  const stats = useMemo(() => {
    const library = simLibrary(deck, (e) => cardsById?.get(e.scryfallId)?.type_line, (e) => cardsById?.get(e.scryfallId)?.cmc)
    return handStats(library)
  }, [deck, cardsById])

  if (!stats) return <div className="dim">The deck needs at least 11 cards in its library for hand stats.</div>
  const hasCommander = !!deck.commander
  return (
    <div className="hand-stats">
      <Row label="2–4 lands in your opening seven" value={oddsPercent(stats.twoToFourLands)} />
      <Row label="Lands in your opening seven, on average" value={stats.averageLands.toFixed(1)} />
      <Row label={`Mulligan, keeping ${SIM_KEEP_LANDS[0]}–${SIM_KEEP_LANDS[1]} lands`} value={oddsPercent(stats.mulliganRate)} />
      <div className="matchup hand-stats-h">
        <span className="grow dim">Land drop every turn</span>
        <span className="dim">Play</span>
        <span className="dim">Draw</span>
      </div>
      {stats.landDrops.map((d) => (
        <div key={d.turn} className="matchup">
          <span className="grow">Turn {d.turn}</span>
          <b className="up">{oddsPercent(d.onThePlay)}</b>
          <b className="up">{oddsPercent(d.onTheDraw)}</b>
        </div>
      ))}
      {stats.twoDrops > 0 ? (
        <div className="matchup">
          <span className="grow">A two-drop to cast on turn 2</span>
          <b className="up">{oddsPercent(stats.twoDropOnTurn2.onThePlay)}</b>
          <b className="up">{oddsPercent(stats.twoDropOnTurn2.onTheDraw)}</b>
        </div>
      ) : (
        <div className="dim">No two-drops in the deck{cardsById ? '' : ' yet — card data is still loading'}.</div>
      )}
      <div className="dim hand-stats-note">
        From {SIM_HANDS.toLocaleString('en-US')} shuffles of the {stats.library} cards in the library ({stats.lands} lands
        {hasCommander ? '; the commander starts in the command zone' : ''}), seven-card hands without mulligans. Colours
        aren't checked: any land counts, and a two-drop is any card with mana value 2, so it's a rough guide.
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="matchup">
      <span className="grow">{label}</span>
      <b className="up">{value}</b>
    </div>
  )
}

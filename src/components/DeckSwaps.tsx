import { useRef, useState } from 'react'
import { searchCards, getByFuzzyName } from '../api/scryfall'
import { comboUrl } from '../api/relay'
import { useMoney } from '../money/currency'
import type { Deck, DeckCardEntry } from '../types/models'
import { displayImageUrl, largeImageUrl, type ScryfallCard } from '../types/scryfall'
import { tagsOf } from '../tags/roleTags'
import { nearMisses } from '../decks/considering'
import {
  BUDGET_THRESHOLDS, budgetCandidates, budgetRoleOf, budgetSwapQuery, freshAlternatives, shownAlternatives, swapIdentity, type BudgetRole,
} from '../decks/budgetSwaps'
import { AddToSheet } from './AddToSheet'
import { useAddCardTo } from './useAddCardTo'
import { useDeckCombos } from './useDeckCardSearch'
import type { DeckCardData } from './DeckStats'
import { PillChip, rise } from './kit'

/** Scryfall asks for 50–100ms between requests. */
const SCRYFALL_SPACING_MS = 90

interface Swap {
  entry: DeckCardEntry
  price: number
  role: BudgetRole | null
  alternatives: ScryfallCard[]
}

type SwapState =
  | { kind: 'idle' }
  | { kind: 'loading'; threshold: number }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; threshold: number; swaps: Swap[] }

/**
 * The Suggestions tab's own finds, above EDHREC's: combos the deck is one card away from, and
 * cheaper cards for its priciest ones. Either goes onto Considering through the "Add to…" sheet, as
 * on the phone (nearMissSection and budgetSwapsSection in ui/decks/DeckBuildingUi.kt).
 */
export function DeckSwaps({ deck, cardsById, roleTags, owned = null, onExpand, onMarkCut }: {
  deck: Deck
  /** "Only cards I own": the name keys of the user's binder cards (ownedNameKeys); null shows every alternative. */
  owned?: Set<string> | null
  cardsById: DeckCardData
  roleTags: Map<string, string[]>
  /** Look at a card up close. */
  onExpand: (card: ScryfallCard) => void
  onMarkCut: (entry: DeckCardEntry) => void
}) {
  const money = useMoney()
  const addCardTo = useAddCardTo()
  const combos = useDeckCombos(deck)
  const near = combos ? nearMisses(combos, deck.cards.map((c) => c.name)) : []
  const [state, setState] = useState<SwapState>({ kind: 'idle' })
  // A card (or just a name, from a combo) whose "into the deck or Considering?" sheet is open.
  const [adding, setAdding] = useState<{ name: string; card: ScryfallCard | null } | null>(null)
  const [lookupFailed, setLookupFailed] = useState<string | null>(null)
  const run = useRef(0)

  const findSwaps = async (threshold: number) => {
    if (!cardsById) return
    const id = ++run.current
    setState({ kind: 'loading', threshold })
    try {
      const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)
      const commanderIds = new Set(commanders.map((c) => c.scryfallId))
      const priceOf = (scryfallId: string) => {
        const usd = Number(cardsById.get(scryfallId)?.prices?.usd)
        return Number.isFinite(usd) && usd > 0 ? usd : null
      }
      const candidates = budgetCandidates(deck.cards, priceOf, commanderIds, threshold)
      const identity = swapIdentity(
        commanders.map((c) => cardsById.get(c.scryfallId)?.color_identity ?? []),
        candidates.map((c) => cardsById.get(c.entry.scryfallId)?.color_identity ?? []),
      )
      const have = [...deck.cards, ...(deck.sideboard ?? []), ...(deck.considering ?? [])].map((c) => c.name)
      const swaps: Swap[] = []
      for (const { entry, price } of candidates) {
        const card = cardsById.get(entry.scryfallId)
        const role = budgetRoleOf(tagsOf(roleTags, entry.name))
        const query = budgetSwapQuery({ name: entry.name, price, role, typeLine: card?.type_line ?? entry.typeLine, cmc: card?.cmc, identity, format: deck.gameMode })
        let alternatives: ScryfallCard[] = []
        try {
          alternatives = freshAlternatives((await searchCards(query, 1, 'edhrec')).cards, have)
        } catch {
          // No match (Scryfall answers 404) or a hiccup: this card just shows none.
        }
        swaps.push({ entry, price, role, alternatives })
        await new Promise((r) => setTimeout(r, SCRYFALL_SPACING_MS))
        if (id !== run.current) return
      }
      setState({ kind: 'done', threshold, swaps })
    } catch (e) {
      if (id !== run.current) return
      setState({ kind: 'failed', message: e instanceof Error && /offline/i.test(e.message) ? "You're offline — budget swaps need an internet connection." : "Couldn't look up alternatives." })
    }
  }

  const addByName = async (name: string, place: Parameters<typeof addCardTo>[1]) => {
    setLookupFailed(null)
    try {
      addCardTo(await getByFuzzyName(name), place)
    } catch {
      setLookupFailed(name)
    }
  }

  const selected = state.kind === 'done' || state.kind === 'loading' ? state.threshold : null

  return (
    <div className="rise" style={rise(0)}>
      {combos !== null && (
        <div className="sugg-section panel">
          <div className="p-h"><h3>One card away</h3>{combos && <span className="p-sub">Combos<b>{near.length}</b></span>}</div>
          {combos === undefined ? (
            <div className="dim">Checking Commander Spellbook…</div>
          ) : near.length === 0 ? (
            <div className="dim">No combos are a single card away.</div>
          ) : (
            <ul className="combo-list">
              {near.slice(0, 15).map(({ combo, missing }) => (
                <li key={combo.id}>
                  <a className="combo press" href={comboUrl(combo.id)} target="_blank" rel="noreferrer noopener">
                    <span className="combo-cards">
                      {combo.uses.map((u, i) => (
                        <span key={`${u.card.name}-${i}`} className={missing.includes(u.card.name) ? 'missing' : ''}>
                          {i > 0 && <i> + </i>}{u.card.name}
                        </span>
                      ))}
                    </span>
                    {combo.produces.length > 0 && <span className="combo-results">{combo.produces.slice(0, 2).map((p) => p.feature.name).join(' · ')}</span>}
                  </a>
                  <div className="near-miss-foot">
                    <span>Missing: {missing.join(', ')}</span>
                    <button type="button" className="link-btn" onClick={() => setAdding({ name: missing[0], card: null })}>Add…</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {lookupFailed && <div className="dim" style={{ marginTop: 8 }}>Couldn't find {lookupFailed} on Scryfall.</div>}
        </div>
      )}

      <div className="sugg-section panel">
        <div className="p-h"><h3>Budget swaps</h3></div>
        <div className="dim" style={{ marginBottom: 8 }}>
          Cheaper cards that do the same job, in your colors and legal in this format. Pick a price above which to look:
        </div>
        <div className="chips">
          {BUDGET_THRESHOLDS.map((t) => (
            <PillChip key={t} label={`${money.format(t, true)}+`} selected={selected === t} onClick={() => void findSwaps(t)} />
          ))}
        </div>
        {!cardsById && <div className="dim" style={{ marginTop: 10 }}>Loading card prices…</div>}
        {state.kind === 'loading' && <div className="dim" style={{ marginTop: 10 }}>Looking for cheaper alternatives…</div>}
        {state.kind === 'failed' && <div className="dim" style={{ marginTop: 10 }}>{state.message}</div>}
        {state.kind === 'done' && state.swaps.length === 0 && (
          <div className="dim" style={{ marginTop: 10 }}>No cards in this deck cost {money.format(state.threshold, true)} or more.</div>
        )}
        {state.kind === 'done' && state.swaps.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {state.swaps.map((swap) => {
              const alternatives = shownAlternatives(swap.alternatives, owned)
              const flagged = deck.cards.find((c) => c.scryfallId === swap.entry.scryfallId)?.replaceable
              return (
                <div key={swap.entry.scryfallId} className="budget-swap">
                  <div className="budget-swap-head">
                    <div>
                      <div className="cname">{swap.entry.name}</div>
                      <div className="dim">{money.format(swap.price)}{swap.role ? ` · ${swap.role.label}` : ''}</div>
                    </div>
                    {flagged
                      ? <span className="badge cut">CUT</span>
                      : <button type="button" className="link-btn cut-link" onClick={() => onMarkCut(swap.entry)}>Mark cut</button>}
                  </div>
                  {alternatives.length === 0 ? (
                    <div className="dim" style={{ marginTop: 6 }}>No cheaper alternatives found.</div>
                  ) : (
                    <div className="budget-alts">
                      {alternatives.map((alt) => (
                        <div key={alt.id} className="budget-alt">
                          <img
                            src={displayImageUrl(alt) ?? undefined} alt={alt.name} loading="lazy"
                            data-card-preview={largeImageUrl(alt) ?? undefined} onClick={() => onExpand(alt)}
                          />
                          <span>{money.formatPrice(alt.prices?.usd) ?? '—'}</span>
                          <button type="button" className="link-btn" onClick={() => setAdding({ name: alt.name, card: alt })}>Add…</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {adding && (
        <AddToSheet
          verb="add"
          what={adding.name}
          imageUrl={adding.card ? displayImageUrl(adding.card) : undefined}
          binders={false}
          onlyDeckId={deck.id}
          considering
          sideboard
          printing={adding.card ?? undefined}
          quantity={null}
          onPick={(target) => {
            if (adding.card) addCardTo(adding.card, target)
            else void addByName(adding.name, target)
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  )
}

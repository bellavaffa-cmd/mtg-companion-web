import { useEffect, useMemo, useState } from 'react'
import { commanderInclusion } from '../api/edhrec'
import { useCardData } from '../collection/cardData'
import { cardNameKeys } from '../decks/comboPieces'
import { combosWithCard, nearMisses } from '../decks/considering'
import { gameChangersOf, isLandType } from '../decks/deckAnalysis'
import {
  applyUpgrades, bracketWarning, KEEP_TAGS, loadDismissed, ownedSources, saveDismissed, upgradeSummary, upgradeSwaps,
  type UpgradeDeckCard, type UpgradeOwnedCard, type UpgradeSwap,
} from '../decks/deckUpgrade'
import { isLimited } from '../decks/limited'
import { entryFromCard } from '../decks/newDeck'
import { useMoney } from '../money/currency'
import { useSync } from '../sync/SyncContext'
import { cachedIdentity, tagsOf, useRoleTags } from '../tags/roleTags'
import { GAME_MODES_USING_COMMANDER, type Deck, type GameMode } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import type { DeckCardData } from './DeckStats'
import { Icon } from './Icon'
import { useDeckCombos } from './useDeckCardSearch'
import { useUndoBar } from './useUndoBar'

const usdOf = (card: ScryfallCard | undefined) => {
  const n = Number(card?.prices?.usd)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * "Upgrade with my cards", at the top of a deck's Suggestions: swaps — cut this, add that — where the
 * card coming in is one the user owns, legal here, doing the same job and better for the deck
 * (decks/deckUpgrade.ts). Each can be made now (the cut onto Considering, the new card onto the
 * deck's pull list), considered, or dismissed for this deck; or the ticked ones made together. The
 * phone's upgradeSection in ui/decks/DeckBuildingUi.kt.
 */
export function DeckUpgrade({ deck, cardsById, onExpand }: {
  deck: Deck
  cardsById: DeckCardData
  onExpand: (card: ScryfallCard) => void
}) {
  const { collections, decks, changeDecksAndStorage, addCardsToDeck, recordUndo } = useSync()
  const money = useMoney()
  const showUndo = useUndoBar()
  const combos = useDeckCombos(deck)
  const usesCommander = GAME_MODES_USING_COMMANDER.has(deck.gameMode as GameMode)
  const commanders = [deck.commander, deck.partnerCommander].filter((c) => c != null)

  // Every card owned outside this deck, with the Scryfall data for it (kept in this browser, so offline too).
  const sources = useMemo(() => ownedSources(collections, decks, deck.id), [collections, decks, deck.id])
  const ids = useMemo(
    () => [...new Set([...[...sources.values()].map((s) => s.scryfallId), ...deck.cards.map((c) => c.scryfallId), ...commanders.map((c) => c.scryfallId)])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, deck],
  )
  const known = useCardData(ids)
  const dataOf = (id: string) => cardsById?.get(id) ?? known?.get(id)

  // The colours a card must be inside: the commanders', or with none, the deck's own spells'.
  const identity = useMemo(() => {
    const from = usesCommander ? commanders : deck.cards.filter((c) => !isLandType(c.typeLine))
    if (usesCommander && commanders.length === 0) return null
    const letters = from.map((c) => {
      const known = cachedIdentity(c.name)
      return dataOf(c.scryfallId)?.color_identity ?? (known != null ? [...known] : undefined)
    })
    if (usesCommander && letters.some((l) => l == null)) return undefined
    return [...new Set(letters.flatMap((l) => l ?? []))].join('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, cardsById, known, usesCommander])

  // The owned cards that could go in, before their jobs are known: legal, not lands, in the colours.
  const format = deck.gameMode.toLowerCase()
  const inDeck = useMemo(() => new Set(deck.cards.flatMap((c) => cardNameKeys(c.name))), [deck])
  const candidates = useMemo(() => {
    if (identity === undefined || !known) return []
    return [...sources.values()].flatMap((s) => {
      const card = known.get(s.scryfallId)
      if (!card || isLandType(card.type_line) || cardNameKeys(s.name).some((k) => inDeck.has(k))) return []
      if (!isLimited(deck.gameMode) && card.legalities?.[format] !== 'legal') return []
      if (identity != null && !(card.color_identity ?? []).every((c) => identity.includes(c))) return []
      return [{ source: s, card }]
    })
  }, [sources, known, identity, inDeck, format, deck.gameMode])
  const { tags: ownedTags, loading: tagging } = useRoleTags(useMemo(() => candidates.map((c) => c.source.name), [candidates]))
  const { tags: deckTags } = useRoleTags(useMemo(() => deck.cards.map((c) => c.name), [deck]))

  // EDHREC's numbers for this commander: undefined while asking, null with none (or unreachable).
  const [inclusion, setInclusion] = useState<Map<string, number> | null | undefined>(undefined)
  const [offline, setOffline] = useState(false)
  const commanderName = usesCommander ? deck.commander?.name ?? null : null
  const partnerName = commanderName ? deck.partnerCommander?.name ?? null : null
  useEffect(() => {
    if (!commanderName) { setInclusion(null); return }
    let cancelled = false
    setInclusion(undefined)
    setOffline(false)
    commanderInclusion(commanderName, partnerName)
      .then((m) => { if (!cancelled) setInclusion(m) })
      .catch(() => { if (!cancelled) { setInclusion(null); setOffline(true) } })
    return () => { cancelled = true }
  }, [commanderName, partnerName])

  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissed(deck.id))
  useEffect(() => { setDismissed(loadDismissed(deck.id)) }, [deck.id])

  const swaps: UpgradeSwap[] | null = useMemo(() => {
    if (identity === undefined || !known || inclusion === undefined) return null
    const edhrec = inclusion != null
    const pct = (name: string) => (inclusion ? cardNameKeys(name).map((k) => inclusion.get(k)).find((v) => v != null) ?? null : null)
    const completers = new Set((combos ? nearMisses(combos, deck.cards.map((c) => c.name)) : []).flatMap((n) => n.missing.flatMap(cardNameKeys)))
    const commanderIds = new Set(commanders.map((c) => c.scryfallId))
    const deckSide: UpgradeDeckCard[] = deck.cards.map((e) => {
      const card = dataOf(e.scryfallId)
      return {
        name: e.name, scryfallId: e.scryfallId, typeLine: card?.type_line ?? e.typeLine, cmc: card?.cmc ?? null,
        roles: tagsOf(deckTags, e.name), usd: usdOf(card), gameChanger: !!card?.game_changer, edhrecRank: card?.edhrec_rank ?? null,
        inclusion: pct(e.name), commander: commanderIds.has(e.scryfallId), replaceable: !!e.replaceable,
        keep: (e.userTags ?? []).some((t) => KEEP_TAGS.includes(t.trim().toLowerCase())),
        comboPiece: combos ? combosWithCard(combos.included, e.name).length > 0 : false,
      }
    })
    const ownedSide: UpgradeOwnedCard[] = candidates.map(({ source, card }) => ({
      name: source.name, scryfallId: source.scryfallId, typeLine: card.type_line ?? null, cmc: card.cmc ?? null,
      roles: tagsOf(ownedTags, source.name), usd: usdOf(card), gameChanger: !!card.game_changer, edhrecRank: card.edhrec_rank ?? null,
      inclusion: pct(source.name), identity: (card.color_identity ?? []).join(''), legal: true,
      completesCombo: cardNameKeys(source.name).some((k) => completers.has(k)),
      spare: source.spare, heldBy: source.heldBy, where: source.where, placeKey: source.placeKey,
    }))
    const limited = isLimited(deck.gameMode)
    return upgradeSwaps({
      commander: commanderName,
      identity,
      edhrec,
      bracket: usesCommander && !limited
        ? { gameChangers: gameChangersOf(deck.cards, new Map(deck.cards.flatMap((e) => { const c = dataOf(e.scryfallId); return c ? [[e.scryfallId, c] as const] : [] }))).length, combos: combos?.included.length ?? 0 }
        : null,
      deck: deckSide,
      owned: ownedSide,
      dismissed,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, candidates, ownedTags, deckTags, inclusion, combos, dismissed, identity, known, cardsById])

  const keeping = useMemo(() => swaps?.filter((s) => s.raisesBracketTo == null) ?? [], [swaps])
  const raising = useMemo(() => swaps?.filter((s) => s.raisesBracketTo != null) ?? [], [swaps])
  const [showRaising, setShowRaising] = useState(false)
  // Ticked for "Apply all checked": every swap that keeps the bracket, until the user says otherwise.
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const isTicked = (s: UpgradeSwap) => (s.raisesBracketTo == null ? !unticked.has(s.key) : ticked.has(s.key))
  const toggle = (s: UpgradeSwap) => {
    const flip = (set: Set<string>) => { const next = new Set(set); if (next.has(s.key)) next.delete(s.key); else next.add(s.key); return next }
    if (s.raisesBracketTo == null) setUnticked(flip)
    else setTicked(flip)
  }
  const shown = showRaising ? [...keeping, ...raising] : keeping
  const chosen = shown.filter(isTicked)

  const swapNow = (list: UpgradeSwap[]) => {
    const made = list.flatMap((s) => {
      const card = dataOf(s.add.scryfallId)
      return card ? [{ cutId: s.cut.scryfallId, add: entryFromCard(card, 1), swap: s }] : []
    })
    if (made.length === 0) return
    const undo = recordUndo(() => changeDecksAndStorage((cols, ds) => applyUpgrades(cols, ds, deck.id, made)))
    const one = made[0].swap
    showUndo({
      message: made.length === 1
        ? `${one.add.name} in for ${one.cut.name} — on the pull list${one.add.spare > 0 && one.add.where ? ` (${one.add.where})` : ''}`
        : `${made.length} swaps made — the new cards are on the pull list`,
      undo: undo ?? undefined,
    })
  }
  const consider = (s: UpgradeSwap) => {
    const card = dataOf(s.add.scryfallId)
    if (!card) return
    const undo = recordUndo(() => { addCardsToDeck(deck.id, [card], true) })
    showUndo(undo ? { message: `${s.add.name} added to Considering`, undo } : { message: `${s.add.name} is already in Considering` })
  }
  const dismiss = (s: UpgradeSwap) => {
    const next = [...dismissed, s.key]
    setDismissed(next)
    saveDismissed(deck.id, next)
  }

  const head = <div className="p-h"><h3>Upgrade with my cards</h3>{swaps && <span className="p-sub">Swaps<b>{keeping.length}</b></span>}</div>
  if (deck.cards.length === 0) return null
  if (swaps === null) {
    return (
      <div className="sugg-section panel" id="deck-upgrade">
        {head}
        <div className="dim">{identity === undefined || !known ? 'Looking through your collection…' : 'Asking EDHREC how this commander is played…'}</div>
      </div>
    )
  }
  return (
    <div className="sugg-section panel" id="deck-upgrade">
      {head}
      <div className="dim" style={{ marginBottom: 8 }}>
        Cards you already own that do the same job as one in the deck, better — in your colours, legal here{usesCommander ? ', and keeping the bracket' : ''}.
      </div>
      {inclusion == null && (
        <div className="upgrade-note">
          <Icon name={offline ? 'cloud_off' : 'info'} />
          {commanderName
            ? (offline ? "EDHREC can't be reached — matched by role and EDHREC rank from your collection alone." : `EDHREC has no page for ${commanderName} — matched by role and EDHREC rank.`)
            : 'Matched by role and EDHREC rank.'}
        </div>
      )}
      {tagging && <div className="dim" style={{ marginBottom: 6 }}>Still finding what your cards do ({tagging.done} of {tagging.total})…</div>}
      {keeping.length === 0 && raising.length === 0 ? (
        <div className="dim">Nothing you own beats what this deck runs for the same job.</div>
      ) : (
        <>
          {keeping.length > 0 && <div className="upgrade-summary">{upgradeSummary(keeping, (n) => money.format(n))}</div>}
          {keeping.length === 0 && <div className="dim">Every upgrade you own would raise the deck's bracket.</div>}
          {shown.map((s) => (
            <div key={s.key} className={`budget-swap upgrade-swap${s.raisesBracketTo != null ? ' raises' : ''}`}>
              <label className="upgrade-row">
                <input type="checkbox" checked={isTicked(s)} onChange={() => toggle(s)} aria-label={`Include ${s.cut.name} to ${s.add.name}`} />
                <span className="upgrade-pair">
                  <button type="button" className="link-btn cut-link" onClick={(e) => { e.preventDefault(); const c = dataOf(s.cut.scryfallId); if (c) onExpand(c) }}>{s.cut.name}</button>
                  <Icon name="arrow_forward" />
                  <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); const c = dataOf(s.add.scryfallId); if (c) onExpand(c) }}>{s.add.name}</button>
                </span>
              </label>
              <div className="upgrade-reason">{s.reason}</div>
              <div className="dim upgrade-meta">
                <span><Icon name={s.add.spare > 0 ? 'inventory_2' : 'style'} />{s.where}</span>
                {s.priceDelta != null && <span>{s.priceDelta >= 0 ? '+' : '−'}{money.format(Math.abs(s.priceDelta))}</span>}
                {s.raisesBracketTo != null && <span className="upgrade-warn"><Icon name="warning" />{bracketWarning(s.raisesBracketTo)}</span>}
              </div>
              <div className="upgrade-actions">
                <button type="button" className="btn line sm" onClick={() => swapNow([s])}>Swap now</button>
                <button type="button" className="btn line sm" onClick={() => consider(s)}>Consider</button>
                <button type="button" className="link-btn" onClick={() => dismiss(s)}>Not this one</button>
              </div>
            </div>
          ))}
          <div className="upgrade-foot">
            <button type="button" className="btn sm" disabled={chosen.length === 0} onClick={() => swapNow(chosen)}>
              Apply all checked{chosen.length > 0 ? ` (${chosen.length})` : ''}
            </button>
            {raising.length > 0 && (
              <button type="button" className="link-btn" onClick={() => setShowRaising((v) => !v)}>
                {showRaising ? 'Hide' : 'Show'} {raising.length} that would raise the bracket
              </button>
            )}
            {dismissed.length > 0 && (
              <button type="button" className="link-btn" onClick={() => { setDismissed([]); saveDismissed(deck.id, []) }}>
                Bring back {dismissed.length} dismissed
              </button>
            )}
          </div>
          <div className="dim" style={{ marginTop: 8 }}>
            Swap now puts the cut card on Considering and the new one in the deck, on its pull list until you fetch it. Tag a card “keep” and it's never suggested as a cut.
          </div>
        </>
      )}
    </div>
  )
}


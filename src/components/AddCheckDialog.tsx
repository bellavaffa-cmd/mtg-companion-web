import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'
import { AddCheckContext, type AddCheckCard, type AddCheckDeck, type ConfirmAdd } from './useAddCheck'
import { getCardsByIds } from '../api/scryfall'
import { addCheckText, addProblems } from '../decks/addCheck'
import { formatRules } from '../decks/deckLegality'
import { useSync } from '../sync/SyncContext'
import { normalizeDeck, type Deck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

/** Cards looked up for the check (commanders, mostly), kept for the next add. */
const looked = new Map<string, ScryfallCard>()

/** What the check needs that the caller didn't hand over: the commanders, and any card given only by id. */
async function cardsFor(deck: Deck, cards: AddCheckCard[]): Promise<Map<string, ScryfallCard>> {
  const byId = new Map<string, ScryfallCard>()
  for (const c of cards) if (c.card) byId.set(c.scryfallId, c.card)
  const commanders = formatRules(deck.gameMode).usesCommander ? [deck.commander, deck.partnerCommander] : []
  const wanted = [...cards.map((c) => c.scryfallId), ...commanders.flatMap((c) => (c ? [c.scryfallId] : []))]
  const missing = [...new Set(wanted.filter((id) => !byId.has(id) && !looked.has(id)))]
  if (missing.length > 0) {
    try {
      for (const c of await getCardsByIds(missing)) looked.set(c.id, c)
    } catch {
      // Offline: legality and colours go unchecked; copies are still counted.
    }
  }
  for (const id of wanted) if (!byId.has(id) && looked.has(id)) byId.set(id, looked.get(id)!)
  return byId
}

interface Asking {
  deckName: string
  cards: { name: string; problems: string[] }[]
  answer: (choice: 'all' | 'allowed' | null) => void
}

/** Holds the one add-check confirmation for the whole app, as UndoProvider holds the Undo bar. */
export function AddCheckProvider({ children }: { children: ReactNode }) {
  const { decks } = useSync()
  const latest = useRef(decks)
  useEffect(() => { latest.current = decks }, [decks])
  const [asking, setAsking] = useState<Asking | null>(null)

  const confirm = useCallback<ConfirmAdd>(async <T,>(target: AddCheckDeck, items: T[], describe: (item: T) => AddCheckCard, options?: { copiesOnly?: boolean }) => {
    const deck = latest.current.find((d) => d.id === target.id)
      ?? (target.gameMode ? normalizeDeck({ id: target.id, name: target.name, gameMode: target.gameMode }) : null)
    if (!deck || items.length === 0) return items
    const cards = items.map(describe)
    // One more copy in a singleton deck that's within the limit by name alone needs no lookup: what
    // the lookup could add (a restricted card) allows one copy too, so the "+" isn't kept waiting.
    if (options?.copiesOnly && formatRules(deck.gameMode).singleton) {
      const quick = addProblems(deck, cards, new Map(cards.flatMap((c) => (c.card ? [[c.scryfallId, c.card] as const] : []))), true)
      if (quick.every((p) => p.length === 0)) return items
    }
    const problems = addProblems(deck, cards, await cardsFor(deck, cards), options?.copiesOnly)
    if (problems.every((p) => p.length === 0)) return items
    const choice = await new Promise<'all' | 'allowed' | null>((resolve) => {
      setAsking({ deckName: deck.name, cards: cards.map((c, i) => ({ name: c.name, problems: problems[i] })), answer: resolve })
    })
    setAsking(null)
    if (choice === 'all') return items
    if (choice === 'allowed') return items.filter((_, i) => problems[i].length === 0)
    return null
  }, [])

  return (
    <AddCheckContext.Provider value={confirm}>
      {children}
      {asking && <AddCheckDialog deckName={asking.deckName} cards={asking.cards} onAnswer={asking.answer} />}
    </AddCheckContext.Provider>
  )
}

/**
 * Asked before cards that break the deck's rules go in: one card ("Add anyway" / "Cancel"), or
 * several ("Add all" / "Add only allowed" / "Cancel"). Same words as the Android app's AddCheckDialog.
 */
export function AddCheckDialog({ deckName, cards, onAnswer }: {
  deckName: string
  cards: { name: string; problems: string[] }[]
  onAnswer: (choice: 'all' | 'allowed' | null) => void
}) {
  const { title, lines, single } = addCheckText(deckName, cards)
  const anyAllowed = cards.some((c) => c.problems.length === 0)
  return (
    <Dialog
      title={title}
      onDismiss={() => onAnswer(null)}
      actions={
        <>
          <button type="button" className="btn line" onClick={() => onAnswer(null)}>Cancel</button>
          {!single && anyAllowed && <button type="button" className="btn line" onClick={() => onAnswer('allowed')}>Add only allowed</button>}
          <button type="button" className="btn gold" onClick={() => onAnswer('all')}>{single ? 'Add anyway' : 'Add all'}</button>
        </>
      }
    >
      <ul className="addcheck-list">
        {lines.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </Dialog>
  )
}

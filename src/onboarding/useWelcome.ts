// The welcome flow's state in this browser, and the facts its steps look at, for WelcomePage and
// Home's "Get started" card. Also adds and removes the sample deck and binder. The Android app's
// ui/onboarding/WelcomeStore.kt and WelcomeScreen.kt do the same.

import { useCallback, useMemo, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { useOverview } from '../social/SocialContext'
import { listCommanderPrecons, preconContents } from '../api/mtgjson'
import { getCardsByIds } from '../api/scryfall'
import type { Collection, Deck, DeckCardEntry } from '../types/models'
import { backImageUrl, canBeCommander, cardTags, displayImageUrl, partnerAbility } from '../types/scryfall'
import {
  libraryFacts, parseWelcomeState, pickSamplePrecon, SAMPLE_BINDER_NAME, sampleBinderPicks, sampleDeckName,
  welcomeStateJson, withoutSamples, type WelcomeFacts, type WelcomeState,
} from './onboarding'

const WELCOME_KEY = 'mtgweb_welcome'

export function loadWelcome(): WelcomeState {
  try {
    return parseWelcomeState(localStorage.getItem(WELCOME_KEY))
  } catch {
    return parseWelcomeState(null)
  }
}

export function saveWelcome(state: WelcomeState) {
  try {
    localStorage.setItem(WELCOME_KEY, welcomeStateJson(state))
  } catch {
    // Storage blocked or full: the flow may show again, which is harmless.
  }
}

/** The facts the steps look at, kept current. Loads the social profile when signed in. */
export function useWelcomeFacts(): WelcomeFacts {
  const { decks, collections, account, accountsAvailable } = useSync()
  const { overview } = useOverview()
  const library = useMemo(() => libraryFacts(decks, collections), [decks, collections])
  return { ...library, accountsAvailable, signedIn: !!account, hasProfile: !!overview?.me }
}

/** The welcome state, and a way to change it that's remembered. */
export function useWelcomeState(): [WelcomeState, (change: Partial<WelcomeState>) => void] {
  const [state, setState] = useState(loadWelcome)
  const update = useCallback((change: Partial<WelcomeState>) => {
    const next = { ...loadWelcome(), ...change }
    saveWelcome(next)
    setState(next)
  }, [])
  return [state, update]
}

/**
 * The sample deck and binder: a real precon from MTGJSON (as the precons page imports it), and a dozen
 * of its cards in a binder. Both carry the sample flag, which keeps them off the account.
 */
export async function buildSamples(now = Date.now()): Promise<{ deck: Deck; binder: Collection }> {
  const precon = pickSamplePrecon(await listCommanderPrecons())
  if (!precon) throw new Error("Couldn't find a precon to use. Check your connection and try again.")
  const contents = await preconContents(precon.fileName)
  const all = [...contents.commander, ...contents.cards]
  const ids = [...new Set(all.map((c) => c.scryfallId).filter((id): id is string => !!id))]
  const byId = new Map((await getCardsByIds(ids, true)).map((card) => [card.id, card]))
  const entries: DeckCardEntry[] = []
  for (const line of all) {
    const card = line.scryfallId ? byId.get(line.scryfallId) : undefined
    if (!card || entries.some((e) => e.scryfallId === card.id)) continue
    entries.push({
      scryfallId: card.id, name: card.name, imageUrl: displayImageUrl(card), quantity: line.quantity,
      canBeCommander: canBeCommander(card), typeLine: card.type_line ?? null, partnerAbility: partnerAbility(card),
      backImageUrl: backImageUrl(card), tags: cardTags(card),
    })
  }
  if (entries.length === 0) throw new Error("Couldn't load the sample cards. Check your connection and try again.")
  const commanders = contents.commander
    .map((c) => entries.find((e) => e.scryfallId === c.scryfallId))
    .filter((e): e is DeckCardEntry => !!e)
  const deck: Deck = {
    id: crypto.randomUUID(), name: sampleDeckName(precon.name), commander: commanders[0] ?? null, partnerCommander: commanders[1] ?? null,
    cards: entries, gameMode: 'COMMANDER', createdAt: now, tags: [], gameResults: [],
    // Not counted as cards the user owns.
    ownership: 'VIRTUAL', sample: true,
  }
  const binder: Collection = {
    id: crypto.randomUUID(), name: SAMPLE_BINDER_NAME, createdAt: now, type: 'OWNED', sample: true,
    entries: sampleBinderPicks(entries, commanders.map((c) => c.scryfallId)).map((e) => ({
      scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, quantity: 1, foilQuantity: 0,
      backImageUrl: e.backImageUrl, tags: e.tags,
    })),
  }
  return { deck, binder }
}

/** Adds and removes the samples. [adding] is true while the sample cards are being looked up. */
export function useSamples() {
  const { changeDecksAndStorage } = useSync()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = useCallback(async (): Promise<Deck | null> => {
    setAdding(true)
    setError(null)
    try {
      const { deck, binder } = await buildSamples()
      changeDecksAndStorage((collections, decks) => {
        // One set at a time: adding again replaces the old ones.
        const rest = withoutSamples({ collections, decks })
        return { collections: [...rest.collections, binder], decks: [...rest.decks, deck] }
      })
      return deck
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the samples.")
      return null
    } finally {
      setAdding(false)
    }
  }, [changeDecksAndStorage])
  const remove = useCallback(() => {
    changeDecksAndStorage((collections, decks) => withoutSamples({ collections, decks }))
  }, [changeDecksAndStorage])
  return { add, remove, adding, error }
}

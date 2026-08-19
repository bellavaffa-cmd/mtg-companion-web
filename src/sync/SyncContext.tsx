import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  Collection, CollectionType, Deck, DeckCardEntry, DeckOwnership, GameMode, GameResult, SyncPayload,
} from '../types/models'
import { DECK_OWNERSHIP_DEFAULT, duplicateWarning, normalizeDeck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { backImageUrl, canBeCommander, cardTags, displayImageUrl, partnerAbility } from '../types/scryfall'
import { clearToken, fetchUserEmail, requestAccessToken } from './googleAuth'
import { downloadText, ensureFolder, findBackup, uploadBackup } from './drive'

const LIBRARY_KEY = 'mtgweb_library'
const SYNC_STATE_KEY = 'mtgweb_sync_state'

interface Library {
  decks: Deck[]
  collections: Collection[]
}

interface SyncState {
  lastSyncedRev: number
  lastSyncedAt: number
}

/** Normalizes a whole library's decks — used for both the localStorage cache and Drive pulls, since
 * either can hold decks written before a field existed (older web-app version, or the Android app). */
function normalizeLibrary(lib: { decks?: Deck[]; collections?: Collection[] }): Library {
  return {
    decks: (lib.decks ?? []).map(normalizeDeck),
    collections: lib.collections ?? [],
  }
}

function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (!raw) return { decks: [], collections: [] }
    return normalizeLibrary(JSON.parse(raw))
  } catch {
    return { decks: [], collections: [] }
  }
}

function loadSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY)
    if (!raw) return { lastSyncedRev: 0, lastSyncedAt: 0 }
    return JSON.parse(raw)
  } catch {
    return { lastSyncedRev: 0, lastSyncedAt: 0 }
  }
}

function entryFromCard(card: ScryfallCard, quantity: number): DeckCardEntry {
  return {
    scryfallId: card.id,
    name: card.name,
    imageUrl: displayImageUrl(card),
    quantity,
    canBeCommander: canBeCommander(card),
    typeLine: card.type_line ?? null,
    partnerAbility: partnerAbility(card),
    backImageUrl: backImageUrl(card),
    tags: cardTags(card),
  }
}

interface SyncContextValue {
  decks: Deck[]
  collections: Collection[]
  connected: boolean
  email: string | null
  syncing: boolean
  message: string | null
  lastSyncedAt: number
  localDirty: boolean
  connect: () => Promise<void>
  disconnect: () => void
  syncNow: () => Promise<void>

  createDeck: (name: string, gameMode: GameMode) => Deck
  deleteDeck: (deckId: string) => void
  /** Returns a warning if the resulting copy count breaks the deck's format rules (singleton, max
   * copies) — informational only, the card is added either way. Null if there's no issue. */
  addCardToDeck: (deckId: string, card: ScryfallCard, quantity?: number) => string | null
  removeCardFromDeck: (deckId: string, scryfallId: string) => void
  setCardQuantity: (deckId: string, scryfallId: string, quantity: number) => void
  setCommander: (deckId: string, entry: DeckCardEntry | null) => void
  setPartnerCommander: (deckId: string, entry: DeckCardEntry | null) => void
  setGameMode: (deckId: string, mode: GameMode) => void
  setDeckOwnership: (deckId: string, ownership: DeckOwnership) => void
  setDeckTags: (deckId: string, tags: string[]) => void
  addGameResult: (deckId: string, result: GameResult) => void
  removeGameResult: (deckId: string, resultId: string) => void

  createCollection: (name: string, type: CollectionType) => Collection
  deleteCollection: (collectionId: string) => void
  addEntryToCollection: (collectionId: string, card: ScryfallCard, quantity?: number, foilQuantity?: number) => void
  removeEntryFromCollection: (collectionId: string, scryfallId: string) => void
  setEntryQuantities: (collectionId: string, scryfallId: string, quantity: number, foilQuantity: number) => void
}

const SyncContext = createContext<SyncContextValue | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<Library>(() => loadLibrary())
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const syncStateRef = useRef<SyncState>(loadSyncState())
  const localUpdatedAtRef = useRef<number>(loadSyncState().lastSyncedRev)
  const libraryRef = useRef(library)
  libraryRef.current = library
  const [lastSyncedAt, setLastSyncedAt] = useState(syncStateRef.current.lastSyncedAt)
  const [localDirty, setLocalDirty] = useState(false)
  const pushTimer = useRef<number | undefined>(undefined)

  const persistLibrary = useCallback((lib: Library) => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib))
  }, [])

  const persistSyncState = useCallback((state: SyncState) => {
    syncStateRef.current = state
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state))
  }, [])

  const pushLocal = useCallback(async () => {
    const token = await requestAccessToken()
    const folderId = await ensureFolder(token)
    const remoteId = await findBackup(token, folderId)
    const rev = Date.now()
    const payload: SyncPayload = { decks: libraryRef.current.decks, collections: libraryRef.current.collections, updatedAt: rev }
    await uploadBackup(token, folderId, remoteId, JSON.stringify(payload))
    localUpdatedAtRef.current = rev
    persistSyncState({ lastSyncedRev: rev, lastSyncedAt: rev })
    setLastSyncedAt(rev)
    setLocalDirty(false)
  }, [persistSyncState])

  const schedulePush = useCallback(() => {
    if (!connected) return
    window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => {
      pushLocal().catch((e) => setMessage(e instanceof Error ? e.message : 'Sync failed'))
    }, 1500)
  }, [connected, pushLocal])

  const updateLibrary = useCallback(
    (updater: (lib: Library) => Library) => {
      setLibrary((prev) => {
        const next = updater(prev)
        persistLibrary(next)
        localUpdatedAtRef.current = Date.now()
        setLocalDirty(true)
        return next
      })
      schedulePush()
    },
    [persistLibrary, schedulePush],
  )

  const runSync = useCallback(async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const token = await requestAccessToken()
      const folderId = await ensureFolder(token)
      const remoteId = await findBackup(token, folderId)
      const remoteRaw: SyncPayload | null = remoteId
        ? JSON.parse(await downloadText(token, remoteId))
        : null
      const remote: SyncPayload | null = remoteRaw && { ...remoteRaw, ...normalizeLibrary(remoteRaw) }

      const st = syncStateRef.current
      const localDirtyNow = localUpdatedAtRef.current > st.lastSyncedRev
      const remoteRev = remote?.updatedAt ?? -1
      const remoteDirty = remote !== null && remoteRev !== st.lastSyncedRev

      if (remote === null) {
        await pushLocal()
      } else if (remoteDirty && !localDirtyNow) {
        setLibrary({ decks: remote.decks, collections: remote.collections })
        persistLibrary({ decks: remote.decks, collections: remote.collections })
        localUpdatedAtRef.current = remoteRev
        persistSyncState({ lastSyncedRev: remoteRev, lastSyncedAt: Date.now() })
        setLastSyncedAt(Date.now())
        setLocalDirty(false)
      } else if (localDirtyNow && !remoteDirty) {
        await pushLocal()
      } else if (localDirtyNow && remoteDirty) {
        if (remoteRev > localUpdatedAtRef.current) {
          setLibrary({ decks: remote.decks, collections: remote.collections })
          persistLibrary({ decks: remote.decks, collections: remote.collections })
          localUpdatedAtRef.current = remoteRev
          persistSyncState({ lastSyncedRev: remoteRev, lastSyncedAt: Date.now() })
          setLastSyncedAt(Date.now())
          setLocalDirty(false)
        } else {
          await pushLocal()
        }
      }
      setMessage('Synced')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [persistLibrary, persistSyncState, pushLocal])

  const connect = useCallback(async () => {
    const token = await requestAccessToken()
    const userEmail = await fetchUserEmail(token)
    setConnected(true)
    setEmail(userEmail)
    await runSync()
  }, [runSync])

  const disconnect = useCallback(() => {
    clearToken()
    setConnected(false)
    setEmail(null)
    setMessage('Disconnected.')
  }, [])

  const syncNow = useCallback(async () => {
    if (!connected) {
      await connect()
      return
    }
    await runSync()
  }, [connected, connect, runSync])

  useEffect(() => () => window.clearTimeout(pushTimer.current), [])

  // ---- Deck mutations ----

  const createDeck = useCallback(
    (name: string, gameMode: GameMode): Deck => {
      const deck: Deck = {
        id: crypto.randomUUID(), name, commander: null, partnerCommander: null, cards: [],
        gameMode, createdAt: Date.now(), tags: [], gameResults: [], ownership: DECK_OWNERSHIP_DEFAULT,
      }
      updateLibrary((lib) => ({ ...lib, decks: [...lib.decks, deck] }))
      return deck
    },
    [updateLibrary],
  )

  const deleteDeck = useCallback(
    (deckId: string) => updateLibrary((lib) => ({ ...lib, decks: lib.decks.filter((d) => d.id !== deckId) })),
    [updateLibrary],
  )

  const mapDeck = useCallback(
    (lib: Library, deckId: string, fn: (d: Deck) => Deck): Library => ({
      ...lib,
      decks: lib.decks.map((d) => (d.id === deckId ? fn(d) : d)),
    }),
    [],
  )

  const addCardToDeck = useCallback(
    (deckId: string, card: ScryfallCard, quantity = 1): string | null => {
      // Checked against the deck's currently-loaded state before writing — informational only,
      // the card is added either way (testing/sideboard scenarios are legitimate).
      const deck = library.decks.find((d) => d.id === deckId)
      const warning = deck ? duplicateWarning(deck, card, quantity) : null
      updateLibrary((lib) =>
        mapDeck(lib, deckId, (d) => {
          const existing = d.cards.find((c) => c.scryfallId === card.id)
          const cards = existing
            ? d.cards.map((c) => (c.scryfallId === card.id ? { ...c, quantity: c.quantity + quantity } : c))
            : [...d.cards, entryFromCard(card, quantity)]
          return { ...d, cards }
        }),
      )
      return warning
    },
    [library, updateLibrary, mapDeck],
  )

  const removeCardFromDeck = useCallback(
    (deckId: string, scryfallId: string) => {
      updateLibrary((lib) =>
        mapDeck(lib, deckId, (deck) => ({
          ...deck,
          cards: deck.cards.filter((c) => c.scryfallId !== scryfallId),
          commander: deck.commander?.scryfallId === scryfallId ? null : deck.commander,
          partnerCommander: deck.partnerCommander?.scryfallId === scryfallId ? null : deck.partnerCommander,
        })),
      )
    },
    [updateLibrary, mapDeck],
  )

  const setCardQuantity = useCallback(
    (deckId: string, scryfallId: string, quantity: number) => {
      updateLibrary((lib) =>
        mapDeck(lib, deckId, (deck) => {
          if (quantity <= 0) {
            return {
              ...deck,
              cards: deck.cards.filter((c) => c.scryfallId !== scryfallId),
              commander: deck.commander?.scryfallId === scryfallId ? null : deck.commander,
              partnerCommander: deck.partnerCommander?.scryfallId === scryfallId ? null : deck.partnerCommander,
            }
          }
          return { ...deck, cards: deck.cards.map((c) => (c.scryfallId === scryfallId ? { ...c, quantity } : c)) }
        }),
      )
    },
    [updateLibrary, mapDeck],
  )

  const setCommander = useCallback(
    (deckId: string, entry: DeckCardEntry | null) => {
      updateLibrary((lib) =>
        mapDeck(lib, deckId, (deck) => {
          // Clearing the commander drops the partner too; setting a new one drops an existing
          // partner if it no longer has a valid Partner pairing with it.
          let partnerCommander = deck.partnerCommander
          if (entry === null) {
            partnerCommander = null
          } else if (partnerCommander !== null && !partnersMatch(entry, partnerCommander)) {
            partnerCommander = null
          }
          return { ...deck, commander: entry, partnerCommander }
        }),
      )
    },
    [updateLibrary, mapDeck],
  )

  const setPartnerCommander = useCallback(
    (deckId: string, entry: DeckCardEntry | null) => {
      updateLibrary((lib) => mapDeck(lib, deckId, (deck) => ({ ...deck, partnerCommander: entry })))
    },
    [updateLibrary, mapDeck],
  )

  const setGameMode = useCallback(
    (deckId: string, mode: GameMode) => {
      updateLibrary((lib) => mapDeck(lib, deckId, (deck) => ({ ...deck, gameMode: mode })))
    },
    [updateLibrary, mapDeck],
  )

  const setDeckOwnership = useCallback(
    (deckId: string, ownership: DeckOwnership) => {
      updateLibrary((lib) => mapDeck(lib, deckId, (deck) => ({ ...deck, ownership })))
    },
    [updateLibrary, mapDeck],
  )

  const setDeckTags = useCallback(
    (deckId: string, tags: string[]) => {
      updateLibrary((lib) => mapDeck(lib, deckId, (deck) => ({ ...deck, tags })))
    },
    [updateLibrary, mapDeck],
  )

  const addGameResult = useCallback(
    (deckId: string, result: GameResult) => {
      updateLibrary((lib) => mapDeck(lib, deckId, (deck) => ({ ...deck, gameResults: [...deck.gameResults, result] })))
    },
    [updateLibrary, mapDeck],
  )

  const removeGameResult = useCallback(
    (deckId: string, resultId: string) => {
      updateLibrary((lib) =>
        mapDeck(lib, deckId, (deck) => ({ ...deck, gameResults: deck.gameResults.filter((r) => r.id !== resultId) })),
      )
    },
    [updateLibrary, mapDeck],
  )

  // ---- Collection mutations ----

  const mapCollection = useCallback(
    (lib: Library, collectionId: string, fn: (c: Collection) => Collection): Library => ({
      ...lib,
      collections: lib.collections.map((c) => (c.id === collectionId ? fn(c) : c)),
    }),
    [],
  )

  const createCollection = useCallback(
    (name: string, type: CollectionType): Collection => {
      const collection: Collection = { id: crypto.randomUUID(), name, entries: [], createdAt: Date.now(), type }
      updateLibrary((lib) => ({ ...lib, collections: [...lib.collections, collection] }))
      return collection
    },
    [updateLibrary],
  )

  const deleteCollection = useCallback(
    (collectionId: string) =>
      updateLibrary((lib) => ({ ...lib, collections: lib.collections.filter((c) => c.id !== collectionId) })),
    [updateLibrary],
  )

  const addEntryToCollection = useCallback(
    (collectionId: string, card: ScryfallCard, quantity = 1, foilQuantity = 0) => {
      updateLibrary((lib) =>
        mapCollection(lib, collectionId, (collection) => {
          const existing = collection.entries.find((e) => e.scryfallId === card.id)
          const entries = existing
            ? collection.entries.map((e) =>
                e.scryfallId === card.id
                  ? { ...e, quantity: e.quantity + quantity, foilQuantity: e.foilQuantity + foilQuantity }
                  : e,
              )
            : [
                ...collection.entries,
                {
                  scryfallId: card.id,
                  name: card.name,
                  imageUrl: displayImageUrl(card),
                  quantity,
                  foilQuantity,
                  backImageUrl: backImageUrl(card),
                  tags: cardTags(card),
                },
              ]
          return { ...collection, entries }
        }),
      )
    },
    [updateLibrary, mapCollection],
  )

  const removeEntryFromCollection = useCallback(
    (collectionId: string, scryfallId: string) => {
      updateLibrary((lib) =>
        mapCollection(lib, collectionId, (collection) => ({
          ...collection,
          entries: collection.entries.filter((e) => e.scryfallId !== scryfallId),
        })),
      )
    },
    [updateLibrary, mapCollection],
  )

  const setEntryQuantities = useCallback(
    (collectionId: string, scryfallId: string, quantity: number, foilQuantity: number) => {
      updateLibrary((lib) =>
        mapCollection(lib, collectionId, (collection) => {
          if (quantity <= 0 && foilQuantity <= 0) {
            return { ...collection, entries: collection.entries.filter((e) => e.scryfallId !== scryfallId) }
          }
          return {
            ...collection,
            entries: collection.entries.map((e) => (e.scryfallId === scryfallId ? { ...e, quantity, foilQuantity } : e)),
          }
        }),
      )
    },
    [updateLibrary, mapCollection],
  )

  const value = useMemo<SyncContextValue>(
    () => ({
      decks: library.decks,
      collections: library.collections,
      connected,
      email,
      syncing,
      message,
      lastSyncedAt,
      localDirty,
      connect,
      disconnect,
      syncNow,
      createDeck,
      deleteDeck,
      addCardToDeck,
      removeCardFromDeck,
      setCardQuantity,
      setCommander,
      setPartnerCommander,
      setGameMode,
      setDeckOwnership,
      setDeckTags,
      addGameResult,
      removeGameResult,
      createCollection,
      deleteCollection,
      addEntryToCollection,
      removeEntryFromCollection,
      setEntryQuantities,
    }),
    [
      library, connected, email, syncing, message, lastSyncedAt, localDirty, connect, disconnect, syncNow,
      createDeck, deleteDeck, addCardToDeck, removeCardFromDeck, setCardQuantity, setCommander,
      setPartnerCommander, setGameMode, setDeckOwnership, setDeckTags, addGameResult, removeGameResult,
      createCollection, deleteCollection, addEntryToCollection, removeEntryFromCollection, setEntryQuantities,
    ],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

/** Whether [a] and [b] can legally be co-commanders under the Partner mechanic. */
function partnersMatch(a: DeckCardEntry, b: DeckCardEntry): boolean {
  if (!a.partnerAbility || !b.partnerAbility) return false
  if (a.partnerAbility === 'Partner' && b.partnerAbility === 'Partner') return true
  if (a.partnerAbility.toLowerCase() === b.name.toLowerCase()) return true
  if (b.partnerAbility.toLowerCase() === a.name.toLowerCase()) return true
  return false
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used within a SyncProvider')
  return ctx
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  Collection, CollectionType, Deck, DeckCardEntry, DeckOwnership, GameMode, GameResult,
} from '../types/models'
import { DECK_OWNERSHIP_DEFAULT, duplicateWarning, normalizeDeck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { backImageUrl, canBeCommander, cardTags, displayImageUrl, partnerAbility } from '../types/scryfall'
import * as auth from './supabaseAuth'
import type { Account } from './supabaseAuth'
import type { Library } from './cloudSync'
import { applyRemoteChanges, clearCloudState, loadCloudState, recordLocalEdits, syncOnce, UnauthorizedError } from './cloudSync'

/** What a user-requested sync ended with. */
export type RefreshResult =
  | { kind: 'ok'; pulled: number; pushed: number }
  | { kind: 'failed'; message: string; offline?: boolean }
  | { kind: 'signed-out' }

/** How often an open, visible tab checks for other devices' edits. */
const POLL_INTERVAL_MS = 20_000
/** Switching back to the tab checks at once, unless a check ran moments ago. */
const RETURN_SYNC_GAP_MS = 5_000

const LIBRARY_KEY = 'mtgweb_library'
/** Where "Use my account's library" keeps this browser's old library, just in case. */
const LIBRARY_BACKUP_KEY = 'mtgweb_library_before_account'
/** Leftover from the retired Google Drive sync. */
const OLD_DRIVE_SYNC_KEY = 'mtgweb_sync_state'

/** Normalizes a whole library's decks, since stored JSON can predate a field (older web app or Android). */
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

export interface CloudStatus {
  syncing: boolean
  lastSyncedAt: number
  message: string | null
  failed: boolean
}

interface SyncContextValue {
  decks: Deck[]
  collections: Collection[]

  /** False when this build has no Supabase project configured. */
  accountsAvailable: boolean
  account: Account | null
  cloud: CloudStatus
  /** Set when an account is signed in for the first time in a browser that already has decks/binders. */
  mergePrompt: { decks: number; collections: number; email: string } | null
  resolveMerge: (choice: 'add' | 'replace') => void
  /** True after a password-reset link signed the user in: ask for a new password. */
  passwordRecovery: boolean
  dismissPasswordRecovery: () => void
  /** A one-off message from opening an account email link. */
  linkNotice: string | null
  dismissLinkNotice: () => void
  signIn: (email: string, password: string) => Promise<void>
  /** Resolves true when signed in right away, false when a confirmation email was sent. */
  signUp: (email: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
  syncNow: () => Promise<void>
  /** A sync the user asked for (pull to refresh), resolving with how it went. */
  refresh: () => Promise<RefreshResult>
  resendConfirmation: (email: string) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>

  createDeck: (name: string, gameMode: GameMode) => Deck
  /** Creates a Commander deck already holding [cards] — importing a precon. */
  createDeckWithCards: (name: string, cards: DeckCardEntry[], commander?: DeckCardEntry | null, partnerCommander?: DeckCardEntry | null) => Deck
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

const IDLE: CloudStatus = { syncing: false, lastSyncedAt: 0, message: null, failed: false }

let authLink: Promise<auth.LinkResult | null> | null = null

export function SyncProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<Library>(() => loadLibrary())
  const libraryRef = useRef(library)
  libraryRef.current = library

  const [account, setAccount] = useState<Account | null>(() => (auth.supabaseConfigured ? auth.currentAccount() : null))
  const accountRef = useRef(account)
  const [cloud, setCloud] = useState<CloudStatus>(() => ({ ...IDLE, lastSyncedAt: loadCloudState().lastSyncedAt }))
  const [mergePrompt, setMergePrompt] = useState<SyncContextValue['mergePrompt']>(null)
  const mergePending = useRef(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [linkNotice, setLinkNotice] = useState<string | null>(null)
  const syncTimer = useRef<number | undefined>(undefined)
  const syncChain = useRef<Promise<void>>(Promise.resolve())
  const lastAutoSync = useRef(0)
  const syncBusy = useRef(false)

  const persistLibrary = useCallback((lib: Library) => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib))
  }, [])

  const setSignedOut = useCallback(() => {
    accountRef.current = null
    setAccount(null)
    setMergePrompt(null)
    mergePending.current = false
  }, [])

  /**
   * One sync pass, queued behind any pass already running. A [quiet] pass — the background check
   * for other devices' edits — skips if one is already under way and doesn't flash the syncing state.
   */
  const runSync = useCallback((quiet = false, onResult?: (r: RefreshResult) => void): Promise<void> => {
    if (quiet && syncBusy.current) return syncChain.current
    syncBusy.current = true
    const pass = syncChain.current.then(async () => {
      const acct = accountRef.current
      if (!acct) return onResult?.({ kind: 'signed-out' })
      if (mergePending.current) return onResult?.({ kind: 'failed', message: 'Choose how to combine this browser’s library first' })
      if (!quiet) setCloud((c) => ({ ...c, syncing: true, message: null, failed: false }))
      try {
        recordLocalEdits(libraryRef.current, acct.userId)
        const token = await auth.accessToken()
        if (!token) {
          setSignedOut()
          throw new auth.AuthError('Signed out — sign in again to sync.')
        }
        const snapshot = libraryRef.current
        let outcome
        try {
          outcome = await syncOnce(snapshot, loadCloudState(), acct.userId, token)
        } catch (e) {
          if (!(e instanceof UnauthorizedError)) throw e
          // The access token was refused: refresh the session once and try again.
          auth.invalidateAccessToken()
          const fresh = await auth.accessToken()
          if (!fresh) {
            setSignedOut()
            throw new auth.AuthError('Signed out — sign in again to sync.')
          }
          outcome = await syncOnce(snapshot, loadCloudState(), acct.userId, fresh)
        }
        const { state, remoteChanges, pushed } = outcome
        if (remoteChanges.size > 0) {
          setLibrary((live) => {
            const next = applyRemoteChanges(live, snapshot, remoteChanges)
            persistLibrary(next)
            libraryRef.current = next
            return next
          })
        }
        setCloud({ syncing: false, lastSyncedAt: state.lastSyncedAt, message: null, failed: false })
        onResult?.({ kind: 'ok', pulled: remoteChanges.size, pushed })
      } catch (e) {
        // The server no longer accepts this session (revoked, or the account was deleted): sign this
        // browser out so the panel offers sign-in again. Local decks and binders stay.
        // Only a session the server has dropped signs this browser out (accessToken() cleared it).
        if (e instanceof auth.AuthError && !auth.currentAccount()) {
          setSignedOut()
        }
        const message = e instanceof auth.ServerBusyError ? e.message
          : e instanceof auth.OfflineError ? "Offline — will sync when you're back online."
          : e instanceof Error ? e.message : 'Sync failed'
        setCloud((c) => ({ ...c, syncing: false, failed: true, message }))
        onResult?.(e instanceof auth.AuthError && !auth.currentAccount()
          ? { kind: 'signed-out' }
          : { kind: 'failed', message, offline: e instanceof auth.OfflineError && !(e instanceof auth.ServerBusyError) })
      }
    }).finally(() => { syncBusy.current = false })
    syncChain.current = pass.catch(() => {})
    return pass
  }, [persistLibrary, setSignedOut])

  const scheduleSync = useCallback(() => {
    if (!accountRef.current || mergePending.current) return
    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => { void runSync() }, 2000)
  }, [runSync])

  /** After any sign-in: ask what to do with this browser's library the first time, otherwise sync. */
  const startAccount = useCallback((acct: Account) => {
    accountRef.current = acct
    setAccount(acct)
    const lib = libraryRef.current
    if (loadCloudState().userId !== acct.userId && (lib.decks.length > 0 || lib.collections.length > 0)) {
      mergePending.current = true
      setMergePrompt({ decks: lib.decks.length, collections: lib.collections.length, email: acct.email })
      return
    }
    void runSync()
  }, [runSync])

  const resolveMerge = useCallback((choice: 'add' | 'replace') => {
    if (choice === 'replace') {
      localStorage.setItem(LIBRARY_BACKUP_KEY, JSON.stringify(libraryRef.current))
      const empty: Library = { decks: [], collections: [] }
      libraryRef.current = empty
      setLibrary(empty)
      persistLibrary(empty)
      clearCloudState()
    }
    mergePending.current = false
    setMergePrompt(null)
    void runSync()
  }, [persistLibrary, runSync])

  // On load: finish an account email link if one opened the page, otherwise resume a saved session.
  useEffect(() => {
    localStorage.removeItem(OLD_DRIVE_SYNC_KEY)
    if (!auth.supabaseConfigured) return
    let cancelled = false
    // Shared promise: the link can only be read once (it's cleared from the URL), but effects may run
    // twice (StrictMode) and the second run still needs the result.
    authLink ??= auth.consumeAuthLink()
    void authLink.then((result) => {
      if (cancelled) return
      if (result?.kind === 'error') setLinkNotice(result.message)
      if (result?.kind === 'signed-in') {
        if (result.recovery) setPasswordRecovery(true)
        else setLinkNotice(`Email confirmed — signed in as ${result.account.email}.`)
        startAccount(result.account)
      } else if (accountRef.current) {
        startAccount(accountRef.current)
      }
    })
    return () => { cancelled = true }
  }, [startAccount])

  // Coming back to the tab (or back online) is when another device's edits are most likely waiting;
  // while the tab stays open and visible, check for them every so often too.
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || !accountRef.current) return
      if (Date.now() - lastAutoSync.current < RETURN_SYNC_GAP_MS) return
      lastAutoSync.current = Date.now()
      void runSync(true)
    }
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !accountRef.current || !navigator.onLine) return
      lastAutoSync.current = Date.now()
      void runSync(true)
    }, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('online', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('online', onReturn)
      window.removeEventListener('focus', onReturn)
      window.clearTimeout(syncTimer.current)
    }
  }, [runSync])

  const updateLibrary = useCallback(
    (updater: (lib: Library) => Library) => {
      setLibrary((prev) => {
        const next = updater(prev)
        persistLibrary(next)
        return next
      })
      scheduleSync()
    },
    [persistLibrary, scheduleSync],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    startAccount(await auth.signIn(email, password))
  }, [startAccount])

  const signUp = useCallback(async (email: string, password: string) => {
    const acct = await auth.signUp(email, password)
    if (acct) startAccount(acct)
    return acct !== null
  }, [startAccount])

  const signOut = useCallback(async () => {
    await syncChain.current
    await auth.signOut()
    clearCloudState()
    setSignedOut()
    setCloud(IDLE)
    setPasswordRecovery(false)
  }, [setSignedOut])

  const syncNow = useCallback(() => runSync(), [runSync])

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    if (!accountRef.current) return { kind: 'signed-out' }
    let result: RefreshResult = { kind: 'ok', pulled: 0, pushed: 0 }
    await runSync(false, (r) => { result = r })
    return result
  }, [runSync])

  const updatePassword = useCallback(async (password: string) => {
    await auth.updatePassword(password)
    setPasswordRecovery(false)
  }, [])

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

  const createDeckWithCards = useCallback(
    (name: string, cards: DeckCardEntry[], commander: DeckCardEntry | null = null, partnerCommander: DeckCardEntry | null = null): Deck => {
      const deck: Deck = {
        id: crypto.randomUUID(), name, commander, partnerCommander, cards,
        gameMode: 'COMMANDER', createdAt: Date.now(), tags: [], gameResults: [], ownership: DECK_OWNERSHIP_DEFAULT,
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
      accountsAvailable: auth.supabaseConfigured,
      account,
      cloud,
      mergePrompt,
      resolveMerge,
      passwordRecovery,
      dismissPasswordRecovery: () => setPasswordRecovery(false),
      linkNotice,
      dismissLinkNotice: () => setLinkNotice(null),
      signIn,
      signUp,
      signOut,
      syncNow,
      refresh,
      resendConfirmation: auth.resendConfirmation,
      sendPasswordReset: auth.sendPasswordReset,
      updatePassword,
      createDeck,
      createDeckWithCards,
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
      library, account, cloud, mergePrompt, resolveMerge, passwordRecovery, linkNotice, signIn, signUp, signOut,
      syncNow, refresh, updatePassword, createDeck, createDeckWithCards, deleteDeck, addCardToDeck, removeCardFromDeck, setCardQuantity,
      setCommander, setPartnerCommander, setGameMode, setDeckOwnership, setDeckTags, addGameResult,
      removeGameResult, createCollection, deleteCollection, addEntryToCollection, removeEntryFromCollection,
      setEntryQuantities,
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

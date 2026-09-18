import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  Collection, CollectionType, Deck, DeckCardEntry, DeckOwnership, GameMode, GameResult,
} from '../types/models'
import { DECK_OWNERSHIP_DEFAULT, duplicateWarning, normalizeDeck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { backImageUrl, canBeCommander, cardTags, displayImageUrl, partnerAbility } from '../types/scryfall'
import * as auth from './supabaseAuth'
import { watchLibrary } from './realtime'
import type { Account } from './supabaseAuth'
import type { Library } from './cloudSync'
import { applyCollectionChanges, type CollectionChange } from '../social/tradeLogic'
import {
  applyRemoteChanges, applyRescue, captureRescue, clearCloudState, clearRescue, CLOUD_STATE_KEY, leftoverFromSignOut,
  libraryIsAnotherAccounts, loadCloudState, loadRescue, pullChanges, pushPending, recordLocalEdits, RESCUE_MAX_AGE_MS,
  saveCloudState, saveRescue, UnauthorizedError,
} from './cloudSync'

/** What a user-requested sync ended with. */
export type RefreshResult =
  | { kind: 'ok'; pulled: number; pushed: number }
  | { kind: 'failed'; message: string; offline?: boolean }
  | { kind: 'signed-out' }

/** How often an open, visible tab checks for other devices' edits. */
const POLL_INTERVAL_MS = 15_000
/** While live updates are coming in (realtime.ts), a check this often is enough as a backup. */
const LIVE_POLL_INTERVAL_MS = 60_000
/** Several saves in quick succession (a whole push from another device) make one sync. */
const LIVE_CHANGE_DELAY_MS = 400
/** How soon after an edit it's sent: soon, so little is ever unsynced if the session ends. */
const EDIT_SYNC_DELAY_MS = 1_000
/** Where the deck page remembers the last deck opened (components/Layout.tsx). */
const LAST_DECK_KEY = 'mtgweb_last_deck'
/**
 * Set (to the account's id) while "this browser already has a library" waits for an answer. Kept in
 * localStorage so every tab knows: none of them may sync that library into the account, or wipe it
 * on signing out — it's the browser's own, not the account's.
 */
const MERGE_PENDING_KEY = 'mtgweb_merge_pending'
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

function loadLibrary(raw = localStorage.getItem(LIBRARY_KEY)): Library {
  try {
    if (!raw) return { decks: [], collections: [] }
    return normalizeLibrary(JSON.parse(raw))
  } catch {
    return { decks: [], collections: [] }
  }
}

/**
 * Runs [fn] while no other tab of this app is syncing. Tabs share the sync bookkeeping and the
 * session, so two passes at once would each push what the other just pulled.
 */
function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  return 'locks' in navigator ? navigator.locks.request('mtgweb-sync', fn) : fn()
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
  /**
   * Syncs, then signs out and removes this account's decks and binders from this browser. If some
   * changes couldn't be synced first, it stops and says how many — pass [force] to go ahead anyway.
   */
  signOut: (force?: boolean) => Promise<{ unsynced: number }>
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
  /** Moves cards in and out of binders in one change (a trade); answers the ones there weren't enough copies of. */
  changeCollections: (changes: CollectionChange[]) => CollectionChange[]
}

const SyncContext = createContext<SyncContextValue | null>(null)

const IDLE: CloudStatus = { syncing: false, lastSyncedAt: 0, message: null, failed: false }

let authLink: Promise<auth.LinkResult | null> | null = null

export function SyncProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<Library>(() => loadLibrary())
  // The library as of the latest change, updated synchronously (React state catches up on the next
  // render), so a sync pass never starts from a copy that's missing an edit.
  const libraryRef = useRef(library)
  // The stored library this tab last wrote or read. When localStorage holds something else, another
  // tab changed it.
  const storedLibrary = useRef<string | null>(localStorage.getItem(LIBRARY_KEY))

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
  /** Whether live updates are connected (realtime.ts). */
  const liveSync = useRef(false)
  /** Passes started and not yet finished, including ones queued behind another. */
  const syncQueue = useRef(0)

  const persistLibrary = useCallback((lib: Library) => {
    const raw = JSON.stringify(lib)
    localStorage.setItem(LIBRARY_KEY, raw)
    storedLibrary.current = raw
  }, [])

  /** Every change to the library goes through here. */
  const commitLibrary = useCallback((next: Library) => {
    libraryRef.current = next
    persistLibrary(next)
    setLibrary(next)
  }, [persistLibrary])

  /** Picks up the library another tab saved, so this one doesn't write an old copy over it. */
  const adoptStoredLibrary = useCallback(() => {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (raw === storedLibrary.current) return
    storedLibrary.current = raw
    const lib = loadLibrary(raw)
    libraryRef.current = lib
    setLibrary(lib)
  }, [])

  /**
   * Signed out, however it happened (the button, an expired session, another tab): this account's
   * decks and binders leave this browser. They're in the account, and come back on signing in.
   * Not when the sign-in never got past "this browser already has a library": that library is the
   * browser's own, never synced, so it stays.
   */
  const setSignedOut = useCallback((keepUnsynced = false) => {
    const libraryIsAccounts = !mergePending.current && localStorage.getItem(MERGE_PENDING_KEY) === null
    // The session ended on its own (the server refused it): edits that hadn't synced yet are kept,
    // out of sight, and put back if the same account signs in again (see applyRescue).
    if (keepUnsynced && libraryIsAccounts && accountRef.current) {
      const rescue = captureRescue(libraryRef.current, loadCloudState(), accountRef.current.userId, Date.now())
      if (rescue) saveRescue(rescue)
    }
    localStorage.removeItem(MERGE_PENDING_KEY)
    window.clearTimeout(syncTimer.current)
    accountRef.current = null
    setAccount(null)
    setMergePrompt(null)
    mergePending.current = false
    clearCloudState()
    if (libraryIsAccounts) {
      commitLibrary({ decks: [], collections: [] })
      localStorage.removeItem(LAST_DECK_KEY)
    }
  }, [commitLibrary])

  /**
   * One sync pass, queued behind any pass already running. A [quiet] pass — the background check
   * for other devices' edits — skips if one is already under way and doesn't flash the syncing state.
   */
  const runSync = useCallback((quiet = false, onResult?: (r: RefreshResult) => void): Promise<void> => {
    if (quiet && syncQueue.current > 0) return syncChain.current
    syncQueue.current++
    const pass = syncChain.current.then(() => withSyncLock(async () => {
      const acct = accountRef.current
      if (!acct) return onResult?.({ kind: 'signed-out' })
      if (mergePending.current || localStorage.getItem(MERGE_PENDING_KEY) !== null) {
        return onResult?.({ kind: 'failed', message: 'Choose how to combine this browser’s library first' })
      }
      // Another tab signed out or into a different account: this one follows it rather than syncing
      // one account's library into the other.
      if (auth.currentAccount()?.userId !== acct.userId) {
        // The session ended elsewhere (another tab, or a token refresh the server refused).
        if (!auth.currentAccount()) setSignedOut(true)
        return onResult?.({ kind: 'signed-out' })
      }
      if (!quiet) setCloud((c) => ({ ...c, syncing: true, message: null, failed: false }))
      try {
        adoptStoredLibrary()
        recordLocalEdits(libraryRef.current, acct.userId)
        let token = await auth.accessToken()
        if (!token) {
          setSignedOut(true)
          throw new auth.AuthError('Signed out — sign in again to sync.')
        }
        // A request whose access token is refused refreshes the session once and tries again.
        const authed = async <T,>(call: (t: string) => Promise<T>): Promise<T> => {
          try {
            return await call(token!)
          } catch (e) {
            if (!(e instanceof UnauthorizedError)) throw e
            auth.invalidateAccessToken()
            token = await auth.accessToken()
            if (!token) {
              setSignedOut(true)
              throw new auth.AuthError('Signed out — sign in again to sync.')
            }
            return await call(token)
          }
        }
        // Signed out while this pass was waiting on the network: its library is gone, and it must not
        // save anything — sync bookkeeping written after the wipe would read the empty library as
        // "everything deleted" on the next sign-in.
        const signedOutMeanwhile = () => accountRef.current?.userId !== acct.userId
        const snapshot = libraryRef.current
        const pulled = await authed((t) => pullChanges(snapshot, loadCloudState(), acct.userId, t))
        if (signedOutMeanwhile()) return onResult?.({ kind: 'signed-out' })
        // Take in what was pulled before pushing, so a push that fails can't lose it: the next pass
        // would find the cursor past those rows and push this browser's old copies over them.
        if (pulled.remoteChanges.size > 0) {
          adoptStoredLibrary()
          commitLibrary(applyRemoteChanges(libraryRef.current, snapshot, pulled.remoteChanges))
        }
        saveCloudState(pulled.state)
        const { state, pushed } = await authed((t) => pushPending(pulled, t))
        if (signedOutMeanwhile()) return onResult?.({ kind: 'signed-out' })
        saveCloudState(state)
        // Signed back in after the session ended on its own: put back the edits that hadn't synced,
        // merged with the account's library as it is now, and send them.
        const rescue = loadRescue()
        if (rescue) {
          clearRescue()
          if (rescue.userId === acct.userId && Date.now() - rescue.savedAt < RESCUE_MAX_AGE_MS) {
            commitLibrary(applyRescue(libraryRef.current, rescue))
            syncTimer.current = window.setTimeout(() => { void runSync(true) }, 0)
          }
        }
        setCloud({ syncing: false, lastSyncedAt: state.lastSyncedAt, message: null, failed: false })
        onResult?.({ kind: 'ok', pulled: pulled.remoteChanges.size, pushed })
      } catch (e) {
        // The server no longer accepts this session (revoked, or the account was deleted): sign this
        // browser out so the panel offers sign-in again.
        // Only a session the server has dropped signs this browser out (accessToken() cleared it).
        if (e instanceof auth.AuthError && !auth.currentAccount()) {
          setSignedOut(true)
        }
        const message = e instanceof auth.ServerBusyError ? e.message
          : e instanceof auth.OfflineError ? "Offline — will sync when you're back online."
          : e instanceof Error ? e.message : 'Sync failed'
        setCloud((c) => ({ ...c, syncing: false, failed: true, message }))
        onResult?.(e instanceof auth.AuthError && !auth.currentAccount()
          ? { kind: 'signed-out' }
          : { kind: 'failed', message, offline: e instanceof auth.OfflineError && !(e instanceof auth.ServerBusyError) })
      }
    })).finally(() => { syncQueue.current-- })
    syncChain.current = pass.catch(() => {})
    return pass
  }, [adoptStoredLibrary, commitLibrary, setSignedOut])

  const scheduleSync = useCallback(() => {
    if (!accountRef.current || mergePending.current) return
    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => { void runSync() }, EDIT_SYNC_DELAY_MS)
  }, [runSync])

  /** After any sign-in: ask what to do with this browser's library the first time, otherwise sync. */
  const startAccount = useCallback((acct: Account) => {
    // This browser still holds another account's library (an email link signed straight into a
    // different account, say): it's that account's, so it goes — never offered to this one.
    const prior = loadCloudState().userId
    // Edits kept from another account's session never go to this one.
    if (loadRescue()?.userId !== undefined && loadRescue()?.userId !== acct.userId) clearRescue()
    if (libraryIsAnotherAccounts(prior, acct.userId)) {
      clearCloudState()
      commitLibrary({ decks: [], collections: [] })
      localStorage.removeItem(LAST_DECK_KEY)
      localStorage.removeItem(MERGE_PENDING_KEY)
    }
    accountRef.current = acct
    setAccount(acct)
    const lib = libraryRef.current
    if (loadCloudState().userId !== acct.userId && (lib.decks.length > 0 || lib.collections.length > 0)) {
      mergePending.current = true
      localStorage.setItem(MERGE_PENDING_KEY, acct.userId)
      setMergePrompt({ decks: lib.decks.length, collections: lib.collections.length, email: acct.email })
      return
    }
    void runSync()
  }, [commitLibrary, runSync])

  const resolveMerge = useCallback((choice: 'add' | 'replace') => {
    if (choice === 'replace') {
      localStorage.setItem(LIBRARY_BACKUP_KEY, JSON.stringify(libraryRef.current))
      commitLibrary({ decks: [], collections: [] })
      clearCloudState()
    }
    mergePending.current = false
    localStorage.removeItem(MERGE_PENDING_KEY)
    setMergePrompt(null)
    void runSync()
  }, [commitLibrary, runSync])

  // On load: finish an account email link if one opened the page, otherwise resume a saved session.
  useEffect(() => {
    localStorage.removeItem(OLD_DRIVE_SYNC_KEY)
    if (!auth.supabaseConfigured) return
    // A sign-out that didn't finish (the tab closed between ending the session and removing the
    // library): no one is signed in, yet the library is an account's. Finish removing it.
    if (!auth.currentAccount()) {
      if (leftoverFromSignOut(false, loadCloudState().userId, localStorage.getItem(MERGE_PENDING_KEY) !== null)) {
        clearCloudState()
        commitLibrary({ decks: [], collections: [] })
        localStorage.removeItem(LAST_DECK_KEY)
      }
      localStorage.removeItem(MERGE_PENDING_KEY)
    }
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
  }, [commitLibrary, startAccount])

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
      if (liveSync.current && Date.now() - lastAutoSync.current < LIVE_POLL_INTERVAL_MS) return
      lastAutoSync.current = Date.now()
      void runSync(true)
    }, POLL_INTERVAL_MS)
    // Leaving the tab (or closing it): send anything not yet synced straight away.
    const onLeave = () => {
      if (document.visibilityState !== 'hidden' || !accountRef.current) return
      window.clearTimeout(syncTimer.current)
      void runSync(true)
    }
    document.addEventListener('visibilitychange', onReturn)
    document.addEventListener('visibilitychange', onLeave)
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('online', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onReturn)
      document.removeEventListener('visibilitychange', onLeave)
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('online', onReturn)
      window.removeEventListener('focus', onReturn)
      window.clearTimeout(syncTimer.current)
    }
  }, [runSync])

  // Live updates while the tab is visible: another device's save is synced here within a moment,
  // rather than at the next check. Hidden tabs let go of the connection and sync on return.
  const liveUserId = account?.userId
  useEffect(() => {
    if (!liveUserId || !auth.supabaseConfigured) return
    let stop: (() => void) | null = null
    let debounce: number | undefined
    const onChange = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        lastAutoSync.current = Date.now()
        void runSync(true)
      }, LIVE_CHANGE_DELAY_MS)
    }
    const start = () => {
      if (stop || document.visibilityState !== 'visible') return
      stop = watchLibrary(liveUserId, auth.accessToken, onChange, (live) => { liveSync.current = live })
    }
    const halt = () => {
      stop?.()
      stop = null
      liveSync.current = false
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : halt())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearTimeout(debounce)
      halt()
    }
  }, [liveUserId, runSync])

  // Another tab of this app changed the library, the session or the sync state: follow it, so this
  // tab neither saves an old library over the new one nor syncs as an account that's gone.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LIBRARY_KEY || e.key === null) adoptStoredLibrary()
      if (e.key === CLOUD_STATE_KEY || e.key === null) {
        setCloud((c) => ({ ...c, lastSyncedAt: loadCloudState().lastSyncedAt }))
      }
      // The other tab answered "this browser already has a library": this one may sync again.
      if (e.key === MERGE_PENDING_KEY && e.newValue === null && mergePending.current) {
        mergePending.current = false
        setMergePrompt(null)
        if (accountRef.current) void runSync(true)
      }
      const stored = auth.supabaseConfigured ? auth.currentAccount() : null
      if (!stored && accountRef.current) {
        // Signed out in another tab: this one lets go of the account's library too.
        setSignedOut()
        setCloud(IDLE)
      } else if (stored?.userId !== accountRef.current?.userId) {
        // Another tab signed into a different account: it owns what's stored now, so just follow it
        // (wiping here could delete the library it just loaded).
        window.clearTimeout(syncTimer.current)
        accountRef.current = stored
        setAccount(stored)
        setMergePrompt(null)
        // Still waiting on "this browser already has a library" there: don't sync it from here.
        mergePending.current = stored !== null && localStorage.getItem(MERGE_PENDING_KEY) === stored.userId
        adoptStoredLibrary()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [adoptStoredLibrary, runSync, setSignedOut])

  const updateLibrary = useCallback(
    (updater: (lib: Library) => Library) => {
      adoptStoredLibrary()
      commitLibrary(updater(libraryRef.current))
      scheduleSync()
    },
    [adoptStoredLibrary, commitLibrary, scheduleSync],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    startAccount(await auth.signIn(email, password))
  }, [startAccount])

  const signUp = useCallback(async (email: string, password: string) => {
    const acct = await auth.signUp(email, password)
    if (acct) startAccount(acct)
    return acct !== null
  }, [startAccount])

  const signOut = useCallback(async (force = false): Promise<{ unsynced: number }> => {
    const acct = accountRef.current
    if (acct && !force && !mergePending.current) {
      // Send everything first — signing out removes this browser's copy. A second pass picks up
      // anything the first had to merge with another device's edit.
      window.clearTimeout(syncTimer.current)
      await runSync()
      recordLocalEdits(libraryRef.current, acct.userId)
      if (Object.keys(loadCloudState().pending).length > 0) await runSync()
      recordLocalEdits(libraryRef.current, acct.userId)
      const unsynced = Object.keys(loadCloudState().pending).length
      if (unsynced > 0) return { unsynced }
    }
    await syncChain.current
    // auth.signOut ends the session at once and then tells the server; the library goes before that
    // request, so closing the tab while it's under way can't leave the account's decks behind.
    const loggingOut = auth.signOut()
    setSignedOut()
    clearRescue() // signed out on purpose, after the warning: nothing is kept
    setCloud(IDLE)
    setPasswordRecovery(false)
    await loggingOut
    return { unsynced: 0 }
  }, [runSync, setSignedOut])

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

  const changeCollections = useCallback(
    (changes: CollectionChange[]): CollectionChange[] => {
      let short: CollectionChange[] = []
      updateLibrary((lib) => {
        const result = applyCollectionChanges(lib.collections, changes)
        short = result.short
        return { ...lib, collections: result.collections }
      })
      return short
    },
    [updateLibrary],
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
      changeCollections,
    }),
    [
      library, account, cloud, mergePrompt, resolveMerge, passwordRecovery, linkNotice, signIn, signUp, signOut,
      syncNow, refresh, updatePassword, createDeck, createDeckWithCards, deleteDeck, addCardToDeck, removeCardFromDeck, setCardQuantity,
      setCommander, setPartnerCommander, setGameMode, setDeckOwnership, setDeckTags, addGameResult,
      removeGameResult, createCollection, deleteCollection, addEntryToCollection, removeEntryFromCollection,
      setEntryQuantities, changeCollections,
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

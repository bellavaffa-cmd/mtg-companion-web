// The community rules (Google Play's user-generated content policy, kept the same on the web):
// before someone first puts something others can see — their profile (name, username, picture), a
// message, a trade or trade reply, a shared deck or binder — they're shown the rules once and agree.
//
// Agreement is kept in this browser and, when signed in, in the account's own user metadata
// (Supabase Auth user_metadata.community_rules_version, which the user may write themselves — no
// table or migration), so agreeing in the Android app counts here too. The Android app keeps the
// same key: data/social/CommunityRules.kt.
//
// Bump COMMUNITY_RULES_VERSION when the rules change in substance: everyone is asked again.

export const COMMUNITY_RULES_VERSION = 1

/** The account metadata key; the same in the Android app. */
export const COMMUNITY_RULES_METADATA_KEY = 'community_rules_version'

export const COMMUNITY_RULES: ReadonlyArray<{ title: string; detail: string }> = [
  { title: 'Be respectful', detail: "Treat other players the way you'd want to be treated at the table." },
  { title: 'No hate or harassment', detail: 'No attacks on anyone for who they are, no threats, no bullying or stalking.' },
  { title: 'No spam or scams', detail: 'No advertising, no repeated unwanted messages, no fake trades or attempts to get money or accounts.' },
  { title: 'No explicit content', detail: 'No sexual, violent or shocking pictures, names or messages.' },
]

export const COMMUNITY_RULES_ENFORCEMENT = 'We can remove content and suspend or delete accounts that break these rules.'

export const COMMUNITY_RULES_REPORTING =
  'To report or block someone, use "Block or report" (the flag) on their profile, a trade, a shared deck or binder, ' +
  "or a conversation. Reports come to us and we act on them; a blocked person can't contact you or see what you share."

/** Whether posting needs the rules shown first, given what this browser and the account say. */
export function needsAgreement(deviceVersion: number, accountVersion: number | null): boolean {
  return Math.max(deviceVersion, accountVersion ?? 0) < COMMUNITY_RULES_VERSION
}

/** The version agreed to, from a Supabase Auth user object ({ user_metadata: {...} }); 0 if none. */
export function versionFromUser(user: unknown): number {
  if (!user || typeof user !== 'object') return 0
  const meta = (user as { user_metadata?: unknown }).user_metadata
  if (!meta || typeof meta !== 'object') return 0
  const value = (meta as Record<string, unknown>)[COMMUNITY_RULES_METADATA_KEY]
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : 0
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

export interface CommunityRulesState {
  deviceVersion: number
  accountVersion: number | null
  /** The action waiting on the sheet's Agree, if it's open. */
  pending: (() => void) | null
}

/** This browser's agreement plus the one-time sheet's requests (shown by CommunityRulesHost). */
export function createCommunityRulesStore(initialDeviceVersion: number, persist: (version: number) => void) {
  let state: CommunityRulesState = { deviceVersion: initialDeviceVersion, accountVersion: null, pending: null }
  const listeners = new Set<() => void>()
  const set = (next: Partial<CommunityRulesState>) => {
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  }
  const recordDevice = (version: number) => {
    if (version <= state.deviceVersion) return
    persist(version)
    set({ deviceVersion: version })
  }
  const agreed = () => !needsAgreement(state.deviceVersion, state.accountVersion)
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    agreed,
    /** Runs [action] now if the rules were already agreed to; otherwise opens the sheet and runs it after Agree. */
    require(action: () => void) {
      if (agreed()) action()
      else set({ pending: action })
    },
    /** Opens the sheet just to read (Settings, the privacy page). */
    show() {
      set({ pending: () => {} })
    },
    /** Agree on the sheet: remembered here, and the waiting action is handed back to run. */
    agree(): (() => void) | null {
      const action = state.pending
      recordDevice(COMMUNITY_RULES_VERSION)
      set({ pending: null })
      return action
    },
    dismiss() {
      set({ pending: null })
    },
    /** From the account's user metadata (sign-in or session refresh); null when signed out. */
    setAccountVersion(version: number | null) {
      set({ accountVersion: version })
      // Agreed on another device: this browser needn't ask again, even signed out later.
      if (version != null && version > state.deviceVersion) recordDevice(version)
    },
  }
}

export type CommunityRulesStore = ReturnType<typeof createCommunityRulesStore>

const STORAGE_KEY = 'mtgweb_community_rules'

function storedVersion(): number {
  try {
    const n = Number(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 0)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/** The app's one store. */
export const communityRules: CommunityRulesStore = createCommunityRulesStore(storedVersion(), (version) => {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, String(version)) } catch { /* private mode: asked again next visit */ }
})

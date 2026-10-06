// What's been ticked on a deck's pull list or put-back list, kept in this browser so it survives a
// reload — not synced: it's one trip round the shelves, and ticking on two devices at once isn't a
// thing anyone does. Also which pull list is open, for "Pull from here" on a scanned box label. The
// Android app keeps the same on the phone (data/PullProgress.kt).

const PULL_KEY = 'mtgweb_pull_'
const PUT_BACK_KEY = 'mtgweb_putback_'
const OPEN_KEY = 'mtgweb_open_pull'

/** Ticks on a list, by row key (collection/pullList.ts). */
export interface ListProgress {
  ticked: string[]
  /** The put-back list's choice: "ORIGIN" (where they came from) or "RULE". */
  mode?: string
  /** A pull list: when its first row was ticked, for Upkeep's "started Tuesday" (upkeep.ts). */
  startedAt?: number
}

function read(key: string): ListProgress {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as Partial<ListProgress>) : null
    return {
      ticked: Array.isArray(parsed?.ticked) ? parsed.ticked.filter((k): k is string => typeof k === 'string') : [],
      ...(typeof parsed?.mode === 'string' ? { mode: parsed.mode } : {}),
      ...(typeof parsed?.startedAt === 'number' ? { startedAt: parsed.startedAt } : {}),
    }
  } catch {
    return { ticked: [] }
  }
}

function write(key: string, progress: ListProgress | null) {
  try {
    if (progress && (progress.ticked.length > 0 || progress.mode)) localStorage.setItem(key, JSON.stringify(progress))
    else localStorage.removeItem(key)
  } catch { /* private mode or out of room: it just isn't kept */ }
}

export const loadPullProgress = (deckId: string) => read(PULL_KEY + deckId)
export function savePullProgress(deckId: string, p: ListProgress | null) {
  // When the list was started: kept while something stays ticked, set at the first tick.
  const ticking = !!p && p.ticked.length > 0
  const before = ticking ? read(PULL_KEY + deckId) : null
  const startedAt = ticking ? (before && before.ticked.length > 0 ? before.startedAt : undefined) ?? p!.startedAt ?? Date.now() : undefined
  write(PULL_KEY + deckId, p && startedAt ? { ...p, startedAt } : p)
}

/** The decks' pull lists with something ticked in this browser, and since when (upkeep.ts). */
export function pullsUnderway(): { deckId: string; ticked: string[]; startedAt?: number }[] {
  const out: { deckId: string; ticked: string[]; startedAt?: number }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(PULL_KEY)) continue
      const deckId = key.slice(PULL_KEY.length)
      const p = read(key)
      if (p.ticked.length > 0) out.push({ deckId, ticked: p.ticked, ...(p.startedAt ? { startedAt: p.startedAt } : {}) })
    }
  } catch { /* storage unavailable: none */ }
  return out
}
export const loadPutBackProgress = (deckId: string) => read(PUT_BACK_KEY + deckId)
export const savePutBackProgress = (deckId: string, p: ListProgress | null) => write(PUT_BACK_KEY + deckId, p)

/** The deck whose pull list is open, if any. */
export function openPullDeck(): string | null {
  try { return localStorage.getItem(OPEN_KEY) } catch { return null }
}

export function setOpenPullDeck(deckId: string | null) {
  try {
    if (deckId) localStorage.setItem(OPEN_KEY, deckId)
    else localStorage.removeItem(OPEN_KEY)
  } catch { /* not kept */ }
}

/** Ticks one more row of a list (for the scanner), and answers the progress now. */
export function tickRow(kind: 'pull' | 'putBack', deckId: string, key: string): ListProgress {
  const now = kind === 'pull' ? loadPullProgress(deckId) : loadPutBackProgress(deckId)
  const next = now.ticked.includes(key) ? now : { ...now, ticked: [...now.ticked, key] }
  if (kind === 'pull') savePullProgress(deckId, next)
  else savePutBackProgress(deckId, next)
  return next
}

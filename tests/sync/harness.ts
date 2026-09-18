// A simulated sync world for tests: several devices (each with its own localStorage and clock) and
// a fake Supabase that behaves like public.library_items and its push functions — the old
// push_library_items (newest edit wins) and, with [cas], push_library_items_v2 (compare-and-swap).
// Each device syncs with the real src/sync/cloudSync.ts, in the same order SyncContext does.

import * as cs from '../../src/sync/cloudSync.ts'

export type Cards = [string, number][]

interface Row {
  kind: string
  id: string
  data: Record<string, unknown> | null
  edited_ms: number
  deleted: boolean
  base_edited_ms: number | null
  server_updated_at: string
}

// Postgres jsonb keeps keys in its own order (shorter first); mimic it so nothing relies on key order.
const jsonb = (v: unknown): unknown => Array.isArray(v) ? v.map(jsonb)
  : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map((k) => [k, jsonb((v as Record<string, unknown>)[k])]))
    : v

export function createSim(cas: boolean) {
  const stores: Record<string, Map<string, string>> = {}
  const libs: Record<string, cs.Library> = {}
  const skew: Record<string, number> = {}
  let current = ''
  let rows = new Map<string, Row>()
  let clock = 0
  const hooks = {
    /** The next push fails before reaching the server. */
    failPush: false,
    /** The next push is written, but its answer is lost. */
    loseResponse: false,
    /** Runs just before the next push is written (another device getting in first). */
    beforePush: null as null | (() => Promise<void>),
  }

  const use = (dev: string) => { current = dev }
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => stores[current].get(k) ?? null,
    setItem: (k: string, v: string) => { stores[current].set(k, v) },
    removeItem: (k: string) => { stores[current].delete(k) },
  }
  const realNow = Date.now
  Date.now = () => realNow() + (skew[current] ?? 0)

  const stamp = (n: number) => new Date(Date.UTC(2026, 8, 18) + n * 1000).toISOString().replace('Z', '+00:00')
  const write = (item: { kind: string; id: string; deleted?: boolean; data?: unknown; edited_ms: number; base_edited_ms?: number | null }, base: number | null) => {
    clock++
    rows.set(`${item.kind}:${item.id}`, {
      kind: item.kind, id: item.id, data: item.deleted ? null : jsonb(item.data) as Record<string, unknown>,
      edited_ms: item.edited_ms, deleted: !!item.deleted, base_edited_ms: base, server_updated_at: stamp(clock),
    })
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  ;(globalThis as Record<string, unknown>).fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const push = url.pathname.endsWith('/push_library_items') || url.pathname.endsWith('/push_library_items_v2')
    if (url.pathname.endsWith('/push_library_items_v2') && !cas) return json({ code: 'PGRST202', message: 'Could not find the function' }, 404)
    if (!cas && (url.searchParams.get('select') ?? '').includes('base_edited_ms')) {
      return json({ code: '42703', message: 'column library_items.base_edited_ms does not exist' }, 400)
    }
    if (push) {
      if (hooks.failPush) { hooks.failPush = false; throw new TypeError('network down') }
      if (hooks.beforePush) { const run = hooks.beforePush; hooks.beforePush = null; const me = current; await run(); use(me) }
      const { items } = JSON.parse(String(init?.body))
      const wrote: { kind: string; id: string }[] = []
      for (const item of items) {
        const existing = rows.get(`${item.kind}:${item.id}`)
        if (url.pathname.endsWith('_v2')) {
          if (existing && existing.edited_ms !== item.base_edited_ms) continue // compare-and-swap; a null base never matches
          write(item, item.base_edited_ms ?? null)
        } else {
          if (existing && existing.edited_ms > item.edited_ms) continue // newest edit wins
          write(item, null)
        }
        wrote.push({ kind: item.kind, id: item.id })
      }
      if (hooks.loseResponse) { hooks.loseResponse = false; throw new TypeError('timeout') }
      return json(url.pathname.endsWith('_v2') ? wrote : wrote.length)
    }
    let out = [...rows.values()]
    const ids = url.searchParams.get('id')
    if (ids) {
      const wanted = ids.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''))
      out = out.filter((r) => wanted.includes(r.id))
    }
    const after = url.searchParams.get('server_updated_at')?.slice(3)
    if (after) out = out.filter((r) => Date.parse(r.server_updated_at) > Date.parse(after))
    return json(out.sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1)))
  }

  const deck = (id: string, cards: Cards, extra: Record<string, unknown> = {}) => ({
    id, name: id, commander: null, partnerCommander: null, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [],
    ownership: 'OWNED', ...extra, cards: cards.map(([c, q]) => ({ scryfallId: c, name: c, imageUrl: null, quantity: q })),
  }) as unknown as cs.Library['decks'][number]
  const sleep = () => new Promise((r) => setTimeout(r, 3))
  const cardsText = (cards: { scryfallId: string; quantity: number }[]) => cards.map((c) => c.scryfallId + c.quantity).join(',')

  const sim = {
    cs,
    hooks,
    skew,
    /** Starts over: no rows on the server, and [devices] with empty libraries and correct clocks. */
    reset(...devices: string[]) {
      rows = new Map()
      clock = 1000
      for (const d of devices) { stores[d] = new Map(); libs[d] = { decks: [], collections: [] }; skew[d] = 0 }
    },
    library: (dev: string) => libs[dev],
    setLibrary(dev: string, lib: cs.Library) { libs[dev] = lib },
    /** Puts deck [id] with [cards] in [dev]'s library (replacing it), keeping decks ordered by id. */
    setDeck(dev: string, id: string, cards: Cards, extra: Record<string, unknown> = {}) {
      const others = libs[dev].decks.filter((d) => d.id !== id)
      libs[dev] = { ...libs[dev], decks: [...others, deck(id, cards, extra)].sort((a, b) => (a.id < b.id ? -1 : 1)) }
    },
    removeDeck(dev: string, id: string) {
      libs[dev] = { ...libs[dev], decks: libs[dev].decks.filter((d) => d.id !== id) }
    },
    cards: (dev: string, id = 'd1'): Cards => (libs[dev].decks.find((d) => d.id === id)?.cards ?? []).map((c) => [c.scryfallId, c.quantity]),
    /** A deck's cards on [dev], e.g. "x1,y2"; "(none)" when it doesn't have the deck. */
    show(dev: string, id = 'd1') {
      const d = libs[dev].decks.find((x) => x.id === id)
      return d ? cardsText(d.cards) : '(none)'
    },
    /** The same, from the server's row. */
    server(id = 'd1') {
      const row = rows.get(`deck:${id}`)
      return row?.deleted ? '(deleted)' : row?.data ? cardsText(row.data.cards as { scryfallId: string; quantity: number }[]) : '(none)'
    },
    row: (id = 'd1') => rows.get(`deck:${id}`),
    /** Moves a row as if its push had committed late, stamped [secondsEarlier] before the newest row. */
    backdate(id: string, secondsEarlier: number, change: (row: Row) => void) {
      const row = { ...rows.get(`deck:${id}`)! }
      change(row)
      row.server_updated_at = stamp(clock - secondsEarlier)
      rows.set(`deck:${id}`, row)
    },
    cloudState: (dev: string) => JSON.parse(stores[dev].get('mtgweb_cloud_state') ?? 'null') as cs.CloudState | null,
    use,
    sleep,
    /** Notes [dev]'s local edits, the way SyncContext does before each pass. */
    recordEdits(dev: string) { use(dev); cs.recordLocalEdits(libs[dev], 'u') },
    /** First half of a pass: pull, apply to the library, save. [midEdit] changes the library during the pull. */
    async pullPhase(dev: string, midEdit?: (lib: cs.Library) => cs.Library) {
      sim.recordEdits(dev)
      const snapshot = libs[dev]
      const pulled = await cs.pullChanges(snapshot, cs.loadCloudState(), 'u', 't')
      use(dev)
      if (midEdit) libs[dev] = midEdit(libs[dev])
      libs[dev] = cs.applyRemoteChanges(libs[dev], snapshot, pulled.remoteChanges)
      cs.saveCloudState(pulled.state)
      return pulled
    },
    /** Second half: push and save. A push that fails is left for the next pass, as in the app. */
    async pushPhase(dev: string, pulled: cs.PullOutcome) {
      use(dev)
      try {
        const { state } = await cs.pushPending(pulled, 't')
        use(dev)
        cs.saveCloudState(state)
      } catch {
        // offline, or the answer was lost: the next pass carries on
      }
      await sleep()
    },
    async pass(dev: string, midEdit?: (lib: cs.Library) => cs.Library) {
      await sim.pushPhase(dev, await sim.pullPhase(dev, midEdit))
    },
    /** A few rounds of passes on every device, so everything that can settle has. */
    async settle(...devices: string[]) {
      for (let i = 0; i < 3; i++) for (const d of devices) await sim.pass(d)
    },
  }
  return sim
}

/** Cards in a stable order, for results where only the set of cards matters. */
export const sortedCards = (text: string) => text.split(',').sort().join(',')

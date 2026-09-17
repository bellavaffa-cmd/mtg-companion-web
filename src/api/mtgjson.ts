// Official Commander precon decklists from MTGJSON's free deck data — the same lists Wizards
// published. Allows browser requests, so this calls it directly. Mirrors the Android app's
// PreconRepository.kt.
//
// The index lists every precon MTGJSON has ever seen (a few hundred KB), so it's fetched once per
// page load; a single deck's contents are only fetched when someone opens or imports it.

const BASE = 'https://mtgjson.com/api/v5'

export interface PreconInfo {
  fileName: string
  name: string
  setCode: string
  releaseDate: string | null
}

/** One card in a precon. [scryfallId] is null when MTGJSON couldn't map it (rare). */
export interface PreconCard {
  name: string
  scryfallId: string | null
  quantity: number
}

export interface PreconContents {
  commander: PreconCard[]
  cards: PreconCard[]
}

interface RawDeckSummary { code: string; fileName: string; name: string; releaseDate?: string; type: string }
interface RawDeckCard { name: string; count?: number; identifiers?: { scryfallId?: string } }

let cachedIndex: Promise<PreconInfo[]> | null = null

/** Every Commander precon, newest first. */
export function listCommanderPrecons(): Promise<PreconInfo[]> {
  cachedIndex ??= (async () => {
    const res = await fetch(`${BASE}/DeckList.json`)
    if (!res.ok) throw new Error(`MTGJSON ${res.status}`)
    const body = (await res.json()) as { data?: RawDeckSummary[] }
    return (body.data ?? [])
      .filter((d) => d.type === 'Commander Deck')
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
      .map((d) => ({ fileName: d.fileName, name: d.name, setCode: d.code, releaseDate: d.releaseDate ?? null }))
  })()
  cachedIndex.catch(() => { cachedIndex = null })
  return cachedIndex
}

export async function preconContents(fileName: string): Promise<PreconContents> {
  const res = await fetch(`${BASE}/decks/${encodeURIComponent(fileName)}.json`)
  if (!res.ok) throw new Error(`MTGJSON ${res.status}`)
  const body = (await res.json()) as { data?: { commander?: RawDeckCard[]; mainBoard?: RawDeckCard[] } }
  const map = (cards: RawDeckCard[] = []): PreconCard[] =>
    cards.map((c) => ({ name: c.name, scryfallId: c.identifiers?.scryfallId ?? null, quantity: c.count ?? 1 }))
  return { commander: map(body.data?.commander), cards: map(body.data?.mainBoard) }
}

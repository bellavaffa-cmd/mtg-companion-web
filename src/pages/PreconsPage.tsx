import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listCommanderPrecons, preconContents, type PreconInfo } from '../api/mtgjson'
import { getCardsByIds } from '../api/scryfall'
import { Icon } from './../components/Icon'
import { PageHeader, SearchPill, rise, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import type { DeckCardEntry } from '../types/models'
import { displayImageUrl, backImageUrl, cardTags } from '../types/scryfall'

const year = (releaseDate: string | null) => releaseDate?.slice(0, 4) ?? ''

/** Official Commander precons from MTGJSON — pick one to copy it in as a new deck. */
export function PreconsPage() {
  const navigate = useNavigate()
  const back = useBack('/decks')
  const { createDeckWithCards } = useSync()
  const [precons, setPrecons] = useState<PreconInfo[] | null | undefined>(undefined)
  const [filter, setFilter] = useState('')
  const [importing, setImporting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listCommanderPrecons()
      .then((list) => { if (!cancelled) setPrecons(list) })
      .catch(() => { if (!cancelled) setPrecons(null) })
    return () => { cancelled = true }
  }, [])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const list = precons ?? []
    return needle ? list.filter((p) => p.name.toLowerCase().includes(needle) || p.setCode.toLowerCase().includes(needle)) : list
  }, [precons, filter])

  async function importPrecon(precon: PreconInfo) {
    setImporting(precon.fileName)
    setError(null)
    try {
      const contents = await preconContents(precon.fileName)
      const all = [...contents.commander, ...contents.cards]
      const ids = [...new Set(all.map((c) => c.scryfallId).filter((id): id is string => !!id))]
      if (ids.length === 0) throw new Error("Couldn't resolve any cards for this precon.")
      const byId = new Map((await getCardsByIds(ids)).map((card) => [card.id, card]))
      const entries: DeckCardEntry[] = []
      for (const entry of all) {
        const card = entry.scryfallId ? byId.get(entry.scryfallId) : undefined
        if (!card) continue
        entries.push({
          scryfallId: card.id,
          name: card.name,
          imageUrl: displayImageUrl(card),
          quantity: entry.quantity,
          canBeCommander: (card.type_line ?? '').includes('Legendary') && (card.type_line ?? '').includes('Creature'),
          typeLine: card.type_line ?? null,
          partnerAbility: null,
          backImageUrl: backImageUrl(card),
          tags: cardTags(card),
        })
      }
      if (entries.length === 0) throw new Error("None of this precon's cards could be found on Scryfall.")
      // MTGJSON lists two commanders for a partner precon — set both when they're there.
      const commanders = contents.commander
        .map((c) => entries.find((e) => e.scryfallId === c.scryfallId))
        .filter((e): e is DeckCardEntry => !!e)
      const deck = createDeckWithCards(precon.name, entries, commanders[0] ?? null, commanders[1] ?? null)
      navigate(`/decks/${deck.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setImporting(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Precons"
        eyebrow="Official Commander decks"
        actions={<button type="button" className="btn line" onClick={back}><Icon name="arrow_back" />Back</button>}
      />
      <div className="content-scroll with-nav">
        <SearchPill value={filter} onChange={setFilter} placeholder="Filter precons" />
        {error && <div className="notice" style={{ marginTop: 12 }}>{error}</div>}
        {precons === undefined && <div className="empty-state">Loading the precon list…</div>}
        {precons === null && <div className="empty-state">Couldn't reach MTGJSON. Check your connection and try again.</div>}
        {precons && shown.length === 0 && <div className="empty-state">No precon matches “{filter}”.</div>}
        <div className="precon-list">
          {shown.map((precon, i) => (
            <button
              key={precon.fileName}
              type="button"
              className="precon press rise"
              style={rise(Math.min(i, 8))}
              onClick={() => void importPrecon(precon)}
              disabled={importing !== null}
            >
              <span className="precon-main">
                <span className="precon-name">{precon.name}</span>
                <span className="precon-meta">{precon.setCode}{precon.releaseDate ? ` · ${year(precon.releaseDate)}` : ''}</span>
              </span>
              <span className="precon-action">
                {importing === precon.fileName ? 'Adding…' : <Icon name="library_add" />}
              </span>
            </button>
          ))}
        </div>
        {precons && shown.length > 0 && (
          <div className="dim" style={{ marginTop: 12 }}>
            Decklists from MTGJSON. Adding one copies it in as a new deck you can edit.
          </div>
        )}
      </div>
    </>
  )
}

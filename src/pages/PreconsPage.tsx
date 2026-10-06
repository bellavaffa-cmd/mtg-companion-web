import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listCommanderPrecons, type PreconContents, type PreconInfo } from '../api/mtgjson'
import { contentsOf, importPreconDeck } from '../decks/preconImport'
import { Icon } from './../components/Icon'
import { PageHeader, SearchPill, TYPE_GROUPS, TYPE_PLURALS, primaryTypeOf, rise, useBack } from '../components/kit'
import { Dialog } from '../components/Dialog'
import { useSync } from '../sync/SyncContext'

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
  // The precon being looked at before importing it, as the phone's PreconContentsDialog.
  const [viewing, setViewing] = useState<PreconInfo | null>(null)

  // Bumped by Try again, to ask MTGJSON once more.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    listCommanderPrecons()
      .then((list) => { if (!cancelled) setPrecons(list) })
      .catch(() => { if (!cancelled) setPrecons(null) })
    return () => { cancelled = true }
  }, [attempt])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const list = precons ?? []
    return needle ? list.filter((p) => p.name.toLowerCase().includes(needle) || p.setCode.toLowerCase().includes(needle)) : list
  }, [precons, filter])

  async function importPrecon(precon: PreconInfo) {
    setImporting(precon.fileName)
    setError(null)
    try {
      const deck = await importPreconDeck(precon.fileName, precon.name, createDeckWithCards)
      setViewing(null)
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
        onBack={back}
      />
      <div className="content-scroll with-nav">
        <SearchPill value={filter} onChange={setFilter} placeholder="Filter precons" />
        {error && <div className="notice" style={{ marginTop: 12 }}>{error}</div>}
        {precons === undefined && <div className="empty-state"><Icon name="hourglass_empty" />Loading the precon list…</div>}
        {precons === null && (
          <div className="empty-state">
            <Icon name="cloud_off" />
            <div>Couldn't reach MTGJSON. Check your connection and try again.</div>
            <button type="button" className="btn line" onClick={() => { setPrecons(undefined); setAttempt((n) => n + 1) }}>Try again</button>
          </div>
        )}
        {precons && shown.length === 0 && <div className="empty-state"><Icon name="search_off" />No precon matches “{filter}”.</div>}
        <div className="precon-list">
          {shown.map((precon, i) => (
            <div key={precon.fileName} className="precon-row rise" style={rise(Math.min(i, 8))}>
              <button
                type="button"
                className="precon press"
                onClick={() => setViewing(precon)}
                disabled={importing !== null}
              >
                <span className="precon-main">
                  <span className="precon-name">{precon.name}</span>
                  <span className="precon-meta">{precon.setCode}{precon.releaseDate ? ` · ${year(precon.releaseDate)}` : ''}</span>
                </span>
              </button>
              {/* The quick way, as the phone's long-press "Import as new deck". */}
              <button
                type="button"
                className="precon-action press"
                onClick={() => void importPrecon(precon)}
                disabled={importing !== null}
                aria-label={`Import ${precon.name} as a new deck`}
                title="Import as new deck"
              >
                {importing === precon.fileName ? 'Adding…' : <Icon name="library_add" />}
              </button>
            </div>
          ))}
        </div>
        {precons && shown.length > 0 && (
          <div className="dim" style={{ marginTop: 12 }}>
            Decklists from MTGJSON. Tap one to see what's in it; adding one copies it in as a new deck you can edit.
          </div>
        )}
      </div>
      {viewing && (
        <PreconContentsDialog
          precon={viewing}
          importing={importing === viewing.fileName}
          onImport={() => void importPrecon(viewing)}
          onDismiss={() => setViewing(null)}
        />
      )}
    </>
  )
}

/** A precon's commander and its cards by type, with "Import as deck" — the phone's PreconContentsDialog. */
function PreconContentsDialog({ precon, importing, onImport, onDismiss }: { precon: PreconInfo; importing: boolean; onImport: () => void; onDismiss: () => void }) {
  const [contents, setContents] = useState<PreconContents | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    contentsOf(precon.fileName)
      .then((c) => { if (!cancelled) setContents(c) })
      .catch(() => { if (!cancelled) setContents(null) })
    return () => { cancelled = true }
  }, [precon])
  const groups = contents
    ? TYPE_GROUPS.map((type) => {
        const cards = contents.cards.filter((c) => primaryTypeOf(c.type) === type).sort((a, b) => a.name.localeCompare(b.name))
        return { type, cards, count: cards.reduce((n, c) => n + c.quantity, 0) }
      }).filter((g) => g.cards.length > 0)
    : []
  return (
    <Dialog
      title={precon.name}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Close</button>
          <button type="button" className="btn gold" disabled={!contents || importing} onClick={onImport}>{importing ? 'Adding…' : 'Import as deck'}</button>
        </>
      }
    >
      <div className="precon-contents">
        {contents === undefined && <div className="dim">Loading the decklist…</div>}
        {contents === null && <div className="dim">Couldn't load this precon's contents.</div>}
        {contents && (
          <>
            {contents.commander.length > 0 && (
              <>
                <div className="grp">{contents.commander.length > 1 ? 'Commanders' : 'Commander'}</div>
                {contents.commander.map((c) => <div key={c.name} className="precon-commander">{c.name}</div>)}
              </>
            )}
            <div className="dim" style={{ margin: '10px 0 4px' }}>{contents.cards.reduce((n, c) => n + c.quantity, 0)} cards</div>
            {groups.map((g) => (
              <div key={g.type}>
                <div className="grp">{TYPE_PLURALS[g.type]}<span>{g.count}</span></div>
                {g.cards.map((c) => <div key={c.name} className="precon-card">{c.quantity}× {c.name}</div>)}
              </div>
            ))}
          </>
        )}
      </div>
    </Dialog>
  )
}

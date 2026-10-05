import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { placesOf, placePath } from '../collection/storagePlaces'
import { lastCheckedLabel, listedWhere, markChecked, markNoPlace, reconcile, recordHere, removeMissing } from '../collection/placeCheck'
import { clearCheck, loadCheck } from '../collection/checkSession'
import '../collection/storage.css'

/** How many missing cards show before "and 3 more". */
const SHOWN = 5

/**
 * A check's results (the Android app's CheckResultsScreen): how many are where they should be, which
 * are missing (listed here, not scanned) and which are extra (scanned here, listed somewhere else or
 * not at all), with what to do about each — Find it, Mark No place yet, Remove from collection; Record
 * them here, I'll put them back. Missing cards stay where they're listed until one of those is
 * tapped. Save results notes when the place was checked. The rules are collection/placeCheck.ts; the
 * scans come from the scanner's check mode (ScanPage.tsx). At /collections/place/:id/check.
 */
export function CheckResultsPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { collections, decks, changeStorage, changeDecksAndStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack(`/collections/place/${id}`)
  const [session] = useState(() => loadCheck(id))
  const places = placesOf(collections)
  const place = places.find((p) => p.id === id)
  const scope = { placeId: id, section: session?.section ?? null }
  const result = useMemo(() => reconcile(collections, decks, scope, session?.scans ?? []), [collections, decks, session]) // eslint-disable-line react-hooks/exhaustive-deps
  const [allMissing, setAllMissing] = useState(false)
  const [puttingBack, setPuttingBack] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [askDecks, setAskDecks] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  if (!place || !session) {
    return (
      <>
        <PageHeader title="Check results" onBack={back} />
        <div className="content-scroll">
          <div className="empty-state">
            <Icon name="fact_check" />
            <div>{place ? 'No check going on here. Start one from the place’s page.' : 'This place isn’t here any more.'}</div>
          </div>
        </div>
      </>
    )
  }

  const what = place.kind === 'BINDER' ? 'binder' : place.kind === 'BOX' ? 'box' : 'place'
  const inDecks = result.extra.filter((l) => l.kind === 'DECK').length
  const shownMissing = allMissing ? result.missing : result.missing.slice(0, SHOWN)
  const record = (takeFromDecks: boolean) => {
    const got: { recorded?: number; left?: number } = {}
    changeDecksAndStorage((c, d) => {
      const out = recordHere(c, d, scope, result.extra, takeFromDecks)
      got.recorded = out.recorded
      got.left = out.leftInDecks
      return { collections: out.collections, decks: out.decks }
    })
    setAskDecks(false)
    setNote(`${got.recorded ?? 0} recorded here${got.left ? ` · ${got.left} left in ${got.left === 1 ? 'its deck' : 'their decks'}` : ''}.`)
  }
  const save = () => {
    changeStorage((c) => markChecked(c, place.id, Date.now()))
    clearCheck()
    navigate(`/collections/place/${place.id}`, { replace: true })
  }

  return (
    <>
      <PageHeader title="Check results" eyebrow={[placePath(places, place.id), session.section].filter(Boolean).join(' › ')} onBack={back} />
      <div className="content-scroll pull-page">
        <div className="check-stats rise">
          <div className="check-stat ok"><b>{result.here}</b><span>where they should be</span></div>
          <div className="check-stat miss"><b>{result.missingCount}</b><span>missing</span></div>
          <div className="check-stat extra"><b>{puttingBack ? 0 : result.extra.length}</b><span>extra</span></div>
        </div>
        {result.foilIgnored && result.expected > 0 && (
          <p className="place-rule">The scanner can't tell foil from plain, so foil and plain copies were counted together.</p>
        )}

        {result.missing.length > 0 && (
          <section className="check-group">
            <h2>Missing · not scanned</h2>
            {shownMissing.map((m, i) => (
              <div key={i} className="check-row">
                <span className="nm">{m.name}{m.line.foil ? ' · foil' : ''} ×{m.qty}</span>
                {listedWhere(m) && <span className="where">{listedWhere(m)}</span>}
                <button type="button" className="pull-chip" onClick={() => navigate(`/card/${encodeURIComponent(m.name)}?id=${m.scryfallId}`)}>Find it</button>
              </div>
            ))}
            {!allMissing && result.missing.length > SHOWN && (
              <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setAllMissing(true)}>
                and {result.missing.length - SHOWN} more
              </button>
            )}
            <div className="check-actions">
              <button type="button" className="btn line" onClick={() => { changeStorage((c) => markNoPlace(c, result.missing)); setNote(`${result.missingCount} marked No place yet.`) }}>Mark No place yet</button>
              <button type="button" className="btn line" onClick={() => setRemoving(true)}>Remove from collection</button>
            </div>
          </section>
        )}

        {result.extra.length > 0 && !puttingBack && (
          <section className="check-group">
            <h2>Extra · found here</h2>
            {result.extra.map((l, i) => (
              <div key={i} className="check-row">
                <span className="nm">{l.scan.name}</span>
                <span className="where">{l.label}</span>
              </div>
            ))}
            <div className="check-actions">
              <button type="button" className="btn line" onClick={() => (inDecks > 0 ? setAskDecks(true) : record(false))}>Record them here</button>
              <button type="button" className="btn line" onClick={() => setPuttingBack(true)}>I'll put them back</button>
            </div>
          </section>
        )}
        {puttingBack && result.extra.length > 0 && (
          <p className="place-rule">{result.extra.length} to put back where {result.extra.length === 1 ? "it's" : "they're"} listed.</p>
        )}
        {result.missing.length === 0 && result.extra.length === 0 && (
          <p className="place-rule">Everything listed here was scanned, and nothing else.</p>
        )}
        {note && <p className="place-rule" role="status">{note}</p>}
        <p className="place-rule">
          Save results to note today as when this {what} was last checked{place.lastChecked ? ` (last time: ${lastCheckedLabel(place.lastChecked, Date.now())})` : ''}. Its page shows it.
        </p>
      </div>
      <div className="pull-bar">
        <button type="button" className="btn gold" onClick={save}>Save results</button>
      </div>

      {removing && (
        <Dialog
          title={`Remove ${result.missingCount} ${result.missingCount === 1 ? 'copy' : 'copies'}?`}
          onDismiss={() => setRemoving(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setRemoving(false)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { changeStorage((c) => removeMissing(c, result.missing)); setRemoving(false); setNote(`${result.missingCount} removed from your collection.`) }}>Remove</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>The missing cards come out of your collection, here and on your other devices.</p>
        </Dialog>
      )}
      {askDecks && (
        <Dialog
          title={`${inDecks} ${inDecks === 1 ? 'is' : 'are'} in a deck`}
          onDismiss={() => setAskDecks(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => record(false)}>Leave in decks</button>
              <button type="button" className="btn gold" onClick={() => record(true)}>Take out of decks</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {result.extra.filter((l) => l.kind === 'DECK').map((l) => `${l.scan.name} (${l.label.replace(/^listed in /, '')})`).join(', ')}.
            Take {inDecks === 1 ? 'it' : 'them'} out of the deck and record {inDecks === 1 ? 'it' : 'them'} here?
          </p>
        </Dialog>
      )}
    </>
  )
}

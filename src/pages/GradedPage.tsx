import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { getByExactName } from '../api/scryfall'
import { displayImageUrl } from '../types/scryfall'
import { placeTree, placesOf } from '../collection/storagePlaces'
import {
  backToRaw, gradedOf, graderName, GRADING_COMPANIES, GRADING_LABELS, markGraded, rawSources, removeGraded, saveGraded,
} from '../collection/graded'
import type { GradedCard, GradingCompany } from '../types/models'
import '../collection/inventory.css'

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `g${Date.now()}${Math.random().toString(36).slice(2, 8)}`)
/** "One that isn't in your collection" in the Which copy list. */
const NOT_HERE = 'new'

/**
 * A graded copy, the Android app's GradedScreen: the slab (grader and grade over the card), who graded
 * it (PSA, BGS, CGC, Other), the grade, the cert number, the user's value — card prices are for raw
 * copies — and where it's kept. A new one takes one of the card's raw copies out of its binder (or is
 * one not in the collection yet); an existing one can come out of its slab (a raw copy again) or be
 * removed. The logic is collection/graded.ts. At /collections/graded?card=<name> (new) or ?id=<id>.
 */
export function GradedPage() {
  const { collections, changeStorage } = useSync()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const money = useMoney()
  const existing = gradedOf(collections).find((g) => g.id === params.get('id')) ?? null
  const name = existing?.name ?? params.get('card') ?? ''
  const back = useBack(name ? `/card/${encodeURIComponent(name)}` : '/collections?tab=storage')
  const places = placesOf(collections)
  const sources = useMemo(() => (existing ? [] : rawSources(collections, name)), [existing, collections, name])
  const [from, setFrom] = useState(sources[0]?.key ?? NOT_HERE)
  const source = sources.find((s) => s.key === from) ?? null
  const [company, setCompany] = useState<GradingCompany>(existing?.company ?? 'PSA')
  const [companyName, setCompanyName] = useState(existing?.companyName ?? '')
  const [grade, setGrade] = useState(existing?.grade ?? '')
  const [cert, setCert] = useState(existing?.cert ?? '')
  const [value, setValue] = useState(existing?.valueUsd !== undefined ? String(Math.round(money.toLocal(existing.valueUsd) * 100) / 100) : '')
  const [placeId, setPlaceId] = useState(existing?.placeId ?? source?.line?.placeId ?? '')
  const [section, setSection] = useState(existing?.section ?? source?.line?.section ?? '')
  const [looked, setLooked] = useState<{ id: string; imageUrl: string | null } | null>(null)
  const [confirm, setConfirm] = useState<'raw' | 'remove' | null>(null)
  const place = places.find((p) => p.id === placeId)

  // A slab that isn't one of the raw copies: its printing, from Scryfall by name.
  useEffect(() => {
    if (existing || source || !name || looked) return
    let cancelled = false
    getByExactName(name).then((c) => { if (!cancelled) setLooked({ id: c.id, imageUrl: displayImageUrl(c) }) }).catch(() => { /* saved without a picture */ })
    return () => { cancelled = true }
  }, [existing, source, name, looked])

  if (!name) return <><PageHeader title="Graded copy" onBack={back} /><div className="content-scroll"><div className="dim">That graded copy isn't here any more.</div></div></>

  const imageUrl = existing?.imageUrl ?? source?.imageUrl ?? looked?.imageUrl ?? null
  const scryfallId = existing?.scryfallId ?? source?.scryfallId ?? looked?.id ?? ''
  const n = Number(value.replace(',', '.'))
  const valueUsd = value.trim() !== '' && Number.isFinite(n) && n >= 0 ? money.toUsd(n) : undefined
  const save = () => {
    const card: GradedCard = {
      ...(existing ?? { id: newId(), createdAt: Date.now() }),
      scryfallId, name, imageUrl: imageUrl ?? undefined, company, companyName: company === 'OTHER' ? companyName : undefined, grade, cert,
      valueUsd, placeId: placeId || undefined, section: placeId ? section || undefined : undefined,
    }
    changeStorage((c) => (existing ? saveGraded(c, card) : markGraded(c, source, card)))
    back()
  }

  return (
    <>
      <PageHeader title={name} eyebrow="Graded copy" onBack={back} />
      <div className="content-scroll graded-page">
        <div className="graded-slab" aria-label={`${graderName({ company, companyName })} ${grade}`}>
          <div className="graded-slab-label"><span>{graderName({ company, companyName })}</span><span>{grade || '–'}</span></div>
          <div className="graded-slab-art">{imageUrl && <img src={imageUrl} alt="" />}</div>
        </div>

        <section className="graded-form">
          <div className="graded-companies" role="group" aria-label="Graded by">
            {GRADING_COMPANIES.map((c) => (
              <button key={c} type="button" aria-pressed={company === c} onClick={() => setCompany(c)}>{GRADING_LABELS[c]}</button>
            ))}
          </div>
          {company === 'OTHER' && (
            <div className="graded-field">
              <label htmlFor="grader">Grader</label>
              <input id="grader" className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Who graded it" />
            </div>
          )}
          <div className="graded-field">
            <label htmlFor="grade">Grade</label>
            <input id="grade" className="input" style={{ flex: 'none', width: 72 }} value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="10" />
          </div>
          <div className="graded-field">
            <label htmlFor="cert">Cert number</label>
            <input id="cert" className="input" value={cert} onChange={(e) => setCert(e.target.value)} placeholder="On the slab's label" />
          </div>
          <div className="graded-field">
            <label htmlFor="val">Your value</label>
            <input id="val" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`${money.currency.symbol} — raw price won't fit`} />
          </div>
          {!existing && (
            <div className="graded-field">
              <label htmlFor="copy">Which copy</label>
              <select id="copy" className="input" value={from} onChange={(e) => {
                setFrom(e.target.value)
                const s = sources.find((x) => x.key === e.target.value)
                if (s?.line) { setPlaceId(s.line.placeId); setSection(s.line.section ?? '') }
              }}>
                {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                <option value={NOT_HERE}>One that isn't in your collection</option>
              </select>
            </div>
          )}
          <div className="graded-note">Graded cards are kept apart from raw copies: they don't fill deck slots, and their value is what you enter, since card prices are for ungraded copies.</div>
        </section>

        <div className="graded-where">
          <span>Where</span>
          <span style={{ display: 'flex', gap: 8, flex: 1, justifyContent: 'flex-end', minWidth: 0 }}>
            <select className="input" aria-label="Where" value={placeId} onChange={(e) => { setPlaceId(e.target.value); setSection('') }} style={{ maxWidth: 220 }}>
              <option value="">No place yet</option>
              {placeTree(places).map((t) => <option key={t.place.id} value={t.place.id}>{`${' '.repeat(t.depth)}${t.place.name}`}</option>)}
            </select>
            {place?.sections && place.sections.length > 0 && (
              <select className="input" aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)} style={{ maxWidth: 140 }}>
                <option value="">Any section</option>
                {place.sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </span>
        </div>
        {existing && (
          <div className="place-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn line" onClick={() => setConfirm('raw')}>Out of its slab</button>
            <button type="button" className="btn line" onClick={() => setConfirm('remove')}>Remove</button>
          </div>
        )}
      </div>
      <div className="pull-bar">
        <button type="button" className="btn gold" disabled={!grade.trim() || !scryfallId} onClick={save}>{existing ? 'Save' : 'Mark as graded'}</button>
      </div>
      {confirm && existing && (
        <Dialog
          title={confirm === 'raw' ? 'Out of its slab?' : 'Remove this graded copy?'}
          onDismiss={() => setConfirm(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="btn gold" onClick={() => {
                changeStorage((c) => (confirm === 'raw' ? backToRaw(c, existing.id) : removeGraded(c, existing.id)))
                navigate(-1)
              }}>{confirm === 'raw' ? 'Make it raw' : 'Remove'}</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {confirm === 'raw'
              ? 'It goes back to being a raw copy, in the binder it came from and in its place — it fills deck slots again.'
              : "It leaves your collection — sold or gone. Its raw copy doesn't come back."}
          </p>
        </Dialog>
      )}
    </>
  )
}

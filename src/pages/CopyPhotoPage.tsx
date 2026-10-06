import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { CARD_CONDITIONS, conditionName } from '../collection/copyDetails'
import { dayOf } from '../collection/copyHistoryStore'
import { boughtLabel, copiesOfCard, hasPhotos, photoDayLabel, type CopyPhoto, type CopyRef } from '../collection/copyPhotos'
import { saveCopyPhoto, setAskOver, setCopyPhoto, useCopyPhotos, usePhotoUrl } from '../collection/copyPhotoStore'
import '../collection/inventory.css'

/**
 * Photos of your copy, the Android app's CopyPhotoScreen: front and back pictures of one particular
 * copy of a card — picked from its copies when there are several — with its condition (the binder
 * entry's, which syncs), when it was photographed, what it was bought for and where, and what it's
 * worth today. The photos stay in this browser (collection/copyPhotoStore.ts); they go in the Value by
 * place PDF report. Also the setting to ask for photos when adding a dear card. The logic is
 * collection/copyPhotos.ts. At /collections/photos?card=Name.
 */
export function CopyPhotoPage() {
  const [params] = useSearchParams()
  const cardName = params.get('card') ?? ''
  const back = useBack(`/card/${encodeURIComponent(cardName)}`)
  const { collections, changeStorage } = useSync()
  const money = useMoney()
  const saved = useCopyPhotos()
  const photos = saved?.photos ?? []
  const copies = useMemo(() => copiesOfCard(collections, cardName), [collections, cardName])
  const [chosen, setChosen] = useState<string | null>(null)
  const copy = copies.find((c) => c.key === chosen) ?? copies.find((c) => photos.some((p) => p.key === c.key && hasPhotos(p))) ?? copies[0] ?? null
  const photo = copy ? photos.find((p) => p.key === copy.key) : undefined
  const data = useCardData(copy ? [copy.scryfallId] : [])
  const card = copy ? data?.get(copy.scryfallId) : undefined
  const plain = Number(card?.prices?.usd) || null
  const foil = Number(card?.prices?.usd_foil) || null
  const worth = copy?.foil ? foil ?? plain : plain ?? foil
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const frontInput = useRef<HTMLInputElement>(null)
  const backInput = useRef<HTMLInputElement>(null)
  const [thenBack, setThenBack] = useState(false)

  const take = async (front: boolean, file: File | undefined) => {
    if (!copy || !file) { setThenBack(false); return }
    const ok = await setCopyPhoto(copy, front, file)
    setMessage(ok ? null : "That picture couldn't be read.")
    // Retake photos: the back straight after the front.
    if (ok && front && thenBack) { setThenBack(false); backInput.current?.click() }
  }

  return (
    <>
      <PageHeader title={copy?.name ?? cardName} eyebrow={copy ? `Your copy · ${copy.where}` : undefined} onBack={back} />
      <div className="content-scroll">
        {!copy ? (
          <div className="empty-state"><Icon name="photo_camera" /><div>You don't own a copy of {cardName}.</div></div>
        ) : (
          <div className="photo-page">
            {copies.length > 1 && (
              <div className="chips wrap photo-copies">
                {copies.map((c) => (
                  <button key={c.key} type="button" className={`pull-chip${c.key === copy.key ? ' on' : ''}`} aria-pressed={c.key === copy.key} onClick={() => setChosen(c.key)}>
                    Copy {c.n}{c.foil ? ' foil' : ''} · {c.where}{photos.some((p) => p.key === c.key && hasPhotos(p)) ? ' · photos' : ''}
                  </button>
                ))}
              </div>
            )}
            <div className="photo-tiles">
              <PhotoTile label="Front" id={photo?.front} onClick={() => frontInput.current?.click()} />
              <PhotoTile label="Back" id={photo?.back} onClick={() => backInput.current?.click()} />
            </div>
            <input ref={frontInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void take(true, e.target.files?.[0]); e.target.value = '' }} />
            <input ref={backInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void take(false, e.target.files?.[0]); e.target.value = '' }} />
            <section className="photo-details">
              <div><span>Condition</span><span>{copy.condition ? conditionName(copy.condition) : 'Not said'}</span></div>
              <div><span>Photographed</span><span>{photo?.photographedAt ? photoDayLabel(dayOf(photo.photographedAt)) : 'Not yet'}</span></div>
              <div><span>Bought for</span><span>{boughtLabel(photo, (usd) => money.format(usd)) || 'Not said'}</span></div>
              <div><span>Worth today</span><span className="gold">{worth !== null ? money.format(worth, worth >= 10) : '—'}</span></div>
            </section>
            <div className="photo-actions">
              <button type="button" className="btn soft" onClick={() => { setThenBack(true); frontInput.current?.click() }}>{photo && hasPhotos(photo) ? 'Retake photos' : 'Take photos'}</button>
              <button type="button" className="btn line" onClick={() => setEditing(true)}>Edit details</button>
            </div>
            {message && <div role="status" style={{ marginTop: 8, color: 'var(--warn)', fontSize: 13 }}>{message}</div>}
            <p className="dim" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 10 }}>
              Photos stay on this device: they aren't synced or uploaded. They go in the Value by place PDF report, for insurance. For cards worth over a set amount, the app can ask for photos when you add them.
            </p>
            <AskSetting askOver={saved?.askOver ?? null} />
          </div>
        )}
      </div>
      {editing && copy && (
        <DetailsDialog
          copy={copy}
          photo={photo}
          onDismiss={() => setEditing(false)}
          onSave={(condition, usd, where) => {
            const had: CopyPhoto = photo ?? { key: copy.key, scryfallId: copy.scryfallId, name: copy.name, ...(copy.foil ? { foil: true } : {}) }
            const { boughtUsd: _u, boughtWhere: _w, ...rest } = had
            saveCopyPhoto({ ...rest, ...(usd !== null ? { boughtUsd: usd } : {}), ...(where ? { boughtWhere: where } : {}) })
            // The condition is the binder entry's, for every copy in it — and it syncs.
            if (condition !== copy.condition) {
              changeStorage((c) => c.map((col) => (col.id !== copy.collectionId ? col : {
                ...col,
                entries: col.entries.map((e) => {
                  if (e.scryfallId !== copy.scryfallId) return e
                  const { condition: _old, ...others } = e
                  return condition ? { ...others, condition } : others
                }),
              })))
            }
            setEditing(false)
          }}
        />
      )}
    </>
  )
}

function PhotoTile({ label, id, onClick }: { label: string; id: string | undefined; onClick: () => void }) {
  const url = usePhotoUrl(id)
  return (
    <button type="button" className="photo-tile" onClick={onClick} aria-label={`${label}: ${url ? 'retake' : 'add a photo'}`}>
      {url ? <img src={url} alt={`${label} of your copy`} /> : <span style={{ fontSize: 12 }}>Tap to add</span>}
      <span className="tag">{label}</span>
    </button>
  )
}

const amountText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/** Ask for photos when adding a card worth over an amount (in the user's currency; blank: never). */
function AskSetting({ askOver }: { askOver: number | null }) {
  const money = useMoney()
  const [text, setText] = useState(askOver !== null ? amountText(money.toLocal(askOver)) : '')
  return (
    <section className="photo-ask">
      <label className="field-label" htmlFor="ask-over">Ask for photos when I add a card worth over</label>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="dim">{money.currency.symbol.trim()}</span>
        <input
          id="ask-over"
          className="input"
          inputMode="decimal"
          placeholder="Never"
          value={text}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.]/g, '').slice(0, 8)
            setText(v)
            setAskOver(v && Number.isFinite(Number(v)) ? money.toUsd(Number(v)) : null)
          }}
        />
      </div>
      <div className="dim" style={{ fontSize: 12 }}>Kept on this device. Leave it empty never to ask.</div>
    </section>
  )
}

/** Edit details: the copies' condition, and what this copy was bought for and where. */
function DetailsDialog({ copy, photo, onDismiss, onSave }: {
  copy: CopyRef; photo: CopyPhoto | undefined; onDismiss: () => void; onSave: (condition: string | null, boughtUsd: number | null, where: string | null) => void
}) {
  const money = useMoney()
  const [condition, setCondition] = useState<string | null>(copy.condition)
  const [price, setPrice] = useState(photo?.boughtUsd !== undefined ? amountText(money.toLocal(photo.boughtUsd)) : '')
  const [where, setWhere] = useState(photo?.boughtWhere ?? '')
  const save = () => onSave(condition, price && Number.isFinite(Number(price)) ? money.toUsd(Number(price)) : null, where.trim() || null)
  return (
    <Dialog
      title="Details of your copy"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" onClick={save}>Save</button>
        </>
      }
    >
      <div className="field-label">Condition</div>
      <div className="chips wrap">
        {[null, ...CARD_CONDITIONS].map((c) => (
          <button key={c ?? 'none'} type="button" className="chip" aria-pressed={c === condition} onClick={() => setCondition(c)}>{c ?? 'Not said'}</button>
        ))}
      </div>
      <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>Every copy of this printing in the binder has the same condition; it syncs.</div>
      <div className="field-label" style={{ marginTop: 12 }}>Bought for ({money.currency.symbol.trim()})</div>
      <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} />
      <div className="field-label" style={{ marginTop: 12 }}>Where</div>
      <input className="input" value={where} maxLength={60} placeholder="Card shop, a trade with Sam…" onChange={(e) => setWhere(e.target.value)} />
      <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>What it cost and where stay on this device, with the photos.</div>
    </Dialog>
  )
}

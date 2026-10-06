import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { useKeepAwake } from '../components/useKeepAwake'
import { getByExactName, getByFuzzyName, getCardsByIds } from '../api/scryfall'
import { pageGrid } from '../collection/binderPages'
import { placesOf, pocketsOf } from '../collection/storagePlaces'
import {
  chooseCell, couldBe, pageAspect, pageCellBoxes, pageDiff, pageDiffSummary, pageDiffText, pageScanHint, pageScanSummary,
  readCell, recordedLine, recordedOnPage, recordPage, type CellCard, type PageCell,
} from '../collection/pageScan'
import { guideInVideo } from '../scan/guide'
import { cardNameIndex } from '../scan/cardNames'
import { readCardName, type Box } from '../scan/ocr'
import { flattenCard } from '../scan/flatCard'
import { loadRecognizer, recognize } from '../scan/cardRecognizer'
import { backImageUrl, cardTags, displayImageUrl, type ScryfallCard } from '../types/scryfall'
import type { CollectionEntry } from '../types/models'
import '../collection/storage.css'

/**
 * Scan a whole binder page (collection/pageScan.ts): one picture of the page, held inside a guide the
 * shape of the binder's pocket grid, read pocket by pocket with the same recogniser a single scan uses
 * — each pocket's card found by its edges and known by sight, and its title read for the pockets the
 * picture alone can't settle. Then Record this page, Check against record, Retake and Save · next
 * page. Without a camera, a photo of the page (cropped to the page) can be chosen instead. The
 * Android app's PageScanScreen.kt. At /collections/place/:id/scan-page?page=4.
 */

const cardOf = (c: ScryfallCard): CellCard => ({ scryfallId: c.id, name: c.name, set: c.set ?? '', number: c.collector_number ?? '' })

/** Every pocket of the page laid over [area] of [source], read. */
async function readPage(source: HTMLCanvasElement, area: Box, pockets: number): Promise<{ cells: PageCell[]; sighted: boolean }> {
  const sighted = await loadRecognizer().then(() => true, () => false)
  const names = await cardNameIndex().catch(() => null)
  const cells: PageCell[] = []
  const boxes = pageCellBoxes(area, pockets)
  for (let i = 0; i < boxes.length; i++) {
    const slot = i + 1
    const flat = sighted ? flattenCard(source, boxes[i]) : null
    const seen = flat ? await recognize(flat).catch(() => null) : null
    let cell = readCell(slot, !!flat, seen?.anywhere ?? [])
    if (cell.state !== 'read' && names) {
      // The title read off the picture: its printings by sight, or the card to confirm.
      const read = await readCardName(source, boxes[i], names).catch(() => null)
      const name = read?.match?.name
      if (name) {
        const byName = flat ? (await recognize(flat, name).catch(() => null))?.named ?? [] : []
        if (byName.length > 0) cell = readCell(slot, true, seen?.anywhere ?? [], byName)
        else {
          const card = await getByExactName(name).catch(() => null)
          if (card) cell = { slot, state: 'choose', options: [cardOf(card)] }
        }
      }
    }
    cells.push(cell)
  }
  return { cells, sighted }
}

type Camera = 'starting' | 'on' | 'denied' | 'unsupported' | 'failed'

export function PageScanPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const { collections, changeStorage } = useSync()
  const back = useBack(`/collections/place/${id}`)
  const place = placesOf(collections).find((p) => p.id === id)
  const pockets = place ? pocketsOf(place) : 9
  const { cols } = pageGrid(pockets)
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1))
  const [phase, setPhase] = useState<'camera' | 'reading' | 'results'>('camera')
  const [cells, setCells] = useState<PageCell[]>([])
  const [cardData, setCardData] = useState<Map<string, ScryfallCard>>(() => new Map())
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<PageCell | null>(null)
  const [camera, setCamera] = useState<Camera>('starting')
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useKeepAwake(phase !== 'results')

  // The model and index start loading now, so the first page doesn't wait for them.
  useEffect(() => { void loadRecognizer().catch(() => undefined) }, [])

  // The camera, wide (no zoom): a whole page needs every pixel it can get.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        const video = videoRef.current
        if (video) {
          video.srcObject = s
          void video.play().catch(() => {})
        }
        setCamera('on')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const name = e instanceof DOMException ? e.name : ''
        setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'unsupported' : 'failed')
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  if (!place) {
    return (
      <>
        <PageHeader title="Scan a page" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="menu_book" /><div>This binder isn't here any more.</div></div></div>
      </>
    )
  }

  const loadCards = (list: PageCell[]) => {
    const ids = [...new Set(list.flatMap((c) => [...(c.card ? [c.card.scryfallId] : []), ...c.options.map((o) => o.scryfallId)]))].filter((x) => !cardData.has(x))
    if (ids.length === 0) return
    getCardsByIds(ids).then((got) => setCardData((m) => { const next = new Map(m); got.forEach((c) => next.set(c.id, c)); return next })).catch(() => {})
  }

  const read = async (source: HTMLCanvasElement, area: Box) => {
    setPhase('reading')
    setMessage(null)
    try {
      const { cells: got, sighted } = await readPage(source, area, pockets)
      setCells(got)
      setChecking(false)
      if (!sighted) setMessage('Card recognition couldn’t load, so only titles were read. Tap a pocket to fix it.')
      loadCards(got)
      setPhase('results')
    } catch {
      setMessage('Couldn’t read the page — try again.')
      setPhase('camera')
    }
  }

  const scanFromCamera = () => {
    const video = videoRef.current
    const guide = guideRef.current
    const area = video && guide ? guideInVideo(video, guide) : null
    if (!video || !area) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    void read(canvas, area)
  }

  const scanFromFile = (file: File) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')?.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      // A chosen photo is taken to be the page, cropped to it.
      void read(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height })
    }
    img.onerror = () => { URL.revokeObjectURL(url); setMessage('Couldn’t open that picture.') }
    img.src = url
  }

  const entryOf = (c: CellCard): CollectionEntry => {
    const card = cardData.get(c.scryfallId)
    return card
      ? { scryfallId: card.id, name: card.name, imageUrl: displayImageUrl(card), quantity: 0, foilQuantity: 0, backImageUrl: backImageUrl(card), tags: cardTags(card) }
      : { scryfallId: c.scryfallId, name: c.name, imageUrl: null, quantity: 0, foilQuantity: 0 }
  }

  const record = (): string => {
    const shown = cells
    const onPage = page
    const result = recordPage(collections, place, onPage, shown, entryOf)
    changeStorage((c) => recordPage(c, place, onPage, shown, entryOf).collections)
    return recordedLine(onPage, result)
  }

  const hint = pageScanHint(cells)
  const diff = checking ? pageDiff(recordedOnPage(place, collections, page), cells) : []

  return (
    <>
      <PageHeader title={`Page ${page} · whole page`} eyebrow={place.name} onBack={back} />
      <div className="content-scroll">
        <div className="page-scan">
          {phase !== 'results' ? (
            <>
              <div className="scan-view page-scan-view" data-no-pull>
                <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
                <div className="scan-guide-wrap">
                  <div
                    ref={guideRef}
                    className="page-scan-guide"
                    style={{ aspectRatio: String(pageAspect(pockets)), gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                    aria-label="Hold the page inside the frame, one card in each box"
                  >
                    {Array.from({ length: pockets }, (_, i) => <span key={i} />)}
                  </div>
                </div>
                {camera !== 'on' && (
                  <div className="scan-camera-note">
                    <Icon name={camera === 'starting' ? 'photo_camera' : 'no_photography'} />
                    {camera === 'starting' && 'Starting the camera…'}
                    {camera === 'denied' && 'The camera is blocked for this site. Allow it in the browser’s site settings — or choose a photo of the page.'}
                    {camera === 'unsupported' && 'No camera here. Choose a photo of the page instead.'}
                    {camera === 'failed' && 'The camera stopped or didn’t start. Choose a photo of the page instead.'}
                  </div>
                )}
                {phase === 'reading' && <div className="scan-camera-note" role="status"><Icon name="hourglass_top" />Reading the pockets…</div>}
              </div>
              <p className={message ? 'page-scan-msg warn' : 'page-scan-msg'} role="status">
                {message ?? 'Lay the page flat and fill the frame with it, one card in each box.'}
              </p>
              <div className="pull-bar">
                <button type="button" className="btn line" disabled={phase !== 'camera'} onClick={() => fileRef.current?.click()}>
                  <Icon name="image" aria-hidden />Choose a photo
                </button>
                <button type="button" className="btn gold" disabled={phase !== 'camera' || camera !== 'on'} onClick={scanFromCamera}>
                  <Icon name="document_scanner" aria-hidden />Scan this page
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) scanFromFile(f) }}
              />
            </>
          ) : (
            <>
              <div className="page-scan-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {cells.map((cell) => {
                  const label = cell.state === 'read' ? cell.card?.name ?? '' : cell.state === 'choose' ? 'Which one?' : 'Empty'
                  const what = cell.state === 'read'
                    ? `Slot ${cell.slot}: ${label}`
                    : cell.state === 'choose' ? `Slot ${cell.slot}: could be ${couldBe(cell)}. Tap to choose.` : `Slot ${cell.slot}: empty`
                  return (
                    <button key={cell.slot} type="button" className={`page-cell ${cell.state}`} aria-label={what} onClick={() => setChoosing(cell)}>
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
              <div className="page-scan-summary" role="status">
                <b>{pageScanSummary(cells)}</b>
                {hint && <span>{hint}</span>}
                {message && <span className="done">{message}</span>}
              </div>
              <div className="page-scan-actions">
                <button type="button" className="btn gold sm" disabled={!cells.some((c) => c.state !== 'choose')} onClick={() => setMessage(record())}>
                  Record this page
                </button>
                <button type="button" className="btn line sm" aria-pressed={checking} onClick={() => setChecking((v) => !v)}>
                  Check against record
                </button>
              </div>
              {checking && (
                <div className="page-scan-diff">
                  <b>{pageDiffSummary(diff)}</b>
                  {diff.map(pageDiffText).filter((t): t is string => t !== null).map((t) => <span key={t}>{t}</span>)}
                  {diff.some((d) => d.kind !== 'same') && <span className="dim">Record this page to make the binder match the photo.</span>}
                </div>
              )}
              <div className="pull-bar page-scan-bottom">
                <button type="button" className="btn line" onClick={() => { setPhase('camera'); setMessage(null); setChecking(false) }}>Retake</button>
                <button
                  type="button"
                  className="btn gold"
                  onClick={() => {
                    const done = record()
                    setPage((p) => p + 1)
                    setCells([])
                    setChecking(false)
                    setMessage(done)
                    setPhase('camera')
                  }}
                >
                  Save · next page
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {choosing && (
        <ChooseDialog
          cell={choosing}
          cardData={cardData}
          onPick={(picked, card) => {
            if (card) setCardData((m) => new Map(m).set(card.id, card))
            setCells((list) => list.map((c) => (c.slot === choosing.slot ? chooseCell(c, picked) : c)))
            setChoosing(null)
          }}
          onDismiss={() => setChoosing(null)}
        />
      )}
    </>
  )
}

/** Settling one pocket: one of the candidates, empty, or a card typed by name. */
function ChooseDialog({ cell, cardData, onPick, onDismiss }: {
  cell: PageCell
  cardData: Map<string, ScryfallCard>
  onPick: (card: CellCard | null, data: ScryfallCard | null) => void
  onDismiss: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seen = new Set<string>()
  const options = [...(cell.card ? [cell.card] : []), ...cell.options].filter((o) => !seen.has(o.scryfallId) && !!seen.add(o.scryfallId))
  const lookUp = async () => {
    const name = typed.trim()
    if (!name) return
    setBusy(true)
    const card = await getByFuzzyName(name).catch(() => null)
    setBusy(false)
    if (!card) setError(`No card called "${name}".`)
    else onPick(cardOf(card), card)
  }
  return (
    <Dialog
      title={`Slot ${cell.slot}`}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!typed.trim() || busy} onClick={() => void lookUp()}>{busy ? 'Looking…' : 'Use this name'}</button>
        </>
      }
    >
      {cell.state === 'choose' && <p className="muted" style={{ marginTop: 0 }}>It could be {couldBe(cell)}. Which one is it?</p>}
      <div className="page-choose">
        {options.map((o) => {
          const data = cardData.get(o.scryfallId)
          const printing = [data?.set_name ?? (o.set ? o.set.toUpperCase() : ''), o.number ? `#${o.number}` : ''].filter(Boolean).join(' · ')
          return (
            <button key={o.scryfallId} type="button" className="storage-row press" onClick={() => onPick(o, data ?? null)}>
              <div className="storage-text"><b>{o.name}</b>{printing && <span>{printing}</span>}</div>
            </button>
          )
        })}
        <button type="button" className="storage-row press" onClick={() => onPick(null, null)}>
          <div className="storage-text"><b>Empty pocket</b></div>
        </button>
      </div>
      <input
        className="input"
        style={{ marginTop: 12 }}
        placeholder="Or type the card's name"
        aria-label="Or type the card's name"
        value={typed}
        onChange={(e) => { setTyped(e.target.value); setError(null) }}
        onKeyDown={(e) => { if (e.key === 'Enter') void lookUp() }}
      />
      {error && <p className="error" role="alert">{error}</p>}
    </Dialog>
  )
}

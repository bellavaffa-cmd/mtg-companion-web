import { useEffect, useRef, useState } from 'react'
import { getByExactName, getByFuzzyName, getBySetAndNumber, OfflineError } from '../api/scryfall'
import { ActionSheet, type SheetAction } from '../components/ActionSheet'
import { Icon } from '../components/Icon'
import { ArtImage, toArtCrop, useBack } from '../components/kit'
import { TopBar } from '../components/TopBar'
import { cardNameIndex, MIN_MATCH } from '../scan/cardNames'
import { guideInVideo } from '../scan/guide'
import { readCardName, readSmallPrint, titleReader } from '../scan/ocr'
import { parseSetAndNumber, sameCardName, ScanTracker } from '../scan/scanLogic'
import { useSync } from '../sync/SyncContext'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'

/** A card's shape: the guide box matches it. */
const CARD_ASPECT = 63 / 88
/** A pause between reads, so the phone isn't reading flat out. */
const BETWEEN_READS_MS = 150

type Camera = 'starting' | 'on' | 'denied' | 'unsupported' | 'failed'

interface Scanned {
  card: ScryfallCard
  quantity: number
  foil: boolean
}

/** A row of the list: the same card as foil and non-foil are separate rows. */
const rowKey = (s: { card: ScryfallCard; foil: boolean }) => `${s.card.id}${s.foil ? ':foil' : ''}`

/** Whether this printing comes in foil (Scryfall lists its finishes; unknown means maybe). */
const canBeFoil = (card: ScryfallCard) => !card.finishes || card.finishes.includes('foil')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Scan cards with the camera, like the phone app: hold one in the frame and its name is read and
 * looked up; each card goes into a list, and the list is added to a deck or binder in one go.
 */
export function ScanPage() {
  const back = useBack('/search')
  const { decks, collections, addCardToDeck, addEntryToCollection } = useSync()
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const scanNow = useRef(false)
  const [camera, setCamera] = useState<Camera>('starting')
  const [cameraAttempt, setCameraAttempt] = useState(0)
  const [loading, setLoading] = useState<string | null>('Getting the card reader ready…')
  const [status, setStatus] = useState('Hold a card inside the frame, its name in the gold strip.')
  const [seen, setSeen] = useState('')
  const [scanned, setScanned] = useState<Scanned[]>([])
  const [flash, setFlash] = useState(0)
  const [typed, setTyped] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [picking, setPicking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const addScanned = (card: ScryfallCard) => {
    setScanned((list) => {
      const existing = list.find((s) => s.card.id === card.id && !s.foil)
      if (existing) {
        setStatus(`${card.name} ×${existing.quantity + 1}`)
        return list.map((s) => (s === existing ? { ...s, quantity: s.quantity + 1 } : s))
      }
      setStatus(`Added ${card.name}`)
      return [{ card, quantity: 1, foil: false }, ...list]
    })
    setFlash((n) => n + 1)
    navigator.vibrate?.(30)
  }

  // The camera: the back one on a phone, as sharp as it offers. It's let go while the page is hidden
  // (another app, a locked phone) and taken again on return — phones often freeze or stop it then
  // anyway — and a camera that stops by itself (unplugged, taken by another app) says so.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported')
      return
    }
    const release = () => {
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }
    const onVisibility = () => {
      if (!document.hidden) setCameraAttempt((n) => n + 1)
      else if (stream) { release(); setCamera('starting') }
    }
    document.addEventListener('visibilitychange', onVisibility)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        s.getVideoTracks().forEach((t) => t.addEventListener('ended', () => { if (!cancelled && stream === s) setCamera('failed') }))
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
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [cameraAttempt])

  // Reading: one frame at a time, as fast as the reader manages. A card is looked up once its name
  // reads the same twice, and not again while it stays in view (ScanTracker).
  useEffect(() => {
    if (camera !== 'on') return
    let stopped = false
    const tracker = new ScanTracker()
    const found = new Map<string, ScryfallCard>()
    void (async () => {
      let names
      try {
        ;[names] = await Promise.all([
          cardNameIndex(),
          titleReader((p) => setLoading(`Downloading the card reader (first time only)… ${Math.round(p * 100)}%`)),
        ])
      } catch {
        if (!stopped) setLoading("The card reader didn't load. Check your connection, then open Scan again.")
        return
      }
      if (stopped) return
      setLoading(null)
      while (!stopped) {
        const video = videoRef.current
        const guide = guideRef.current
        const box = video && guide && !document.hidden ? guideInVideo(video, guide) : null
        if (!video || !box) { await sleep(300); continue }
        const read = await readCardName(video, box, names).catch(() => null)
        if (stopped) break
        setSeen(read?.seen ?? '')
        const forced = scanNow.current
        scanNow.current = false
        const step = tracker.onRead(read?.match?.name ?? null, forced)
        if (forced && !read?.match) setStatus("Couldn't read a name there — hold the card flat and still, or type it below.")
        if (step.kind === 'lookup') {
          try {
            // The exact printing, from the small print at the bottom — kept only if it names the same
            // card as the title (a misread number mustn't swap in a different card). Otherwise the
            // card's usual printing, by name.
            let card: ScryfallCard | null = null
            const printing = parseSetAndNumber(await readSmallPrint(video, box).catch(() => ''))
            if (stopped) break
            if (printing) {
              const key = `${printing.set}:${printing.number}`
              card = found.get(key) ?? await getBySetAndNumber(printing.set, printing.number).catch(() => null)
              if (card && sameCardName(step.name, card.name)) found.set(key, card)
              else card = null
            }
            if (!card) {
              const byName = found.get(step.name) ?? await getByExactName(step.name)
                .catch((e: unknown) => { if (e instanceof OfflineError) throw e; return getByFuzzyName(step.name) })
              found.set(step.name, byName)
              card = byName
            }
            if (stopped) break
            tracker.added(card.name)
            addScanned(card)
          } catch (e) {
            if (stopped) break
            tracker.failed()
            setStatus(e instanceof OfflineError
              ? "You're offline — cards can't be looked up until the connection is back."
              : `Didn't find “${step.name}” — keep scanning…`)
          }
        }
        await sleep(BETWEEN_READS_MS)
      }
    })()
    return () => { stopped = true }
  }, [camera])

  const addTyped = async () => {
    const name = typed.trim()
    if (!name || lookingUp) return
    setLookingUp(true)
    try {
      // The same matching as scanning, which copes with typos better than Scryfall's fuzzy search
      // ("sol rng" is Sol Ring there, Oathsworn Giant here); that search is the fallback.
      const match = (await cardNameIndex().catch(() => null))?.match(name)
      addScanned(match && match.score >= MIN_MATCH ? await getByExactName(match.name) : await getByFuzzyName(name))
      setTyped('')
    } catch (e) {
      setStatus(e instanceof OfflineError ? "You're offline — cards can't be looked up until the connection is back." : `No card called “${name}”.`)
    } finally {
      setLookingUp(false)
    }
  }

  // Rows are found by their key, not the row seen at render: a scan may have replaced it since.
  /** Switches a row between foil and not, joining the other row of the same card if there is one. */
  const toggleFoil = (key: string) => {
    setScanned((list) => {
      const row = list.find((s) => rowKey(s) === key)
      if (!row) return list
      const other = list.find((s) => s.card.id === row.card.id && s.foil !== row.foil)
      if (!other) return list.map((s) => (s === row ? { ...s, foil: !s.foil } : s))
      return list.filter((s) => s !== row).map((s) => (s === other ? { ...s, quantity: s.quantity + row.quantity } : s))
    })
  }
  /** One more or one less of a row; the last one taken away removes it. */
  const changeQuantity = (key: string, by: number) => {
    setScanned((list) => list.flatMap((s) => (rowKey(s) !== key ? [s] : s.quantity + by > 0 ? [{ ...s, quantity: s.quantity + by }] : [])))
  }

  const total = scanned.reduce((n, s) => n + s.quantity, 0)
  const addAllTo = (target: { kind: 'deck' | 'binder'; id: string; name: string }) => {
    const warnings: string[] = []
    for (const s of scanned) {
      // A deck doesn't track foils; a binder counts them separately.
      if (target.kind === 'deck') {
        const warning = addCardToDeck(target.id, s.card, s.quantity)
        if (warning) warnings.push(warning)
      } else addEntryToCollection(target.id, s.card, s.foil ? 0 : s.quantity, s.foil ? s.quantity : 0)
    }
    setNotice([`Added ${total} ${total === 1 ? 'card' : 'cards'} to ${target.name}.`, ...warnings].join(' '))
    setScanned([])
    setPicking(false)
  }
  const targets: SheetAction[] = [
    ...decks.map((d): SheetAction => ({ label: d.name, icon: 'style', detail: 'Deck', onClick: () => addAllTo({ kind: 'deck', id: d.id, name: d.name }) })),
    ...collections.map((c): SheetAction => ({
      label: c.name, icon: c.type === 'WISHLIST' ? 'star' : 'collections', detail: c.type === 'WISHLIST' ? 'Wishlist' : 'Binder',
      onClick: () => addAllTo({ kind: 'binder', id: c.id, name: c.name }),
    })),
  ]

  return (
    <>
      <TopBar title="Scan cards" onBack={back} />
      <div className="content-scroll scan-page">
        <div className="scan-view" data-no-pull>
          <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
          <div className="scan-guide-wrap">
            <div ref={guideRef} className="scan-guide" style={{ aspectRatio: String(CARD_ASPECT) }} key={flash}>
              <div className="scan-guide-title" />
            </div>
          </div>
          {camera !== 'on' && (
            <div className="scan-camera-note">
              <Icon name={camera === 'starting' ? 'photo_camera' : 'no_photography'} />
              {camera === 'starting' && 'Starting the camera…'}
              {camera === 'denied' && 'The camera is blocked for this site. Allow it in the browser’s site settings, then try again — or type names below.'}
              {camera === 'unsupported' && 'No camera here. Type card names below instead.'}
              {camera === 'failed' && 'The camera stopped or didn’t start. Close other apps using it and try again — or type names below.'}
              {(camera === 'failed' || camera === 'denied') && (
                <button type="button" className="btn line" onClick={() => { setCamera('starting'); setCameraAttempt((n) => n + 1) }}>
                  <Icon name="refresh" aria-hidden />Try again
                </button>
              )}
            </div>
          )}
        </div>

        <div className="scan-status">
          <div aria-live="polite">{(camera === 'on' && loading) || status}</div>
          {!loading && camera === 'on' && <div className="scan-seen">Reading: {seen || '…'}</div>}
        </div>

        {camera === 'on' && !loading && (
          <button type="button" className="btn line block" onClick={() => { scanNow.current = true; setStatus('Reading…') }}>
            <Icon name="center_focus_strong" aria-hidden />Scan now
          </button>
        )}

        <form className="scan-type" onSubmit={(e) => { e.preventDefault(); void addTyped() }}>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a card name" aria-label="Card name" />
          <button type="submit" className="btn gold" disabled={!typed.trim() || lookingUp}>Add</button>
        </form>

        {notice && <div className="notice" style={{ marginTop: 12 }}><Icon name="check_circle" style={{ color: 'var(--ok)', fontSize: 18, marginRight: 6 }} />{notice}</div>}

        {scanned.length > 0 && (
          <>
            <div className="scan-list-head">
              <span>{total} {total === 1 ? 'card' : 'cards'} scanned</span>
              <button type="button" className="btn gold" onClick={() => setPicking(true)}>
                <Icon name="add" aria-hidden />Add to a deck or binder
              </button>
            </div>
            <div className="list">
              {scanned.map((s) => (
                <div key={rowKey(s)} className="crow no-qty scan-row">
                  <ArtImage className="thumb" src={toArtCrop(displayImageUrl(s.card))} seed={s.card.name} colors={s.card.color_identity} />
                  <div className="cmain">
                    <div className="cname">{s.card.name}</div>
                    <div className="cmeta">
                      <span>{[s.card.set_name ?? s.card.set?.toUpperCase(), s.card.collector_number && `#${s.card.collector_number}`].filter(Boolean).join(' · ')}</span>
                    </div>
                    {canBeFoil(s.card) && (
                      <button type="button" className="chip scan-foil" aria-pressed={s.foil} aria-label={`Foil: ${s.card.name}`} onClick={() => toggleFoil(rowKey(s))}>
                        <Icon name="auto_awesome" aria-hidden />Foil
                      </button>
                    )}
                  </div>
                  <div className="scan-qty">
                    <button type="button" className="ib" aria-label={`One less ${s.card.name}`}
                      onClick={() => changeQuantity(rowKey(s), -1)}>
                      <Icon name={s.quantity > 1 ? 'remove' : 'delete'} aria-hidden />
                    </button>
                    <b>{s.quantity}</b>
                    <button type="button" className="ib" aria-label={`One more ${s.card.name}`}
                      onClick={() => changeQuantity(rowKey(s), 1)}>
                      <Icon name="add" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {picking && (
        <ActionSheet
          title={`Add ${total} ${total === 1 ? 'card' : 'cards'} to…`}
          actions={targets.length > 0 ? targets : [{ label: 'No decks or binders yet — make one first', icon: 'info', onClick: () => setPicking(false) }]}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

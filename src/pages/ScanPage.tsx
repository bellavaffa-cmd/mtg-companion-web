import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getByExactName, getByFuzzyName, getBySetAndNumber, getCardsByIds, getPrintings, OfflineError } from '../api/scryfall'
import { ActionSheet, type SheetAction } from '../components/ActionSheet'
import { Icon } from '../components/Icon'
import { ArtImage, PillChip, toArtCrop, useBack } from '../components/kit'
import { Dialog } from '../components/Dialog'
import { PrintingPicker, printingName } from '../components/PrintingPicker'
import { useLeaveGuard } from '../components/useLeaveGuard'
import { useKeepAwake } from '../components/useKeepAwake'
import { TopBar } from '../components/TopBar'
import { cardNameIndex, MIN_MATCH } from '../scan/cardNames'
import { guideInVideo } from '../scan/guide'
import { cameraSignatures, decideInSet, matchPrinting, measurePrintings, type ArtSignature } from '../scan/printingMatch'
import { readCardName, readSmallPrint, STRIP_STYLES, titleReader, type Box, type StripStyle } from '../scan/ocr'
import { flatCanvas, flatSignatures, flattenCard, wholeCard, type FlatCard } from '../scan/flatCard'
import { loadRecognizer, recognize, recognizerReady } from '../scan/cardRecognizer'
import { cardBySight, choosePrinting, looksLikeAnotherCard, smallPrintAgrees } from '../scan/sight'
import { regularInSet } from '../collection/printings'
import { confirmRead, parseSetAndNumber, parseSetCode, sameCardName, SCAN_MODES, scanModeOf, ScanTracker, type ScanMode } from '../scan/scanLogic'
import { appLinkPath, qrReader } from '../scan/qr'
import { copyNumber, grouped, onlyRepeats, repeatedCards, scannedTwiceOver, type ScanRow } from '../scan/scanLog'
import { useSync } from '../sync/SyncContext'
import { isUnsorted, UNSORTED_COLLECTION_ID } from '../types/models'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'

/** A card's shape: the guide box matches it. */
const CARD_ASPECT = 63 / 88
/** A pause between reads, so the phone isn't reading flat out. */
const BETWEEN_READS_MS = 150
/**
 * How long Accurate scanning keeps reading the small print, on fresh frames, once its first goes
 * haven't made it out — glare or blur on the bottom edge often clears a moment later. The card must
 * still be in the guide; a card whose small print reads straight away isn't held up at all.
 */
const SMALL_PRINT_PATIENCE_MS = 1000

/** Frames in a row the title has to fail to read before the card is looked for by sight instead. */
const SIGHT_AFTER_BLANK = 2
/** How often the camera is checked for a QR code. */
const QR_EVERY_MS = 400

type Camera = 'starting' | 'on' | 'denied' | 'unsupported' | 'failed'

/** A row of the list: the same card as foil and non-foil are separate rows. */
/** Scans counted up, so each row stays its own even when the same card comes round twice. */
let nextScanId = 1

/**
 * Printings looked up this session, by card name. Scanning a pile of lands asks after the same
 * eight hundred Plains printings over and over otherwise, and Scryfall is owed better than that.
 */
const printingsByName = new Map<string, Promise<ScryfallCard[]>>()
/** What the scanner decided, in the console while developing (the scan test rig reads it). */
const devLog = (message: string) => { if (import.meta.env.DEV) console.debug(`[ScanTiming] ${message}`) }

/** Printings fetched by id this session, for a card seen by sight more than once. */
const printingById = new Map<string, ScryfallCard>()


/**
 * The pile is kept for this tab while the app is open: a card scanned isn't lost to a reload, a
 * phone's back gesture, or a wander off to look something up.
 */
const PILE_KEY = 'mtgweb_scan_pile'

/** Fast or Accurate, kept on this device for next time. */
const MODE_KEY = 'mtgweb_scan_mode'
const PILE_KEEP = 300

function loadPile(): ScanRow[] {
  try {
    const rows = JSON.parse(sessionStorage.getItem(PILE_KEY) ?? '[]') as ScanRow[]
    if (!Array.isArray(rows)) return []
    nextScanId = Math.max(nextScanId, ...rows.map((r) => r.id + 1))
    return rows
  } catch {
    return []
  }
}

function savePile(rows: ScanRow[]) {
  try {
    sessionStorage.setItem(PILE_KEY, JSON.stringify(rows.slice(0, PILE_KEEP)))
  } catch {
    // A tab that won't store it still has the pile on screen.
  }
}

/** Whether this printing comes in foil (Scryfall lists its finishes; unknown means maybe). */
const canBeFoil = (card: ScryfallCard) => !card.finishes || card.finishes.includes('foil')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Scan cards with the camera, like the phone app: hold one in the frame and its name is read and
 * looked up; each card goes into a list, and the list is added to a deck or binder in one go.
 * The app's QR codes are read too — a friend's, a life counter seat's, a share link — and opened.
 */
export function ScanPage() {
  const back = useBack('/search')
  const navigate = useNavigate()
  const { decks, collections, addCardToDeck, addEntryToCollection, importIntoCollection } = useSync()
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const scanNow = useRef(false)
  const [camera, setCamera] = useState<Camera>('starting')
  const [mode, setMode] = useState<ScanMode>(() => {
    try { return scanModeOf(localStorage.getItem(MODE_KEY)) } catch { return 'accurate' }
  })
  // Read by the camera loop on every frame, so a switch takes effect without restarting it.
  const modeRef = useRef(mode)
  useEffect(() => {
    modeRef.current = mode
    try { localStorage.setItem(MODE_KEY, mode) } catch { /* private mode: it just isn't kept */ }
  }, [mode])
  const [cameraAttempt, setCameraAttempt] = useState(0)
  const [loading, setLoading] = useState<string | null>('Getting the card reader ready…')
  const [status, setStatus] = useState("Hold a card inside the frame, its name in the gold strip — or a friend's QR code.")
  const [seen, setSeen] = useState('')
  const [scanned, setScanned] = useState<ScanRow[]>(loadPile)
  // "Only the ones I may have scanned twice."
  const [repeatsOnly, setRepeatsOnly] = useState(false)
  // Leaving with cards still in the list would throw them away, so it asks first.
  const [leaving, setLeaving] = useState<(() => void) | null>(null)
  useEffect(() => { savePile(scanned) }, [scanned])
  // Scanning a pile is minutes of not touching the screen: don't let it dim and lock.
  useKeepAwake(camera === 'on')
  const [flash, setFlash] = useState(0)
  const [typed, setTyped] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [picking, setPicking] = useState(false)
  // The row whose art is being chosen, when the printing was guessed from the name.
  const [pickingArt, setPickingArt] = useState<ScanRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Every scan is its own row, newest first, so a card read twice shows twice. */
  const addScanned = (card: ScryfallCard, exact = false): number => {
    const id = nextScanId++
    setScanned((list) => {
      const row: ScanRow = { id, card, foil: false, at: Date.now(), exact }
      const next = [row, ...list]
      const copy = copyNumber(next, row)
      setStatus(copy > 1
        ? `${card.name} again — copy ${copy}${scannedTwiceOver(next, row) ? ', scanned just now' : ''}`
        : `Added ${card.name}`)
      return next
    })
    setFlash((n) => n + 1)
    navigator.vibrate?.(30)
    return id
  }

  /**
   * Works out which printing was really in the frame from what the card looked like, and corrects
   * the row without being asked. This runs behind the scan rather than in front of it: fetching a
   * card's printings and their pictures takes a moment, and nobody should have to hold a card still
   * while it happens. The row is left alone if it's been deleted, or its printing already picked by
   * hand, since the scan.
   */
  const matchArt = async (id: number, scanned: ScryfallCard, camera: ArtSignature[], setCode: string | null) => {
    const correct = (pick: ScryfallCard, only: boolean, how: string) => {
      setScanned((list) => list.map((s) => (
        s.id === id && s.card.id === scanned.id && !s.exact ? { ...s, card: pick, exact: only } : s
      )))
      if (pick.id !== scanned.id) setStatus(`${scanned.name} — ${how}`)
    }
    // When the small print gave the set code but not the number, it narrows things first: the name
    // says which card, the set code which of its printings are in play, and the whole card's look —
    // framed, full art, borderless — which of that set's few it is. If nothing in that set looks
    // like the card, the set code was misread, and every printing is compared as if it hadn't been.
    if (setCode) {
      // Every printing may already be here from an earlier copy; then the set's are among them.
      const every = printingsByName.get(scanned.name)
      const inSet = every
        ? (await every).filter((p) => p.set?.toLowerCase() === setCode)
        : await getPrintings(scanned.name, setCode).catch(() => [])
      const regular = regularInSet(inSet)
      if (regular) {
        const decision = decideInSet(camera, await measurePrintings(inSet).catch(() => []), regular)
        if (decision.kind !== 'misread') {
          const pick = decision.kind === 'found' ? decision.pick : decision.regular
          correct(pick, decision.kind === 'found' && decision.only, `matched the art in ${printingName(pick)}`)
          return
        }
      }
    }
    let asked = printingsByName.get(scanned.name)
    if (!asked) {
      asked = getPrintings(scanned.name).catch(() => [])
      printingsByName.set(scanned.name, asked)
    }
    const printings = await asked
    // Nothing came back — offline, most likely. Don't hold on to that as the answer.
    if (printings.length === 0) printingsByName.delete(scanned.name)
    if (printings.length < 2) return
    const found = await matchPrinting(camera, printings).catch(() => null)
    if (!found) return
    correct(found.pick, found.only, `matched the art to ${printingName(found.pick)}`)
  }

  /**
   * Which printing of [named] the flattened card is, by sight — the card index in the browser, no
   * fetching every printing to compare — and whether that's certain (see printingBySight). The set
   * code narrows it when it was read (see choosePrinting). Null when the look can't tell, and the card
   * stays as it was looked up. If the look plainly says it's another card altogether, that's said,
   * and the row is left as a best guess for a tap to fix.
   *
   * When [named] came from the small print ([printed]), the look checks it instead: a set code and
   * number misread as another real printing of the same card would otherwise go in as certain. It's
   * kept (null) when the look bears it out, and overruled by the look when it doesn't.
   */
  const sightPrinting = async (flat: FlatCard, named: ScryfallCard, setCode: string | null, printed: boolean): Promise<{ card: ScryfallCard; certain: boolean; overruled: boolean } | null> => {
    const started = performance.now()
    // The scan test rig looks at what the recognizer was given.
    if (import.meta.env.DEV) (window as unknown as { lastFlat: FlatCard }).lastFlat = flat
    const seen = await recognize(flat, named.name, setCode, printed ? named.id : undefined).catch(() => null)
    devLog(`by sight ${Math.round(performance.now() - started)} ms: ${seen ? seen.named.slice(0, 3).map((m) => `${m.set} #${m.number} ${m.score.toFixed(3)}`).join(', ') : 'failed'}`)
    if (!seen) return null
    const other = looksLikeAnotherCard(named.name, seen.named, seen.anywhere)
    if (other) {
      setStatus(`Read “${named.name}”, but it looks like ${other.name} — tap the row to check.`)
      return null
    }
    const overruled = printed && !smallPrintAgrees(seen.printing, seen.named)
    if (printed && !overruled) return null
    if (overruled) devLog(`small print said ${named.set} #${named.collector_number}, but it doesn't look like it — going by sight`)
    // Once the small print is overruled, the look's best is the best there is, sure or not.
    const pick = choosePrinting(seen.named, overruled ? [] : seen.inSet) ?? (overruled && seen.named[0] ? { entry: seen.named[0], certain: false } : null)
    if (!pick) return null
    if (pick.entry.id === named.id) return { card: named, certain: pick.certain, overruled }
    let card = printingById.get(pick.entry.id)
    if (!card) {
      card = (await getCardsByIds([pick.entry.id]).catch(() => []))[0]
      if (!card) return null
      printingById.set(pick.entry.id, card)
    }
    return { card, certain: pick.certain, overruled }
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
    const tracker = new ScanTracker(() => SCAN_MODES[modeRef.current].steadyReads)
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
      // Knowing cards by sight: the card index and its model (~26 MB), fetched now the first time and
      // kept by the browser. Until they're here, the art is matched the old way, online.
      loadRecognizer().catch(() => undefined)
      let titleless = 0
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
        // A title that won't read — busy borderless art, glare, a foreign-language card, a torn
        // corner — needn't stop the card: once the card index is here, the whole card is looked up by
        // sight, and a clear match counts as the read. It goes through the same steadiness and
        // not-twice checks as a read title.
        let title = read?.match?.name ?? null
        let seenBySight = false
        titleless = title ? 0 : titleless + 1
        if (!title && titleless >= SIGHT_AFTER_BLANK && recognizerReady()) {
          const flat = flattenCard(video, box)
          const seen = flat ? await recognize(flat).catch(() => null) : null
          const sight = seen ? cardBySight(seen.anywhere) : null
          if (stopped) break
          if (sight) {
            title = sight.name
            seenBySight = true
            devLog(`title unread; by sight: ${sight.name} ${sight.set} #${sight.number} ${sight.score.toFixed(3)}`)
          }
        }
        const step = tracker.onRead(title, forced)
        if (forced && !read?.match) setStatus("Couldn't read a name there — hold the card flat and still, or type it below.")
        if (step.kind === 'lookup') {
          // What the camera actually read, to hold the card it found up against.
          const seenNow = read?.seen?.trim() || step.name
          devLog(`looking up "${step.name}" (read "${seenNow}"${seenBySight ? ', by sight' : ''})`)
          try {
            // The exact printing, from the small print at the bottom — kept only if it names the same
            // card as the title (a misread number mustn't swap in a different card). Otherwise the
            // card's usual printing, by name.
            let card: ScryfallCard | null = null
            // Which printing it is — the alternate art, the borderless one — is only knowable from
            // the tiny line at the bottom, so it's worth a few goes at reading it.
            let printing: ReturnType<typeof parseSetAndNumber> = null
            // The set code on its own, from the first read that got it, for when the number never reads.
            let setCode: string | null = null
            // The card itself, found by its edges and flattened while it's still in the frame: the
            // small print and the look are then read off exactly the card, however it was held.
            const mode = SCAN_MODES[modeRef.current]
            const flat = mode.readsSmallPrint || mode.matchesArt ? flattenCard(video, box) : null
            const flatStrip = flat && mode.readsSmallPrint ? flatCanvas(flat) : null
            // Fast scanning skips the close read and leaves the card as its usual printing. Should
            // the edges have been found wrong, the guide's strip is read too once the flattened
            // card gives no set code, so finding them never reads less than before.
            const reads: [CanvasImageSource, Box, StripStyle][] = !mode.readsSmallPrint ? []
              : flatStrip ? [...STRIP_STYLES.map((s): [CanvasImageSource, Box, StripStyle] => [flatStrip, wholeCard(flatStrip), s]), [video, box, STRIP_STYLES[0]]]
              : STRIP_STYLES.map((s): [CanvasImageSource, Box, StripStyle] => [video, box, s])
            for (const [source, card, style] of reads) {
              if (source === video && flatStrip && setCode) break
              const text = await readSmallPrint(source, card, style).catch(() => '')
              printing = parseSetAndNumber(text)
              setCode ??= parseSetCode(text)
              if (printing || stopped) break
            }
            // Still not read: a few more goes on fresh frames, for as long as the card is in view.
            if (mode.readsSmallPrint && !printing && !stopped) {
              const until = performance.now() + SMALL_PRINT_PATIENCE_MS
              let tries = 0
              while (!printing && !stopped && performance.now() < until) {
                const again = flattenCard(video, box)
                if (!again) break // the card has left the guide
                const strip = flatCanvas(again)
                if (!strip) break
                const text = await readSmallPrint(strip, wholeCard(strip), STRIP_STYLES[tries % STRIP_STYLES.length]).catch(() => '')
                printing = parseSetAndNumber(text)
                setCode ??= parseSetCode(text)
                tries++
              }
              devLog(`small print ${printing ? `read on retry ${tries}` : `still unread after ${tries} more`}`)
            }
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
            // A fuzzy lookup answers half a title with a real card, so the read has to account for
            // the whole name before it's added. Tapping Scan now says "yes, really" and skips this.
            // A card known by sight needs no reading to account for it: its look already did.
            const confirmation = forced || seenBySight ? 'yes' : confirmRead(seenNow, card.name, card.flavor_name)
            if (confirmation !== 'yes') {
              tracker.unconfirmed()
              setStatus(confirmation === 'partial'
                ? `Only read “${seenNow}” — hold the whole card in the frame, its name in the gold strip.`
                : `Read “${seenNow}”, which looks like ${card.flavor_name ?? card.name} — hold the card still and try again.`)
              continue
            }
            tracker.added(card.name)
            // Which printing it is, when the small print didn't say: by sight, from the card index
            // (see sightPrinting) — or, until that's loaded or when the card's edges weren't found,
            // from what the card looked like compared with every printing online (see matchArt).
            // Fast scanning does neither and leaves the card as its usual printing.
            // With the card index, the look also checks a printing the small print named.
            const bySight = mode.matchesArt && flat && recognizerReady() ? await sightPrinting(flat, card, setCode, !!printing) : null
            if (stopped) break
            if (bySight?.overruled) printing = null
            const matchesArt = !printing && mode.matchesArt
            const look = !matchesArt || (flat && recognizerReady()) ? null : flat ? flatSignatures(flat) : cameraSignatures(video, box)
            const added = bySight?.card ?? card
            devLog(`added ${added.name} ${added.set} #${added.collector_number} (${printing ? 'small print' : bySight ? (bySight.certain ? 'by sight, certain' : 'by sight, best guess') : 'usual printing'})`)
            const id = addScanned(added, !!printing || bySight?.certain === true)
            if (look) void matchArt(id, card, look, setCode)
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

  // QR codes, alongside cards and from the start (they don't wait for the card reader): one of the
  // app's opens where it leads — a friend's code asks to add them.
  useEffect(() => {
    if (camera !== 'on') return
    let stopped = false
    let unknown = ''
    void (async () => {
      const read = await qrReader().catch(() => null)
      while (read && !stopped) {
        const video = videoRef.current
        if (video && !document.hidden && video.readyState >= 2) {
          const text = await read(video).catch(() => null)
          if (stopped) break
          const path = text ? appLinkPath(text) : null
          if (path) {
            navigator.vibrate?.(30)
            navigate(path)
            return
          }
          if (text && text !== unknown) {
            unknown = text
            setStatus("That QR code isn't a Manabind one.")
          }
        }
        await sleep(QR_EVERY_MS)
      }
    })()
    return () => { stopped = true }
  }, [camera, navigate])

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

  // Rows are found by their scan, not the row seen at render: a scan may have arrived since.
  /** Switches one scan between foil and not. */
  const toggleFoil = (id: number) => {
    setScanned((list) => list.map((s) => (s.id === id ? { ...s, foil: !s.foil } : s)))
  }
  /** The printing on a row, swapped for the art the user picked. */
  const setPrinting = (id: number, card: ScryfallCard) => {
    setScanned((list) => list.map((s) => (s.id === id ? { ...s, card, exact: true } : s)))
    setPickingArt(null)
  }

  /** Takes one scan off the pile — a card read twice, or read wrongly. */
  const removeScan = (id: number) => {
    setScanned((list) => list.filter((s) => s.id !== id))
  }

  const total = scanned.length
  // The nav bar and the sidebar are the app's own links: caught here, asked about, then followed.
  useLeaveGuard(scanned.length > 0, useCallback((go: () => void) => setLeaving(() => go), []))
  const repeats = repeatedCards(scanned)
  // With nothing scanned twice the filter has nothing to hide — and its chip is gone, so leaving it
  // on would leave an empty list and no way back.
  const filtered = repeatsOnly && repeats.size > 0
  const shownScans = filtered ? onlyRepeats(scanned) : scanned
  const addAllTo = (target: { kind: 'deck' | 'binder' | 'unsorted'; id: string; name: string }) => {
    const warnings: string[] = []
    // Copies are added together only here: the list itself stays one row per scan.
    for (const s of grouped(scanned)) {
      // A deck doesn't track foils; a binder counts them separately.
      if (target.kind === 'deck') {
        // Scanned cards are new copies in hand, not the loose ones in the Unsorted pile.
        const warning = addCardToDeck(target.id, s.card, s.quantity, false)
        if (warning) warnings.push(warning)
      } else if (target.kind === 'unsorted') {
        // The pile straight into the collection, making the Unsorted pile if there isn't one.
        importIntoCollection(UNSORTED_COLLECTION_ID, [{ card: s.card, quantity: s.foil ? 0 : s.quantity, foilQuantity: s.foil ? s.quantity : 0 }])
      } else addEntryToCollection(target.id, s.card, s.foil ? 0 : s.quantity, s.foil ? s.quantity : 0)
    }
    setNotice([`Added ${total} ${total === 1 ? 'card' : 'cards'} to ${target.name}.`, ...warnings].join(' '))
    setScanned([])
    setPicking(false)
  }
  const unsorted = collections.find(isUnsorted)
  const targets: SheetAction[] = [
    // Cards you own but haven't sorted yet: the pile goes in as it is, to be sorted later.
    {
      label: 'Unsorted',
      icon: 'inbox',
      tone: 'gold',
      detail: 'Into your collection, to sort into binders later',
      onClick: () => addAllTo({ kind: 'unsorted', id: UNSORTED_COLLECTION_ID, name: 'Unsorted' }),
    },
    ...decks.map((d): SheetAction => ({ label: d.name, icon: 'style', detail: 'Deck', onClick: () => addAllTo({ kind: 'deck', id: d.id, name: d.name }) })),
    ...collections.filter((c) => c.id !== unsorted?.id).map((c): SheetAction => ({
      label: c.name, icon: c.type === 'WISHLIST' ? 'star' : 'collections', detail: c.type === 'WISHLIST' ? 'Wishlist' : 'Binder',
      onClick: () => addAllTo({ kind: 'binder', id: c.id, name: c.name }),
    })),
  ]

  return (
    <>
      <TopBar
        title="Scan"
        onBack={() => (scanned.length > 0 ? setLeaving(() => back) : back())}
        actions={
          <button
            type="button"
            className="chip scan-mode"
            aria-label={mode === 'fast' ? 'Fast scanning — switch to accurate' : 'Accurate scanning — switch to fast'}
            title={mode === 'fast'
              ? 'Fast: takes a card sooner and leaves its printing as a best guess to change later. Tap for Accurate.'
              : 'Accurate: waits for a steady read and works out the exact printing from the small print or the art. Tap for Fast.'}
            onClick={() => setMode(mode === 'fast' ? 'accurate' : 'fast')}
          >
            <Icon name={mode === 'fast' ? 'bolt' : 'verified'} aria-hidden />{SCAN_MODES[mode].label}
          </button>
        }
      />
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
              <span>
                {total} {total === 1 ? 'scan' : 'scans'}
                {repeats.size > 0 && ` · ${repeats.size} ${repeats.size === 1 ? 'card' : 'cards'} scanned more than once`}
              </span>
              <button type="button" className="btn gold" onClick={() => setPicking(true)}>
                <Icon name="add" aria-hidden />Add to a deck or binder
              </button>
            </div>
            {repeats.size > 0 && (
              <div className="chips" style={{ marginBottom: 10 }}>
                <PillChip
                  label={filtered ? 'Showing repeats only' : 'Show repeats only'}
                  icon="filter_alt"
                  selected={filtered}
                  onClick={() => setRepeatsOnly((v) => !v)}
                />
              </div>
            )}
            <div className="list">
              {shownScans.map((s) => {
                const copy = copyNumber(scanned, s)
                const justNow = copy > 1 && scannedTwiceOver(scanned, s)
                return (
                <div key={s.id} className={`crow no-qty scan-row${justNow ? ' scan-double' : ''}`}>
                  <ArtImage className="thumb" src={toArtCrop(displayImageUrl(s.card))} seed={s.card.name} colors={s.card.color_identity} />
                  <div className="cmain">
                    <div className="cname">{s.card.name}</div>
                    <div className="cmeta">
                      {!s.exact && (
                        <button type="button" className="chip scan-art" onClick={() => setPickingArt(s)}>
                          <Icon name="image_search" aria-hidden />Best guess · pick art
                        </button>
                      )}
                      {copy > 1 && (
                        <span className={`badge ${justNow ? 'warn' : 'soft'}`}>
                          {justNow ? `copy ${copy} · scanned just now` : `copy ${copy}`}
                        </span>
                      )}
                      <span>{printingName(s.card)}</span>
                    </div>
                    {canBeFoil(s.card) && (
                      <button type="button" className="chip scan-foil" aria-pressed={s.foil} aria-label={`Foil: ${s.card.name}`} onClick={() => toggleFoil(s.id)}>
                        <Icon name="auto_awesome" aria-hidden />Foil
                      </button>
                    )}
                  </div>
                  <div className="scan-qty">
                    <button type="button" className="ib" aria-label={`Take off this scan of ${s.card.name}`} onClick={() => removeScan(s.id)}>
                      <Icon name="delete" aria-hidden />
                    </button>
                  </div>
                </div>
                )
              })}
              {filtered && shownScans.length === 0 && <div className="empty-state">Nothing scanned twice.</div>}
            </div>
          </>
        )}
      </div>

      {leaving && (
        <Dialog
          title={`Leave ${total} ${total === 1 ? 'scan' : 'scans'} behind?`}
          onDismiss={() => setLeaving(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => { setLeaving(null); setPicking(true) }}>Put them away</button>
              <button type="button" className="btn danger" onClick={() => { const go = leaving; setScanned([]); setLeaving(null); go?.() }}>Leave</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>They haven't been put into a deck or binder yet, and leaving throws them away.</p>
        </Dialog>
      )}

      {pickingArt && (
        <PrintingPicker
          name={pickingArt.card.name}
          currentId={pickingArt.card.id}
          onPick={(card) => setPrinting(pickingArt.id, card)}
          onClose={() => setPickingArt(null)}
        />
      )}

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

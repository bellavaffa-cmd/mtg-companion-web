import { countAction } from '../usage/usage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getByExactName, getByFuzzyName, getBySetAndNumber, getCardsByIds, getPrintings, OfflineError } from '../api/scryfall'
import { canBeFoil, deckPlace, doneMessage } from '../collection/addTo'
import { AddToSheet, type AddTarget } from '../components/AddToSheet'
import { useAddCheck } from '../components/useAddCheck'
import { useUndoBar } from '../components/useUndoBar'
import { Icon } from '../components/Icon'
import { ArtImage, IconButton, PillChip, toArtCrop, useBack } from '../components/kit'
import { Dialog } from '../components/Dialog'
import { PrintingPicker, printingName } from '../components/PrintingPicker'
import { useLeaveGuard } from '../components/useLeaveGuard'
import { useKeepAwake } from '../components/useKeepAwake'
import { TopBar } from '../components/TopBar'
import { hasTorch, torchConstraints } from '../scan/torch'
import { cardNameIndex, MIN_MATCH } from '../scan/cardNames'
import { guideInVideo } from '../scan/guide'
import { defaultZoom } from '../scan/scanZoom'
import { useScanZoom } from '../components/useScanZoom'
import { loadAutoCamera, useAutoCamera } from '../components/useAutoCamera'
import { ScanZoomControl } from '../components/ScanZoomControl'
import { cameraSignatures, decideInSet, matchPrinting, measurePrintings, type ArtSignature } from '../scan/printingMatch'
import { readCardName, readSmallPrint, STRIP_STYLES, titleReader, type Box, type StripStyle } from '../scan/ocr'
import { flatCanvas, flatSignatures, flattenCard, wholeCard, type FlatCard } from '../scan/flatCard'
import { loadRecognizer, recognize, recognizerReady } from '../scan/cardRecognizer'
import { cardBySight, choosePrinting, looksLikeAnotherCard, smallPrintAgrees } from '../scan/sight'
import { regularInSet } from '../collection/printings'
import { confirmRead, parseSetAndNumber, parseSetCode, sameCardName, SCAN_MODES, scanModeOf, ScanTracker, type ScanMode } from '../scan/scanLogic'
import { appLinkPath, qrReader } from '../scan/qr'
import { copyNumber, grouped, onlyRepeats, repeatedCards, saveNewest, scannedTwiceOver, withPrinting, type ScanRow } from '../scan/scanLog'
import { useSync } from '../sync/SyncContext'
import { cardRecognised, unlockScanAudio } from '../scan/scanFeedback'
import { rarityLabel } from '../scan/scanSounds'
import { UNSORTED_COLLECTION_ID } from '../types/models'
import { isLimited } from '../decks/limited'
import { backImageUrl, cardTags, displayImageUrl, type ScryfallCard } from '../types/scryfall'
import { addedHere, cardFactsOf, placesOf, pocketLabel, putAway, suggestSpot, undoPutAway, type PutAwayResult, type PutAwayStep, type Spot } from '../collection/storagePlaces'
import { PlacePicker } from '../collection/StorageTab'
import { placeIdFromLabel } from '../collection/placeLabel'
import { PlaceLabelSheet } from '../collection/PlaceLabelSheet'
import { pullList, putBackList, rowToTick } from '../collection/pullList'
import { loadPullProgress, loadPutBackProgress, tickRow } from '../collection/pullProgress'
import { reconcile, type CheckScan } from '../collection/placeCheck'
import { loadCheck, saveCheck, type CheckSession } from '../collection/checkSession'
import { nearlyFull, overflowLine, roomLine, spaceOf, spaceRoom } from '../collection/boxSpace'
import '../collection/inventory.css'
import { looseCopies } from '../collection/binderPages'
import { cardsIn, placePath } from '../collection/storagePlaces'
import { fileEveryPile, nextPile, ownedCounts, wantedByDecks, type FiledPiles, type SortScan, type SortSession } from '../collection/sortPiles'
import { loadPiles, loadSort, saveSort } from '../collection/sortSession'
import { SortPilePanel } from '../collection/SortPilePanel'
import {
  apartOf, checkPileCard, deckNeedsOf, derivePiles, fileRecipe, friendWantsOf, HandsFreeCapture, orderedBinders, ownedOf, pileFor, reasonsFor,
  sortCard as sortRecipeCard, spokenPile, type ApartKind, type RecipeChoice, type RecipeCard, type RecipeScan, type SmartContext,
} from '../collection/sortRecipes'
import { loadRecipeSession, loadVoice, saveRecipeSession, sayOutLoud, type RecipeSessionState } from '../collection/recipeSession'
import { RecipeScanPanel } from '../collection/RecipeScanPanel'
import { useCardData } from '../collection/cardData'
import { tradeMatches, type TradeMatch } from '../social/more'
import { useOverview } from '../social/SocialContext'
import { onlyFoilFinish } from '../scan/scanSounds'
import { useMoney } from '../money/currency'
import { addedMove, putAwayMove } from '../collection/copyHistory'
import { recordMoves } from '../collection/copyHistoryStore'
import '../collection/storage.css'

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

/** The zoom last scanned at, kept on this device for next time (see useScanZoom). */
const ZOOM_KEY = 'mtgweb_scan_zoom'

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

/**
 * Every scan is kept. A tab with too little room keeps the newest that fit, and answers how many,
 * so the page can say the rest won't survive a reload (they're still on screen until then).
 */
function savePile(rows: ScanRow[]): number {
  return saveNewest(rows, (keep) => {
    try {
      sessionStorage.setItem(PILE_KEY, JSON.stringify(keep))
      return true
    } catch {
      return false
    }
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One card put away this session (put-away mode): what happened to it, and how to take it back. */
interface PutAwayRow {
  id: number
  card: ScryfallCard
  /** Where it goes: "Red › around “L”", "Page 3, slot 6". */
  hint: string | null
  /** The section or pocket, short, for the list. */
  where: string
  spot: Spot
  result: PutAwayResult
  label: string
  step: PutAwayStep | null
}

const priceOf = (s: string | null | undefined): number | null => { const n = s ? Number(s) : NaN; return Number.isFinite(n) ? n : null }

/** What a sorting recipe needs to know of a scanned card (collection/sortRecipes.ts). */
const recipeCardOf = (card: ScryfallCard, was?: RecipeCard): RecipeCard => ({
  name: card.name,
  colors: card.colors ?? card.card_faces?.[0]?.colors ?? [],
  colorIdentity: card.color_identity ?? [],
  typeLine: card.type_line ?? card.card_faces?.[0]?.type_line ?? null,
  set: card.set ?? null,
  collectorNumber: card.collector_number ?? null,
  cmc: card.cmc ?? null,
  rarity: card.rarity ?? null,
  usd: priceOf(card.prices?.usd),
  usdFoil: priceOf(card.prices?.usd_foil),
  // The camera can't see foil; a printing that's only foil is. The rest the card's own switches say.
  foil: was?.foil ?? onlyFoilFinish(card.finishes),
  lang: was?.lang ?? 'en',
  played: was?.played ?? false,
})

/** Nothing for the smart piles to go by (not sorting with a recipe). */
const NO_CONTEXT: SmartContext = { deckNeeds: {}, friendWants: {}, binders: [], owned: {} }

/** A scanned card as a new binder entry, with no copies yet — as the scanner's Add to… makes it. */
const entryOf = (card: ScryfallCard) => ({
  scryfallId: card.id, name: card.name, imageUrl: displayImageUrl(card), quantity: 0, foilQuantity: 0,
  backImageUrl: backImageUrl(card), tags: cardTags(card),
})

/**
 * Scan cards with the camera, like the phone app: hold one in the frame and its name is read and
 * looked up; each card goes into a list, and the list is added to a deck or binder in one go.
 * The app's QR codes are read too — a friend's, a life counter seat's, a share link — and opened.
 */
export function ScanPage() {
  const back = useBack('/search')
  const navigate = useNavigate()
  const { addCardToDeck, addCardsToDeck, addCardToSideboard, addEntryToCollection, importIntoCollection, recordUndo, collections, decks, changeStorage } = useSync()
  // Put-away mode (?putAway=<place>): each card scanned is put away into that place at once, rather
  // than gathered into a pile (see collection/storagePlaces.ts).
  const [params, setParams] = useSearchParams()
  const target = placesOf(collections).find((p) => p.id === params.get('putAway')) ?? null
  const [session, setSession] = useState<PutAwayRow[]>([])
  const [choosingPlace, setChoosingPlace] = useState(false)
  /** Puts [card] away into the target; read by the camera loop, so it always sees the place chosen now. */
  const putAwayCard = useRef<((card: ScryfallCard, id: number) => void) | null>(null)
  putAwayCard.current = target
    ? (card, id) => {
      const got: { row?: PutAwayRow } = {}
      changeStorage((c) => {
        const { spot, hint } = suggestSpot(target, cardFactsOf(card), c)
        const o = putAway(c, card, spot, entryOf(card))
        const where = spot.section ?? (spot.page && spot.slot ? pocketLabel(spot.page, spot.slot) : target.name)
        got.row = { id, card, hint, where, spot, result: o.result, label: o.label, step: o.step }
        return o.collections
      })
      const row = got.row
      if (!row) return
      // The copy's history (collection/copyHistory.ts): put away from where it was, or added here.
      const placesNow = placesOf(collections)
      const fromPlace = row.step?.from ? placesNow.find((p) => p.id === row.step!.from!.placeId) : undefined
      const here = { id: target.id, name: [target.name, row.spot.section].filter(Boolean).join(' › ') }
      if (row.result === 'new') recordMoves([addedMove(Date.now(), { name: card.name, scryfallId: card.id }, 1, here, 'by scanning')])
      else if (row.result !== 'here') recordMoves([putAwayMove(Date.now(), { name: card.name, scryfallId: card.id }, 1, here, fromPlace ? { id: fromPlace.id, name: fromPlace.name } : row.step?.collectionId === UNSORTED_COLLECTION_ID ? { id: '', name: 'Unsorted' } : null, 'by scanning')])
      setSession((list) => [row, ...list])
      sayCard(`${card.name} — ${row.label}`, card)
    }
    : null
  // Check mode (?check=<place>): each card scanned is matched against what's listed in that place (or
  // one section of it), live — "belongs here", "should be in Blue", "listed in Krenko deck" — and
  // Finish check opens the results (collection/placeCheck.ts, CheckResultsPage.tsx). The scans are
  // kept in the tab (checkSession.ts), so the results page and a reload see them.
  const checkPlace = placesOf(collections).find((p) => p.id === params.get('check')) ?? null
  const [check, setCheck] = useState<CheckSession | null>(() => {
    const id = params.get('check')
    return id ? loadCheck(id) ?? { placeId: id, section: null, scans: [] } : null
  })
  const checkResult = useMemo(
    () => (check && checkPlace ? reconcile(collections, decks, { placeId: check.placeId, section: check.section }, check.scans) : null),
    [check, checkPlace, collections, decks],
  )
  // The check as it stands, for the camera loop: two cards read close together both count.
  const checkNow = useRef(check)
  const changeCheck = (next: CheckSession) => { checkNow.current = next; saveCheck(next); setCheck(next) }
  const checkCard = useRef<((card: ScryfallCard, exact: boolean) => void) | null>(null)
  checkCard.current = check && checkPlace && !target
    ? (card, exact) => {
      const now = checkNow.current
      if (!now) return
      // The scanner can't see foil, so a scan matches plain or foil copies.
      const scan: CheckScan = { scryfallId: card.id, name: card.name, imageUrl: displayImageUrl(card), foil: null, exact }
      const next = { ...now, scans: [...now.scans, scan] }
      changeCheck(next)
      const line = reconcile(collections, decks, { placeId: next.placeId, section: next.section }, next.scans).lines.at(-1)
      sayCard(`${card.name} — ${line?.label ?? 'scanned'}`, card)
    }
    : null
  // Scan-to-tick mode (?pull=<deck> or ?putBack=<deck>): each card scanned ticks its row on that deck's
  // pull list or put-back list (collection/pullList.ts), kept where the list keeps its ticks.
  const tickDeck = decks.find((d) => d.id === (params.get('pull') ?? params.get('putBack'))) ?? null
  const tickKind: 'pull' | 'putBack' | null = !tickDeck || target || checkPlace ? null : params.get('pull') ? 'pull' : 'putBack'
  const [tickCount, setTickCount] = useState<{ done: number; of: number } | null>(null)
  const tickCard = useRef<((card: ScryfallCard) => void) | null>(null)
  tickCard.current = tickDeck && tickKind
    ? (card) => {
      const rows: { key: string; name: string; qty: number; source?: { kind: string }; where?: string }[] = tickKind === 'pull'
        ? pullList(tickDeck, collections, decks).groups.flatMap((g) => g.rows)
        : putBackList(tickDeck, collections, loadPutBackProgress(tickDeck.id).mode === 'RULE' ? 'RULE' : 'ORIGIN').groups.flatMap((g) => g.rows)
      const ticked = new Set((tickKind === 'pull' ? loadPullProgress(tickDeck.id) : loadPutBackProgress(tickDeck.id)).ticked)
      const row = rowToTick(rows, ticked, card.name)
      const countable = rows.filter((r) => r.source?.kind !== 'missing')
      const of = countable.reduce((n, r) => n + r.qty, 0)
      if (!row) {
        const onList = rows.some((r) => r.name.toLowerCase() === card.name.toLowerCase())
        sayCard(onList ? `${card.name} — already ticked` : `${card.name} isn't on the list`, card)
        return
      }
      if (row.source?.kind === 'deck') {
        sayCard(`${card.name} is only in another deck — tick it on the list to take it`, card)
        return
      }
      const now = new Set(tickRow(tickKind, tickDeck.id, row.key).ticked)
      const done = countable.filter((r) => now.has(r.key)).reduce((n, r) => n + r.qty, 0)
      setTickCount({ done, of })
      sayCard(`${card.name} — ticked${row.where ? ` (${row.where})` : ''}`, card)
    }
    : null
  // Sort mode (?sort): each card scanned goes in the first pile whose rule fits it — shown big, in its
  // pile's colour — and Done files every pile at once (collection/sortPiles.ts, SortPilePanel.tsx).
  // The sort is kept in the tab (sortSession.ts), so a reload doesn't lose it.
  const sortMode = params.has('sort') && !target && !checkPlace && !tickKind
  const [sort, setSortState] = useState<SortSession | null>(() => (params.has('sort') ? loadSort() ?? { source: '', rules: loadPiles(collections), newCards: true, scans: [] } : null))
  const sortNow = useRef(sort)
  const setSort = (next: SortSession | null) => { sortNow.current = next; saveSort(next); setSortState(next) }
  const owned = useMemo(() => (sortMode ? ownedCounts(collections, decks) : new Map<string, number>()), [sortMode, collections, decks])
  const wanted = useMemo(() => (sortMode ? wantedByDecks(collections, decks) : new Map<string, { decks: string[]; qty: number }>()), [sortMode, collections, decks])
  const sortCard = useRef<((card: ScryfallCard, id: number) => void) | null>(null)
  sortCard.current = sortMode
    ? (card, id) => {
      const now = sortNow.current ?? { source: '', rules: loadPiles(collections), newCards: true, scans: [] }
      const usd = Number(card.prices?.usd ?? card.prices?.usd_foil)
      const price = Number.isFinite(usd) && (card.prices?.usd || card.prices?.usd_foil) ? usd : null
      const choice = nextPile(now, { name: card.name, rarity: card.rarity, usd: price }, owned, wanted)
      const scan: SortScan = {
        id, scryfallId: card.id, name: card.name, rarity: card.rarity ?? null, usd: price, facts: cardFactsOf(card), entry: entryOf(card),
        pile: choice?.index ?? -1, why: choice?.why ?? '', ...(choice && choice.decks.length > 0 ? { decks: choice.decks } : {}),
      }
      setSort({ ...now, scans: [...now.scans, scan] })
      sayCard(choice ? `${card.name} — pile ${choice.index + 1}` : `${card.name} — no pile fits`, card)
    }
    : null
  const fileSort = () => {
    const now = sortNow.current
    if (!now || now.scans.length === 0) return
    const at = Date.now()
    let filed: FiledPiles | null = null
    changeStorage((c) => { filed = fileEveryPile(c, now); return filed.collections })
    const done = filed as FiledPiles | null
    if (done) {
      const placeOf = (id: string | undefined) => (id ? placesOf(done.collections).find((p) => p.id === id) ?? null : null)
      recordMoves(done.steps.map(({ scan, step, to }) => {
        const place = placeOf(step?.to.placeId)
        const where = place ? { id: place.id, name: to } : null
        return now.newCards || !step
          ? addedMove(at, scan, 1, where, now.source.trim() || undefined)
          : putAwayMove(at, scan, 1, where ?? { id: '', name: to }, step.from ? placeOf(step.from.placeId) : null, 'sorting a pile')
      }))
    }
    const n = now.scans.length
    setSort({ ...now, scans: [] })
    showUndo({ message: `Filed ${n} ${n === 1 ? 'card' : 'cards'}${now.source.trim() ? ` from ${now.source.trim()}` : ''}` })
  }
  // Recipe mode (?recipe): sorting with a recipe (collection/sortRecipes.ts) — each card goes in its
  // pile, shown big and said out loud, and taken without a tap when the recipe's switch says so
  // (HandsFreeCapture). The sort is kept in this browser (recipeSession.ts), so a restart doesn't lose
  // it; Done opens what went where (SortRecipesPage.tsx's summary). With a pile to check, each card is
  // checked against that pile instead.
  const recipeMode = params.has('recipe') && !target && !checkPlace && !tickKind && !sortMode
  const money = useMoney()
  const [recipe, setRecipeState] = useState<RecipeSessionState | null>(() => (params.has('recipe') ? loadRecipeSession() : null))
  const recipeNow = useRef(recipe)
  const setRecipe = (next: RecipeSessionState | null) => { recipeNow.current = next; saveRecipeSession(next); setRecipeState(next) }
  const voice = useMemo(loadVoice, [])
  /** Read by the camera loop: whether cards are taken without a tap. Null when not sorting with a recipe. */
  const handsFreeOn = useRef<boolean | null>(null)
  handsFreeOn.current = recipeMode && recipe ? voice.auto : null
  const handsFree = useRef(new HandsFreeCapture())
  const sortingWith = recipe?.recipe
  const derived = useMemo(() => (sortingWith ? derivePiles(sortingWith, (n) => money.formatLocal(n, Number.isInteger(n))) : null), [sortingWith, money])
  const [matches, setMatches] = useState<TradeMatch[]>([])
  const { person } = useOverview()
  useEffect(() => {
    if (!recipeMode) return
    let off = false
    tradeMatches().then((m) => { if (!off) setMatches(m) }).catch(() => { /* signed out or offline: no friends' wants */ })
    return () => { off = true }
  }, [recipeMode])
  const binderIds = useMemo(() => (recipeMode
    ? placesOf(collections).filter((p) => p.kind === 'BINDER' && p.sortRule).flatMap((p) => cardsIn(collections, p.id).map((c) => c.entry.scryfallId))
    : []), [recipeMode, collections])
  const binderData = useCardData(binderIds)
  const smart = useMemo<SmartContext>(() => (recipeMode
    ? {
      deckNeeds: deckNeedsOf(collections, decks),
      friendWants: friendWantsOf(matches, (id) => { const p = person(id); return p ? p.display_name || p.username : null }),
      binders: orderedBinders(collections, (id) => { const c = binderData?.get(id); return c ? cardFactsOf(c) : null }),
      owned: ownedOf(collections, decks),
    }
    : NO_CONTEXT), [recipeMode, collections, decks, matches, binderData, person])
  /** The cards of this sort as Scryfall has them, by scan, for Wrong card? and Put in deck now. */
  const recipeCards = useRef(new Map<number, ScryfallCard>())
  const [wrongCard, setWrongCard] = useState(false)
  const [pickingRecipeArt, setPickingRecipeArt] = useState(false)
  /** The pile in words, said out loud and buzzed: a smart pile buzzes twice. */
  const announce = (pileNumber: number, reason: RecipeScan['reason'], name: string) => {
    const pile = derived?.piles.find((p) => p.number === pileNumber)
    if (!pile) return
    if (voice.speak) sayOutLoud(spokenPile(pile, reason ?? null))
    navigator.vibrate?.(reason ? [40, 60, 40] : 30)
    setStatusRarity(null)
    setStatus(`Pile ${pile.number}, ${pile.name} — ${name}`)
  }
  const recipeCard = useRef<((card: ScryfallCard, id: number) => void) | null>(null)
  recipeCard.current = recipeMode && recipe && derived
    ? (card, id) => {
      const now = recipeNow.current
      if (!now || !derived) return
      handsFree.current.captured(card.name)
      // Checking a pile: does this card belong in it?
      if (now.checking) {
        const c = now.checking
        const verdict = checkPileCard(derived, now.scans, c.pile, c.checked, card.name)
        setRecipe({ ...now, checking: { ...c, checked: verdict.belongs ? [...c.checked, card.name] : c.checked, flagged: verdict.belongs ? c.flagged : [...c.flagged, { name: card.name, line: verdict.line }] } })
        if (voice.speak) sayOutLoud(verdict.belongs ? 'Belongs' : verdict.goes ? `No — pile ${verdict.goes}` : "No — not sorted")
        navigator.vibrate?.(verdict.belongs ? 30 : [80, 60, 80])
        setStatus(`${card.name} — ${verdict.line}`)
        return
      }
      const rc = recipeCardOf(card)
      // A card already put with its deck is in the collection now, so the collection counts it, not the sort.
      const choice = sortRecipeCard(now.recipe, derived, smart, rc, now.scans.filter((x) => !x.filed), money.rate)
      recipeCards.current.set(id, card)
      const scan: RecipeScan = {
        id, scryfallId: card.id, name: card.name, setName: card.set_name ?? null, card: rc, facts: cardFactsOf(card), entry: entryOf(card),
        pile: choice.pile, key: choice.key, reason: choice.reason, also: choice.also, at: Date.now(),
      }
      setRecipe({ ...now, scans: [...now.scans, scan] })
      announce(choice.pile, choice.reason, card.name)
    }
    : null
  /** The newest scan of the sort, replaced (re-sorted, sent elsewhere…). */
  const changeLast = (change: (last: RecipeScan, rest: RecipeScan[]) => RecipeScan | null) => {
    const now = recipeNow.current
    const last = now?.scans.at(-1)
    if (!now || !last) return
    const rest = now.scans.slice(0, -1)
    const next = change(last, rest)
    setRecipe({ ...now, scans: next ? [...rest, next] : rest })
    if (next && (next.pile !== last.pile || next.reason !== last.reason)) announce(next.pile, next.reason, next.name)
  }
  /** The newest card sorted again as [card] (another printing, or now foil…). */
  const resort = (last: RecipeScan, rest: RecipeScan[], rc: RecipeCard, card?: ScryfallCard): RecipeScan => {
    const now = recipeNow.current!
    const choice = pileFor(now.recipe, derived!, rc, reasonsFor(smart, rc, rest.filter((x) => !x.filed)), money.rate)
    return {
      ...last, ...(card ? { scryfallId: card.id, name: card.name, setName: card.set_name ?? null, facts: cardFactsOf(card), entry: entryOf(card) } : {}),
      card: rc, pile: choice.pile, key: choice.key, reason: choice.reason, also: choice.also,
    }
  }
  const toggleApart = (kind: ApartKind) => changeLast((last, rest) => {
    const c = last.card
    const on = apartOf(c).includes(kind)
    const rc: RecipeCard = kind === 'FOIL' ? { ...c, foil: !on } : kind === 'FOREIGN' ? { ...c, lang: on ? 'en' : 'xx' } : { ...c, played: !on }
    return resort(last, rest, rc)
  })
  const sendTo = (choice: RecipeChoice) => changeLast((last) => ({ ...last, pile: choice.pile, key: choice.key, reason: choice.reason, also: choice.also }))
  const putInDeckNow = () => {
    const now = recipeNow.current
    const last = now?.scans.at(-1)
    if (!now || !last || last.reason?.kind !== 'DECKS' || !derived) return
    const deck = decks.find((d) => d.id === (last.reason as { deckId: string }).deckId)
    const card = recipeCards.current.get(last.id)
    // A deck that holds its own copies takes the card into its list; otherwise it's yours now, for the deck's pull list.
    if (deck?.ownership === 'PHYSICAL' && card) addCardToDeck(deck.id, card, 1, false)
    else changeStorage((c) => fileRecipe(c, now.recipe, derived, [last]).collections)
    setRecipe({ ...now, scans: [...now.scans.slice(0, -1), { ...last, filed: true }] })
    setStatus(`${last.name} — put with ${deck?.name ?? 'its deck'}`)
  }
  const recipeMiss = (seen: string) => {
    const now = recipeNow.current
    if (!now || now.checking) return
    const before = now.misses.at(-1)
    if (before && before.seen === seen && Date.now() - before.at < 10_000) return
    setRecipe({ ...now, misses: [...now.misses, { at: Date.now(), seen }] })
  }
  const recipeMissRef = useRef(recipeMiss)
  recipeMissRef.current = recipeMiss
  // A box label read by the camera: what it offers, over the camera (PlaceLabelSheet).
  const [labelId, setLabelId] = useState<string | null>(null)
  const labelShown = useRef<string | null>(null)
  const labelDismissedAt = useRef(0)
  const placesNow = useRef(placesOf(collections))
  placesNow.current = placesOf(collections)
  const closeLabel = () => { labelShown.current = null; labelDismissedAt.current = Date.now(); setLabelId(null) }
  /** A card that was already here is another copy after all: it's added, here. */
  const anotherCopy = (row: PutAwayRow) => {
    const got: { step?: PutAwayStep } = {}
    changeStorage((c) => {
      const out = addedHere(c, row.card, row.spot, entryOf(row.card))
      got.step = out.step
      return out.collections
    })
    const step = got.step
    if (step) setSession((list) => [{ ...row, id: nextScanId++, result: 'new', label: 'new to collection', step }, ...list])
  }
  /** Takes back the newest card of the session. */
  const undoLast = () => {
    const [last, ...rest] = session
    if (!last) return
    if (last.step) changeStorage((c) => undoPutAway(c, last.step!))
    setSession(rest)
    setStatus(`${last.card.name} taken back`)
  }
  const confirmAdd = useAddCheck()
  const showUndo = useUndoBar()
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const scanNow = useRef(false)
  const [camera, setCamera] = useState<Camera>('starting')
  /** Set by the camera loop: a zoom change starts the steady reads again (the picture just moved). */
  const settleReads = useRef<() => void>(() => {})
  // Zoomed in so the card fills the frame from where it is comfortable to hold it, which is what
  // decides whether the printing can be read off the card or has to be guessed from its name (see
  // SCAN_ZOOM) — and the − / + chip, a pinch or ctrl + wheel to change it (useScanZoom). With auto
  // zoom and focus (Settings › Scanner) the zoom follows the card and focus is kept on it (useAutoCamera).
  const [autoCamera] = useState(loadAutoCamera)
  const zoom = useScanZoom({ storageKey: ZOOM_KEY, defaultFor: defaultZoom, autoEnabled: autoCamera, onZoomChange: () => settleReads.current() })
  const auto = useAutoCamera(zoom, autoCamera, () => settleReads.current())
  const attachZoom = zoom.attach
  const { attach: attachAuto, onFrame: autoFrame, adjusting: autoAdjusting } = auto
  // The camera's light, when it has one (see scan/torch.ts), and whether it's on.
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean } | null>(null)
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
  // A screen reader hears a recognised card's rarity with its line ("Added Sol Ring, Uncommon"); the
  // line on screen stays as it was. Kept with the line it goes with, so a later line doesn't get it.
  const [statusRarity, setStatusRarity] = useState<{ status: string; rarity: string } | null>(null)
  /** The line for a card just recognised, with its rarity for a screen reader. */
  const sayCard = (text: string, card: ScryfallCard) => {
    const rarity = rarityLabel(card.rarity)
    setStatusRarity(rarity ? { status: text, rarity } : null)
    setStatus(text)
  }
  // Browsers only make sound after a tap: the scanner's first one readies the scan sounds.
  useEffect(() => {
    unlockScanAudio()
    const unlock = () => unlockScanAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])
  const [seen, setSeen] = useState('')
  const [scanned, setScanned] = useState<ScanRow[]>(loadPile)
  // "Only the ones I may have scanned twice."
  const [repeatsOnly, setRepeatsOnly] = useState(false)
  // Leaving with cards still in the list would throw them away, so it asks first.
  const [leaving, setLeaving] = useState<(() => void) | null>(null)
  // How many scans a reload would bring back: fewer than the pile when this tab ran out of room.
  const [pileKept, setPileKept] = useState(Infinity)
  useEffect(() => { setPileKept(savePile(scanned)) }, [scanned])
  // Scanning a pile is minutes of not touching the screen: don't let it dim and lock.
  useKeepAwake(camera === 'on')
  const [flash, setFlash] = useState(0)
  const [typed, setTyped] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [picking, setPicking] = useState(false)
  // The row whose art is being chosen, when the printing was guessed from the name.
  const [pickingArt, setPickingArt] = useState<ScanRow | null>(null)

  /** Every scan is its own row, newest first, so a card read twice shows twice. */
  const addScanned = (card: ScryfallCard, exact = false): number => {
    const id = nextScanId++
    // While a box label's sheet is up, cards wait.
    if (labelShown.current) return id
    countAction('card_scanned')
    // Its sound and buzz (Settings › Scanner): by rarity, or a sting for a valuable card.
    cardRecognised(card)
    const modeCard = recipeCard.current
      ? () => recipeCard.current?.(card, id)
      : sortCard.current
      ? () => sortCard.current?.(card, id)
      : tickCard.current
        ? () => tickCard.current?.(card)
        : putAwayCard.current
          ? () => putAwayCard.current?.(card, id)
          : checkCard.current
            ? () => checkCard.current?.(card, exact)
            : null
    if (modeCard) {
      modeCard()
      setFlash((n) => n + 1)
      return id
    }
    setScanned((list) => {
      const row: ScanRow = { id, card, foil: false, at: Date.now(), exact }
      const next = [row, ...list]
      const copy = copyNumber(next, row)
      const text = copy > 1
        ? `${card.name} again — copy ${copy}${scannedTwiceOver(next, row) ? ', scanned just now' : ''}`
        : `Added ${card.name}`
      const rarity = rarityLabel(card.rarity)
      setStatusRarity(rarity ? { status: text, rarity } : null)
      setStatus(text)
      return next
    })
    setFlash((n) => n + 1)
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
        s.id === id && s.card.id === scanned.id && !s.exact ? withPrinting(s, pick, only) : s
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
      setTorch(null)
      attachZoom(null)
      attachAuto(null)
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
        // The zoom, asked for once the stream is running, because only then does the camera say
        // what zoom it has; a camera with none — most laptops — is left alone, with no control.
        attachZoom(s.getVideoTracks()[0] ?? null)
        // Continuous focus and exposure, where it has them and auto focus is on.
        attachAuto(s.getVideoTracks()[0] ?? null)
        // The light, when this camera has one; it starts off, as the camera does.
        const lit = s.getVideoTracks().find((t) => hasTorch(t.getCapabilities?.()))
        setTorch(lit ? { track: lit, on: false } : null)
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
  }, [cameraAttempt, attachZoom, attachAuto])

  // Reading: one frame at a time, as fast as the reader manages. A card is looked up once its name
  // reads the same twice, and not again while it stays in view (ScanTracker).
  useEffect(() => {
    if (camera !== 'on') return
    let stopped = false
    const tracker = new ScanTracker(() => SCAN_MODES[modeRef.current].steadyReads)
    settleReads.current = () => { tracker.settle(); handsFree.current.settle() }
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
        // Mid-pinch the picture is moving under the card: nothing is read, let alone taken, until
        // the fingers are off (the reads then start again from nothing — see settleReads).
        // The same while the focus is being run again.
        if (zoom.pinching.current || autoAdjusting.current) { await sleep(BETWEEN_READS_MS); continue }
        const read = await readCardName(video, box, names).catch(() => null)
        if (stopped) break
        // Auto zoom and focus look at the same frame: where the card is, and whether it's sharp.
        autoFrame(video, box, !!read?.match)
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
        // Sorting with a recipe: a card is taken when it's held still and wasn't the card just taken
        // (HandsFreeCapture) — or, with that switched off, only with Scan now.
        const handsFreeNow = handsFreeOn.current
        const step = handsFreeNow === null || forced
          ? tracker.onRead(title, forced)
          : handsFreeNow && !labelShown.current && handsFree.current.onRead(title) && title ? { kind: 'lookup' as const, name: title } : { kind: 'wait' as const }
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
              if (handsFreeOn.current !== null) {
                handsFree.current.missed()
                if (confirmation === 'different') recipeMissRef.current(seenNow)
              }
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
            // Put away already: the printing is matched on the card's name, so it's left as it is.
            if (look && !putAwayCard.current && !checkCard.current && !sortCard.current) void matchArt(id, card, look, setCode)
          } catch (e) {
            if (stopped) break
            tracker.failed()
            if (handsFreeOn.current !== null) {
              handsFree.current.missed()
              if (!(e instanceof OfflineError)) recipeMissRef.current(step.name)
            }
            setStatus(e instanceof OfflineError
              ? "You're offline — cards can't be looked up until the connection is back."
              : `Didn't find “${step.name}” — keep scanning…`)
          }
        }
        await sleep(BETWEEN_READS_MS)
      }
    })()
    return () => { stopped = true; settleReads.current = () => {} }
  }, [camera, zoom.pinching, autoAdjusting, autoFrame])

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
          // A box label: its sheet, unless one is up or was just closed (the label's still in view).
          const label = text ? placeIdFromLabel(text) : null
          if (label && (!label.bare || placesNow.current.some((p) => p.id === label.id))) {
            if (!labelShown.current && Date.now() - labelDismissedAt.current > 3000) {
              labelShown.current = label.id
              navigator.vibrate?.(30)
              setLabelId(label.id)
            }
            await sleep(QR_EVERY_MS)
            continue
          }
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
    setScanned((list) => list.map((s) => (s.id === id ? withPrinting(s, card, true) : s)))
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
  const addAllTo = async (target: AddTarget) => {
    let groups = grouped(scanned)
    let pile = scanned
    let left: typeof scanned = []
    if (target.kind === 'deck' && !target.considering) {
      // Asked first when a card breaks the deck's rules; cards left out stay on the pile.
      const ok = await confirmAdd(target, groups, (g) => ({ scryfallId: g.card.id, name: g.card.name, quantity: g.quantity, card: g.card, toSideboard: !!target.sideboard }))
      if (!ok || ok.length === 0) return
      const going = new Set(ok.map((g) => `${g.card.id}:${g.foil}`))
      groups = ok
      pile = scanned.filter((s) => going.has(`${s.card.id}:${s.foil}`))
      left = scanned.filter((s) => !going.has(`${s.card.id}:${s.foil}`))
    }
    const count = pile.length
    const undo = recordUndo(() => {
      // Copies are added together only here: the list itself stays one row per scan.
      for (const s of groups) {
        // A deck doesn't track foils; a binder counts them separately.
        if (target.kind === 'deck') {
          if (target.considering) {
            addCardsToDeck(target.id, [s.card], true)
            continue
          }
          // A sideboard — a Limited deck's pool, say — takes the copies as they are.
          if (target.sideboard) {
            addCardToSideboard(target.id, s.card, s.quantity)
            continue
          }
          // Scanned cards are new copies in hand, not the loose ones in the Unsorted pile.
          addCardToDeck(target.id, s.card, s.quantity, false)
        } else if (target.id === UNSORTED_COLLECTION_ID) {
          // The pile straight into the collection, making the Unsorted pile if there isn't one.
          importIntoCollection(UNSORTED_COLLECTION_ID, [{ card: s.card, quantity: s.foil ? 0 : s.quantity, foilQuantity: s.foil ? s.quantity : 0 }])
        } else addEntryToCollection(target.id, s.card, s.foil ? 0 : s.quantity, s.foil ? s.quantity : 0)
      }
    })
    const place = target.kind === 'deck' ? deckPlace(target.name, target.considering, target.sideboard, isLimited(target.gameMode ?? '')) : target.name
    const before = scanned
    showUndo({
      message: doneMessage('add', `${count} ${count === 1 ? 'card' : 'cards'}`, place),
      undo,
      // Undo puts the scans back too, ready to go somewhere else.
      onUndone: () => setScanned(before),
    })
    setScanned(left)
    setPicking(false)
  }

  const toggleTorch = () => {
    if (!torch) return
    const on = !torch.on
    torch.track.applyConstraints(torchConstraints(on))
      .then(() => setTorch((t) => (t && t.track === torch.track ? { ...t, on } : t)))
      .catch(() => setTorch(null))
  }

  return (
    <>
      <TopBar
        title={target ? 'Put away' : tickKind ? 'Scan to tick' : checkPlace ? 'Check' : sortMode ? 'Sorting a new pile' : recipeMode && recipe ? `Sorting: ${recipe.recipe.name}` : 'Scan'}
        onBack={() => (scanned.length > 0 && !target && !tickKind && !checkPlace ? setLeaving(() => back) : back())}
        actions={
          <>
          {torch && (
            <IconButton
              icon={torch.on ? 'flash_on' : 'flash_off'}
              label={torch.on ? 'Turn off the light' : 'Turn on the light'}
              className={torch.on ? 'on' : ''}
              onClick={toggleTorch}
            />
          )}
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
          </>
        }
      />
      <div className="content-scroll scan-page">
        {tickDeck && tickKind && (
          <div className="putaway-target" role="status">
            <span>
              Ticking off: {tickKind === 'pull' ? 'pull list' : 'put back list'} for {tickDeck.name}
              {tickCount ? ` · ${tickCount.done} of ${tickCount.of}` : ''}
            </span>
          </div>
        )}
        {checkPlace && check && !target && (
          <div className="putaway-target" role="status">
            <span>Checking: {[placePath(placesOf(collections), checkPlace.id), check.section].filter(Boolean).join(' › ')}</span>
            {check.section !== null && (
              <button type="button" className="pull-chip" onClick={() => changeCheck({ ...check, section: null })}>
                Whole {checkPlace.kind === 'BINDER' ? 'binder' : checkPlace.kind === 'BOX' ? 'box' : 'place'}
              </button>
            )}
          </div>
        )}
        {target && (
          <button type="button" className="putaway-target" onClick={() => setChoosingPlace(true)} aria-label={`Putting away into ${target.name} — change`}>
            <span>Putting away into: {target.name}</span>
            <Icon name="expand_more" aria-hidden />
          </button>
        )}
        <div
          ref={zoom.viewRef}
          className={zoom.range ? 'scan-view zoomable' : 'scan-view'}
          data-no-pull
          {...(zoom.range ? { tabIndex: 0, role: 'group', 'aria-label': 'Camera — pinch, or press + and −, to zoom' } : {})}
        >
          <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
          <div className="scan-guide-wrap">
            <div ref={guideRef} className="scan-guide" style={{ aspectRatio: String(CARD_ASPECT) }} key={flash}>
              <div className="scan-guide-title" />
            </div>
          </div>
          {camera === 'on' && <ScanZoomControl zoom={zoom} />}
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
          <div aria-live="polite" aria-atomic="true">
            {(camera === 'on' && loading) || status}
            {!(camera === 'on' && loading) && statusRarity?.status === status && <span className="sr-only">, {statusRarity.rarity}</span>}
          </div>
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

        {sortMode && sort && <SortPilePanel session={sort} onChange={setSort} onDone={fileSort} />}
        {recipeMode && !recipe && (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <div>Pick a recipe to sort with first.</div>
            <button type="button" className="btn gold" onClick={() => navigate('/sort')}>Pick a recipe</button>
          </div>
        )}
        {recipeMode && recipe && derived && (
          <RecipeScanPanel
            session={recipe}
            derived={derived}
            ctx={smart}
            voice={voice}
            rate={money.rate}
            onUndo={() => { changeLast(() => null); handsFree.current.rescan(); setStatus('Last card taken back') }}
            onWrong={() => setWrongCard(true)}
            onSend={sendTo}
            onPutInDeck={putInDeckNow}
            onApart={toggleApart}
            onDone={() => navigate('/sort?summary')}
            onFinishCheck={() => { const now = recipeNow.current; if (now) setRecipe({ ...now, checking: null }); navigate('/sort?summary') }}
          />
        )}
        {target && (() => {
          // A place with a size that's full, or nearly (collection/boxSpace.ts).
          const space = spaceOf(target, collections)
          if (!space) return null
          const warning = spaceRoom(space) <= 0
            ? overflowLine({ placeId: target.id, name: target.name, adding: 1, room: spaceRoom(space) })
            : nearlyFull(space) ? `${target.name}: ${roomLine(space).charAt(0).toLowerCase()}${roomLine(space).slice(1)}` : null
          return warning ? <div className="space-warn" role="status" style={{ marginTop: 8 }}>{warning}</div> : null
        })()}
        {target && session[0] && (() => {
          const last = session[0]
          return (
            <div className="putaway-last">
              <ArtImage className="thumb" src={toArtCrop(displayImageUrl(last.card))} seed={last.card.name} colors={last.card.color_identity} />
              <div className="storage-text">
                <b>{last.card.name}</b>
                {last.result !== 'here' && last.hint && <span className="file-in">File in: {last.hint}</span>}
                {last.result === 'here' && (
                  <button type="button" className="link" style={{ padding: 0, alignSelf: 'flex-start' }} onClick={() => anotherCopy(last)}>It's another copy — add it</button>
                )}
              </div>
              <span className={`putaway-badge ${last.result}`}>{last.label.charAt(0).toUpperCase() + last.label.slice(1)}</span>
            </div>
          )
        })()}
        {checkPlace && check && checkResult && !target && (() => {
          const last = checkResult.lines.at(-1)
          const off = checkResult.extra.slice().reverse().slice(0, 8)
          return (
            <>
              <div className="check-progress">
                <div className="pull-progress-h">
                  <b>{checkResult.here} of {checkResult.expected} scanned</b>
                  <span>{checkResult.here >= checkResult.expected ? 'All found' : 'Keep going'}</span>
                </div>
                <div className="storage-bar"><div style={{ width: `${checkResult.expected ? Math.min(100, (checkResult.here / checkResult.expected) * 100) : 0}%` }} /></div>
              </div>
              {last && (
                <div className={`check-last ${last.kind === 'HERE' ? 'here' : 'off'}`}>
                  <span>{last.scan.name}</span><span>{last.label}</span>
                </div>
              )}
              {off.length > 0 && (
                <>
                  <div className="check-head">Found something that doesn't belong</div>
                  <div className="putaway-rows">
                    {off.map((l, i) => <div key={i} className="check-off"><span>{l.scan.name}</span><span>{l.label}</span></div>)}
                  </div>
                </>
              )}
              <div className="putaway-head">
                <span>{check.scans.length} {check.scans.length === 1 ? 'card' : 'cards'} scanned</span>
                {check.scans.length > 0 && (
                  <button type="button" className="link" onClick={() => { changeCheck({ ...check, scans: check.scans.slice(0, -1) }); setStatus('Last scan taken back') }}>Undo last</button>
                )}
              </div>
              <button type="button" className="btn gold block" style={{ marginTop: 8 }} onClick={() => navigate(`/collections/place/${checkPlace.id}/check`)}>
                Finish check
              </button>
            </>
          )
        })()}
        {target && target.kind === 'BINDER' && target.sortRule && (() => {
          const waiting = looseCopies(target, cardsIn(collections, target.id)).length
          return waiting > 0 ? (
            <div className="putaway-last">
              <div className="storage-text">
                <b>{waiting} {waiting === 1 ? 'card' : 'cards'} to fit in order</b>
                <span>Keep them beside the binder — the steps say where each goes.</span>
              </div>
              <button type="button" className="btn gold" onClick={() => navigate(`/collections/place/${target.id}/fit`)}>Fit in order</button>
            </div>
          ) : null
        })()}
        {target && session.length > 0 && (
          <>
            <div className="putaway-head">
              <span>This session: {session.length} {session.length === 1 ? 'card' : 'cards'}</span>
              <button type="button" className="link" onClick={undoLast}>Undo last</button>
            </div>
            <div className="putaway-rows">
              {session.map((r) => (
                <div key={r.id} className="putaway-row">
                  <span>{r.card.name}</span>
                  <span className={r.result}>{r.where} · {r.label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!target && !tickKind && pileKept < scanned.length && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            This browser is out of room to keep the whole pile. If the page reloads, only the newest {pileKept} of
            your {scanned.length} scans come back — add them to a deck or binder soon.
          </div>
        )}

        {!target && !tickKind && scanned.length > 0 && (
          <>
            <div className="scan-list-head">
              <span>
                {total} {total === 1 ? 'scan' : 'scans'}
                {repeats.size > 0 && ` · ${repeats.size} ${repeats.size === 1 ? 'card' : 'cards'} scanned more than once`}
              </span>
              <button type="button" className="btn gold" onClick={() => setPicking(true)}>
                <Icon name="add" aria-hidden />Add to…
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

      {labelId && (
        <PlaceLabelSheet
          placeId={labelId}
          onPutAway={(id) => { closeLabel(); setParams({ putAway: id }, { replace: true }) }}
          onOpen={(id) => { closeLabel(); navigate(`/collections/place/${id}`) }}
          onPull={(deckId, id) => { closeLabel(); navigate(`/decks/${deckId}/pull?place=${encodeURIComponent(id)}`) }}
          onClose={closeLabel}
        />
      )}

      {choosingPlace && (
        <PlacePicker
          title="Put cards away into…"
          onPick={(id) => setParams({ putAway: id }, { replace: true })}
          onClose={() => setChoosingPlace(false)}
        />
      )}

      {wrongCard && recipe?.scans.at(-1) && (
        <Dialog
          title={`Not ${recipe.scans.at(-1)!.name}?`}
          onDismiss={() => setWrongCard(false)}
          actions={<>
            <button type="button" className="btn line" onClick={() => { setWrongCard(false); setPickingRecipeArt(true) }}>Pick the printing</button>
            <button type="button" className="btn gold" onClick={() => { changeLast(() => null); handsFree.current.rescan(); setWrongCard(false); setStatus('Show the card again') }}>Rescan it</button>
          </>}
        >
          <p className="muted" style={{ margin: 0 }}>Right card, wrong printing: pick the one you're holding. A different card: rescan it — it's taken off its pile first.</p>
        </Dialog>
      )}
      {pickingRecipeArt && recipe?.scans.at(-1) && (
        <PrintingPicker
          name={recipe.scans.at(-1)!.name}
          currentId={recipe.scans.at(-1)!.scryfallId}
          onPick={(card) => {
            setPickingRecipeArt(false)
            changeLast((last, rest) => { recipeCards.current.set(last.id, card); return resort(last, rest, recipeCardOf(card, last.card), card) })
          }}
          onClose={() => setPickingRecipeArt(false)}
        />
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
        <AddToSheet
          verb="add"
          what={`${total} ${total === 1 ? 'card' : 'cards'}`}
          unsorted
          create
          // Each scan is a copy and says whether it's foil, so there's nothing to count or switch here.
          quantity={null}
          // A deck's sideboard too: a draft or sealed pool is scanned straight in.
          sideboard
          onPick={addAllTo}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

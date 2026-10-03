import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { ArtImage, PillChip, toArtCrop } from './kit'
import { useSync } from '../sync/SyncContext'
import { kindDetail, sheetTitle, type AddVerb, type TargetKind } from '../collection/addTo'
import { GAME_MODES, GAME_MODE_LABELS, isUnsorted, UNSORTED_COLLECTION_ID, type Collection, type GameMode } from '../types/models'

/** Where the user chose to put the cards, and how. */
export type AddTarget =
  | { kind: 'binder'; id: string; name: string; quantity: number; foil: boolean }
  | { kind: 'deck'; id: string; name: string; quantity: number; considering: boolean }

interface Props {
  verb: AddVerb
  /** What's going: one card's name, or "3 cards". */
  what: string
  /** Card image; shown as its art crop beside the title. */
  imageUrl?: string | null
  subtitle?: string
  /** The binders on offer (default: all of them); false offers none. */
  binders?: boolean | ((c: Collection) => boolean)
  /** Whether decks are on offer (default: yes). */
  decks?: boolean
  /** Offer "New binder…" and "New deck…". */
  create?: boolean
  /** Scan: the Unsorted pile, first thing on the first step. */
  unsorted?: boolean
  /** Where the deck list's toggle starts: into the deck, or its Considering list (suggestions). */
  considering?: boolean
  /** The copies stepper: where it starts and how high it goes. Null hides it (the scanned pile has its own counts). */
  quantity?: { initial: number; max?: number } | null
  /** Shows the Foil switch for a binder, and whether it starts on (a printing that only comes in foil). */
  foil?: { on: boolean } | null
  onPick: (target: AddTarget) => void
  onClose: () => void
}

const cardCount = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`

type Step = 'kinds' | TargetKind | 'new-binder' | 'new-deck'

/**
 * The one "Add to…" / "Move to…" / "Copy to…" sheet: a binder or a deck first, when both are on
 * offer, then the list — with a new one made right there, the copies, foil for a binder, and for a
 * deck whether it goes in or onto Considering. The Android app's AddToSheet is built to the same
 * steps. Its own component rather than an ActionSheet, which closes before its action runs.
 */
export function AddToSheet({
  verb, what, imageUrl, subtitle, binders = true, decks: decksOffered = true, create = false, unsorted = false,
  considering: consideringAtFirst = false, quantity = { initial: 1 }, foil = null, onPick, onClose,
}: Props) {
  const { collections, decks, createCollection, createDeck } = useSync()
  const binderList = binders === false ? [] : collections.filter((c) => (unsorted ? !isUnsorted(c) : true) && (binders === true || binders(c)))
  const deckList = decksOffered ? decks : []
  const offersBinders = binders !== false && (binderList.length > 0 || create)
  const offersDecks = decksOffered && (deckList.length > 0 || create)
  const asksFirst = unsorted || (offersBinders && offersDecks)
  const [step, setStep] = useState<Step>(asksFirst ? 'kinds' : offersDecks ? 'deck' : 'binder')
  const [considering, setConsidering] = useState(consideringAtFirst)
  const [copies, setCopies] = useState(quantity?.initial ?? 1)
  const [isFoil, setIsFoil] = useState(foil?.on ?? false)
  const [newName, setNewName] = useState('')
  const [format, setFormat] = useState<GameMode>('COMMANDER')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = (target: AddTarget) => {
    onClose()
    onPick(target)
  }
  const toBinder = (c: { id: string; name: string }) => pick({ kind: 'binder', id: c.id, name: c.name, quantity: copies, foil: isFoil })
  const toDeck = (d: { id: string; name: string }) => pick({ kind: 'deck', id: d.id, name: d.name, quantity: copies, considering })
  const makeBinder = () => {
    if (newName.trim()) toBinder(createCollection(newName.trim(), 'OWNED'))
  }
  const makeDeck = () => {
    if (newName.trim()) toDeck(createDeck(newName.trim(), format))
  }
  const startNew = (next: Step) => { setNewName(''); setStep(next) }
  const max = quantity?.max ?? 99

  const back = (to: Step, detail: string) => (
    <Row icon="arrow_back" label="Back" detail={detail} onClick={() => setStep(to)} />
  )

  return (
    <>
      <div className="scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={sheetTitle(verb, what)}>
        <div className="grab" />
        <div className={`sheet-head${imageUrl === undefined ? ' no-art' : ''}`}>
          {imageUrl !== undefined && <ArtImage src={toArtCrop(imageUrl)} seed={what} />}
          <div style={{ minWidth: 0 }}>
            <div className="sheet-title">{sheetTitle(verb, what)}</div>
            {subtitle && <div className="sheet-sub">{subtitle}</div>}
          </div>
        </div>

        {(step === 'binder' || step === 'deck') && (quantity || step === 'deck' || (foil && step === 'binder')) && (
          <div className="addto-opts">
            {step === 'deck' && (
              <div className="seg-choice" role="radiogroup" aria-label="Where in the deck">
                <button type="button" role="radio" aria-checked={!considering} className={!considering ? 'on' : ''} onClick={() => setConsidering(false)}>Into the deck</button>
                <button type="button" role="radio" aria-checked={considering} className={considering ? 'on' : ''} onClick={() => setConsidering(true)}>Considering</button>
              </div>
            )}
            {quantity && !(step === 'deck' && considering) && (
              <div className="addto-qty">
                Copies
                <div className="stepper-big">
                  <button type="button" disabled={copies <= 1} onClick={() => setCopies((n) => Math.max(1, n - 1))} aria-label="One copy fewer">−</button>
                  <span className="qn" aria-live="polite">{copies}</span>
                  <button type="button" disabled={copies >= max} onClick={() => setCopies((n) => Math.min(max, n + 1))} aria-label="One copy more">+</button>
                </div>
              </div>
            )}
            {foil && step === 'binder' && (
              <PillChip label="Foil" icon="auto_awesome" selected={isFoil} onClick={() => setIsFoil((f) => !f)} />
            )}
          </div>
        )}

        <div className="sheet-actions">
          {step === 'kinds' && (
            <>
              {unsorted && (
                // Cards you own but haven't sorted yet: they go in as they are, to be sorted later.
                <Row
                  icon="inbox" tone="gold" label="Unsorted" detail="Into your collection, to sort into binders later"
                  onClick={() => pick({ kind: 'binder', id: UNSORTED_COLLECTION_ID, name: 'Unsorted', quantity: copies, foil: isFoil })}
                />
              )}
              {offersBinders && <Row icon="collections" label="A binder" detail={kindDetail('binder', binderList.length)} onClick={() => setStep('binder')} />}
              {offersDecks && <Row icon="style" label="A deck" detail={kindDetail('deck', deckList.length)} onClick={() => setStep('deck')} />}
            </>
          )}

          {step === 'binder' && (
            <>
              {asksFirst && back('kinds', unsorted ? 'Unsorted, a binder or a deck' : 'A binder or a deck')}
              {create && <Row icon="add" tone="gold" label="New binder…" onClick={() => startNew('new-binder')} />}
              {binderList.map((c) => (
                <Row
                  key={c.id}
                  icon={isUnsorted(c) ? 'inbox' : c.type === 'WISHLIST' ? 'star' : 'collections'}
                  label={c.name}
                  detail={isUnsorted(c) ? 'Not in a binder' : c.type === 'WISHLIST' ? 'Wishlist' : 'Binder'}
                  onClick={() => toBinder(c)}
                />
              ))}
              {binderList.length === 0 && !create && <div className="addto-empty">No binders yet.</div>}
            </>
          )}

          {step === 'deck' && (
            <>
              {asksFirst && back('kinds', unsorted ? 'Unsorted, a binder or a deck' : 'A binder or a deck')}
              {create && <Row icon="add" tone="gold" label="New deck…" onClick={() => startNew('new-deck')} />}
              {deckList.map((d) => (
                <Row
                  key={d.id}
                  icon="style"
                  label={d.name}
                  detail={`${GAME_MODE_LABELS[d.gameMode as GameMode] ?? d.gameMode} · ${cardCount(d.cards.reduce((n, c) => n + c.quantity, 0))}`}
                  onClick={() => toDeck(d)}
                />
              ))}
              {deckList.length === 0 && !create && <div className="addto-empty">No decks yet. Make one in Decks first.</div>}
            </>
          )}

          {(step === 'new-binder' || step === 'new-deck') && back(step === 'new-binder' ? 'binder' : 'deck', step === 'new-binder' ? 'Your binders' : 'Your decks')}
        </div>

        {(step === 'new-binder' || step === 'new-deck') && (
          <form className="addto-new" onSubmit={(e) => { e.preventDefault(); if (step === 'new-binder') makeBinder(); else makeDeck() }}>
            <label className="field-label" htmlFor="addto-new-name" style={{ marginTop: 0 }}>{step === 'new-binder' ? 'Binder name' : 'Deck name'}</label>
            <input id="addto-new-name" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            {step === 'new-deck' && (
              <>
                <div className="field-label" style={{ marginTop: 6 }}>Format</div>
                <div className="chips wrap">
                  {GAME_MODES.map((m) => (
                    <PillChip key={m} label={GAME_MODE_LABELS[m]} selected={format === m} onClick={() => setFormat(m)} className="on-g2" />
                  ))}
                </div>
              </>
            )}
            <button type="submit" className="btn gold" disabled={!newName.trim()}>
              {step === 'new-binder' ? 'Create binder' : 'Create deck'} &amp; {verb}
            </button>
          </form>
        )}
      </div>
    </>
  )
}

function Row({ icon, label, detail, tone, onClick }: { icon: string; label: string; detail?: string; tone?: 'gold'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}>
      <span className={`sa-ic ${tone ?? ''}`}><Icon name={icon} /></span>
      <span className="sa-t">
        {label}
        {detail && <small>{detail}</small>}
      </span>
    </button>
  )
}

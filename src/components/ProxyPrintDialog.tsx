import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  PAPERS, PROXY_MARK, defaultPaper, pickedCopies, sheetCards, sheetLayout, sheetPages, sheetSummary, withCopies,
  type PaperSize, type ProxyOptions, type ProxyPick,
} from '../decks/proxySheet'
import { Icon } from './Icon'
import { ArtImage, PillChip, toArtCrop } from './kit'
import { useModalFocus } from './useModalFocus'
import './proxyPrint.css'

/** The paper this browser's language suggests: Letter for en-US and the like, else A4. */
function browserPaper(): PaperSize {
  const lang = typeof navigator !== 'undefined' ? navigator.language : ''
  return defaultPaper(lang.split('-')[1] ?? null)
}

/** Waits for the sheet's pictures, so the print doesn't go out with gaps — at most [ms]. */
function picturesLoaded(root: HTMLElement | null, ms: number): Promise<void> {
  const images = root ? [...root.querySelectorAll('img')] : []
  const pending = images.filter((img) => !img.complete).map((img) => new Promise<void>((done) => {
    img.addEventListener('load', () => done(), { once: true })
    img.addEventListener('error', () => done(), { once: true })
  }))
  return Promise.race([Promise.all(pending).then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))])
}

/**
 * Print proxies: pick the cards and how many of each, then print them (or save a PDF) nine to a page at
 * real card size with thin cut lines — on A4 or Letter, marked "PROXY — not for sale" or not, in
 * colour or black and white to save ink. The pages print with the browser's own print, as box labels
 * do. Opened from a deck's menu, its pull list and Spread thin. The layout is decks/proxySheet.ts; the
 * Android app's ProxyPrintDialog.kt is the same.
 */
export function ProxyPrintDialog({ title, initial, markLabel, onMark, onClose }: {
  /** Under "Print proxies": the deck's name, or Spread thin. */
  title: string
  initial: ProxyPick[]
  /** "Mark them as proxies in Krenko", where printing can do that. */
  markLabel?: string
  onMark?: (printed: ProxyPick[]) => void
  onClose: () => void
}) {
  const [picks, setPicks] = useState(initial)
  const [options, setOptions] = useState<ProxyOptions>(() => ({ paper: browserPaper(), marked: true, lowInk: false, backs: true }))
  const [mark, setMark] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const keepFocusIn = useModalFocus(box, onClose)
  const layout = sheetLayout(options.paper)
  const cards = sheetCards(picks, options.backs)
  const pages = sheetPages(cards)
  const hasBacks = picks.some((p) => p.backImageUrl)
  const set = (patch: Partial<ProxyOptions>) => setOptions((o) => ({ ...o, ...patch }))

  // While this is open a print is the proxy sheet and nothing else.
  useEffect(() => {
    document.body.classList.add('printing-proxies')
    return () => document.body.classList.remove('printing-proxies')
  }, [])

  const print = async () => {
    setWaiting(true)
    await picturesLoaded(sheet.current, 10_000)
    setWaiting(false)
    window.print()
    if (mark && onMark) {
      onMark(picks.filter((p) => p.copies > 0))
      setMark(false)
    }
  }

  return (
    <div ref={box} className="goldfish proxy-dialog" role="dialog" aria-modal="true" aria-label="Print proxies" onKeyDown={keepFocusIn}>
      <div className="goldfish-bar">
        <button type="button" className="ib" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        <div className="goldfish-title">
          <b>Print proxies</b>
          <span className="playtest-status">{title}</span>
        </div>
      </div>

      <div className="goldfish-body">
        <div className="proxy-narrow">
          <div className="goldfish-label">Paper</div>
          <div className="chips wrap">
            {PAPERS.map((p) => <PillChip key={p.size} label={p.label} selected={options.paper === p.size} onClick={() => set({ paper: p.size })} />)}
          </div>
          <div className="goldfish-label">On the sheet</div>
          <div className="chips wrap">
            <PillChip label={PROXY_MARK} selected={options.marked} onClick={() => set({ marked: !options.marked })} />
            <PillChip label="Low ink" selected={options.lowInk} onClick={() => set({ lowInk: !options.lowInk })} />
            {hasBacks && <PillChip label="Back faces too" selected={options.backs} onClick={() => set({ backs: !options.backs })} />}
            {onMark && markLabel && <PillChip label={markLabel} selected={mark} onClick={() => setMark((m) => !m)} />}
          </div>
          <div className="dim proxy-note">
            Nine cards a page at real size, 63 × 88 mm. Print at 100% (not "fit to page"), then cut along the lines.
            {options.lowInk ? ' Low ink prints in black and white, lighter.' : ''}
          </div>

          <div className="row-between proxy-cards-h">
            <div className="goldfish-label">Cards</div>
            {pickedCopies(picks) > 0 && (
              <button type="button" className="btn line sm" onClick={() => setPicks((ps) => ps.map((p) => ({ ...p, copies: 0 })))}>Clear</button>
            )}
          </div>
          {picks.length === 0 ? (
            <div className="dim">No cards here to print.</div>
          ) : (
            <div className="list">
              {picks.map((p) => (
                <div key={p.name} className={`crow no-qty proxy-row${p.copies === 0 ? ' off' : ''}`}>
                  <ArtImage className="thumb" src={toArtCrop(p.imageUrl)} seed={p.name} />
                  <div className="cmain"><div className="cname">{p.name}</div></div>
                  <div className="stepper-big">
                    <button type="button" disabled={p.copies <= 0} onClick={() => setPicks((ps) => withCopies(ps, p.name, p.copies - 1))} aria-label={`One ${p.name} fewer`}>−</button>
                    <span className="qn" aria-live="polite">{p.copies}</span>
                    <button type="button" onClick={() => setPicks((ps) => withCopies(ps, p.name, p.copies + 1))} aria-label={`One ${p.name} more`}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="goldfish-actions proxy-actions">
        <span className="dim">{sheetSummary(picks, options.backs)}</span>
        <button type="button" className="btn gold" disabled={cards.length === 0 || waiting} onClick={() => void print()}>
          <Icon name="print" aria-hidden />{waiting ? 'Getting the pictures…' : 'Print or save PDF'}
        </button>
      </div>

      {createPortal(
        <div ref={sheet} className={`proxy-print${options.lowInk ? ' low-ink' : ''}`} aria-hidden="true">
          <style>{`@page { size: ${options.paper === 'LETTER' ? 'letter' : 'A4'} portrait; margin: 0; }`}</style>
          {pages.map((page, i) => (
            <div key={i} className="proxy-page" style={{ width: `${layout.widthMm}mm`, height: `${layout.heightMm}mm` }}>
              {layout.cutsXMm.map((x) => <div key={`x${x}`} className="proxy-cut v" style={{ left: `${x}mm` }} />)}
              {layout.cutsYMm.map((y) => <div key={`y${y}`} className="proxy-cut h" style={{ top: `${y}mm` }} />)}
              {page.map((card, j) => (
                <div key={j} className="proxy-card" style={{ left: `${layout.slots[j].xMm}mm`, top: `${layout.slots[j].yMm}mm` }}>
                  <span className="proxy-name">{card.name}</span>
                  {card.imageUrl && <img src={card.imageUrl} alt="" />}
                  {options.marked && <span className="proxy-mark">{PROXY_MARK}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

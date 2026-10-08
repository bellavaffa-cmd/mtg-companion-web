import { useEffect, useRef, useState } from 'react'
import { useMoney } from '../money/currency'
import { previewCue, setScanSound, useScanSound } from '../scan/scanFeedback'
import { useAutoCameraSetting } from '../components/useAutoCamera'
import { useShowLastScannedSetting } from '../components/LastScannedPanel'
import { parseThreshold, SOUND_MODE_LABELS, type ScanCue, type ScanSoundMode } from '../scan/scanSounds'
import { correctedLine, correctionsOf, forgetCorrection, readLine, usedLine, withCorrections } from '../scan/scanCorrections'
import { useSync } from '../sync/SyncContext'

/** Play all's buttons, in the order Play all plays them. The Android app's ScannerSection.kt. */
const PREVIEWS: { label: string; cue: ScanCue }[] = [
  { label: 'Common', cue: { tier: 'common', foil: false } },
  { label: 'Uncommon', cue: { tier: 'uncommon', foil: false } },
  { label: 'Rare', cue: { tier: 'rare', foil: false } },
  { label: 'Mythic', cue: { tier: 'mythic', foil: false } },
  { label: 'Value', cue: { tier: 'value', foil: false } },
  { label: 'Foil', cue: { tier: 'common', foil: true } },
]

const MODE_NOTES: Record<ScanSoundMode, string> = {
  rarity: 'Common: a soft tick. Uncommon: a two-note blip. Rare: a chime. Mythic: a rising flourish. A foil adds a sparkle.',
  value: 'A jackpot sting for a card worth the amount below or more; a soft tick for the rest.',
  both: 'A jackpot sting for a card worth the amount below or more; the rest sound by rarity.',
}

function Switch({ on, title, note, onChange }: { on: boolean; title: string; note: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="share-switch" onClick={() => onChange(!on)}>
      <span className="txt">
        <b>{title}</b>
        <span>{note}</span>
      </span>
      <span className={`sw${on ? ' on' : ''}`}><i /></span>
    </button>
  )
}

/**
 * Learned corrections (scan/scanCorrections.ts): what the scanner read and what it puts in instead, how
 * often, with Forget for each and Forget all. Synced with the collection. The Android app's ScannerSection.kt.
 */
function LearnedCorrections() {
  const { collections, changeStorage } = useSync()
  const list = correctionsOf(collections)
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState(false)
  const forget = (key: string) => changeStorage((c) => withCorrections(c, forgetCorrection(correctionsOf(c), key)))
  return (
    <>
      <button type="button" className="settings-row" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="grow">Learned corrections ({list.length})</span>
        <span className="dim" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <p className="dim settings-note">
            When you change a scanned card to another printing, the scanner remembers what it read and puts in
            your pick next time. A printing picked for a card whose set can't be read is used once you've picked it twice.
          </p>
          {list.length === 0 && <p className="dim settings-note">Nothing learned yet.</p>}
          {list.map((c) => (
            <div key={c.key} className="settings-row">
              <span className="grow">
                <span className="dim" style={{ display: 'block', fontSize: '0.8125rem' }}>{readLine(c)}</span>
                <b style={{ display: 'block' }}>→ {correctedLine(c)}</b>
                <span className="dim" style={{ display: 'block', fontSize: '0.75rem' }}>{usedLine(c)}</span>
              </span>
              <button type="button" className="btn line" aria-label={`Forget: ${readLine(c)}`} onClick={() => forget(c.key)}>Forget</button>
            </div>
          ))}
          {list.length > 0 && (
            <div className="settings-row">
              <span className="grow">{sure ? `Forget all ${list.length}?` : ''}</span>
              {sure && <button type="button" className="btn line" onClick={() => setSure(false)}>Keep</button>}
              <button
                type="button"
                className="btn line"
                onClick={() => {
                  if (!sure) { setSure(true); return }
                  changeStorage((c) => withCorrections(c, []))
                  setSure(false)
                }}
              >Forget all</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

/** Settings › Scanner: the sound and buzz when the scanner recognises a card (scan/scanFeedback.ts), auto zoom and focus, and what it learned. */
export function ScannerSection() {
  const s = useScanSound()
  const [autoCamera, setAutoCamera] = useAutoCameraSetting()
  const [lastScanned, setLastScanned] = useShowLastScannedSetting()
  const money = useMoney()
  const [threshold, setThreshold] = useState(String(s.threshold))
  useEffect(() => { setThreshold(String(s.threshold)) }, [s.threshold])
  const commitThreshold = () => {
    const v = parseThreshold(threshold)
    if (v != null) setScanSound({ threshold: v })
    else setThreshold(String(s.threshold))
  }
  const playing = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => playing.current.forEach(clearTimeout), [])
  const playAll = () => {
    playing.current.forEach(clearTimeout)
    playing.current = PREVIEWS.map((p, i) => setTimeout(() => previewCue(p.cue), i * 650))
  }

  return (
    <section className="panel">
      <p className="dim settings-note">A sound and a buzz when the scanner recognises a card — by its rarity, or a special sound for a valuable one.</p>
      <Switch
        on={s.on}
        title="Scan sounds"
        note="A sound for each card recognised: a tick for a common, up to a flourish for a mythic."
        onChange={(on) => setScanSound({ on })}
      />
      <div className="settings-row">
        <span className="grow">Volume</span>
        <span className="settings-value">{s.volume}%</span>
      </div>
      <input
        type="range"
        className="settings-slider"
        min={0}
        max={100}
        step={5}
        value={s.volume}
        disabled={!s.on}
        aria-label="Scan sound volume, in percent"
        onChange={(e) => setScanSound({ volume: Number(e.target.value) })}
        onPointerUp={() => previewCue({ tier: 'rare', foil: false })}
      />
      <div className="settings-row">
        <span className="grow">Sound by</span>
        <div className="chips" role="radiogroup" aria-label="Sound by">
          {(Object.keys(SOUND_MODE_LABELS) as ScanSoundMode[]).map((m) => (
            <button key={m} type="button" className="chip" role="radio" aria-checked={s.mode === m} aria-pressed={s.mode === m} onClick={() => setScanSound({ mode: m })}>
              {SOUND_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <p className="dim settings-note" style={{ marginTop: 6 }}>{MODE_NOTES[s.mode]}</p>
      {s.mode !== 'rarity' && (
        <div className="settings-row">
          <label className="grow" htmlFor="scan-threshold">Worth at least</label>
          <span className="dim">{money.currency.symbol.trim()}</span>
          <input
            id="scan-threshold"
            className="input"
            style={{ width: 110 }}
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={commitThreshold}
            onKeyDown={(e) => { if (e.key === 'Enter') commitThreshold() }}
            aria-label={`Value threshold, in ${money.currency.name}s`}
          />
        </div>
      )}
      {s.mode !== 'rarity' && (
        <p className="dim settings-note" style={{ marginTop: 6 }}>
          {`The printing's price, foil or not, in ${money.currency.code} — ${money.formatLocal(s.threshold)} or more gets the sting.`}
        </p>
      )}
      <div className="settings-divider" />
      <Switch on={s.vibrate} title="Vibrate" note="A buzz for each card, stronger for rarer ones." onChange={(vibrate) => setScanSound({ vibrate })} />
      <Switch
        on={s.silent}
        title="Play in silent mode"
        note="Off: the sounds stay quiet while the phone is on silent or vibrate."
        onChange={(silent) => setScanSound({ silent })}
      />
      <div className="settings-divider" />
      <Switch
        on={autoCamera}
        title="Auto zoom and focus"
        note="Zooms to fit the card in the frame and keeps it in focus, on cameras that allow it. Zooming by hand takes over until you tap the zoom chip."
        onChange={setAutoCamera}
      />
      <Switch
        on={lastScanned}
        title="Show last scanned card"
        note="The card just scanned stays under the camera until the next one: its set code and number, how it was recognised, and Change printing, Foil and Undo."
        onChange={setLastScanned}
      />
      <div className="settings-divider" />
      <LearnedCorrections />
      <div className="settings-divider" />
      <div className="settings-row">
        <span className="grow">Play all</span>
        <button type="button" className="btn line" onClick={playAll}>Play all</button>
      </div>
      <div className="chips" role="group" aria-label="Play one">
        {PREVIEWS.map((p) => (
          <button key={p.label} type="button" className="chip" onClick={() => previewCue(p.cue)}>{p.label}</button>
        ))}
      </div>
    </section>
  )
}

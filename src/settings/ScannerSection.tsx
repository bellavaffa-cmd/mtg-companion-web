import { useEffect, useRef, useState } from 'react'
import { useMoney } from '../money/currency'
import { previewCue, setScanSound, useScanSound } from '../scan/scanFeedback'
import { useAutoCameraSetting } from '../components/useAutoCamera'
import { parseThreshold, SOUND_MODE_LABELS, type ScanCue, type ScanSoundMode } from '../scan/scanSounds'

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

/** Settings › Scanner: the sound and buzz when the scanner recognises a card (scan/scanFeedback.ts), and auto zoom and focus. */
export function ScannerSection() {
  const s = useScanSound()
  const [autoCamera, setAutoCamera] = useAutoCameraSetting()
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

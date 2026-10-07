// Scan sounds: what the scanner plays (and how the phone buzzes) when it recognises a card — a
// sound for the card's rarity, or a "jackpot" sting for a card worth more than the user's threshold.
// Everything here is pure: the sound table, which cue a card gets, the rate limiter, and a renderer
// that turns a sound into samples (for the tests and for listening to them as WAV files). The page
// plays the same table live with Web Audio (scanFeedback.ts).
//
// The Android app's data/ScanSounds.kt holds the same table, number for number, and the same logic:
// SOUND_TABLE_SIGNATURE below is checked by the tests on both sides, so the two can't drift apart.

/** What the scan sounds like: by rarity, by value, or both (a valuable card's sting wins, else its rarity). */
export type ScanSoundMode = 'rarity' | 'value' | 'both'

/** A card's cue, quietest first. `value` is the sting for a card worth the threshold or more. */
export type ScanTier = 'common' | 'uncommon' | 'rare' | 'mythic' | 'value'

export const SCAN_TIERS: readonly ScanTier[] = ['common', 'uncommon', 'rare', 'mythic', 'value']

/** What plays for one recognised card: its tier, and a foil sparkle over it. */
export interface ScanCue {
  tier: ScanTier
  foil: boolean
}

// ---- The sound table ----

/** One tone: a sine or triangle wave with an attack–hold–release envelope. Times in ms, gain in thousandths. */
export interface ToneNote {
  /** When it starts, from the start of the sound. */
  at: number
  hz: number
  wave: 'sine' | 'triangle'
  /** Peak gain, in thousandths of full scale (before the sound's level and the volume). */
  gain: number
  /** Linear rise from silence to the peak. */
  attack: number
  /** Held at the peak. */
  hold: number
  /** Exponential fall from the peak to 1/10,000 (Web Audio's exponentialRampToValueAtTime), then silence. */
  release: number
}

export interface SoundSpec {
  /** A tier, or `foil` — the sparkle layered over a foil card's tier. */
  id: ScanTier | 'foil'
  /** The whole sound's gain in thousandths: sets the sounds to the same loudness (see the tests). */
  level: number
  notes: ToneNote[]
}

const n = (at: number, hz: number, wave: ToneNote['wave'], gain: number, attack: number, hold: number, release: number): ToneNote =>
  ({ at, hz, wave, gain, attack, hold, release })

/**
 * The sounds, all original and synthesised. Pitches are equal-tempered notes rounded to the hertz.
 *
 * - common — a soft tick: a short sine click with a triangle body (~45 ms).
 * - uncommon — a two-note blip, C6 then G6 (~210 ms).
 * - rare — a bright chime: E6 with its overtones, and B6 struck just after (~400 ms).
 * - mythic — a short rising flourish: C6 E6 G6 arpeggio landing on C7 (~450 ms).
 * - value — the jackpot sting: two quick D6 taps, then a G major chord (~445 ms).
 * - foil — a tiny sparkle, four high glints from 40 ms, layered over the card's tier (~210 ms).
 *
 * The Android app's ScanSounds.kt has the same table; keep them identical (SOUND_TABLE_SIGNATURE).
 */
export const SOUND_TABLE: readonly SoundSpec[] = [
  {
    id: 'common', level: 490, notes: [
      n(0, 1400, 'sine', 700, 1, 0, 30),
      n(0, 700, 'triangle', 400, 1, 2, 40),
      n(0, 2800, 'sine', 150, 1, 0, 14),
    ],
  },
  {
    id: 'uncommon', level: 405, notes: [
      n(0, 1047, 'triangle', 600, 3, 25, 70),
      n(0, 2094, 'sine', 150, 3, 25, 50),
      n(85, 1568, 'triangle', 600, 3, 30, 90),
      n(85, 3136, 'sine', 120, 3, 30, 60),
    ],
  },
  {
    id: 'rare', level: 465, notes: [
      n(0, 1319, 'sine', 700, 2, 10, 380),
      n(0, 2638, 'sine', 250, 2, 0, 220),
      n(0, 3957, 'sine', 120, 2, 0, 140),
      n(45, 1976, 'sine', 380, 2, 10, 340),
    ],
  },
  {
    id: 'mythic', level: 445, notes: [
      n(0, 1047, 'triangle', 450, 3, 10, 160),
      n(55, 1319, 'triangle', 450, 3, 10, 160),
      n(110, 1568, 'triangle', 450, 3, 10, 170),
      n(165, 2093, 'sine', 650, 3, 30, 250),
      n(165, 1047, 'sine', 220, 3, 30, 250),
      n(165, 4186, 'sine', 110, 3, 10, 150),
    ],
  },
  {
    id: 'value', level: 465, notes: [
      n(0, 1175, 'triangle', 450, 2, 15, 50),
      n(75, 1175, 'triangle', 450, 2, 15, 50),
      n(150, 784, 'sine', 300, 3, 40, 250),
      n(150, 1568, 'triangle', 420, 3, 40, 250),
      n(150, 1976, 'sine', 350, 3, 40, 250),
      n(150, 2349, 'sine', 300, 3, 40, 250),
    ],
  },
  {
    id: 'foil', level: 530, notes: [
      n(40, 3951, 'sine', 300, 1, 0, 50),
      n(75, 4699, 'sine', 280, 1, 0, 50),
      n(110, 5274, 'sine', 250, 1, 0, 55),
      n(145, 6272, 'sine', 220, 1, 0, 60),
    ],
  },
]

/** No sound runs longer than this. */
export const MAX_SOUND_MS = 450
/** Where a release ends (Web Audio can't ramp exponentially to zero). */
export const RELEASE_FLOOR = 0.0001

export const soundSpec = (id: SoundSpec['id']): SoundSpec => SOUND_TABLE.find((s) => s.id === id)!

export const noteEndMs = (note: ToneNote) => note.at + note.attack + note.hold + note.release

/** How long a sound runs, in ms. */
export const soundMs = (spec: SoundSpec) => Math.max(...spec.notes.map(noteEndMs))

/** How long a cue runs: its tier, and the sparkle over it. */
export const cueMs = (cue: ScanCue) => Math.max(soundMs(soundSpec(cue.tier)), cue.foil ? soundMs(soundSpec('foil')) : 0)

/** The table as one line of text, the same on both apps — see SOUND_TABLE_SIGNATURE. */
export function tableText(table: readonly SoundSpec[] = SOUND_TABLE): string {
  return table.map((s) => `${s.id}:${s.level}|${s.notes.map((x) => [x.at, x.hz, x.wave === 'sine' ? 's' : 't', x.gain, x.attack, x.hold, x.release].join(',')).join(';')}`).join('/')
}

/** FNV-1a, 32 bits, as eight hex digits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The table's fingerprint. Change the table here and in ScanSounds.kt together, then this on both sides. */
export const SOUND_TABLE_SIGNATURE = 'c7a6e2b6'

// ---- Rendering (tests, and the WAV previews) ----

/** One tone's envelope at [ms] into it (0 before and after). */
export function envelope(note: ToneNote, gain: number, ms: number): number {
  if (ms < 0) return 0
  if (ms < note.attack) return gain * (ms / note.attack)
  if (ms <= note.attack + note.hold) return gain
  const x = ms - note.attack - note.hold
  if (x >= note.release) return 0
  return gain * Math.pow(RELEASE_FLOOR / gain, x / note.release)
}

/** One cycle of [wave] at phase [p] (in cycles): both start at zero, rising. */
export function waveAt(wave: ToneNote['wave'], p: number): number {
  if (wave === 'sine') return Math.sin(2 * Math.PI * p)
  const f = (((p + 0.25) % 1) + 1) % 1
  return 1 - 4 * Math.abs(f - 0.5)
}

/** [specs] mixed, at full volume, as samples from -1 to 1. Live playback scales by the volume setting. */
export function renderSounds(specs: SoundSpec[], sampleRate = 44100, volume = 1): Float32Array {
  const ms = Math.max(...specs.map(soundMs))
  const out = new Float32Array(Math.ceil((ms / 1000) * sampleRate) + 1)
  for (const spec of specs) {
    for (const note of spec.notes) {
      const peak = (note.gain / 1000) * (spec.level / 1000) * volume
      if (peak <= RELEASE_FLOOR) continue
      const start = Math.round((note.at / 1000) * sampleRate)
      const length = Math.ceil(((note.attack + note.hold + note.release) / 1000) * sampleRate)
      for (let i = 0; i < length && start + i < out.length; i++) {
        const t = i / sampleRate
        out[start + i] += waveAt(note.wave, note.hz * t) * envelope(note, peak, t * 1000)
      }
    }
  }
  return out
}

/** A cue's sound: its tier, with the sparkle mixed in for a foil. */
export const renderCue = (cue: ScanCue, sampleRate = 44100, volume = 1) =>
  renderSounds(cue.foil ? [soundSpec(cue.tier), soundSpec('foil')] : [soundSpec(cue.tier)], sampleRate, volume)

/** Root-mean-square of [samples], over the part that's sounding (up to its last sample above 1/1000). */
export function loudness(samples: Float32Array): number {
  let end = samples.length
  while (end > 0 && Math.abs(samples[end - 1]) < 0.001) end--
  if (end === 0) return 0
  let sum = 0
  for (let i = 0; i < end; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / end)
}

export const peak = (samples: Float32Array) => samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0)

/** [samples] as a 16-bit mono WAV file. */
export function wavBytes(samples: Float32Array, sampleRate = 44100): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true)
  return bytes
}

// ---- Which cue a card gets ----

/** A Scryfall rarity's tier: special and bonus count as mythic; anything unknown as common. */
export function rarityTier(rarity: string | null | undefined): Exclude<ScanTier, 'value'> {
  switch (rarity?.toLowerCase()) {
    case 'uncommon': return 'uncommon'
    case 'rare': return 'rare'
    case 'mythic': case 'special': case 'bonus': return 'mythic'
    default: return 'common'
  }
}

/** A rarity as a screen reader says it: "Rare", "Mythic rare". Null when there's none. */
export function rarityLabel(rarity: string | null | undefined): string | null {
  switch (rarity?.toLowerCase()) {
    case 'common': return 'Common'
    case 'uncommon': return 'Uncommon'
    case 'rare': return 'Rare'
    case 'mythic': return 'Mythic rare'
    case 'special': return 'Special'
    case 'bonus': return 'Bonus'
    default: return null
  }
}

/** Whether a printing only comes in foil (or etched) — then a scanned copy is a foil one. */
export function onlyFoilFinish(finishes: readonly string[] | null | undefined): boolean {
  return !!finishes && finishes.length > 0 && !finishes.includes('nonfoil') && finishes.some((f) => f === 'foil' || f === 'etched')
}

const price = (s: string | null | undefined) => {
  const v = s ? Number(s) : NaN
  return Number.isFinite(v) ? v : null
}

/** The printing's US dollar price for its finish: a foil's foil price, else the plain one — each falling back to the other. */
export function priceUsd(prices: { usd?: string | null; usd_foil?: string | null } | null | undefined, foil: boolean): number | null {
  const plain = price(prices?.usd)
  const shiny = price(prices?.usd_foil)
  return foil ? shiny ?? plain : plain ?? shiny
}

/** Whether [usd] is worth [threshold] or more in the user's currency ([rate] of it to the dollar). */
export function overThreshold(usd: number | null, threshold: number, rate: number): boolean {
  return usd != null && threshold > 0 && usd * rate >= threshold - 1e-9
}

/**
 * The cue for a recognised card. By rarity: its rarity's sound. By value: the sting when it's worth
 * the threshold or more, else the soft tick. Both: the sting when it's worth it, else its rarity.
 */
export function cueFor(card: { rarity: string | null | undefined; usd: number | null; foil: boolean }, mode: ScanSoundMode, threshold: number, rate: number): ScanCue {
  const valuable = mode !== 'rarity' && overThreshold(card.usd, threshold, rate)
  const tier: ScanTier = valuable ? 'value' : mode === 'value' ? 'common' : rarityTier(card.rarity)
  return { tier, foil: card.foil }
}

/** How a cue ranks against another: its tier, then a foil over a plain card. */
export const cueRank = (cue: ScanCue) => SCAN_TIERS.indexOf(cue.tier) * 2 + (cue.foil ? 1 : 0)

/** The cue that ranks highest of [cues] — a page scan's one cue — or null for none. */
export function bestCue(cues: readonly ScanCue[]): ScanCue | null {
  return cues.reduce<ScanCue | null>((best, c) => (best == null || cueRank(c) > cueRank(best) ? c : best), null)
}

// ---- Rate limiting ----

/** At most one cue in this long. */
export const CUE_GAP_MS = 250

/** Play [cue] now (a waiting cue that outranks the one offered plays in its place), wait until [at] and call due(), or drop it. */
export type CueDecision = { kind: 'play'; cue: ScanCue } | { kind: 'later'; at: number } | { kind: 'drop' }

/**
 * At most one cue per [gap] ms, so cards recognised in a quick run don't pile up into a wall of
 * sound. A cue inside the gap waits for its end if it outranks the one just played (and anything
 * already waiting, which it replaces); otherwise it's dropped. Call [due] at the time [offer] gave.
 */
export class CueLimiter {
  private readonly gap: number
  private lastAt = -Infinity
  private lastRank = -1
  private waiting: ScanCue | null = null

  constructor(gap = CUE_GAP_MS) { this.gap = gap }

  offer(cue: ScanCue, now: number): CueDecision {
    if (now - this.lastAt >= this.gap) {
      // A cue left waiting past its time goes with this one: whichever ranks higher plays.
      const waiting = this.waiting
      this.waiting = null
      const play = waiting && cueRank(waiting) > cueRank(cue) ? waiting : cue
      this.played(play, now)
      return { kind: 'play', cue: play }
    }
    const rank = cueRank(cue)
    if (rank > this.lastRank && (this.waiting == null || rank > cueRank(this.waiting))) {
      this.waiting = cue
      return { kind: 'later', at: this.lastAt + this.gap }
    }
    return { kind: 'drop' }
  }

  /** The waiting cue, once its time has come — it's played now. Null if there's none, or not yet. */
  due(now: number): ScanCue | null {
    const cue = this.waiting
    if (!cue || now - this.lastAt < this.gap) return null
    this.waiting = null
    this.played(cue, now)
    return cue
  }

  private played(cue: ScanCue, now: number) {
    this.lastAt = now
    this.lastRank = cueRank(cue)
  }
}

// ---- Haptics ----

/** The buzz for each tier, as navigator.vibrate patterns (ms on, off, on…); the Android app's fallback waveforms. */
export const VIBRATION: Record<ScanTier, readonly number[]> = {
  common: [10],
  uncommon: [20],
  rare: [20, 60, 20],
  mythic: [15, 40, 15, 40, 45],
  value: [30, 50, 30, 50, 80],
}

// ---- Settings ----

/** The scanner's sound settings, under these keys (the Android app's DataStore has the same names, unprefixed). */
export const SCAN_SOUND_KEYS = {
  on: 'mtgweb_scan_sound_on',
  volume: 'mtgweb_scan_sound_volume',
  mode: 'mtgweb_scan_sound_mode',
  threshold: 'mtgweb_scan_sound_threshold',
  vibrate: 'mtgweb_scan_vibrate',
  silent: 'mtgweb_scan_sound_silent',
} as const

export interface ScanSoundSettings {
  on: boolean
  /** 0–100. */
  volume: number
  mode: ScanSoundMode
  /** In the user's currency. */
  threshold: number
  vibrate: boolean
  /** Play even when the phone is set to silent (where the browser can tell). */
  silent: boolean
}

/**
 * On, by rarity, at 60%: the sound says what was just scanned without looking up from the pile, and
 * rarity needs no prices. 60% sits under music and calls. $10 (in the user's currency) for value.
 */
export const DEFAULT_SCAN_SOUND: ScanSoundSettings = { on: true, volume: 60, mode: 'rarity', threshold: 10, vibrate: true, silent: false }

const bool = (s: string | null, fallback: boolean) => (s === 'true' ? true : s === 'false' ? false : fallback)

/** The settings from their stored text, each falling back to its default. */
export function parseScanSound(get: (key: string) => string | null): ScanSoundSettings {
  const d = DEFAULT_SCAN_SOUND
  const volume = Number(get(SCAN_SOUND_KEYS.volume) ?? NaN)
  const threshold = Number(get(SCAN_SOUND_KEYS.threshold) ?? NaN)
  const mode = get(SCAN_SOUND_KEYS.mode)
  return {
    on: bool(get(SCAN_SOUND_KEYS.on), d.on),
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : d.volume,
    mode: mode === 'rarity' || mode === 'value' || mode === 'both' ? mode : d.mode,
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : d.threshold,
    vibrate: bool(get(SCAN_SOUND_KEYS.vibrate), d.vibrate),
    silent: bool(get(SCAN_SOUND_KEYS.silent), d.silent),
  }
}

/** A threshold typed in: a positive amount, or null. "12,50" reads as 12.50. */
export function parseThreshold(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Settings › Scanner's summary line: "Sounds by rarity · 60%", "Sounds off · vibration on". */
export function scanSoundSummary(s: ScanSoundSettings): string {
  if (!s.on) return s.vibrate ? 'Sounds off · vibration on' : 'Sounds and vibration off'
  const how = s.mode === 'rarity' ? 'by rarity' : s.mode === 'value' ? 'by value' : 'by rarity and value'
  return `Sounds ${how} · ${s.volume}%`
}

export const SOUND_MODE_LABELS: Record<ScanSoundMode, string> = { rarity: 'By rarity', value: 'By value', both: 'Both' }

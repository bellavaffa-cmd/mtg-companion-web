// The scanner's feedback as it plays: a recognised card's sound, through Web Audio (oscillators with
// gain envelopes, from the table in scanSounds.ts), and its buzz where the browser can vibrate. Also
// the sound settings (Settings › Scanner), kept in this browser. The Android app's ScanFeedback.kt.

import { useSyncExternalStore } from 'react'
import { currentMoney } from '../money/currency'
import {
  CueLimiter, cueFor, onlyFoilFinish, parseScanSound, priceUsd, SCAN_SOUND_KEYS, soundSpec, VIBRATION, RELEASE_FLOOR,
  type ScanCue, type ScanSoundSettings,
} from './scanSounds'
import type { ScryfallCard } from '../types/scryfall'

// ---- Settings ----

const memory = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

function get(key: string): string | null {
  try { return localStorage.getItem(key) ?? memory.get(key) ?? null } catch { return memory.get(key) ?? null }
}

let settings: ScanSoundSettings = parseScanSound(get)

/** The sound settings now. */
export const scanSoundSettings = () => settings

/** Changes some of the sound settings, and keeps them. */
export function setScanSound(change: Partial<ScanSoundSettings>) {
  const next = { ...settings, ...change }
  for (const k of Object.keys(change) as (keyof ScanSoundSettings)[]) {
    const value = String(next[k])
    memory.set(SCAN_SOUND_KEYS[k], value)
    try { localStorage.setItem(SCAN_SOUND_KEYS[k], value) } catch { /* this visit only */ }
  }
  settings = parseScanSound(get)
  version++
  listeners.forEach((l) => l())
  applyAudioSession()
}

if (typeof window !== 'undefined') {
  // Another tab changed them.
  window.addEventListener('storage', (e) => {
    if (e.key && !Object.values(SCAN_SOUND_KEYS).includes(e.key as never)) return
    settings = parseScanSound(get)
    version++
    listeners.forEach((l) => l())
  })
}

/** The sound settings, re-rendering when they change. */
export function useScanSound(): ScanSoundSettings {
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => version)
  return settings
}

// ---- Sound ----

let context: AudioContext | null = null

/**
 * Safari's audio session: "ambient" stays quiet when the phone's ring switch is on silent (and mixes
 * with music); "playback" plays anyway — Play in silent mode. Other browsers don't have it.
 */
function applyAudioSession() {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) {
    try { session.type = settings.silent ? 'playback' : 'ambient' } catch { /* not settable here */ }
  }
}

function audio(): AudioContext | null {
  if (context) return context
  const Ctor = typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined
  if (!Ctor) return null
  try {
    applyAudioSession()
    context = new Ctor({ latencyHint: 'interactive' })
  } catch {
    return null
  }
  return context
}

/**
 * Gets the sound ready: browsers only let a page make sound once someone has touched it, so the
 * scanner calls this on its first tap or key press (and on opening, which follows a tap in the app).
 */
export function unlockScanAudio() {
  const ctx = audio()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

/** Plays [cue]'s sound at [volume] (0–100), now. */
function playSound(cue: ScanCue, volume: number) {
  const ctx = audio()
  if (!ctx || volume <= 0) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  const t0 = ctx.currentTime + 0.005
  const specs = cue.foil ? [soundSpec(cue.tier), soundSpec('foil')] : [soundSpec(cue.tier)]
  for (const spec of specs) {
    for (const note of spec.notes) {
      const peak = (note.gain / 1000) * (spec.level / 1000) * (volume / 100)
      if (peak <= RELEASE_FLOOR) continue
      const start = t0 + note.at / 1000
      const top = start + note.attack / 1000
      const held = top + note.hold / 1000
      const end = held + note.release / 1000
      const osc = ctx.createOscillator()
      osc.type = note.wave
      osc.frequency.value = note.hz
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(peak, top)
      gain.gain.setValueAtTime(peak, held)
      gain.gain.exponentialRampToValueAtTime(RELEASE_FLOOR, end)
      gain.gain.setValueAtTime(0, end)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(end + 0.02)
      osc.onended = () => { osc.disconnect(); gain.disconnect() }
    }
  }
}

function buzz(cue: ScanCue) {
  try { navigator.vibrate?.([...VIBRATION[cue.tier]]) } catch { /* not allowed here */ }
}

// ---- Cues ----

const limiter = new CueLimiter()
let timer: ReturnType<typeof setTimeout> | null = null

function perform(cue: ScanCue) {
  const s = settings
  if (s.on) playSound(cue, s.volume)
  if (s.vibrate) buzz(cue)
}

/** Plays [cue] — or, inside the 250 ms after the last, waits for its end if it ranks higher, or drops it. */
export function playCue(cue: ScanCue) {
  if (!settings.on && !settings.vibrate) return
  const decision = limiter.offer(cue, performance.now())
  if (decision.kind === 'play') perform(decision.cue)
  else if (decision.kind === 'later') {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const due = limiter.due(performance.now())
      if (due) perform(due)
    }, Math.max(0, decision.at - performance.now()) + 1)
  }
}

/** A card's cue under the settings now: [foil] when the copy is known to be foil, or the printing only comes in foil. */
export function cueOfCard(card: ScryfallCard, foil = false): ScanCue {
  const shiny = foil || onlyFoilFinish(card.finishes)
  return cueFor({ rarity: card.rarity, usd: priceUsd(card.prices, shiny), foil: shiny }, settings.mode, settings.threshold, currentMoney().rate)
}

/** The scanner recognised [card]: its sound and buzz. */
export function cardRecognised(card: ScryfallCard, foil = false) {
  playCue(cueOfCard(card, foil))
}

/** Settings' Play all: one tier's sound, as it would play, whatever the on switch says. */
export function previewCue(cue: ScanCue) {
  unlockScanAudio()
  playSound(cue, settings.volume)
  if (settings.vibrate) buzz(cue)
}

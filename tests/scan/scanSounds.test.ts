import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bestCue, cueFor, cueMs, CueLimiter, CUE_GAP_MS, DEFAULT_SCAN_SOUND, fnv1a, loudness, MAX_SOUND_MS, onlyFoilFinish, overThreshold,
  parseScanSound, parseThreshold, peak, priceUsd, rarityLabel, rarityTier, renderCue, renderSounds, SCAN_SOUND_KEYS, SCAN_TIERS,
  scanSoundSummary, SOUND_TABLE, SOUND_TABLE_SIGNATURE, soundMs, soundSpec, tableText, wavBytes, type ScanCue,
} from '../../src/scan/scanSounds.ts'

// The scan sounds: which cue a card gets, the rate limiter and the sound table. The Android app has
// the same checks — see ScanSoundsTest.kt.

const cue = (tier: ScanCue['tier'], foil = false): ScanCue => ({ tier, foil })

test('rarity picks the sound; special and bonus sound as mythic, anything unknown as common', () => {
  assert.equal(rarityTier('common'), 'common')
  assert.equal(rarityTier('uncommon'), 'uncommon')
  assert.equal(rarityTier('rare'), 'rare')
  assert.equal(rarityTier('mythic'), 'mythic')
  assert.equal(rarityTier('special'), 'mythic')
  assert.equal(rarityTier('bonus'), 'mythic')
  assert.equal(rarityTier(null), 'common')
  assert.equal(rarityTier('weird'), 'common')
  assert.equal(rarityLabel('mythic'), 'Mythic rare')
  assert.equal(rarityLabel('rare'), 'Rare')
  assert.equal(rarityLabel(undefined), null)
})

test('by rarity, the price makes no difference', () => {
  assert.deepEqual(cueFor({ rarity: 'common', usd: 80, foil: false }, 'rarity', 10, 1), cue('common'))
  assert.deepEqual(cueFor({ rarity: 'rare', usd: 0.1, foil: true }, 'rarity', 10, 1), cue('rare', true))
})

test('by value, a card worth the threshold gets the sting whatever its rarity; the rest a tick', () => {
  assert.deepEqual(cueFor({ rarity: 'common', usd: 12, foil: false }, 'value', 10, 1), cue('value'))
  assert.deepEqual(cueFor({ rarity: 'common', usd: 10, foil: false }, 'value', 10, 1), cue('value'), 'exactly the threshold counts')
  assert.deepEqual(cueFor({ rarity: 'mythic', usd: 2, foil: false }, 'value', 10, 1), cue('common'))
  assert.deepEqual(cueFor({ rarity: 'mythic', usd: null, foil: false }, 'value', 10, 1), cue('common'), 'no price, no sting')
})

test('both: the sting over the threshold, else the rarity', () => {
  assert.deepEqual(cueFor({ rarity: 'uncommon', usd: 25, foil: true }, 'both', 10, 1), cue('value', true))
  assert.deepEqual(cueFor({ rarity: 'uncommon', usd: 3, foil: false }, 'both', 10, 1), cue('uncommon'))
})

test('the threshold is in the user\'s currency', () => {
  // ₱500 at 56 pesos to the dollar is about $8.93.
  assert.equal(overThreshold(9, 500, 56), true)
  assert.equal(overThreshold(8.9, 500, 56), false)
  // ¥1,500 at 150 yen to the dollar is $10.
  assert.equal(overThreshold(10, 1500, 150), true)
  assert.equal(overThreshold(9.99, 1500, 150), false)
  assert.equal(overThreshold(null, 10, 1), false)
})

test('the price is the printing\'s, for its finish', () => {
  assert.equal(priceUsd({ usd: '1.50', usd_foil: '12.00' }, false), 1.5)
  assert.equal(priceUsd({ usd: '1.50', usd_foil: '12.00' }, true), 12)
  assert.equal(priceUsd({ usd: null, usd_foil: '7.25' }, false), 7.25, 'a foil-only printing has only a foil price')
  assert.equal(priceUsd({ usd: '3', usd_foil: null }, true), 3)
  assert.equal(priceUsd(null, false), null)
  assert.equal(onlyFoilFinish(['foil']), true)
  assert.equal(onlyFoilFinish(['etched']), true)
  assert.equal(onlyFoilFinish(['nonfoil', 'foil']), false)
  assert.equal(onlyFoilFinish(undefined), false)
})

test('a page scan plays its best card: the higher tier, then a foil', () => {
  assert.deepEqual(bestCue([cue('common'), cue('mythic'), cue('rare', true)]), cue('mythic'))
  assert.deepEqual(bestCue([cue('rare'), cue('rare', true)]), cue('rare', true))
  assert.deepEqual(bestCue([cue('mythic'), cue('value')]), cue('value'))
  assert.equal(bestCue([]), null)
})

test('at most one cue per 250 ms: a higher one waits for its turn, the rest are dropped', () => {
  const l = new CueLimiter()
  assert.deepEqual(l.offer(cue('common'), 0), { kind: 'play', cue: cue('common') })
  assert.deepEqual(l.offer(cue('common'), 100), { kind: 'drop' }, 'a second tick inside the gap is dropped')
  assert.deepEqual(l.offer(cue('rare'), 120), { kind: 'later', at: CUE_GAP_MS })
  assert.deepEqual(l.offer(cue('uncommon'), 150), { kind: 'drop' }, 'lower than the one waiting')
  assert.deepEqual(l.offer(cue('mythic'), 200), { kind: 'later', at: CUE_GAP_MS }, 'a higher one takes its place')
  assert.equal(l.due(240), null, 'not yet')
  assert.deepEqual(l.due(250), cue('mythic'))
  assert.equal(l.due(260), null, 'played once')
  assert.deepEqual(l.offer(cue('rare'), 400), { kind: 'drop' }, 'inside the mythic\'s gap, and lower')
  assert.deepEqual(l.offer(cue('common'), 500), { kind: 'play', cue: cue('common') })
})

test('nine cards at once make one cue, not nine', () => {
  const l = new CueLimiter()
  const played: ScanCue[] = []
  const tiers: ScanCue['tier'][] = ['common', 'rare', 'common', 'uncommon', 'mythic', 'common', 'rare', 'common', 'uncommon']
  let wake: number | null = null
  tiers.forEach((t, i) => {
    const d = l.offer(cue(t), i * 5)
    if (d.kind === 'play') played.push(d.cue)
    if (d.kind === 'later') wake = d.at
  })
  if (wake != null) { const due = l.due(wake); if (due) played.push(due) }
  assert.deepEqual(played, [cue('common'), cue('mythic')])
})

test('a cue left waiting past its time plays with the next, the higher of the two', () => {
  const l = new CueLimiter()
  l.offer(cue('common'), 0)
  l.offer(cue('mythic'), 100)
  assert.deepEqual(l.offer(cue('uncommon'), 1000), { kind: 'play', cue: cue('mythic') })
})

test('every sound is 450 ms or less, foil or not', () => {
  for (const s of SOUND_TABLE) assert.ok(soundMs(s) <= MAX_SOUND_MS, `${s.id} runs ${soundMs(s)} ms`)
  for (const t of SCAN_TIERS) for (const foil of [false, true]) assert.ok(cueMs(cue(t, foil)) <= MAX_SOUND_MS)
  for (const s of SOUND_TABLE) {
    for (const note of s.notes) {
      assert.ok(note.hz >= 200 && note.hz <= 8000, `${s.id}: ${note.hz} Hz is outside the pleasant range`)
      assert.ok(note.gain > 0 && note.gain <= 1000)
      assert.ok(note.attack >= 1, `${s.id}: an instant attack clicks`)
      assert.ok(note.release >= 10)
    }
  }
})

test('the sounds are normalised: the same loudness, a quiet sparkle, and nothing clips', () => {
  const db = (x: number) => 20 * Math.log10(x)
  const levels = SCAN_TIERS.map((t) => db(loudness(renderSounds([soundSpec(t)]))))
  const top = Math.max(...levels)
  for (const [i, l] of levels.entries()) assert.ok(top - l <= 1.5, `${SCAN_TIERS[i]} is ${(top - l).toFixed(1)} dB quieter than the loudest`)
  assert.ok(db(loudness(renderSounds([soundSpec('foil')]))) < top - 6, 'the sparkle sits under the tier')
  for (const t of SCAN_TIERS) for (const foil of [false, true]) assert.ok(peak(renderCue(cue(t, foil))) < 0.8)
  assert.ok(peak(renderCue(cue('rare'), 44100, 0.6)) < peak(renderCue(cue('rare'))), 'the volume scales it')
})

test('the table is the same as the Android app\'s', () => {
  // ScanSoundsTest.kt checks its own table against the same signature.
  assert.equal(fnv1a(tableText()), SOUND_TABLE_SIGNATURE)
  assert.equal(fnv1a('abc'), '1a47e90b')
})

test('a WAV file is 16-bit mono PCM', () => {
  const bytes = wavBytes(new Float32Array([0, 1, -1]), 8000)
  const v = new DataView(bytes.buffer)
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF')
  assert.equal(v.getUint32(24, true), 8000)
  assert.equal(v.getUint16(34, true), 16)
  assert.equal(v.getInt16(46, true), 32767)
  assert.equal(v.getInt16(48, true), -32767)
})

test('settings: on by rarity at 60%, $10, vibrate, quiet in silent mode — and what was kept', () => {
  assert.deepEqual(parseScanSound(() => null), DEFAULT_SCAN_SOUND)
  assert.deepEqual(DEFAULT_SCAN_SOUND, { on: true, volume: 60, mode: 'rarity', threshold: 10, vibrate: true, silent: false })
  const kept: Record<string, string> = {
    [SCAN_SOUND_KEYS.on]: 'false', [SCAN_SOUND_KEYS.volume]: '140', [SCAN_SOUND_KEYS.mode]: 'both',
    [SCAN_SOUND_KEYS.threshold]: '-3', [SCAN_SOUND_KEYS.silent]: 'true',
  }
  assert.deepEqual(parseScanSound((k) => kept[k] ?? null), { on: false, volume: 100, mode: 'both', threshold: 10, vibrate: true, silent: true })
  assert.equal(parseThreshold('12,50'), 12.5)
  assert.equal(parseThreshold('0'), null)
  assert.equal(parseThreshold('lots'), null)
  assert.equal(scanSoundSummary(DEFAULT_SCAN_SOUND), 'Sounds by rarity · 60%')
  assert.equal(scanSoundSummary({ ...DEFAULT_SCAN_SOUND, on: false }), 'Sounds off · vibration on')
})

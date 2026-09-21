/**
 * Knowing a card by sight: the flattened card (flatCard.ts) run through the image model in the
 * browser, and its fingerprint looked up in the card index (cardIndex.ts). The model and the index
 * are fetched the first time they're wanted and kept by the browser afterwards (see the service
 * worker), about 20 MB between them. Mirrors the Android app's ui/scan/CardRecognizer.kt.
 */

import { CardIndex, type IndexMatch } from './cardIndex'
import { modelInputCount, modelInputs, type FlatCard } from './flatCard'

const BASE = `${import.meta.env.BASE_URL}card-index/`
export const INDEX_URL = `${BASE}card-index.bin`
export const MODEL_URL = `${BASE}card-model.onnx`

type Ort = typeof import('onnxruntime-web/wasm')

interface Loaded {
  ort: Ort
  session: import('onnxruntime-web/wasm').InferenceSession
  index: CardIndex
}

let loading: Promise<Loaded> | null = null

/** The model and the index, loaded once. A failed load (offline) is forgotten, to be tried again. */
export function loadRecognizer(): Promise<Loaded> {
  loading ??= (async () => {
    const [ort, indexBytes, modelBytes] = await Promise.all([
      import('onnxruntime-web/wasm'),
      fetch(INDEX_URL).then((r) => { if (!r.ok) throw new Error(`Card index: HTTP ${r.status}`); return r.arrayBuffer() }),
      fetch(MODEL_URL).then((r) => { if (!r.ok) throw new Error(`Card model: HTTP ${r.status}`); return r.arrayBuffer() }),
    ])
    // One thread: sharing memory between threads needs headers GitHub Pages can't send.
    ort.env.wasm.numThreads = 1
    const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ['wasm'] })
    return { ort, session, index: new CardIndex(indexBytes) }
  })().catch((e) => {
    loading = null
    throw e
  })
  return loading
}

/** Whether the model and index are loaded already — without starting to load them. */
export const recognizerReady = () => loading !== null

/** What the index makes of a flattened card. */
export interface Recognized {
  /** The nearest printings to the card's look, over the whole index, best first. */
  anywhere: IndexMatch[]
  /** The nearest among [name]'s printings, when a name was given. */
  named: IndexMatch[]
}

/**
 * The flattened card fingerprinted — through each of its likeliest outlines, as edge and as frame —
 * and looked up: over the whole index, and among the printings of [name] if the title was read.
 */
export async function recognize(flat: FlatCard, name?: string): Promise<Recognized> {
  const { ort, session, index } = await loadRecognizer()
  const size = index.inputSize
  const count = modelInputCount(flat)
  const input = new ort.Tensor('float32', modelInputs(flat, size), [count, 3, size, size])
  const output = await session.run({ [session.inputNames[0]]: input })
  const features = output[session.outputNames[0]].data as Float32Array
  const looks: Int8Array[] = []
  for (let i = 0; i < count; i++) looks.push(index.fingerprint(features.subarray(i * index.featDim, (i + 1) * index.featDim)))
  const rows = name ? index.rowsNamed(name) : []
  return {
    anywhere: index.nearest(looks, 8),
    named: rows.length ? index.nearest(looks, 8, rows) : [],
  }
}

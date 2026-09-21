/**
 * The card index: a short fingerprint of what every English paper printing looks like, made by an
 * image model from Scryfall's pictures (see tools/card-index). A card in the camera, fingerprinted
 * the same way, is looked up by which fingerprints it's nearest to — how the scanner knows a card by
 * sight, even when its name can't be read. Mirrors the Android app's data/CardIndex.kt; the file
 * layout is documented in tools/card-index/build_index.py.
 */

export interface IndexEntry {
  /** Which picture in the index. */
  row: number
  /** The Scryfall id of the printing. */
  id: string
  /** 0 for a card's front, 1 for the back of a double-faced one. */
  face: number
  name: string
  set: string
  number: string
  /** Printings sharing one illustration share this: the picture says which art, not which of them. */
  group: number
}

export interface IndexMatch extends IndexEntry {
  /** How alike, from -1 to 1. */
  score: number
}

const MAGIC = 0x5849424d // "MBIX", little-endian

export class CardIndex {
  readonly count: number
  readonly dim: number
  readonly featDim: number
  readonly inputSize: number
  private readonly scale: number
  private readonly mean: Float32Array
  private readonly comps: Float32Array
  private readonly prints: Int8Array
  private readonly ids: Uint8Array
  private readonly faces: Uint8Array
  private readonly nameOf: Uint32Array
  private readonly setOf_: Uint16Array
  private readonly numberOf: Uint16Array
  private readonly groups: Uint32Array
  private readonly names: string[]
  private readonly sets: string[]
  private readonly numbers: string[]
  private byName: Map<string, number[]> | null = null
  private byId: Map<string, number[]> | null = null

  constructor(buffer: ArrayBuffer) {
    const view = new DataView(buffer)
    if (buffer.byteLength < 28 || view.getUint32(0, true) !== MAGIC) throw new Error('Not a card index')
    if (view.getUint32(4, true) !== 1) throw new Error('Card index version not understood')
    this.count = view.getUint32(8, true)
    this.dim = view.getUint32(12, true)
    this.featDim = view.getUint32(16, true)
    this.scale = view.getFloat32(20, true)
    this.inputSize = view.getUint32(24, true)
    let at = 28
    // Copied out rather than viewed: the Float32Array views need 4-byte alignment.
    const floats = (n: number) => { const a = new Float32Array(buffer.slice(at, at + n * 4)); at += n * 4; return a }
    const bytes = (n: number) => { const a = new Uint8Array(buffer, at, n); at += n; return a }
    this.mean = floats(this.featDim)
    this.comps = floats(this.dim * this.featDim)
    this.prints = new Int8Array(buffer, at, this.count * this.dim); at += this.count * this.dim
    this.ids = bytes(16 * this.count)
    this.faces = bytes(this.count)
    this.nameOf = new Uint32Array(buffer.slice(at, at + 4 * this.count)); at += 4 * this.count
    this.setOf_ = new Uint16Array(buffer.slice(at, at + 2 * this.count)); at += 2 * this.count
    this.numberOf = new Uint16Array(buffer.slice(at, at + 2 * this.count)); at += 2 * this.count
    this.groups = new Uint32Array(buffer.slice(at, at + 4 * this.count)); at += 4 * this.count
    const metaLength = view.getUint32(at, true); at += 4
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at, metaLength)))
    this.names = meta.names
    this.sets = meta.sets
    this.numbers = meta.numbers
  }

  entry(row: number): IndexEntry {
    const b = this.ids.subarray(row * 16, row * 16 + 16)
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return {
      row,
      id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      face: this.faces[row],
      name: this.names[this.nameOf[row]],
      set: this.sets[this.setOf_[row]],
      number: this.numbers[this.numberOf[row]],
      group: this.groups[row],
    }
  }

  /** The model's feature vector for a picture, turned into a fingerprint like the index's own. */
  fingerprint(features: ArrayLike<number>): Int8Array {
    const z = new Float32Array(this.dim)
    for (let d = 0; d < this.dim; d++) {
      let sum = 0
      const base = d * this.featDim
      for (let i = 0; i < this.featDim; i++) sum += (features[i] - this.mean[i]) * this.comps[base + i]
      z[d] = sum
    }
    let norm = 0
    for (const v of z) norm += v * v
    norm = Math.sqrt(norm) || 1
    const out = new Int8Array(this.dim)
    for (let d = 0; d < this.dim; d++) out[d] = Math.max(-127, Math.min(127, Math.round((z[d] / norm) * this.scale)))
    return out
  }

  /** The set code of row [row]'s printing. */
  setOf(row: number): string {
    return this.sets[this.setOf_[row]]
  }

  /** The rows of the printing with Scryfall id [id] — one per face. */
  rowsWithId(id: string): number[] {
    if (!this.byId) {
      this.byId = new Map()
      for (let r = 0; r < this.count; r++) {
        const key = this.entry(r).id
        const list = this.byId.get(key)
        if (list) list.push(r)
        else this.byId.set(key, [r])
      }
    }
    return this.byId.get(id) ?? []
  }

  /** The rows of every printing of [name] (either face's name, for a double-faced card). */
  rowsNamed(name: string): number[] {
    if (!this.byName) {
      this.byName = new Map()
      for (let r = 0; r < this.count; r++) {
        const full = this.names[this.nameOf[r]].toLowerCase()
        for (const key of new Set([full, ...full.split(' // ')])) {
          const list = this.byName.get(key)
          if (list) list.push(r)
          else this.byName.set(key, [r])
        }
      }
    }
    return this.byName.get(name.toLowerCase()) ?? []
  }

  /**
   * The [most] nearest pictures to any of [looks] (fingerprints of the camera's card, measured a
   * few ways — the best of them counts), among [rows] or the whole index, nearest first.
   */
  nearest(looks: Int8Array[], most = 5, rows?: number[]): IndexMatch[] {
    const top: { row: number; dot: number }[] = []
    const consider = (r: number) => {
      const base = r * this.dim
      let best = -Infinity
      for (const q of looks) {
        let dot = 0
        for (let d = 0; d < this.dim; d++) dot += q[d] * this.prints[base + d]
        if (dot > best) best = dot
      }
      if (top.length < most || best > top[top.length - 1].dot) {
        let i = top.length < most ? top.length : top.length - 1
        if (top.length < most) top.push({ row: r, dot: best })
        while (i > 0 && top[i - 1].dot < best) { top[i] = top[i - 1]; i-- }
        top[i] = { row: r, dot: best }
      }
    }
    if (rows) for (const r of rows) consider(r)
    else for (let r = 0; r < this.count; r++) consider(r)
    const unit = this.scale * this.scale
    return top.map(({ row, dot }) => ({ ...this.entry(row), score: dot / unit }))
  }
}

/**
 * JSON with object keys sorted. Postgres jsonb doesn't keep key order, so a deck this browser pushed
 * comes back from the server reordered — comparing canonical JSON keeps that from looking like a change.
 *
 * Written out directly rather than through JSON.stringify with a replacer that rebuilds every object
 * with its keys sorted (canonicalJsonSlow, kept for the tests, which check the two agree character for
 * character): the sync does this to the whole library, and a 25,000-card one spent its time copying.
 */
export function canonicalJson(value: unknown): string {
  return write(value, false) ?? ''
}

/** [v] as JSON, or undefined when an object leaves it out (undefined, a function), as JSON.stringify does. */
function write(v: unknown, inArray: boolean): string | undefined {
  switch (typeof v) {
    case 'string': return JSON.stringify(v)
    case 'number': return Number.isFinite(v) ? String(v) : 'null'
    case 'boolean': return v ? 'true' : 'false'
    case 'undefined':
    case 'function':
    case 'symbol':
      return inArray ? 'null' : undefined
    case 'bigint':
      throw new TypeError('Do not know how to serialize a BigInt')
  }
  if (v === null) return 'null'
  const o = v as Record<string, unknown> & { toJSON?: () => unknown }
  if (typeof o.toJSON === 'function') return write(o.toJSON(), inArray)
  if (Array.isArray(o)) {
    let s = '['
    for (let i = 0; i < o.length; i++) {
      if (i > 0) s += ','
      s += write(o[i], true)
    }
    return s + ']'
  }
  let s = '{'
  let first = true
  for (const k of keysOf(o)) {
    const x = write(o[k], false)
    if (x === undefined) continue
    if (!first) s += ','
    s += JSON.stringify(k) + ':' + x
    first = false
  }
  return s + '}'
}

const isIndex = (k: string) => {
  const c = k.charCodeAt(0)
  return c >= 48 && c <= 57 && /^(0|[1-9]\d*)$/.test(k) && Number(k) < 4294967295
}

/** Sorted key lists by the keys as they come: the library's thousands of entries share a few shapes. */
const shapes = new Map<string, string[]>()

/**
 * [o]'s keys in the order the old way wrote them: sorted, except that an object lists keys that are
 * array indexes ("2", "10") first, in numeric order, whatever order they were added in.
 */
function keysOf(o: object): string[] {
  const raw = Object.keys(o)
  // A record keyed by card names (a deck's history) isn't a shape worth keeping.
  const shape = raw.length <= 24 ? raw.join('\u0000') : null
  let keys = shape === null ? undefined : shapes.get(shape)
  if (!keys) {
    keys = raw.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (keys.some(isIndex)) keys = [...keys.filter(isIndex).sort((a, b) => Number(a) - Number(b)), ...keys.filter((k) => !isIndex(k))]
    if (shape !== null && shapes.size < 5000) shapes.set(shape, keys)
  }
  return keys
}

/** Whether [a] and [b] are the same as JSON (missing and null alike), comparing plain values without writing them out. */
export function sameJson(a: unknown, b: unknown): boolean {
  const x = plain(a), y = plain(b)
  if (x === y) return true
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false
  return canonicalJson(x) === canonicalJson(y)
}

/** What a value is as JSON, for the plain kinds: undefined, NaN and Infinity are all null. */
const plain = (v: unknown): unknown => (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null : v)

/** The old way, for the tests: JSON.stringify, every object rebuilt with its keys sorted. */
export function canonicalJsonSlow(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

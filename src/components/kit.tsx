// Web versions of the Android app's shared building blocks (ui/common/DesignKit.kt): art with a
// mana-coloured fallback, identity strips, pips, pill chips, a sliding segmented control, count-ups.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { SyncButton } from './SyncButton'

/** Magic's five colours plus colorless, tuned to glow on the dark ground (ManaColors in Color.kt). */
export const MANA: Record<string, string> = {
  W: '#E9DBA6', U: '#4583EE', B: '#8B68C4', R: '#E8583A', G: '#37A96F', C: '#A3ABB9',
}

const WUBRG = ['W', 'U', 'B', 'R', 'G']

export function sortColors(colors: string[]): string[] {
  return [...new Set(colors.map((c) => c.toUpperCase()))].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b))
}

/** Stagger delay for the `.rise` entrance. */
export const rise = (i: number): CSSProperties => ({ ['--i' as string]: i })

/** Scryfall image URL → its art-crop version (the part of the card that's just the illustration). */
export function toArtCrop(url: string | null | undefined): string | null {
  if (!url) return null
  return url.replace('/normal/', '/art_crop/').replace('/large/', '/art_crop/').replace('/small/', '/art_crop/')
}

function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function seeded(seed: number, salt: number): number {
  let x = Math.imul(seed ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function darken(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (v: number, to: number) => Math.round(v * (1 - t) + to * t)
  return `rgb(${mix((n >> 16) & 255, 8)}, ${mix((n >> 8) & 255, 8)}, ${mix(n & 255, 11)})`
}

/**
 * Soft mana-coloured light blooms over a dark wash — behind every art image, so a card whose image
 * hasn't loaded (or can't) still gets a distinct, on-theme placeholder. Mirrors fallbackArt().
 */
export function fallbackArt(seed: string, colors: string[] = []): string {
  const h = hashString(seed)
  const codes = colors.length > 0 ? colors : [WUBRG[h % 5], WUBRG[Math.floor(h / 7) % 5]]
  const palette = codes.map((c) => MANA[c.toUpperCase()] ?? MANA.C)
  const layers: string[] = []
  for (let i = 0; i < 4; i++) {
    const c = palette[i % palette.length]
    const x = Math.round(seeded(h, i * 2 + 1) * 100)
    const y = Math.round(seeded(h, i * 2 + 2) * 100)
    const r = Math.round(35 + seeded(h, i + 11) * 45)
    layers.push(`radial-gradient(circle at ${x}% ${y}%, ${rgba(c, 0.85)} 0%, ${rgba(c, 0)} ${r}%)`)
  }
  layers.unshift('linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.45))')
  layers.push(`linear-gradient(135deg, ${darken(palette[0], 0.55)}, ${darken(palette[1 % palette.length], 0.8)})`)
  return layers.join(', ')
}

/** An art image with [fallbackArt] underneath, so it never shows as an empty box. */
export function ArtImage({
  src, seed, colors = [], className = '', style, alt = '',
}: { src: string | null | undefined; seed: string; colors?: string[]; className?: string; style?: CSSProperties; alt?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <div className={`art ${className}`} style={{ background: fallbackArt(seed, colors), ...style }}>
      {src && !failed && <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />}
    </div>
  )
}

/** A thin glowing bar in a deck's colour identity. */
export function IdentityStrip({ colors, className = '', style }: { colors: string[]; className?: string; style?: CSSProperties }) {
  const cs = (colors.length > 0 ? colors : ['C']).map((c) => MANA[c] ?? MANA.C)
  const background = cs.length === 1 ? cs[0] : `linear-gradient(90deg, ${cs.join(', ')})`
  return <div className={`strip ${className}`} style={{ background, ...style }} />
}

/** Colour-identity pips drawn locally, letters in the numbers face. */
export function ManaPips({ colors, size = 16 }: { colors: string[]; size?: number }) {
  return (
    <span className="pips">
      {(colors.length > 0 ? colors : ['C']).map((c) => (
        <i
          key={c}
          className={`pip${c === 'U' || c === 'B' ? ' dk' : ''}`}
          style={{ ['--c' as string]: MANA[c] ?? MANA.C, width: size, height: size, fontSize: size * 0.68 }}
        >
          {c}
        </i>
      ))}
    </span>
  )
}

export function PillChip({
  label, selected, onClick, count, icon, className = '',
}: { label: string; selected?: boolean; onClick?: () => void; count?: number; icon?: string; className?: string }) {
  return (
    <button type="button" className={`chip ${className}`} aria-pressed={!!selected} onClick={onClick}>
      {icon && <Icon name={icon} />}
      {label}
      {count !== undefined && <span className="n">{count}</span>}
    </button>
  )
}

export function SearchPill({
  value, onChange, placeholder, autoFocus,
}: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="searchpill">
      <Icon name="search" style={{ fontSize: 20 }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      {value && (
        <button type="button" className="clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="close" />
        </button>
      )}
    </label>
  )
}

/** A pill-shaped tab control whose highlight slides (with a little spring) to the selected tab. */
export function SegmentedTabs({
  labels, selected, onSelect, counts = {}, className = '',
}: { labels: string[]; selected: number; onSelect: (i: number) => void; counts?: Record<number, number>; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const container = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[selected]
      if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth })
    }
    measure()
    // Tabs stretch with the window, so re-measure when the control resizes.
    const observer = new ResizeObserver(measure)
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [selected, labels.join('|'), JSON.stringify(counts)]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={container} className={`seg ${className}`} role="tablist">
      {ind && <span className="seg-ind" style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} />}
      {labels.map((label, i) => (
        <button
          key={label}
          ref={(el) => { refs.current[i] = el }}
          type="button"
          role="tab"
          aria-selected={i === selected}
          onClick={() => onSelect(i)}
        >
          {label}
          {counts[i] ? <span className="count">{counts[i]}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** A number that counts up from zero on first show, then eases between later values. */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('en-US') }: { value: number; format?: (v: number) => string }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      from.current = value
      return
    }
    const start = performance.now()
    const begin = from.current
    const duration = begin === 0 ? 900 : 500
    let frame = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(begin + (value - begin) * eased)
      if (p < 1) frame = requestAnimationFrame(step)
      else from.current = value
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{format(shown)}</>
}

export function StatFigure({
  value, label, onClick, format, style,
}: { value: number | null; label: string; onClick?: () => void; format?: (v: number) => string; style?: CSSProperties }) {
  return (
    <button type="button" className="stat press" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', ...style }}>
      <span className="num">{value === null ? <span style={{ color: 'var(--t2)' }}>—</span> : <CountUp value={value} format={format} />}</span>
      <span className="lbl">{label}</span>
    </button>
  )
}

export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: CSSProperties }) {
  return (
    <div className="sec-h" style={style}>
      <h2>{title}</h2>
      {action && onAction && <button type="button" className="link" onClick={onAction}>{action}</button>}
    </div>
  )
}

export function IconButton({
  icon, label, onClick, variant = '', className = '',
}: { icon: string; label: string; onClick?: () => void; variant?: '' | 'glass' | 'gold'; className?: string }) {
  return (
    <button type="button" className={`ib ${variant} ${className}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  )
}

/** Big page title for the top-level tabs (Decks, Collection, Search). */
export function PageHeader({ title, eyebrow, actions }: { title: string; eyebrow?: string; actions?: ReactNode }) {
  // Phones have no sidebar, so the sync button rides in each page's header.
  const phone = useLayoutSize() === 'phone'
  return (
    <header className="page-h rise" style={rise(0)}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {(actions || phone) && <div className="acts">{actions}{phone && <SyncButton />}</div>}
    </header>
  )
}

/** Back button that returns to where the user came from, or [fallback] on a direct visit. */
export function useBack(fallback: string) {
  const navigate = useNavigate()
  return () => {
    if (window.history.state && typeof window.history.state.idx === 'number' && window.history.state.idx > 0) navigate(-1)
    else navigate(fallback)
  }
}

/** 0 at the top of the page, 1 once scrolled [distance] px — drives collapsing headers. */
export function useScrollProgress(distance: number): number {
  const [p, setP] = useState(() => Math.min(1, window.scrollY / distance))
  useEffect(() => {
    const onScroll = () => setP(Math.min(1, Math.max(0, window.scrollY / distance)))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [distance])
  return p
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land']

/** "Creature" from "Legendary Artifact Creature — Necron", checked in the Android app's priority order. */
export function primaryTypeOf(typeLine: string | null | undefined): string {
  const line = (typeLine ?? '').toLowerCase()
  const front = line.split('//')[0]
  return TYPE_ORDER.find((t) => front.includes(t.toLowerCase())) ?? 'Other'
}

export const TYPE_GROUPS = [...TYPE_ORDER, 'Other']

export const TYPE_PLURALS: Record<string, string> = {
  Creature: 'Creatures', Planeswalker: 'Planeswalkers', Battle: 'Battles', Instant: 'Instants', Sorcery: 'Sorceries',
  Artifact: 'Artifacts', Enchantment: 'Enchantments', Land: 'Lands', Other: 'Other',
}

export type LayoutSize = 'phone' | 'tablet' | 'desktop'

const TABLET_MIN = 700
const DESKTOP_MIN = 1100

function currentLayout(): LayoutSize {
  if (window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`).matches) return 'desktop'
  if (window.matchMedia(`(min-width: ${TABLET_MIN}px)`).matches) return 'tablet'
  return 'phone'
}

/**
 * Which layout the window is wide enough for — phone (bottom bar), tablet (navigation rail) or
 * desktop (sidebar). Updates live as the window is resized. The same widths drive the CSS media
 * queries in theme.css.
 */
export function useLayoutSize(): LayoutSize {
  const [size, setSize] = useState<LayoutSize>(currentLayout)
  useEffect(() => {
    const queries = [TABLET_MIN, DESKTOP_MIN].map((w) => window.matchMedia(`(min-width: ${w}px)`))
    const update = () => setSize(currentLayout())
    queries.forEach((q) => q.addEventListener('change', update))
    return () => queries.forEach((q) => q.removeEventListener('change', update))
  }, [])
  return size
}

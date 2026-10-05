// Appearance and card display settings — the web's half of the Android app's Settings → Appearance
// and Card Display (data/SettingsRepository.kt, ui/theme/Color.kt): the same choices, defaults and
// palettes. Kept in this browser's storage; pure, so the tests run without a page.

/** Overall light/dark of the app. SYSTEM follows the device's own dark-mode setting. */
export type AppBrightness = 'DARK' | 'LIGHT' | 'SYSTEM'
/** Accent colour, themed on Magic's five colours of mana. */
export type AccentTheme = 'GOLD' | 'SAPPHIRE' | 'AMETHYST' | 'RUBY' | 'EMERALD'
/** How a screen lays out its cards: a detailed row, or a compact grid of card art. */
export type CardViewMode = 'list' | 'grid'
/** The screens with a list/grid choice on the web. */
export type CardViewSurface = 'binder' | 'deck' | 'allCards'

export const BRIGHTNESS_DEFAULT: AppBrightness = 'DARK'
export const ACCENT_DEFAULT: AccentTheme = 'GOLD'
export const ACCENT_THEMES: { id: AccentTheme; label: string }[] = [
  { id: 'GOLD', label: 'Gold' },
  { id: 'SAPPHIRE', label: 'Sapphire' },
  { id: 'AMETHYST', label: 'Amethyst' },
  { id: 'RUBY', label: 'Ruby' },
  { id: 'EMERALD', label: 'Emerald' },
]
/**
 * Valid range for the shared grid column count, and its default. Three across until someone asks
 * for more: at four, a phone's cards were too small to read.
 */
export const GRID_COLUMNS_MIN = 3
export const GRID_COLUMNS_MAX = 10
export const GRID_COLUMNS_DEFAULT = 3

export const KEYS = {
  brightness: 'mtgweb_app_brightness',
  accent: 'mtgweb_accent_theme',
  gridColumns: 'mtgweb_grid_columns',
  // The list/grid toggles already kept their last choice under these; they stay the same keys, so
  // nothing to migrate and the toggle and Settings change one value.
  view: {
    allCards: 'mtgweb_all_cards_view',
    deck: 'mtgweb_deck_cards_view',
    binder: 'mtgweb_binder_cards_view',
  } satisfies Record<CardViewSurface, string>,
}

export interface Appearance {
  brightness: AppBrightness
  accent: AccentTheme
}

type Read = (key: string) => string | null

export function parseBrightness(v: string | null): AppBrightness {
  return v === 'DARK' || v === 'LIGHT' || v === 'SYSTEM' ? v : BRIGHTNESS_DEFAULT
}

export function parseAccent(v: string | null): AccentTheme {
  return ACCENT_THEMES.some((a) => a.id === v) ? (v as AccentTheme) : ACCENT_DEFAULT
}

export function parseViewMode(v: string | null): CardViewMode {
  // Upper case too, as the Android app writes them.
  return v?.toLowerCase() === 'grid' ? 'grid' : 'list'
}

export function parseGridColumns(v: string | null): number {
  const n = Math.round(Number(v))
  if (v == null || v === '' || !Number.isFinite(n)) return GRID_COLUMNS_DEFAULT
  return Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, n))
}

export function readAppearance(read: Read): Appearance {
  return { brightness: parseBrightness(read(KEYS.brightness)), accent: parseAccent(read(KEYS.accent)) }
}

/** Whether the app draws dark: SYSTEM asks the device. */
export function isDark(brightness: AppBrightness, systemDark: boolean): boolean {
  return brightness === 'SYSTEM' ? systemDark : brightness === 'DARK'
}

interface Hues { base: string; light: string; dim: string; lightModeBase: string }

// One hue per accent theme, mapped to Magic's colours of mana (Color.kt accentHues).
const HUES: Record<AccentTheme, Hues> = {
  // Gold's and Emerald's light hues are a step darker than the app's first ones, for 4.5:1 on the
  // light theme's raised grey (--g2) too (tests/a11y/contrast.test.ts).
  GOLD: { base: '#e6b45e', light: '#f2cb86', dim: '#8e6a2c', lightModeBase: '#8a5e18' },
  SAPPHIRE: { base: '#5b9bf0', light: '#86b8f6', dim: '#2f5c99', lightModeBase: '#2563c9' },
  AMETHYST: { base: '#a77be6', light: '#c3a2f0', dim: '#5f3e91', lightModeBase: '#7b45c4' },
  RUBY: { base: '#ee6a7c', light: '#f594a1', dim: '#8e2e3c', lightModeBase: '#c0304a' },
  EMERALD: { base: '#52c788', light: '#83dba9', dim: '#2b7a4f', lightModeBase: '#1a7348' },
}

/** The accent's base hue, whatever the brightness — for the swatches in Settings. */
export function accentPreview(accent: AccentTheme): string {
  return HUES[accent].base
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Relative luminance, as Compose's Color.luminance() and WCAG work it out. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(', ')}, ${a})`

/** Dark ink for a fill. */
export const DARK_INK = '#1c1405'

/**
 * Text on a solid accent fill: dark ink or white, whichever reads better. In the dark every accent
 * takes dark ink — white on Sapphire was 2.8:1 — and in the light every one takes white.
 */
export function inkFor(fill: string): string {
  return contrast(DARK_INK, fill) >= contrast('#ffffff', fill) ? DARK_INK : '#ffffff'
}

/**
 * The --gold family for an accent: in the dark the bright hue with dark or white ink on it; in the
 * light a darker hue, so it keeps its contrast on white, with white ink.
 */
export function accentVars(accent: AccentTheme, dark: boolean): Record<string, string> {
  const h = HUES[accent]
  if (dark) {
    return {
      '--gold': h.base,
      '--gold-light': h.light,
      '--gold-dim': h.dim,
      '--gold-soft': alpha(h.base, 0.16),
      '--gold-ink': inkFor(h.base),
      '--gold-art': h.base,
    }
  }
  return {
    '--gold': h.lightModeBase,
    '--gold-light': h.lightModeBase,
    '--gold-dim': h.dim,
    '--gold-soft': alpha(h.lightModeBase, 0.12),
    '--gold-ink': inkFor(h.lightModeBase),
    // On a dark scrim over card art the bright hue still reads best.
    '--gold-art': h.base,
  }
}

/** The light ground the browser's bar takes (meta theme-color). */
export const THEME_COLOR = { dark: '#0c0d11', light: '#f4f4f7' }

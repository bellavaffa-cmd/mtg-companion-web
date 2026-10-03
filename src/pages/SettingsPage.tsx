import { Link, Navigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { PricesPanel } from '../components/PricesPanel'
import { rise, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { currencyOf, useCurrencySetting } from '../money/currency'
import { cardViewMode, useAppearance, useCardViewMode } from '../settings/settings'
import {
  ACCENT_THEMES, accentPreview, GRID_COLUMNS_MAX, GRID_COLUMNS_MIN,
  type AppBrightness, type CardViewSurface,
} from '../settings/appearance'

/** The surfaces Card Display sets, with their names there. */
const VIEW_SURFACES: { surface: CardViewSurface; label: string }[] = [
  { surface: 'binder', label: 'Binder cards' },
  { surface: 'deck', label: 'Deck cards' },
  { surface: 'allCards', label: 'All Cards' },
]

/**
 * Settings' sections, in the Android app's order and words (its SettingsSection). Account & sync
 * has a page of its own here; the app's Offline Search, Card Recognition and App Updates have no
 * web counterpart.
 */
const SECTIONS = [
  { id: 'account', title: 'Account & sync', icon: 'person', to: '/account' },
  { id: 'appearance', title: 'Appearance', icon: 'dark_mode', to: '/settings/appearance' },
  { id: 'card-display', title: 'Card Display', icon: 'grid_view', to: '/settings/card-display' },
  { id: 'prices', title: 'Prices', icon: 'sell', to: '/settings/prices' },
] as const

/**
 * Settings: one row per section — its icon, its name and a line on how it's set now — each opening
 * the section on a page of its own, as on the phone.
 */
export function SettingsPage() {
  const back = useBack('/')
  const { accountsAvailable, account } = useSync()
  const { brightness, accent } = useAppearance()
  const { chosen } = useCurrencySetting()

  const summaryOf = (id: (typeof SECTIONS)[number]['id']): string => {
    switch (id) {
      case 'account':
        return !accountsAvailable
          ? "Accounts aren't set up in this build"
          : account ? `Signed in as ${account.email}` : 'Not signed in — sign in to sync decks and binders'
      case 'appearance': {
        const mode = brightness === 'DARK' ? 'Dark' : brightness === 'LIGHT' ? 'Light' : 'Follows the system'
        return `${mode} · ${ACCENT_THEMES.find((t) => t.id === accent)?.label ?? accent}`
      }
      case 'card-display': {
        const grids = VIEW_SURFACES.filter((v) => cardViewMode(v.surface) === 'grid').length
        return grids === 0 ? 'Every tab shows a list' : grids === VIEW_SURFACES.length ? 'Every tab shows a grid' : `${grids} of ${VIEW_SURFACES.length} tabs show a grid`
      }
      case 'prices': {
        const c = currencyOf(chosen)
        return `${c.name} (${c.code})`
      }
    }
  }

  return (
    <>
      <TopBar title="Settings" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <div className="narrow-width settings-list">
          {SECTIONS.map((section) => (
            <Link key={section.id} to={section.to} className="settings-section press">
              <span className="ss-ic"><Icon name={section.icon} /></span>
              <span className="ss-t">
                {section.title}
                <small>{summaryOf(section.id)}</small>
              </span>
              <Icon name="chevron_right" className="ss-go" />
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}

/** One settings section on a page of its own, opened from [SettingsPage]'s list. */
export function SettingsSectionPage() {
  const { section } = useParams<{ section: string }>()
  const back = useBack('/settings')
  const found = SECTIONS.find((s) => s.id === section && s.to === `/settings/${s.id}`)
  if (!found) return <Navigate to="/settings" replace />
  return (
    <>
      <TopBar title={found.title} onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <div className="narrow-width settings">
          {found.id === 'appearance' && <AppearanceSection />}
          {found.id === 'card-display' && <CardDisplaySection />}
          {found.id === 'prices' && <PricesPanel heading={false} />}
        </div>
      </div>
    </>
  )
}

function AppearanceSection() {
  const { brightness, accent, setBrightness, setAccent } = useAppearance()
  const modes: { id: AppBrightness; label: string }[] = [
    { id: 'DARK', label: 'Dark' }, { id: 'LIGHT', label: 'Light' }, { id: 'SYSTEM', label: 'System' },
  ]
  return (
    <section className="panel">
      <p className="dim settings-note">Choose a brightness mode and an accent color, themed on Magic's five colors of mana.</p>
      <div className="settings-row">
        <span className="grow">Brightness</span>
        <div className="chips" role="radiogroup" aria-label="Brightness">
          {modes.map((m) => (
            <button key={m.id} type="button" className="chip" role="radio" aria-checked={brightness === m.id} aria-pressed={brightness === m.id} onClick={() => setBrightness(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-label">Accent color</div>
      <div className="accent-swatches" role="radiogroup" aria-label="Accent color">
        {ACCENT_THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={accent === t.id} className="accent-swatch" onClick={() => setAccent(t.id)}>
            <span className="dot" style={{ background: accentPreview(t.id) }} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function CardDisplaySection() {
  const { gridColumns, setGridColumns } = useAppearance()
  return (
    <section className="panel">
      <p className="dim settings-note">Choose list (detailed rows) or grid (compact card art) for each tab.</p>
      {VIEW_SURFACES.map((v) => <ViewModeRow key={v.surface} label={v.label} surface={v.surface} />)}
      <div className="settings-divider" />
      <div className="settings-row">
        <span className="grow">Grid tile size</span>
        <span className="settings-value">{gridColumns} columns</span>
      </div>
      <div className="grid-preview" style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }} aria-hidden>
        {Array.from({ length: gridColumns }, (_, i) => <span key={i}><Icon name="style" /></span>)}
      </div>
      <input
        type="range"
        className="settings-slider"
        min={GRID_COLUMNS_MIN}
        max={GRID_COLUMNS_MAX}
        step={1}
        value={gridColumns}
        aria-label="Grid tile size, in columns"
        onChange={(e) => setGridColumns(Number(e.target.value))}
      />
      <p className="dim settings-note">A phone's width of columns — a wider screen fits more.</p>
    </section>
  )
}

function ViewModeRow({ label, surface }: { label: string; surface: CardViewSurface }) {
  const [mode, setMode] = useCardViewMode(surface)
  return (
    <div className="settings-row">
      <span className="grow">{label}</span>
      <div className="chips" role="radiogroup" aria-label={label}>
        <button type="button" className="chip" role="radio" aria-checked={mode === 'list'} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
          <Icon name="view_list" />List
        </button>
        <button type="button" className="chip" role="radio" aria-checked={mode === 'grid'} aria-pressed={mode === 'grid'} onClick={() => setMode('grid')}>
          <Icon name="grid_view" />Grid
        </button>
      </div>
    </div>
  )
}

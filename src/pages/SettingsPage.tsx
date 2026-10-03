import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { rise, useBack } from '../components/kit'
import { useAppearance, useCardViewMode } from '../settings/settings'
import {
  ACCENT_THEMES, accentPreview, GRID_COLUMNS_MAX, GRID_COLUMNS_MIN,
  type AppBrightness, type CardViewSurface,
} from '../settings/appearance'

/**
 * Settings — the Android app's Settings → Appearance and Card Display. Account & sync and prices
 * have their own page here, linked from the top.
 */
export function SettingsPage() {
  const back = useBack('/')
  return (
    <>
      <TopBar title="Settings" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <div className="narrow-width settings">
          <Link to="/account" className="banner press" style={{ textDecoration: 'none', marginBottom: 16 }}>
            <Icon name="account_circle" />
            <span style={{ flex: 1 }}>Account &amp; sync, and the currency prices show in</span>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </Link>
          <AppearanceSection />
          <CardDisplaySection />
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
      <div className="p-h"><h3>Appearance</h3></div>
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
      <div className="p-h"><h3>Card Display</h3></div>
      <p className="dim settings-note">Choose list (detailed rows) or grid (compact card art) for each tab.</p>
      <ViewModeRow label="Binder cards" surface="binder" />
      <ViewModeRow label="Deck cards" surface="deck" />
      <ViewModeRow label="All Cards" surface="allCards" />
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

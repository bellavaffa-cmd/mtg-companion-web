import { useEffect } from 'react'
import { Icon } from './Icon'
import { ArtImage, toArtCrop } from './kit'

export interface SheetAction {
  label: string
  icon: string
  /** A short second line under the label. */
  detail?: string
  tone?: 'gold' | 'danger'
  onClick: () => void
}

interface Props {
  title?: string
  subtitle?: string
  /** Card image; shown as its art crop beside the title. */
  imageUrl?: string | null
  actions: SheetAction[]
  onClose: () => void
}

/** Bottom action sheet — the Android app's CardActionMenu (a ModalBottomSheet), replacing popup menus. */
export function ActionSheet({ title, subtitle, imageUrl, actions, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title ?? 'Actions'}>
        <div className="grab" />
        {title && (
          <div className={`sheet-head${imageUrl === undefined ? ' no-art' : ''}`}>
            {imageUrl !== undefined && <ArtImage src={toArtCrop(imageUrl)} seed={title} />}
            <div style={{ minWidth: 0 }}>
              <div className="sheet-title">{title}</div>
              {subtitle && <div className="sheet-sub">{subtitle}</div>}
            </div>
          </div>
        )}
        <div className="sheet-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                onClose()
                action.onClick()
              }}
            >
              <span className={`sa-ic ${action.tone ?? ''}`}><Icon name={action.icon} /></span>
              <span className={`sa-t ${action.tone === 'danger' ? 'danger' : ''}`}>
                {action.label}
                {action.detail && <small>{action.detail}</small>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

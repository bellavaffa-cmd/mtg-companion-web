import { Fragment, useRef } from 'react'
import { Icon } from './Icon'
import { ArtImage, toArtCrop } from './kit'
import { useModalFocus } from './useModalFocus'

export interface SheetAction {
  label: string
  icon: string
  /** A short second line under the label. */
  detail?: string
  tone?: 'gold' | 'danger'
  /**
   * A heading over a group: consecutive actions with the same section sit under one small heading
   * of that name. An action without one after a group (Remove, say) gets a little air instead.
   */
  section?: string
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
  const box = useRef<HTMLDivElement>(null)
  const keepFocusIn = useModalFocus(box, onClose)

  return (
    <>
      <div className="scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div ref={box} className="sheet" role="dialog" aria-modal="true" aria-label={title ?? 'Actions'} onKeyDown={keepFocusIn}>
        <div className="grab" />
        {title && (
          <div className={`sheet-head${imageUrl === undefined ? ' no-art' : ''}`}>
            {imageUrl !== undefined && <ArtImage src={toArtCrop(imageUrl)} seed={title} />}
            <div style={{ minWidth: 0 }}>
              <h2 className="sheet-title">{title}</h2>
              {subtitle && <div className="sheet-sub">{subtitle}</div>}
            </div>
          </div>
        )}
        <div className="sheet-actions">
          {actions.map((action, i) => {
            const before = i > 0 ? actions[i - 1].section : undefined
            const heading = action.section && action.section !== before ? action.section : null
            const gap = !action.section && before
            return (
              <Fragment key={action.label}>
                {heading && <div className={`sa-section${i === 0 ? ' first' : ''}`}>{heading}</div>}
                {gap && <div className="sa-gap" aria-hidden />}
                <button
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
              </Fragment>
            )
          })}
        </div>
      </div>
    </>
  )
}

import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  imageUrl: string | null
  name: string
  priceUsd?: string | null
  onClose: () => void
  children?: ReactNode
}

/** Enlarged card view, mirroring the Android app's CardZoomDialog. [children] holds any extra
 * controls (quantity steppers, etc.) — callers pass live state so it stays in sync as they edit. */
export function CardZoomModal({ imageUrl, name, priceUsd, onClose, children }: Props) {
  return (
    <div className="zoom-overlay" onClick={onClose}>
      <button className="zoom-close" onClick={onClose} aria-label="Close">
        <Icon name="close" />
      </button>
      <div className="zoom-content" onClick={(e) => e.stopPropagation()}>
        {imageUrl && <img src={imageUrl} alt={name} />}
        <div className="zoom-name">{name}</div>
        {priceUsd && <div className="zoom-price">${priceUsd}</div>}
        {children}
      </div>
    </div>
  )
}

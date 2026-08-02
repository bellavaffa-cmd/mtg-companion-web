import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  title: string
  onBack?: () => void
  actions?: ReactNode
}

/** Mirrors the Android app's per-screen Scaffold TopAppBar: title, optional back arrow, actions. */
export function TopBar({ title, onBack, actions }: Props) {
  return (
    <div className="top-bar">
      {onBack && (
        <button className="top-bar-icon" onClick={onBack} aria-label="Back">
          <Icon name="arrow_back" />
        </button>
      )}
      <div className="top-bar-title">{title}</div>
      {actions}
    </div>
  )
}

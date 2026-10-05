import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import './emptyState.css'

/** One of an empty state's buttons: a route to open, or something to do. */
export interface EmptyAction {
  label: string
  icon?: string
  /** A route to open… */
  to?: string
  /** …or something to do. */
  onClick?: () => void
}

/**
 * What a list says when there's nothing in it yet: an icon, one plain sentence, and a button or two
 * for the obvious next step ("No decks yet" → Paste a list · Browse precons). The first action is
 * the main one. Every empty list in the app uses this, so they all look and read alike. Mirrors the
 * Android app's ui/common/EmptyPrompt.kt.
 */
export function EmptyState({ icon, text, actions = [], className = '', style }: {
  icon: string
  text: ReactNode
  actions?: EmptyAction[]
  className?: string
  style?: CSSProperties
}) {
  const navigate = useNavigate()
  return (
    <div className={`empty-state ${className}`.trim()} style={style}>
      <Icon name={icon} />
      <div className="empty-text">{text}</div>
      {actions.length > 0 && (
        <div className="empty-actions">
          {actions.slice(0, 2).map((a, i) => (
            <button
              key={a.label}
              type="button"
              className={`btn ${i === 0 ? 'gold' : 'line'}`}
              onClick={() => (a.onClick ? a.onClick() : a.to ? navigate(a.to) : undefined)}
            >
              {a.icon && <Icon name={a.icon} />}{a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

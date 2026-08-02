import type { ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
  onDismiss: () => void
  actions?: ReactNode
}

/** Mirrors the Android app's AlertDialog styling. */
export function Dialog({ title, children, onDismiss, actions }: Props) {
  return (
    <div className="dialog-overlay" onClick={onDismiss}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div>{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  )
}

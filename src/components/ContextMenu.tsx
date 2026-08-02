import { Icon } from './Icon'

export interface MenuAction {
  label: string
  icon: string
  destructive?: boolean
  onClick: () => void
}

interface Props {
  x: number
  y: number
  actions: MenuAction[]
  onClose: () => void
}

/** Anchored quick-action menu, mirroring the Android app's long-press CardActionMenu. */
export function ContextMenu({ x, y, actions, onClose }: Props) {
  const clampedX = Math.min(x, window.innerWidth - 220)
  const clampedY = Math.min(y, window.innerHeight - actions.length * 42 - 20)

  return (
    <>
      <div
        className="context-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div className="context-menu" style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}>
        {actions.map((action) => (
          <div
            key={action.label}
            className={`context-menu-item${action.destructive ? ' destructive' : ''}`}
            onClick={() => {
              onClose()
              action.onClick()
            }}
          >
            <Icon name={action.icon} className="icon" />
            <span>{action.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}

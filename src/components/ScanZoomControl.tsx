// The zoom chip over a scanner's preview (see useScanZoom.ts): − 1.8× +, the 1.8× going back to the
// default, and a hint past the lens switch. Nothing at all for a camera that can't zoom.

import { Icon } from './Icon'
import type { ScanZoom } from './useScanZoom'
import { canStepZoom, zoomLabel } from '../scan/scanZoom'

/** The chip over the preview: − 1.8× +, and the hint past the lens switch. Nothing without zoom. */
export function ScanZoomControl({ zoom }: { zoom: ScanZoom }) {
  const { range } = zoom
  if (!range) return null
  const label = zoomLabel(zoom.zoom)
  return (
    <div className="scan-zoom" role="group" aria-label="Zoom">
      {zoom.hint && <div className="scan-zoom-hint" role="status">{zoom.hint}</div>}
      <div className="scan-zoom-bar">
        <button type="button" className="scan-zoom-btn" aria-label="Zoom out" disabled={!canStepZoom(zoom.zoom, -1, range)} onClick={() => zoom.step(-1)}>
          <Icon name="remove" aria-hidden />
        </button>
        <button
          type="button"
          className="scan-zoom-chip"
          aria-label={`Zoom ${label} — reset to ${zoomLabel(zoom.defaultZoom)}`}
          title={`Tap to go back to ${zoomLabel(zoom.defaultZoom)}`}
          onClick={zoom.reset}
        >
          <span aria-hidden>{label}</span>
        </button>
        <button type="button" className="scan-zoom-btn" aria-label="Zoom in" disabled={!canStepZoom(zoom.zoom, 1, range)} onClick={() => zoom.step(1)}>
          <Icon name="add" aria-hidden />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">Zoom {label}</span>
    </div>
  )
}

// The zoom chip over a scanner's preview (see useScanZoom.ts): − 1.8× +, the 1.8× going back to the
// default, and a hint past the lens switch. Nothing at all for a camera that can't zoom.

import { Icon } from './Icon'
import type { ScanZoom } from './useScanZoom'
import { canStepZoom, zoomLabel, zoomSpoken } from '../scan/scanZoom'

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
          className={zoom.auto ? 'scan-zoom-chip auto' : 'scan-zoom-chip'}
          aria-label={`${zoomSpoken(zoom.zoom)}${zoom.auto ? ', auto' : ''} — reset to ${zoomLabel(zoom.defaultZoom)}${zoom.autoEnabled ? ' with auto zoom' : ''}`}
          title={zoom.auto
            ? 'Auto zoom: follows the card. − or + (or a pinch) takes over by hand.'
            : `Tap to go back to ${zoomLabel(zoom.defaultZoom)}${zoom.autoEnabled ? ' with auto zoom' : ''}`}
          onClick={zoom.reset}
        >
          <span aria-hidden>{label}</span>
          {zoom.auto && <span className="scan-zoom-auto" aria-hidden>Auto</span>}
        </button>
        <button type="button" className="scan-zoom-btn" aria-label="Zoom in" disabled={!canStepZoom(zoom.zoom, 1, range)} onClick={() => zoom.step(1)}>
          <Icon name="add" aria-hidden />
        </button>
      </div>
      {/* Auto zoom moves often: said once as it starts, not at every nudge. */}
      <span className="sr-only" aria-live="polite">{zoom.auto ? 'Auto zoom' : zoomSpoken(zoom.zoom)}</span>
    </div>
  )
}

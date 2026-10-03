// The phone's light, for scanning in a dim room — the Android scanner's "Turn on the light". Only a
// camera that says it has one (getCapabilities().torch) gets the button; most laptops and iPhones
// in Safari don't, and then there's no button at all.

/** Whether a camera track's capabilities include a light that can be switched. */
export function hasTorch(capabilities: unknown): boolean {
  return !!capabilities && typeof capabilities === 'object' && (capabilities as { torch?: unknown }).torch === true
}

/** The constraints that switch it — torch is real but still outside the DOM types, hence the cast. */
export function torchConstraints(on: boolean): MediaTrackConstraints {
  return { advanced: [{ torch: on }] } as unknown as MediaTrackConstraints
}

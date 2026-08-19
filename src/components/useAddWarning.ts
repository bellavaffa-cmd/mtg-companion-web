import { useEffect, useState } from 'react'

/** A brief, auto-dismissing warning message — e.g. "you'll have 2 copies in a singleton format." */
export function useAddWarning() {
  const [warning, setWarning] = useState<string | null>(null)
  useEffect(() => {
    if (!warning) return
    const t = setTimeout(() => setWarning(null), 4000)
    return () => clearTimeout(t)
  }, [warning])
  return [warning, setWarning] as const
}

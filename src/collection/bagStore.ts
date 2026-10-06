// The bags being packed (eventBag.ts), kept in this browser only: a bag is for one trip and its ticks
// aren't worth syncing — the phone keeps its own (EventBagStore.kt). The newest MAX_BAGS are kept.

import { useEffect, useState } from 'react'
import { MAX_BAGS, type PackingBag } from './eventBag'

const KEY = 'mtgweb_packing_bags'
const listeners = new Set<() => void>()
let bags: PackingBag[] = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as PackingBag[]
    return Array.isArray(raw) ? raw.filter((b) => b && typeof b.id === 'string') : []
  } catch { return [] }
})()

function setBags(next: PackingBag[]) {
  bags = [...next].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_BAGS)
  try { localStorage.setItem(KEY, JSON.stringify(bags)) } catch { /* this visit only */ }
  listeners.forEach((l) => l())
}

export const saveBag = (bag: PackingBag) => setBags(bags.some((b) => b.id === bag.id) ? bags.map((b) => (b.id === bag.id ? bag : b)) : [...bags, bag])
export const deleteBag = (id: string) => setBags(bags.filter((b) => b.id !== id))

/** The bags on this device, newest first. */
export function useBags(): PackingBag[] {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return bags
}

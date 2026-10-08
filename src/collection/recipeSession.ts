// Sorting with a recipe (sortRecipes.ts): the sort under way, kept in this browser so closing the tab
// or restarting the phone doesn't lose it, how it's heard (say the pile out loud, capture without
// tapping) and the recipe used last. The Android app keeps the same on the phone (RecipeSessionStore.kt).

import { sortRecipe, type RecipeScan, type SortRecipe } from './sortRecipes'

/** A card the scanner saw but couldn't read: what it made of it. */
export interface RecipeMiss { at: number; seen: string }

/** Checking one pile by scanning it again: the names that belonged, and the cards that didn't. */
export interface PileChecking { pile: number; checked: string[]; flagged: { name: string; line: string }[] }

export interface RecipeSessionState {
  recipe: SortRecipe
  scans: RecipeScan[]
  misses: RecipeMiss[]
  startedAt: number
  checking?: PileChecking | null
}

export interface RecipeVoice { speak: boolean; auto: boolean }

const SESSION_KEY = 'mtgweb_recipe_session'
const VOICE_KEY = 'mtgweb_recipe_voice'
const LAST_KEY = 'mtgweb_recipe_last'

export function loadRecipeSession(): RecipeSessionState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as RecipeSessionState | null
    if (!raw || !raw.recipe || !Array.isArray(raw.scans)) return null
    return { ...raw, recipe: sortRecipe(raw.recipe), misses: Array.isArray(raw.misses) ? raw.misses : [] }
  } catch {
    return null
  }
}

export function saveRecipeSession(session: RecipeSessionState | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* this visit only */ }
}

/** A new sort with [recipe]. */
export const startRecipeSession = (recipe: SortRecipe, now = Date.now()): RecipeSessionState => ({ recipe: sortRecipe(recipe), scans: [], misses: [], startedAt: now })

export function loadVoice(): RecipeVoice {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_KEY) ?? 'null') as Partial<RecipeVoice> | null
    return { speak: raw?.speak ?? true, auto: raw?.auto ?? true }
  } catch {
    return { speak: true, auto: true }
  }
}

export function saveVoice(voice: RecipeVoice) {
  try { localStorage.setItem(VOICE_KEY, JSON.stringify(voice)) } catch { /* this visit only */ }
}

export function lastRecipeId(): string | null {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

export function setLastRecipeId(id: string) {
  try { localStorage.setItem(LAST_KEY, id) } catch { /* this visit only */ }
}

/** Says [text] out loud, cutting off whatever was being said ("Seven, blue"). */
export function sayOutLoud(text: string) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return
  try {
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.1
    synth.speak(u)
  } catch { /* no voice here */ }
}

/** Prints [html] (a whole page) from a frame of its own, so only it prints. */
export function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) { frame.remove(); return }
  doc.open()
  doc.write(html)
  doc.close()
  const go = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  if (doc.readyState === 'complete') setTimeout(go, 100)
  else frame.addEventListener('load', go, { once: true })
}

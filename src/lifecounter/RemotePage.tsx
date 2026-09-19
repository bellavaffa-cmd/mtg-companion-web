import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { accessToken } from '../sync/supabaseAuth'
import { watchMatch } from '../sync/realtime'
import * as api from '../social/api'
import { useOverview } from '../social/SocialContext'
import { GiphyPicker } from '../social/GiphyPicker'
import { autocomplete, getByExactName } from '../api/scryfall'
import { displayImageUrl } from '../types/scryfall'
import { toArtCrop } from '../components/kit'
import type { Deck } from '../types/models'
import { COUNTER_INFO, COUNTER_KINDS } from './game'
import { useStepper } from './PlayerTile'
import { useWakeLock } from './wakeLock'
import { HEARTBEAT_MS, REMOTE_VERSION, type RemoteAction, type RemoteCounter, type RemoteSeat, type RemoteState } from './remote'
import '../social/social.css'
import './remote.css'

/** No word from the table for this long (it publishes at least every HEARTBEAT_MS): it's gone. */
const SILENT_MS = HEARTBEAT_MS * 2 + 10_000
const FEEDBACK_HOLD_MS = 1500

type Sheet = null | 'damage' | 'counters' | 'background' | 'more' | 'deck' | 'show' | 'notes'
type BackgroundKind = 'commander' | 'profile' | 'colour' | 'custom'

/** What the player chose for their tile last time, so the next table starts with it. */
interface RemotePrefs { background: BackgroundKind; customUrl: string | null; deckId: string | null }
const PREFS_KEY = 'mtgweb_remote_prefs'
const LOGGED_KEY = 'mtgweb_remote_logged'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode: not remembered */ }
}
const hasSavedPrefs = () => {
  try { return localStorage.getItem(PREFS_KEY) !== null } catch { return false }
}
function readText(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

const commanderArt = (deck: Deck | undefined | null) => toArtCrop(deck?.commander?.imageUrl ?? null)

/**
 * A player's phone as the remote for their seat at someone's life counter (opened after joining a
 * seat by QR code): their life, counters and commander damage, whose turn it is, and everyone's
 * life. Every change is a request the table applies — the table's game is the one truth.
 */
export function RemotePage() {
  const { matchId = '', seat = '' } = useParams<{ matchId: string; seat: string }>()
  const seatNo = Number(seat)
  const navigate = useNavigate()
  const { account, decks, addGameResult } = useSync()
  const { overview } = useOverview()
  const me = overview?.me ?? null
  useWakeLock()

  const [state, setState] = useState<RemoteState | null>(null)
  const [live, setLive] = useState(false)
  const [heardAt, setHeardAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [big, setBig] = useState(false)
  const [prefs, setPrefsState] = useState<RemotePrefs>(() => readJson(PREFS_KEY, { background: 'colour', customUrl: null, deckId: null }))
  const setPrefs = (next: RemotePrefs) => { setPrefsState(next); writeJson(PREFS_KEY, next) }
  const deck = decks.find((d) => d.id === prefs.deckId) ?? null

  useEffect(() => {
    document.title = 'Remote · MTG Companion'
    return () => { document.title = 'MTG Companion' }
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(t)
  }, [])

  const send = useCallback((action: RemoteAction) => {
    setError(null)
    api.sendMatchAction(matchId, action).catch((e: unknown) => {
      if (e instanceof api.SocialError && e.code === 'not_seated') setGone(true)
      else setError(e instanceof Error ? e.message : 'Something went wrong.')
    })
  }, [matchId])

  useEffect(() => {
    if (!account || !matchId) return
    return watchMatch(
      matchId,
      accessToken,
      (event, payload) => {
        if (event !== 'state') return
        const next = (payload as { state?: RemoteState } | null)?.state
        if (!next || next.v !== REMOTE_VERSION || !Array.isArray(next.players)) return
        setState(next)
        setHeardAt(Date.now())
      },
      () => send({ type: 'hello' }),
      setLive,
    )
  }, [account, matchId, send])

  const mine = state?.players.find((p) => p.seat === seatNo) ?? null
  const others = state?.players.filter((p) => p.seat !== seatNo) ?? []

  // The tile picture this player chose, as a URL (null: the seat's colour).
  const preferredUrl = useMemo(() => {
    switch (prefs.background) {
      case 'commander': return commanderArt(deck)
      case 'profile': return api.avatarUrl(me?.avatar_path)
      case 'custom': return prefs.customUrl
      default: return null
    }
  }, [prefs, deck, me?.avatar_path])

  // Sitting down at a new table: the tile starts bare, so put on it the picture and deck this player
  // chose last time — never over one that's already there (set from here, or from another phone).
  const applied = useRef(false)
  useEffect(() => {
    if (!mine || !state?.remotes || applied.current) return
    applied.current = true
    if (mine.background || mine.deck || !hasSavedPrefs()) return
    if (preferredUrl || deck) send({ type: 'background', url: preferredUrl, deck: deck?.name ?? null })
  }, [mine, state?.remotes, preferredUrl, deck, send])

  const chooseBackground = (kind: BackgroundKind, customUrl: string | null = prefs.customUrl, deckId = prefs.deckId) => {
    const next = { background: kind, customUrl, deckId }
    setPrefs(next)
    const d = decks.find((x) => x.id === deckId) ?? null
    const url = kind === 'commander' ? commanderArt(d) : kind === 'profile' ? api.avatarUrl(me?.avatar_path) : kind === 'custom' ? customUrl : null
    send({ type: 'background', url, deck: d?.name ?? null })
  }
  const chooseDeck = (d: Deck) => {
    const kind = prefs.background === 'colour' && commanderArt(d) ? 'commander' : prefs.background
    chooseBackground(kind, prefs.customUrl, d.id)
    setSheet(null)
  }

  const silent = !!state && now - heardAt > SILENT_MS

  let body: ReactNode
  if (!account) {
    body = <Notice icon="login" title="Sign in to use your remote" action={<button type="button" className="rm-btn" onClick={() => navigate('/account')}>Sign in</button>} />
  } else if (gone) {
    body = <Notice icon="event_seat" title="You've left this table" text="The seat was freed, or the table ended." action={<button type="button" className="rm-btn" onClick={() => navigate('/')}>Done</button>} />
  } else if (!state || !mine) {
    body = <Notice icon="sync" title={live ? 'Waiting for the table…' : 'Connecting to the table…'} text="Keep the life counter open on the table's phone." />
  } else if (mine.userId && account.userId !== mine.userId) {
    body = <Notice icon="event_seat" title={`Someone else is in seat ${seatNo} now`} action={<button type="button" className="rm-btn" onClick={() => navigate('/')}>Done</button>} />
  } else if (!state.remotes) {
    body = <Notice icon="mobile_off" title="Remotes are off" text="The table's owner is keeping this game on the table's phone." />
  } else {
    body = (
      <Remote
        state={state}
        mine={mine}
        others={others}
        big={big}
        deck={deck}
        send={send}
        sheet={sheet}
        setSheet={setSheet}
      />
    )
  }

  return (
    <div className="rm-root">
      <header className="rm-head">
        <span className={`rm-dot${live && !silent ? ' on' : ''}`} aria-hidden />
        <span className="rm-where">
          Seat {seatNo}{state?.turn ? ` · turn ${state.turn.number}` : ''}
          {(!live || silent) && state && <b> · {silent ? 'table disconnected' : 'reconnecting…'}</b>}
        </span>
        {state && mine && state.remotes && (
          <button type="button" className="rm-chip" onClick={() => setBig((b) => !b)} aria-pressed={big}>
            <span className="material-symbols-rounded" aria-hidden>{big ? 'close_fullscreen' : 'open_in_full'}</span>{big ? 'Exit big' : 'Big'}
          </button>
        )}
        <button type="button" className="rm-chip" onClick={() => setSheet('more')} aria-label="More">
          <span className="material-symbols-rounded" aria-hidden>more_horiz</span>
        </button>
      </header>
      {error && <div className="rm-error" role="alert">{error}</div>}
      {body}

      {sheet === 'background' && mine && (
        <BackgroundSheet
          current={mine.background}
          prefs={prefs}
          deck={deck}
          avatar={api.avatarUrl(me?.avatar_path)}
          userId={account?.userId ?? null}
          onPick={(kind, url) => { chooseBackground(kind, url ?? prefs.customUrl); setSheet(null) }}
          onPickDeck={() => setSheet('deck')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'deck' && (
        <RmSheet title="Your deck" onClose={() => setSheet(null)}>
          {decks.length === 0 && <p className="rm-muted">You have no decks yet.</p>}
          <div className="rm-list">
            {decks.map((d) => (
              <button key={d.id} type="button" className={`rm-opt${d.id === prefs.deckId ? ' on' : ''}`} onClick={() => chooseDeck(d)}>
                <span className="rm-swatch" style={commanderArt(d) ? { backgroundImage: `url("${commanderArt(d)}")` } : undefined} />
                <span className="rm-opt-text"><b>{d.name}</b><span>{d.commander?.name ?? 'No commander'}</span></span>
              </button>
            ))}
          </div>
          {prefs.deckId && (
            <button type="button" className="rm-btn line" onClick={() => { chooseBackground(prefs.background === 'commander' ? 'colour' : prefs.background, prefs.customUrl, null); setSheet(null) }}>
              Not playing one of my decks
            </button>
          )}
        </RmSheet>
      )}
      {sheet === 'more' && (
        <RmSheet title="More" onClose={() => setSheet(null)}>
          <div className="rm-list">
            <button type="button" className="rm-opt" onClick={() => setSheet('deck')}>
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>style</span>
              <span className="rm-opt-text"><b>Deck</b><span>{deck?.name ?? 'Pick the deck you’re playing'}</span></span>
            </button>
            {state?.remotes && mine && (
              <button type="button" className="rm-opt" onClick={() => setSheet('show')}>
                <span className="material-symbols-rounded rm-opt-icon" aria-hidden>visibility</span>
                <span className="rm-opt-text"><b>Show a card on the table</b><span>Everyone sees it big until they tap it away</span></span>
              </button>
            )}
            <button type="button" className="rm-opt" onClick={() => setSheet('notes')}>
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>lock</span>
              <span className="rm-opt-text"><b>Notes</b><span>Only you see these</span></span>
            </button>
            <button
              type="button"
              className="rm-opt"
              onClick={() => {
                void api.clearMatchSeat(matchId, seatNo).catch(() => {})
                navigate('/')
              }}
            >
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>logout</span>
              <span className="rm-opt-text"><b>Leave this seat</b><span>Your name comes off the table</span></span>
            </button>
          </div>
        </RmSheet>
      )}
      {sheet === 'show' && <ShowCardSheet onShow={(name, imageUrl) => { send({ type: 'showCard', name, imageUrl }); setSheet(null) }} onClose={() => setSheet(null)} />}
      {sheet === 'notes' && <NotesSheet matchId={matchId} onClose={() => setSheet(null)} />}

      {state?.over && mine && (
        <GameOver
          key={state.gameId}
          matchId={matchId}
          state={state}
          seat={seatNo}
          deck={deck}
          log={(result, opponent) => { if (deck) addGameResult(deck.id, { id: crypto.randomUUID(), result, opponent, playedAt: Date.now() }) }}
          onPickDeck={() => setSheet('deck')}
        />
      )}
    </div>
  )
}

function Notice({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rm-notice">
      <span className="material-symbols-rounded" aria-hidden>{icon}</span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

function seatStyle(p: RemoteSeat): CSSProperties {
  if (p.background) {
    return { backgroundColor: p.color, backgroundImage: `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.5)), url("${p.background.replace(/"/g, '%22')}")`, color: '#fff' }
  }
  return { backgroundColor: p.color, color: p.ink }
}

const damageFrom = (to: RemoteSeat, from: number, slot: number) =>
  to.commanderDamage.find((d) => d.from === from && d.slot === slot)?.amount ?? 0

/** The remote proper: this seat's life and buttons, everyone else's life, and the sheets. */
function Remote({
  state, mine, others, big, deck, send, sheet, setSheet,
}: {
  state: RemoteState
  mine: RemoteSeat
  others: RemoteSeat[]
  big: boolean
  deck: Deck | null
  send: (a: RemoteAction) => void
  sheet: Sheet
  setSheet: (s: Sheet) => void
}) {
  const [tally, setTally] = useState(0)
  const [taps, setTaps] = useState(0)
  useEffect(() => {
    if (tally === 0) return
    const t = window.setTimeout(() => setTally(0), FEEDBACK_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [tally, taps])
  const change = (delta: number) => {
    send({ type: 'life', delta })
    setTaps((n) => n + 1)
    setTally((p) => ((p > 0) === (delta > 0) || p === 0 ? p + delta : delta))
    navigator.vibrate?.(8)
  }
  const minus = useStepper((n) => change(-n), state.longPress, true)
  const plus = useStepper((n) => change(n), state.longPress, true)
  const myTurn = state.turn?.seat === mine.seat
  const worst = Math.max(0, ...mine.commanderDamage.map((d) => d.amount))
  const alert = mine.out ? null
    : mine.poison >= 8 ? `Poison ${mine.poison} — ${10 - mine.poison} more and you're out`
    : worst >= 18 ? `Commander damage ${worst} — ${21 - worst} more and you're out`
    : null
  const showing = state.shownCard?.seat === mine.seat ? state.shownCard : null
  const tallyText = tally === 0 ? null : `${tally > 0 ? '+' : '−'}${Math.abs(tally)}`

  const lifeButtons = (
    <div className="rm-pm">
      <button type="button" className="rm-circle" aria-label={`Lose life (hold for ${state.longPress})`} {...minus}>−</button>
      {!big && (
        <button type="button" className="rm-circle sm" onClick={() => send({ type: 'undo' })} disabled={!mine.canUndo} aria-label="Undo my last change">
          <span className="material-symbols-rounded" aria-hidden>undo</span>
        </button>
      )}
      {!big && myTurn && !mine.out && (
        <button type="button" className="rm-circle sm turn" onClick={() => send({ type: 'endTurn' })} aria-label="End turn">
          <span className="material-symbols-rounded" aria-hidden>check</span>
        </button>
      )}
      <button type="button" className="rm-circle" aria-label={`Gain life (hold for ${state.longPress})`} {...plus}>+</button>
    </div>
  )

  if (big) {
    return (
      <div className="rm-me big" style={seatStyle(mine)}>
        <div className="rm-life">{mine.life}</div>
        <div className="rm-tally" aria-live="polite">{tallyText}</div>
        {lifeButtons}
      </div>
    )
  }

  return (
    <div className="rm-main">
      <div className={`rm-me${mine.out ? ' out' : ''}${myTurn ? ' turn' : ''}`} style={seatStyle(mine)}>
        <div className="rm-me-name">{mine.name}{deck ? ` · ${deck.name}` : ''}</div>
        <div className="rm-life">{mine.life}</div>
        <div className="rm-tally" aria-live="polite">{tallyText ?? (mine.out ? 'Out of the game' : myTurn ? 'Your turn' : '')}</div>
        {lifeButtons}
      </div>
      {alert && <div className="rm-alert" role="status"><span className="material-symbols-rounded" aria-hidden>warning</span>{alert}</div>}
      {showing && (
        <div className="rm-showing">
          <span>Showing <b>{showing.name}</b> on the table</span>
          <button type="button" className="rm-chip" onClick={() => send({ type: 'hideCard' })}>Hide</button>
        </div>
      )}

      <div className="rm-label">Everyone</div>
      <div className="rm-others">
        {others.map((o) => (
          <div key={o.seat} className={`rm-other${o.out ? ' out' : ''}${state.turn?.seat === o.seat ? ' turn' : ''}`} style={seatStyle(o)}>
            <span className="rm-other-name">{o.name}</span>
            <b>{o.life}</b>
            {o.poison > 0 && <span className="rm-other-sub">☠ {o.poison}</span>}
          </div>
        ))}
      </div>

      <div className="rm-bar">
        <button type="button" onClick={() => setSheet('damage')}><span className="material-symbols-rounded" aria-hidden>swords</span>Damage</button>
        <button type="button" onClick={() => setSheet('counters')}><span className="material-symbols-rounded" aria-hidden>water_drop</span>Counters</button>
        <button type="button" onClick={() => setSheet('background')}><span className="material-symbols-rounded" aria-hidden>image</span>Background</button>
        <button type="button" onClick={() => setSheet('more')}><span className="material-symbols-rounded" aria-hidden>more_horiz</span>More</button>
      </div>

      {sheet === 'damage' && (
        <RmSheet title="Commander damage" onClose={() => setSheet(null)}>
          <div className="rm-label">You dealt</div>
          {others.flatMap((o) => (mine.partner ? [0, 1] : [0]).map((slot) => (
            <Stepper
              key={`d${o.seat}-${slot}`}
              label={`${o.name}${mine.partner ? (slot === 0 ? ' · commander' : ' · partner') : ''}`}
              color={o.color}
              value={damageFrom(o, mine.seat, slot)}
              onChange={(delta) => send({ type: 'dealtDamage', to: o.seat, slot, delta })}
            />
          )))}
          <div className="rm-label">You took</div>
          {others.flatMap((o) => (o.partner ? [0, 1] : [0]).map((slot) => (
            <Stepper
              key={`r${o.seat}-${slot}`}
              label={`${o.name}${o.partner ? (slot === 0 ? ' · commander' : ' · partner') : ''}`}
              color={o.color}
              value={damageFrom(mine, o.seat, slot)}
              onChange={(delta) => send({ type: 'commanderDamage', from: o.seat, slot, delta })}
            />
          )))}
        </RmSheet>
      )}
      {sheet === 'counters' && (
        <RmSheet title="Counters" onClose={() => setSheet(null)}>
          {(['poison', ...COUNTER_KINDS] as RemoteCounter[]).map((k) => (
            <Stepper
              key={k}
              label={k === 'poison' ? 'Poison' : COUNTER_INFO[k].label}
              icon={k === 'poison' ? 'water_drop' : COUNTER_INFO[k].icon}
              value={k === 'poison' ? mine.poison : mine.counters[k] ?? 0}
              onChange={(delta) => send({ type: 'counter', counter: k, delta })}
            />
          ))}
          <p className="rm-muted">Storm goes back to 0 when the turn passes.</p>
        </RmSheet>
      )}
    </div>
  )
}

function Stepper({ label, value, color, icon, onChange }: { label: string; value: number; color?: string; icon?: string; onChange: (d: number) => void }) {
  return (
    <div className="rm-stepper">
      {color && <i style={{ background: color }} aria-hidden />}
      {icon && <span className="material-symbols-rounded" aria-hidden>{icon}</span>}
      <span className="rm-stepper-label">{label}</span>
      <button type="button" onClick={() => onChange(-1)} aria-label={`${label} minus one`}>−</button>
      <b>{value}</b>
      <button type="button" onClick={() => onChange(1)} aria-label={`${label} plus one`}>+</button>
    </div>
  )
}

function RmSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <button type="button" className="rm-scrim" aria-label="Close" onClick={onClose} />
      <div className="rm-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="rm-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="rm-chip" onClick={onClose}>Done</button>
        </div>
        <div className="rm-sheet-body">{children}</div>
      </div>
    </>
  )
}

/** Tile background: the commander of the deck being played, the profile picture, the seat colour, or a GIF / photo. */
function BackgroundSheet({
  current, prefs, deck, avatar, userId, onPick, onPickDeck, onClose,
}: {
  /** What's on the tile now. */
  current: string | null
  prefs: RemotePrefs
  deck: Deck | null
  avatar: string | null
  userId: string | null
  onPick: (kind: BackgroundKind, url?: string) => void
  onPickDeck: () => void
  onClose: () => void
}) {
  const [giphy, setGiphy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const art = commanderArt(deck)
  const currentKind: BackgroundKind = !current ? 'colour' : current === art ? 'commander' : current === avatar ? 'profile' : 'custom'
  const custom = currentKind === 'custom' ? current : prefs.customUrl
  const upload = async (f: File) => {
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      const path = await api.uploadAvatar(userId, f)
      const url = api.avatarUrl(path)
      if (url) onPick('custom', url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The picture didn’t upload.')
    } finally {
      setBusy(false)
    }
  }
  const opt = (kind: BackgroundKind, title: string, sub: string, swatch: CSSProperties, onClick: () => void, disabled = false) => (
    <button type="button" className={`rm-opt${currentKind === kind ? ' on' : ''}`} onClick={onClick} disabled={disabled || busy}>
      <span className="rm-swatch" style={swatch} />
      <span className="rm-opt-text"><b>{title}</b><span>{sub}</span></span>
    </button>
  )
  return (
    <>
      <RmSheet title="Tile background" onClose={onClose}>
        <div className="rm-list">
          {opt('commander', 'Commander art', deck ? (deck.commander ? `${deck.commander.name}, from ${deck.name}` : `${deck.name} has no commander`) : 'Pick the deck you’re playing',
            art ? { backgroundImage: `url("${art}")` } : {}, () => (art ? onPick('commander') : onPickDeck()))}
          {opt('profile', 'Profile picture', avatar ? 'Your photo or GIF' : 'You have no profile picture', avatar ? { backgroundImage: `url("${avatar}")` } : {}, () => onPick('profile'), !avatar)}
          {opt('colour', 'Seat colour', 'Plain colour', { background: 'linear-gradient(135deg, #ff005f, #ffc600)' }, () => onPick('colour'))}
          {opt('custom', 'A GIF or a photo', busy ? 'Uploading…' : 'Search Giphy, or pick from your phone',
            custom ? { backgroundImage: `url("${custom}")` } : { background: '#2bd98f' }, () => (custom ? onPick('custom', custom) : setGiphy(true)))}
        </div>
        <div className="rm-row">
          <button type="button" className="rm-btn line" onClick={() => setGiphy(true)} disabled={busy}>Search Giphy</button>
          <button type="button" className="rm-btn line" onClick={() => file.current?.click()} disabled={busy}>Pick a photo</button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
        {error && <p className="rm-error" role="alert">{error}</p>}
      </RmSheet>
      {giphy && <GiphyPicker onPicked={(f) => { setGiphy(false); void upload(f) }} onClose={() => setGiphy(false)} />}
    </>
  )
}

/** Search a card by name and show it big on the table. */
function ShowCardSheet({ onShow, onClose }: { onShow: (name: string, imageUrl: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setNames([]); return }
    let cancelled = false
    const t = window.setTimeout(() => {
      autocomplete(q).then((r) => { if (!cancelled) setNames(r.slice(0, 12)) }, () => {})
    }, 250)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query])
  const pick = async (name: string) => {
    setBusy(name)
    setError(null)
    try {
      const card = await getByExactName(name)
      const url = displayImageUrl(card)
      if (url) onShow(card.name, url)
      else setError('That card has no picture.')
    } catch {
      setError('Couldn’t find that card — check your connection.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <RmSheet title="Show a card on the table" onClose={onClose}>
      <input className="rm-input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Card name" aria-label="Card name" />
      <div className="rm-list">
        {names.map((n) => (
          <button key={n} type="button" className="rm-opt" onClick={() => void pick(n)} disabled={busy !== null}>
            <span className="rm-opt-text"><b>{n}</b>{busy === n && <span>Loading…</span>}</span>
          </button>
        ))}
      </div>
      {error && <p className="rm-error" role="alert">{error}</p>}
    </RmSheet>
  )
}

/** A scratch pad for this table only, kept on this phone. */
function NotesSheet({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const key = `mtgweb_remote_notes:${matchId}`
  const [text, setText] = useState(() => readText(key))
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(key, text) } catch { /* not kept */ } }, 300)
    return () => window.clearTimeout(t)
  }, [key, text])
  return (
    <RmSheet title="Notes" onClose={onClose}>
      <p className="rm-muted"><span className="material-symbols-rounded" aria-hidden>lock</span> Only you see these, on this phone.</p>
      <textarea className="rm-input rm-notes" value={text} onChange={(e) => setText(e.target.value)} placeholder="Opponent has 3 cards in hand, Rhystic paid…" aria-label="Notes" />
    </RmSheet>
  )
}

/** The result, once the table has one winner (or nobody left) — and the game logged to the chosen deck, once. */
function GameOver({
  matchId, state, seat, deck, log, onPickDeck,
}: {
  matchId: string
  state: RemoteState
  seat: number
  deck: Deck | null
  log: (result: 'WIN' | 'LOSS', opponent: string | null) => void
  onPickDeck: () => void
}) {
  const [closed, setClosed] = useState(false)
  const over = state.over!
  const logKey = `${matchId}:${state.gameId}`
  const [logged, setLogged] = useState(() => readJson<{ keys: string[] }>(LOGGED_KEY, { keys: [] }).keys.includes(logKey))
  useEffect(() => {
    if (logged || !deck) return
    // What's saved is the record: this runs again when the page reopens (or twice, in development).
    const keys = readJson<{ keys: string[] }>(LOGGED_KEY, { keys: [] }).keys
    if (!keys.includes(logKey)) {
      writeJson(LOGGED_KEY, { keys: [...keys, logKey].slice(-100) })
      const opponents = state.players.filter((p) => p.seat !== seat).map((p) => p.name).join(', ')
      log(over.winner === seat ? 'WIN' : 'LOSS', opponents || null)
    }
    setLogged(true)
  }, [logged, deck, state.players, seat, over.winner, logKey, log])
  if (closed) return null
  const winner = state.players.find((p) => p.seat === over.winner)
  const standings = [...state.players].sort((a, b) => Number(a.seat !== over.winner) - Number(b.seat !== over.winner) || Number(!!a.out) - Number(!!b.out) || b.life - a.life)
  const record = deck ? `${deck.gameResults.filter((g) => g.result === 'WIN').length}–${deck.gameResults.filter((g) => g.result === 'LOSS').length}` : ''
  return (
    <div className="rm-over" role="dialog" aria-modal="true" aria-label="Game over">
      <p className="rm-muted">Game over · {over.minutes} min · {over.turns} {over.turns === 1 ? 'turn' : 'turns'}</p>
      <h2>{winner ? (winner.seat === seat ? 'You win!' : `${winner.name} wins`) : 'Nobody is left standing'}</h2>
      <div className="rm-list">
        {standings.map((p, i) => (
          <div key={p.seat} className="rm-stand">
            <i style={{ background: p.color }} aria-hidden />
            <span>{i + 1}. {p.name}{p.seat === seat ? ' (you)' : ''}</span>
            <b>{p.life}</b>
          </div>
        ))}
      </div>
      {deck ? (
        <div className="rm-saved"><span className="material-symbols-rounded" aria-hidden>bar_chart</span>Saved to {deck.name} · now {record}</div>
      ) : (
        <button type="button" className="rm-btn line" onClick={onPickDeck}>Pick your deck to save this result</button>
      )}
      <button type="button" className="rm-btn" onClick={() => setClosed(true)}>Done</button>
    </div>
  )
}

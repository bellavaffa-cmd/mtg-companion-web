import { useEffect, useRef, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import * as api from './api'
import { useSocial } from './SocialContext'
import { Avatar } from './ui'
import { fetchGiphyGif, GIPHY_SITE } from './giphy'

const USERNAME = /^[a-z0-9_]{3,20}$/

/** A username from an email, as a starting suggestion: "Jane.Doe+mtg@…" → "janedoe". */
function suggestUsername(email: string): string {
  return email.split('@')[0].toLowerCase().replace(/\+.*$/, '').replace(/[^a-z0-9_]/g, '').slice(0, 20)
}

/**
 * Makes or edits the user's profile: a unique username (how friends find them), the name shown to
 * others, and a picture — a photo, or a GIF that keeps moving on the life counter.
 */
export function ProfileEditor({ onDone }: { onDone?: () => void }) {
  const { account } = useSync()
  const { overview, refresh } = useSocial()
  const me = overview?.me ?? null
  const [username, setUsername] = useState(me?.username ?? suggestUsername(account?.email ?? ''))
  const [name, setName] = useState(me?.display_name ?? '')
  const [picture, setPicture] = useState<File | null>(null)
  const [removePicture, setRemovePicture] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [giphyOpen, setGiphyOpen] = useState(false)
  const [giphyLink, setGiphyLink] = useState('')
  const [giphyBusy, setGiphyBusy] = useState(false)

  const cleanUsername = username.trim().toLowerCase()
  useEffect(() => {
    setAvailable(null)
    if (!USERNAME.test(cleanUsername) || cleanUsername === me?.username) return
    const t = window.setTimeout(() => {
      api.usernameAvailable(cleanUsername).then(setAvailable).catch(() => {})
    }, 400)
    return () => window.clearTimeout(t)
  }, [cleanUsername, me?.username])

  useEffect(() => {
    if (!picture) { setPreview(null); return }
    const url = URL.createObjectURL(picture)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [picture])

  if (!account) return null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const old = me?.avatar_path ?? null
      let path: string | null | undefined
      if (picture) path = await api.uploadAvatar(account.userId, picture)
      else if (removePicture) path = null
      await api.saveProfile(cleanUsername, name.trim(), path)
      if (path !== undefined && old) void api.deleteAvatar(old)
      await refresh()
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const shown = preview
    ? null
    : removePicture ? { display_name: name || cleanUsername || '?', avatar_path: null } : { display_name: name || cleanUsername || '?', avatar_path: me?.avatar_path ?? null }
  const usernameProblem = cleanUsername && !USERNAME.test(cleanUsername)
    ? '3–20 letters, numbers or _'
    : available === false ? 'Taken — try another' : null

  return (
    <div className="profile-editor">
      <div className="profile-pic-row">
        {preview ? <img className="avatar avatar-img" src={preview} alt="" style={{ width: 88, height: 88 }} /> : <Avatar profile={shown} size={88} />}
        <div className="profile-pic-actions">
          <button type="button" className="btn line sm" onClick={() => fileInput.current?.click()}>
            <Icon name="add_photo_alternate" aria-hidden />{me?.avatar_path || picture ? 'Change picture' : 'Add a picture'}
          </button>
          <button type="button" className="btn line sm" onClick={() => setGiphyOpen((o) => !o)} aria-expanded={giphyOpen}>
            <Icon name="gif_box" aria-hidden />GIF from Giphy
          </button>
          {(picture || (me?.avatar_path && !removePicture)) && (
            <button type="button" className="btn-link" onClick={() => { setPicture(null); setRemovePicture(true) }}>Remove picture</button>
          )}
          <div className="dim" style={{ fontSize: 12 }}>A photo, or a GIF (up to 2 MB) — it plays on the life counter too.</div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            if (file.type === 'image/gif' && file.size > 2 * 1024 * 1024) { setError('That GIF is over 2 MB — pick a smaller one.'); return }
            setError(null)
            setPicture(file)
            setRemovePicture(false)
          }}
        />
      </div>

      {giphyOpen && (
        <div className="giphy-box">
          <label className="field-label" htmlFor="giphy-link" style={{ marginTop: 0 }}>Paste a Giphy link</label>
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={async (e) => {
              e.preventDefault()
              if (!giphyLink.trim() || giphyBusy) return
              setGiphyBusy(true)
              setError(null)
              try {
                setPicture(await fetchGiphyGif(giphyLink))
                setRemovePicture(false)
                setGiphyOpen(false)
                setGiphyLink('')
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Something went wrong.')
              } finally {
                setGiphyBusy(false)
              }
            }}
          >
            <input
              id="giphy-link"
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              value={giphyLink}
              onChange={(e) => setGiphyLink(e.target.value)}
              placeholder="https://giphy.com/gifs/…"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit" className="btn gold" disabled={giphyBusy || !giphyLink.trim()}>{giphyBusy ? 'Getting it…' : 'Use'}</button>
          </form>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            Find one on <a href={GIPHY_SITE} target="_blank" rel="noreferrer">giphy.com</a>, open it, and copy its address (or Share → Copy link). Powered by GIPHY.
          </div>
        </div>
      )}

      <label className="field-label" htmlFor="profile-name">Your name</label>
      <input id="profile-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="How friends see you" />

      <label className="field-label" htmlFor="profile-username" style={{ marginTop: 14 }}>Username</label>
      <div className="input-prefix">
        <span aria-hidden>@</span>
        <input
          id="profile-username"
          className="input"
          value={username}
          maxLength={20}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
        />
      </div>
      <div className={`dim${usernameProblem ? ' field-error' : ''}`} style={{ fontSize: 12, marginTop: 6 }}>
        {usernameProblem ?? (available ? 'Available' : 'Friends add you by this name.')}
      </div>

      {error && <div className="notice warn" style={{ marginTop: 12 }}>{error}</div>}

      <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        {onDone && me && <button type="button" className="btn line" onClick={onDone} disabled={busy}>Cancel</button>}
        <button
          type="button"
          className="btn gold"
          disabled={busy || !name.trim() || !USERNAME.test(cleanUsername) || available === false}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : me ? 'Save profile' : 'Create profile'}
        </button>
      </div>
    </div>
  )
}

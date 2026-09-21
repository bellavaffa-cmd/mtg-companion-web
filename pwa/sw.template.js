// MTG Companion's service worker: the app's own files are kept on the device, so the installed app
// (or the page) opens without a connection and works with the decks already in this browser.
// vite.config.ts writes this out as sw.js at build time, filling in the build's file list; each new
// build gets a new cache and drops the old one.
//
// Only this app's own files and its fonts are cached. Scryfall, Supabase and everything else always
// go to the network — sync and card data are never served stale from here.

const VERSION = '__VERSION__'
const APP_CACHE = `mtg-companion-${VERSION}`
const FONT_CACHE = 'mtg-companion-fonts'
// The scanner's card recognition: the card index, its model and their runtime (~40 MB between them, ~30 MB over the wire),
// fetched the first time the scanner wants them and kept across app updates.
const CARD_CACHE = 'mtg-companion-cards'
const FILES = __FILES__
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('mtg-companion-') && ![APP_CACHE, FONT_CACHE, CARD_CACHE].includes(key)).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Fonts (the icons are a font too): kept once fetched, so the app still looks right offline.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) => cache.match(request).then((hit) => hit ?? fetch(request).then((response) => {
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone())
        return response
      }))),
    )
    return
  }

  const scope = new URL(self.registration.scope)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return

  // The card index and its model: the kept copy straight away, and a fresh one fetched behind it for
  // next time — a rebuilt index (new sets) goes up under the same name.
  if (url.pathname.startsWith(new URL('card-index/', scope).pathname)) {
    event.respondWith(
      caches.open(CARD_CACHE).then((cache) => cache.match(request).then((hit) => {
        const fresh = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        if (hit) {
          event.waitUntil(fresh.catch(() => undefined))
          return hit
        }
        return fresh
      })),
    )
    return
  }

  // The recognizer's runtime: its name carries a content hash, so a kept copy is never out of date.
  if (url.pathname.endsWith('.wasm')) {
    event.respondWith(
      caches.open(CARD_CACHE).then((cache) => cache.match(request).then((hit) => hit ?? fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone())
        return response
      }))),
    )
    return
  }

  // Pages: the network first, so an update shows straight away; offline, the cached app, which
  // works out the page from the address itself.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('./', scope).href, { cacheName: APP_CACHE, ignoreVary: true })),
    )
    return
  }

  // The app's files carry a content hash in their names, so a cached copy is never out of date.
  // ignoreVary: the page asks for its script with an Origin header the stored copy was fetched
  // without, and a server that answers "Vary: Origin" would otherwise make that a miss.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((hit) => hit ?? fetch(request)))
})

// ---- Notifications (friend requests and trades), sent by the push Edge Function ----

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'MTG Companion', body: event.data ? event.data.text() : '' }
  }
  const scope = self.registration.scope
  event.waitUntil(
    self.registration.showNotification(data.title || 'MTG Companion', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: new URL('icon-192.png', scope).href,
      badge: new URL('icon-192.png', scope).href,
      data: { url: new URL(data.open === 'trades' ? 'trades' : 'friends', scope).href },
    }),
  )
})

// A tap opens the screen it's about: in a tab of the app that's already open if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (open) return open.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : undefined))
      return self.clients.openWindow(url)
    }),
  )
})

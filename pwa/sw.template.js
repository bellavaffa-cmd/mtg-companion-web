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
        keys.filter((key) => key.startsWith('mtg-companion-') && key !== APP_CACHE && key !== FONT_CACHE).map((key) => caches.delete(key)),
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

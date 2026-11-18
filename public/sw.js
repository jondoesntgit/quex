/* Quex service worker: keeps the game playable with no connection.
 * - Pages: network first, falling back to the cached copy when offline.
 * - Built files (/assets/*, hashed names), tile art, icons, fonts: cache first.
 * - Everything else (Supabase API, realtime) goes straight to the network.
 * Bump VERSION to drop old caches. */
const VERSION = 'quex-v1'
const STATIC = /^\/(assets|art|icons)\/|\.(woff2?|ttf|png|svg|webmanifest)$/

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    // the page itself: fresh when online, cached when not
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(VERSION).then((c) => c.put('/', copy))
        return res
      }).catch(() => caches.match('/').then((r) => r || caches.match(req))),
    )
    return
  }

  if (STATIC.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)) }
        return res
      })),
    )
  }
})

// Service Worker: App + Preiskatalog offline verfügbar (Netzwerk zuerst, sonst Cache)
const CACHE = "ft-local-v2";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/api.js", "js/util.js", "js/state.js", "js/charts.js", "js/sheets.js",
  "js/local/engine.js", "js/local/local.js", "js/views/home.js", "js/views/visits.js", "js/views/stats.js", "js/views/profile.js",
  "js/views/onboarding.js", "js/views/map.js", "js/views/wrapped.js", "js/analytics.js", "data/catalog.json", "icon.svg", "icon-180.png", "icon-192.png",
  "icon-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  const leaflet = url.hostname === "unpkg.com";
  if (!sameOrigin && !leaflet) return; // Kartenkacheln direkt laden
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : undefined))));
});

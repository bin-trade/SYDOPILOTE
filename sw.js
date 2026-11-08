// EXTRACTOR · service worker — l'app complète fonctionne hors connexion.
// Stratégie : on sert le cache immédiatement, et on le rafraîchit en arrière-plan.
// Pour forcer une mise à jour chez tous les utilisateurs, changer CACHE ci-dessous.
const CACHE = "extractor-pwa-3";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./config.js", "./manifest.webmanifest",
  "./js/app.js", "./js/ui.js", "./js/store.js", "./js/verify.js", "./js/scanner.js",
  "./vendor/jsQR.js",
  "./assets/icon-192.png", "./assets/icon-512.png",
  "./assets/fonts/dm-sans-400.woff2", "./assets/fonts/dm-sans-500.woff2",
  "./assets/fonts/dm-sans-600.woff2", "./assets/fonts/dm-sans-700.woff2",
  "./assets/fonts/space-grotesk-600.woff2", "./assets/fonts/space-grotesk-700.woff2"
];

self.addEventListener("install", e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));

self.addEventListener("activate", e =>
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // l'API reste hors cache
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === "navigate" ? "./index.html" : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req).then(res => { if (res && res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
    e.waitUntil(network);
    return cached || (await network) || Response.error();
  })());
});

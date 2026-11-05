// Garde la ludothèque disponible hors ligne une fois ouverte une première fois.
const CACHE = "ludotheque-v1";
const FICHIERS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Répond tout de suite avec la copie locale, et met à jour en arrière-plan si internet est là.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const enCache = await c.match(req, { ignoreSearch: true });
      const reseau = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => enCache);
      return enCache || reseau;
    })
  );
});
